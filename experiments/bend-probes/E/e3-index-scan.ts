// @ts-nocheck
// E3: deterministic extraction of shape-index gaps for a fixture snapshot.
// Usage: bun e3-index-scan.ts <snapshotRoot> <fixtureRelDir> [shapeFile]
//   snapshotRoot: directory whose relative layout matches the repo (paths in
//   the fixture's .shape files are relative to it). Writes JSON to stdout.
// Uses: `shp inspect --json`, `shp analyze --shape-files`, the TypeScript
// compiler API (installed in a scratch dir) for imports/calls/throws, and
// fixed regexes over Markdown for review/ordering requirements.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { buildFacts } from "./callgraph.ts";
const SHP = ["bun", "/home/user/shapelang/packages/shp-cli/src/index.ts"];

const [root, fx, shapeArg] = process.argv.slice(2);
const fxAbs = join(root, fx);
const walk = (d: string): string[] =>
  existsSync(d)
    ? readdirSync(d).flatMap((n) =>
        statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]
      )
    : [];
const files = walk(fxAbs)
  .map((f) => relative(root, f))
  .sort();
const srcFiles = files.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
const docFiles = files.filter((f) => f.endsWith(".md"));
const shapeFiles = shapeArg ? [shapeArg] : files.filter((f) => f.endsWith(".shape"));

function shp(args: string[]) {
  return spawnSync(SHP[0], [...SHP.slice(1), ...args], { cwd: root, encoding: "utf8" });
}
const model = shapeFiles.length
  ? JSON.parse(shp(["inspect", "--json", ...shapeFiles]).stdout)
  : { functions: [], relations: [], implementations: [], bindings: [], components: [] };

// ---------- source facts (TypeScript checker based call graph) ----------
type Fn = {
  file: string;
  name: string;
  imports: number;
  throws: number;
  io: string[];
  calls: { file: string; name: string; awaited: boolean }[];
};
const fns: Fn[] = buildFacts(root, srcFiles).map((f) => ({
  file: f.file,
  name: f.name,
  imports: f.importsInFile,
  throws: f.throws,
  io: f.io,
  calls: f.calls
}));

// ---------- model lookups ----------
const fnByRef = new Map<string, { id: string; component: string }>();
for (const m of model.functions ?? [])
  if (m.source) fnByRef.set(m.source.path, { id: m.id, component: m.component });
const local = (id: string) => id.split("::").pop()!;
const hasRelation = (a: string, b: string) =>
  (model.relations ?? []).some(
    (r: { kind: string; endpoints: { id: string; index: number }[] }) => {
      if (!["calls", "coordinated_call"].includes(r.kind)) return false;
      const ids = r.endpoints.toSorted((x, y) => x.index - y.index).map((e) => e.id);
      const i = ids.indexOf(a),
        j = ids.indexOf(b);
      return i >= 0 && j > i;
    }
  );
const globRe = (g: string) =>
  new RegExp(
    "^" +
      g
        .split(/(\*\*\/|\*\*|\*|\?)/)
        .map((t) =>
          t === "**/"
            ? "(?:.*/)?"
            : t === "**"
              ? ".*"
              : t === "*"
                ? "[^/]*"
                : t === "?"
                  ? "."
                  : t.replace(/[.+^${}()|[\]\\]/g, "\\$&")
        )
        .join("") +
      "$"
  );
const governed = (p: string) =>
  (model.implementations ?? []).some(
    (i: { paths: string[]; onChangeRequirement?: string }) =>
      i.onChangeRequirement && i.paths.some((g) => globRe(g).test(p))
  );
const citedBySource = (p: string) => [...fnByRef.keys()].some((k) => k.split("#")[0] === p);
const boundDoc = (p: string) =>
  (model.bindings ?? []).some((b: { requireChanged: string[] }) =>
    b.requireChanged.some((g) => globRe(g).test(p))
  );

const findings: Record<string, unknown>[] = [];

// G-calls: cross-component call without a calls/coordinated_call relation.
const edges: { from: string; to: string; caller: string; callee: string; awaited: boolean }[] = [];
for (const f of fns)
  for (const c of f.calls) {
    const a = fnByRef.get(`${f.file}#${f.name}`),
      b = fnByRef.get(`${c.file}#${c.name}`);
    if (a && b && a.component !== b.component) {
      edges.push({
        from: a.component,
        to: b.component,
        caller: a.id,
        callee: b.id,
        awaited: c.awaited
      });
      if (!hasRelation(a.component, b.component))
        findings.push({
          kind: "missing-calls-relation",
          from: local(a.component),
          to: local(b.component),
          evidence: `${f.file}#${f.name} calls ${c.file}#${c.name}${c.awaited ? " (awaited)" : ""}`,
          suggested: `relation { kind calls  connects ${local(a.component)} -> ${local(b.component)} }`
        });
    }
  }

// G-coverage: source not governed or cited. A file whose functions all show no
// boundary signal (no imports, cross-module calls, I/O or throws) is classified
// "not architecture-significant" instead of a gap (fixed proxy rule).
const pureLeaf = (f: string) =>
  fns
    .filter((x) => x.file === f)
    .every((x) => x.imports === 0 && x.calls.length === 0 && x.io.length === 0 && x.throws === 0);
const notSignificant: string[] = [];
for (const f of srcFiles)
  if (!governed(f) && !citedBySource(f)) {
    if (pureLeaf(f)) notSignificant.push(f);
    else findings.push({ kind: "uncovered-source", file: f });
  }

// G-docs: a doc that states a review coupling but no binding requires it.
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
const stem = (p: string) =>
  basename(p)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
for (const d of docFiles) {
  const text = readFileSync(join(root, d), "utf8");
  const sentences = text
    .split(/\n\s*\n/)
    .filter((para) => !para.startsWith("#"))
    .map((para) => para.replace(/\n/g, " "))
    .flatMap((para) => para.split(/(?<=\.)\s+/));
  for (const s of sentences) {
    if (
      /requires? review|must be reviewed|review of this document|keep (this|it) in sync|update this document/i.test(
        s
      )
    ) {
      const w = new Set(words(s));
      const triggers = [
        ...srcFiles.filter((p) => w.has(stem(p))),
        ...(/\bmodel\b/i.test(s) ? shapeFiles : [])
      ];
      if (!boundDoc(d))
        findings.push({
          kind: "missing-binding",
          doc: d,
          sentence: s.trim(),
          suggested: { when_changed: triggers, require_changed: [d] }
        });
    }
    if (/\bonly after\b|\bmust (?:happen|run|complete) (?:before|after)\b/i.test(s)) {
      const w = new Set(words(s));
      for (const e of edges) {
        const nameWords = (id: string) => words(local(id).replace(/([a-z])([A-Z])/g, "$1 $2"));
        const callerHit = nameWords(e.caller).some((x) => w.has(x) || w.has(x + "s"));
        const calleeHit =
          nameWords(e.callee).some((x) => w.has(x) || w.has(x + "s")) ||
          nameWords(e.to).some((x) => w.has(x));
        const coordinated = (model.relations ?? []).some(
          (r: { kind: string }) => r.kind === "coordinated_call"
        );
        if (e.awaited && callerHit && calleeHit && !coordinated)
          findings.push({
            kind: "ordering-candidate",
            from: local(e.from),
            to: local(e.to),
            doc: d,
            sentence: s.trim(),
            evidence: `${local(e.caller)} awaits ${local(e.callee)}`,
            suggested: `coordinated_call ${local(e.from)} -> ${local(e.to)} (or a typed memory)`
          });
      }
    }
  }
}

// G-effects: analyzer hints vs declared effects.
if (shapeFiles.length && srcFiles.length) {
  const r = shp(["analyze", "--shape-files", shapeFiles.join(","), ...srcFiles]);
  if (r.status !== 0) findings.push({ kind: "analyzer-mismatch", detail: r.stderr.trim() });
}
// Source symbol existence for every fn source ref.
for (const [ref] of fnByRef) {
  const [p, sym] = ref.split("#");
  if (!fns.some((f) => f.file === p && f.name === sym))
    findings.push({ kind: "missing-source-symbol", ref });
}

// AST navigation availability (fixture-local only; outer repo AST is not evidence).
const astManifest = join(fxAbs, "shape/generated/ast/manifest.json");
const ast = existsSync(astManifest) ? "available" : "absent";

// Significance proxy for uncovered or unmodeled files: no imports, calls, I/O, throws.
const significance = fns.map((f) => ({
  fn: `${f.file}#${f.name}`,
  modeled: fnByRef.has(`${f.file}#${f.name}`),
  imports: f.imports,
  crossModuleCalls: f.calls.length,
  io: f.io.length,
  throws: f.throws,
  proxy:
    f.imports === 0 && f.calls.length === 0 && f.io.length === 0 && f.throws === 0
      ? "pure-leaf: no architecture invariant indicated"
      : "has-boundary-signals"
}));

console.log(
  JSON.stringify(
    {
      fixture: fx,
      shapeFiles,
      srcFiles,
      docFiles,
      generatedAst: ast,
      astDecision:
        ast === "absent"
          ? "proceed with source navigation; do not run the AST generator (shape-index policy); record AST unavailable"
          : "use AST anchors for navigation only",
      state: findings.length ? "incomplete_with_explicit_gaps" : "no deterministic gaps",
      notArchitectureSignificant: notSignificant,
      findings,
      sourceFacts: fns,
      significance
    },
    null,
    2
  )
);
