// @ts-nocheck
// The (base, head) code pairs H3 measures, per task:
//   mutant    base = reference solution, head = one harness mutant (hidden/<task>/mutants)
//   refactor  base = reference solution, head = one law-preserving refactor (refactors/<task>)
//   feature   base = pre-feature code (g8/<task>/src), head = the reference or an alternative
//             legitimate solution (law-preserving feature change)
//   trap      base = pre-feature code, head = the harness trap (law-breaking feature change)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { BENDEXP, type Code, H3_DIR, TASKS, type Task } from "./lib.ts";

export interface Variant {
  task: string;
  id: string;
  kind: "mutant" | "refactor" | "feature" | "trap";
  base: Code;
  head: Code;
  /** contract laws the harness says the head breaks ([] = none) */
  breaks: string[];
  breaksFeature: boolean | null;
  description: string;
}

const read = (p: string): string => readFileSync(p, "utf8");

export function refCode(T: Task): Code {
  return { [T.module]: read(join(BENDEXP, "hidden", T.id, "ref", "ts", basename(T.module))) };
}

export function preCode(T: Task): Code {
  return { [T.module]: read(join(BENDEXP, "g8", T.id, T.module)) };
}

function mutantTags(
  T: Task
): Map<string, { breaks: string[]; feature: boolean | null; description: string }> {
  const m = JSON.parse(read(join(BENDEXP, "hidden", T.id, "mutants", "manifest.json")));
  const list = Array.isArray(m) ? m : m.mutants;
  const out = new Map();
  for (const e of list) {
    const f = basename(e.file ?? e.path ?? `${e.id}.ts`);
    const laws = (e.breaks_laws ?? e.breaks ?? []).filter((x: string) => /^L\d$/.test(x));
    const feature = e.breaks_feature ?? (e.breaks ? e.breaks.includes("feature") : null);
    out.set(f, { breaks: laws, feature, description: e.description ?? "" });
  }
  return out;
}

/** A refactor is a file (the whole task module) or a directory of src/ files. */
function refactorCode(T: Task, p: string): Code {
  if (!statSync(p).isDirectory()) return { [T.module]: read(p) };
  const code: Code = {};
  for (const f of readdirSync(p).sort()) code[`src/${f}`] = read(join(p, f));
  if (!code[T.module]) throw new Error(`${p}: no ${T.module}`);
  return code;
}

export const REFACTOR_NOTES: Record<string, string> = {
  r01_comments: "comments only",
  r02_format: "layout, quotes and semicolons only",
  r03_reorder: "top-level declarations reordered",
  r04_rename_helpers: "private helpers renamed",
  r04_rename_const: "private constant renamed (data in env)",
  r05_inline_targets: "target helpers inlined into step",
  r05_purge_loop: "purge as a for loop",
  r05_total_reduce: "total as reduce",
  r06_walls_table: "walls as a precomputed Set",
  r06_extract_expired: "expiry predicate extracted",
  r06_fee_constants: "fee literals named as constants",
  r07_arrow_helpers: "helpers as const arrow functions",
  r07_extract_redact: "redaction extracted to a helper",
  r07_transfer_cost: "transfer restructured around a cost variable",
  r08_replay_reduce: "replay as reduce",
  r08_get_expression: "get as one guarded expression",
  r08_delta_map: "transfer applies a delta map",
  r09_split_level: "level moved to src/level.ts behind an isWall wrapper",
  r09_list_slice: "list via slice, append via concat",
  r09_balance_switch: "balance as a switch, total as a sum",
  r10_step_table: "step dispatches through a table of arrow functions",
  r10_append_fields: "append via destructuring",
  r10_arrow_helpers: "helpers as const arrow functions",
  r11_rename_locals: "parameters and locals renamed",
  r11_with_entries: "log construction through one helper",
  r11_split_fees: "fee schedule moved to src/fees.ts behind a feeFor wrapper",
  r12_expressions: "if/switch/ternary forms swapped, index loop",
  r12_split_retention: "retention predicate moved to src/retention.ts",
  r12_guard_order: "transfer guards reordered",
  r13_line_comments: "line comments only (no JSDoc)"
};

export function variantsOf(tid: string): Variant[] {
  const T = TASKS[tid];
  const out: Variant[] = [];
  const ref = refCode(T);
  const pre = preCode(T);
  // feature-change controls and traps (base = pre-feature)
  out.push({
    task: tid,
    id: "ref",
    kind: "feature",
    base: pre,
    head: ref,
    breaks: [],
    breaksFeature: false,
    description: "the reference solution of the ticket"
  });
  if (tid === "T1") {
    for (const f of ["alt_a_minimal_far_walls.ts", "alt_b_inner_walls.ts", "alt_c_flag_cage.ts"]) {
      out.push({
        task: tid,
        id: f.replace(/\.ts$/, ""),
        kind: "feature",
        base: pre,
        head: { [T.module]: read(join(BENDEXP, "hidden", tid, "ref", "alt", f)) },
        breaks: [],
        breaksFeature: false,
        description: "an alternative legitimate solution"
      });
    }
  }
  const trapDir = join(BENDEXP, "hidden", tid, "trap", "ts");
  for (const f of readdirSync(trapDir)
    .filter((x) => x.endsWith(".ts"))
    .sort()) {
    const breaks =
      tid === "T1"
        ? ["L1", "L2"]
        : tid === "T3"
          ? ["L0", "L1", "L2", "L3", "L4", "L5"]
          : f.startsWith("stale_self")
            ? ["L1", "L5"]
            : ["L1", "L4", "L5"];
    out.push({
      task: tid,
      id: `trap_${f.replace(/\.ts$/, "")}`,
      kind: "trap",
      base: pre,
      head: { [T.module]: read(join(trapDir, f)) },
      breaks,
      breaksFeature: null,
      description: "the natural law-breaking implementation of the ticket"
    });
  }
  // mutants (base = reference)
  const tags = mutantTags(T);
  const mdir = join(BENDEXP, "hidden", tid, "mutants");
  for (const f of readdirSync(mdir)
    .filter((x) => x.endsWith(".ts"))
    .sort()) {
    const t = tags.get(f) ?? { breaks: [], feature: null, description: "" };
    out.push({
      task: tid,
      id: f.replace(/\.ts$/, ""),
      kind: "mutant",
      base: ref,
      head: { [T.module]: read(join(mdir, f)) },
      breaks: t.breaks,
      breaksFeature: t.feature,
      description: t.description
    });
  }
  // refactors (base = reference)
  const rdir = join(H3_DIR, "refactors", tid);
  if (existsSync(rdir)) {
    for (const f of readdirSync(rdir).sort()) {
      const id = f.replace(/\.ts$/, "");
      out.push({
        task: tid,
        id,
        kind: "refactor",
        base: ref,
        head: refactorCode(T, join(rdir, f)),
        breaks: [],
        breaksFeature: false,
        description: REFACTOR_NOTES[id] ?? ""
      });
    }
  }
  return out;
}
