// @ts-nocheck
// H4 case registry: 23 fixtures/loosening pairs, 2 guard fixtures, 8 calibration cases
// (frozen copies of experiments/bend-probes/E/e2-calibration.ts's inputs under ./cases).
//
// `extra` adds code files the fixture implies but does not contain ("completion"):
//   - files named in a fixture's changed-files.txt / repository.txt;
//   - one identity per unit that has no `source` (0.x allows it; 1.0 binds by name over
//     ids(M_h) and raises E-unbound otherwise), with the same text in base and head unless the
//     case is an in-place code edit.
// Synthesised code for every `source ts("path#sym")` binding and every literal .ts
// implementation path is added by build.ts exactly as `shape1 check --synthesize` writes it.
import { join } from "node:path";

export const REPO = "/home/user/shapelang";
export const TRIAL = join(REPO, "experiments/shape-1/trials/H4");

const fx = (n) => ({
  base: join(REPO, "fixtures/loosening", n, "base"),
  head: join(REPO, "fixtures/loosening", n, "head")
});
const fn = (name, tag = "") =>
  `export function ${name}() {\n  return ${JSON.stringify(name + tag)};\n}\n`;

export const LOOSENING = [
  "claim_misdescribes_code",
  "draft_trait_removed",
  "effects_unknown",
  "governed_directory_moved",
  "governed_paths_narrowed",
  "grant_added",
  "guarded_fn_edited_in_place",
  "memory_and_trait_removed",
  "memory_guard_removed",
  "path_rule_narrowed",
  "path_rule_removed",
  "read_only_function_added",
  "relation_left_out",
  "renamed_component",
  "renamed_component_and_narrowed_rule",
  "resource_renamed_trait_dropped",
  "resource_renamed_trait_kept",
  "rule_added",
  "rule_and_trait_removed_together",
  "rule_moved_between_files",
  "rule_removed",
  "trait_removed_from_resource",
  "unused_rule_removed"
];

const autosave = { "src/editor/autosave.ts": fn("mergeAutosaves") };
const listRev = { "src/history/list.ts": fn("listRevisions") };

const EXTRA = {
  governed_paths_narrowed: {
    extra: {
      base: { "src/share/button.ts": fn("shareButton", "@base") },
      head: { "src/share/button.ts": fn("shareButton", "@head") }
    },
    changed: ["src/share/button.ts", "shape/sharing.shape"]
  },
  governed_directory_moved: {
    changed: ["shape/sharing.shape", "src/share/public.ts", "src/sharing/public.ts"]
  },
  guarded_fn_edited_in_place: {
    extra: {
      base: { "src/editor/autosave.ts": fn("mergeAutosaves", "@base") },
      head: { "src/editor/autosave.ts": fn("mergeAutosaves", "@head") }
    }
  },
  memory_and_trait_removed: { extra: { base: autosave, head: autosave } },
  memory_guard_removed: { extra: { base: autosave, head: autosave } },
  rule_removed: { extra: { base: listRev, head: listRev } },
  rule_and_trait_removed_together: { extra: { base: listRev, head: listRev } }
};

const store = (...fns) => ({ "src/audit/store.ts": fns.map((f) => fn(f)).join("\n") });

export const CASES = [
  ...LOOSENING.map((n) => ({ id: n, family: "loosening", ...fx(n), ...EXTRA[n] })),
  ...["policy-removal", "equivalent-relocation"].map((n) => ({
    id: `guard-${n}`,
    family: "guard",
    base: join(REPO, "fixtures/skills/guard", n, "base"),
    head: join(REPO, "fixtures/skills/guard", n, "candidate"),
    flat: true // shape files at the directory top level, not under shape/
  })),
  ...[
    [
      "cal1-removal-destructive",
      { base: store("appendEvent"), head: store("appendEvent", "deleteEvent") }
    ],
    ["cal2-supported-loosening", {}],
    ["cal3-relocated-rule", { base: store("appendEvent"), head: store("appendEvent") }],
    ["cal4-protected-to-appendonly", { base: store("appendEvent"), head: store("appendEvent") }],
    ["cal5-path-weakened", {}],
    ["cal6-vendored-final-removed", { base: store("appendEvent"), head: store("appendEvent") }],
    ["cal7-generic-attestation", {}],
    [
      "cal8-false-completeness",
      {
        base: { "src/exp/exporter.ts": fn("exportSnapshot") },
        head: { "src/exp/exporter.ts": fn("exportSnapshot") }
      }
    ]
  ].map(([n, e]) => ({
    id: n,
    family: "calibration",
    base: join(TRIAL, "cases", n, "base"),
    head: join(TRIAL, "cases", n, "head"),
    extra: e
  }))
];
