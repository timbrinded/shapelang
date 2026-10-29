// Law of memory ShapeSourceNormalizationContract on unit
// shape.checker::ShapeStringHelpers.normalizeShapeSourcePath.
import {
  checkShapeModules,
  parseShapeModule,
  type CheckResult
} from "../../../../packages/shp-checker/src/index.ts";
import { normalizeShapeSourcePath } from "../../../../packages/shp-checker/src/shape-strings.ts";
import { type Rng, lawTest, property, stable } from "./lawkit.ts";

const DIRS = ["src", "audit", "lib", "store", "a_b", "x1"] as const;
const FILES = ["store.ts", "purge.ts", "index.ts", "a.ts", "deep_file.ts"] as const;

function genPath(r: Rng): string {
  return [...Array.from({ length: r.int(1, 3) }, () => r.pick(DIRS)), r.pick(FILES)].join("/");
}

/** Spellings of one repo-relative path that every comparison must read as that path. */
function spell(r: Rng, p: string, withAnchor: boolean): string {
  let s = r.bool() ? p.replaceAll("/", "\\") : p;
  if (r.bool()) s = `./${s}`;
  if (withAnchor) s += r.pick(["", "#appendEvent", ":12", ":3-9"]);
  return s;
}

interface Case {
  governed: string[];
  bound: string;
  docs: string;
  changed: string[];
  spelled: string[];
  refPath: string;
  refSpelled: string;
}

function genCase(r: Rng): Case {
  const governed = [...new Set(Array.from({ length: r.int(1, 3) }, () => genPath(r)))];
  const bound = r.pick(governed);
  const universe = [...governed, genPath(r), genPath(r), "docs/audit.md"];
  const changed = [...new Set(r.subset(universe, 1))];
  const refPath = r.pick(governed);
  return {
    governed,
    bound,
    docs: "docs/audit.md",
    changed,
    spelled: changed.map((p) => spell(r, p, false)),
    refPath,
    refSpelled: spell(r, refPath, true)
  };
}

function model(c: Case, ref: string): string {
  return [
    "module law",
    "resource Event",
    [
      "component Store {",
      "  grants Append<Event>",
      "  fn appendEvent",
      `    source ts(${JSON.stringify(ref)})`,
      "    effects complete {",
      "      Append<Event>",
      `        evidence ts(${JSON.stringify(ref)})`,
      "    }",
      "}"
    ].join("\n"),
    [
      "implementation StoreImpl {",
      "  paths {",
      ...c.governed.map((g) => `    ${JSON.stringify(g)}`),
      "  }",
      "  conforms_to Store",
      "  on_change require shape_update",
      "}"
    ].join("\n"),
    [
      "binding StoreDocs {",
      "  when_changed paths {",
      `    ${JSON.stringify(c.bound)}`,
      "  }",
      "  require_changed paths {",
      `    ${JSON.stringify(c.docs)}`,
      "  }",
      "  allow attest docs_not_needed",
      "}"
    ].join("\n")
  ].join("\n\n");
}

function run(src: string, changed: string[]): CheckResult {
  const p = parseShapeModule(src, "shape/law.shape");
  if (!p.ok)
    throw new Error(`does not parse: ${p.diagnostics.map((d) => d.message).join("; ")}\n${src}`);
  return checkShapeModules(
    [{ module: p.module, filePath: "shape/law.shape", origin: "authored" }],
    { changedFiles: changed, repoRoot: "/repo" }
  );
}

/** The coverage and binding verdict, with reported paths normalised. */
function verdict(res: CheckResult): string {
  return stable(
    res.diagnostics
      .filter((d) => d.kind === "missing_shape_update" || d.kind === "missing_bound_docs_change")
      .map((d) => `${d.kind} ${normalizeShapeSourcePath("changedFile" in d ? d.changedFile : "")}`)
      .sort()
  );
}

// "coverage, binding and analyzer comparisons use the same repo-relative path rules":
// normalisation is idempotent and reads every spelling of a path as that path, and the coverage
// and binding verdicts do not depend on how changed files or source references are spelled.
lawTest("shape.checker::SourcePathRulesShared", "holds", () =>
  property("shape.checker::SourcePathRulesShared", { cases: 200, seed: 0x9a7401 }, genCase, (c) => {
    const n = normalizeShapeSourcePath(c.refSpelled);
    if (n !== c.refPath)
      return `normalizeShapeSourcePath(${JSON.stringify(c.refSpelled)}) = ${JSON.stringify(n)}, expected ${JSON.stringify(c.refPath)}`;
    if (normalizeShapeSourcePath(n) !== n) return `not idempotent on ${JSON.stringify(n)}`;
    const clean = verdict(run(model(c, c.refPath), c.changed));
    const changedSpelled = verdict(run(model(c, c.refPath), c.spelled));
    if (changedSpelled !== clean)
      return `changed-file spelling changed the verdict: ${JSON.stringify(c.spelled)}\n${clean}\n${changedSpelled}`;
    const refSpelled = verdict(run(model(c, c.refSpelled), c.changed));
    if (refSpelled !== clean)
      return `source-reference spelling ${JSON.stringify(c.refSpelled)} changed the verdict:\n${clean}\n${refSpelled}`;
    return null;
  })
);
