// @ts-nocheck
// E5: five design memories of Shape's own model turned into deterministic checks.
// Usage: bun e5-checks.ts <root> [checkId...]
//   root: a directory holding `packages/` laid out as in the repo (the repo
//   itself, or a seeded copy under $X/work/E/e5). Prints one JSON result per check.
// Checks:
//   A clock-boundary        ClockReadAtCliBoundary, FreshnessDeterminism c1, InspectionSchemaContract c6 (static scan)
//   B analyzer-separation   AnalyzerCheckerSeparation (call-graph rule)
//   C shared-normalization  ShapeSourceNormalizationContract (cross-surface law; C0 = first, call-graph formalisation)
//   D formatter-canonical   FormatterCanonicalDiffs (law: idempotence, semantic preservation, permutation canonicality)
//   E path-witness          ForbiddenPathWitness / findShortestPath description (law: fewest hops, canonical tie-break, order independence)
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildFacts, ts, type FnFact } from "./callgraph.ts";

const DEPS =
  process.env.EDEPS ??
  "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E/deps";
const fc = createRequire(DEPS + "/package.json")("fast-check") as typeof import("fast-check");
const REPO = "/home/user/shapelang";
const root = process.argv[2] ?? REPO;
const only = new Set(process.argv.slice(3));
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) =>
    n === "node_modules" ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]
  );
const srcOf = (pkg: string) =>
  walk(join(root, pkg))
    .map((f) => relative(root, f))
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !f.includes("/generated/") &&
        !f.endsWith("test-support.ts")
    )
    .sort();

type Result = {
  check: string;
  memory: string;
  pass: boolean;
  violations: string[];
  notes: string[];
};
const results: Result[] = [];

// ---------------- A: clock boundary ----------------
function checkA(): Result {
  const CLOCK =
    /^(Date\.now|performance\.now|process\.hrtime(\.bigint)?|Bun\.nanoseconds|Temporal\.Now\.\w+)$/;
  const files = [...srcOf("packages/shp-checker/src"), ...srcOf("packages/shp-cli/src")];
  const sites: { file: string; line: number; fn: string; text: string }[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(
      f,
      readFileSync(join(root, f), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (n: import("typescript").Node, fn: string) => {
      let name = fn;
      if (
        (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
        n.name &&
        ts.isIdentifier(n.name)
      )
        name = n.name.text;
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
      )
        name = n.name.text;
      const hit =
        (ts.isCallExpression(n) && CLOCK.test(n.expression.getText(sf))) ||
        (ts.isNewExpression(n) &&
          n.expression.getText(sf) === "Date" &&
          (n.arguments?.length ?? 0) === 0);
      if (hit)
        sites.push({
          file: f,
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          fn: name,
          text: n.getText(sf).slice(0, 40)
        });
      n.forEachChild((c) => visit(c, name));
    };
    visit(sf, "<module>");
  }
  const checkerSites = sites.filter((s) => s.file.startsWith("packages/shp-checker/"));
  const cliOther = sites.filter(
    (s) => s.file.startsWith("packages/shp-cli/") && s.fn !== "isoToday"
  );
  return {
    check: "A clock-boundary",
    memory: "ClockReadAtCliBoundary (+FreshnessDeterminism c1, InspectionSchemaContract c6)",
    pass: checkerSites.length === 0,
    violations: checkerSites.map(
      (s) => `checker reads clock: ${s.file}:${s.line} in ${s.fn}: ${s.text}`
    ),
    notes: [
      `files scanned: ${files.length}; clock sites: ${sites.length}`,
      ...sites
        .filter((s) => s.fn === "isoToday")
        .map((s) => `allowed: ${s.file}:${s.line} in isoToday`),
      ...cliOther.map(
        (s) =>
          `strict-reading finding (CLI clock read not for freshness): ${s.file}:${s.line} in ${s.fn}: ${s.text}`
      )
    ]
  };
}

// shared call graph for B/C (checker package only)
let facts: FnFact[] | undefined;
const graph = () =>
  (facts ??= buildFacts(root, srcOf("packages/shp-checker/src"), { followTypes: false }));
function closure(starts: FnFact[]): Map<string, string[]> {
  const byKey = new Map(graph().map((f) => [`${f.file}#${f.name}`, f]));
  const seen = new Map<string, string[]>(); // key -> path from a start
  const queue = starts.map((s) => ({ key: `${s.file}#${s.name}`, path: [`${s.file}#${s.name}`] }));
  while (queue.length) {
    const { key, path } = queue.shift()!;
    if (seen.has(key)) continue;
    seen.set(key, path);
    const f = byKey.get(key);
    for (const c of f?.calls ?? [])
      queue.push({ key: `${c.file}#${c.name}`, path: [...path, `${c.file}#${c.name}`] });
  }
  return seen;
}

// ---------------- B: analyzer does not call the checker ----------------
function checkB(): Result {
  const analyzerFiles = srcOf("packages/shp-checker/src").filter((f) =>
    /\/analyzer[^/]*\.ts$/.test(f)
  );
  const starts = graph().filter((f) => analyzerFiles.includes(f.file));
  const reach = closure(starts);
  const isChecker = (k: string) =>
    k.startsWith("packages/shp-checker/src/checker/") ||
    k.startsWith("packages/shp-checker/src/checker.ts");
  const viol = [...reach.entries()]
    .filter(([k]) => isChecker(k))
    .map(([, p]) => `analyzer reaches checker: ${p.join(" -> ")}`);
  const importViol: string[] = [];
  for (const f of analyzerFiles) {
    const sf = ts.createSourceFile(
      f,
      readFileSync(join(root, f), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    for (const st of sf.statements)
      if (
        ts.isImportDeclaration(st) &&
        ts.isStringLiteral(st.moduleSpecifier) &&
        /(^|\/)checker(\.ts|\/)/.test(st.moduleSpecifier.text) &&
        !st.importClause?.isTypeOnly
      )
        importViol.push(`analyzer imports checker module: ${f} <- ${st.moduleSpecifier.text}`);
  }
  return {
    check: "B analyzer-separation",
    memory: "AnalyzerCheckerSeparation (rationale on ShapeAnalyzer)",
    pass: viol.length + importViol.length === 0,
    violations: [...importViol, ...viol],
    notes: [
      `analyzer files: ${analyzerFiles.length}; analyzer functions: ${starts.length}; reachable functions: ${reach.size}; reachable outside analyzer: ${[...reach.keys()].filter((k) => !analyzerFiles.some((a) => k.startsWith(a))).join(", ") || "none"}`
    ]
  };
}

// ---------------- C0: first formalisation (call-graph rule) -- kept for the record ----------------
// "coverage, bindings and analyzer each reach normalizeShapeSourcePath". This
// produced false positives on the current source: coverage and bindings compare
// paths that lowering already normalized (data flow, not call flow).
function checkC0(): Result {
  const entries = [
    ["packages/shp-checker/src/checker/rules/coverage.ts", "checkCoverage"],
    ["packages/shp-checker/src/checker/rules/coverage.ts", "checkBindings"],
    ["packages/shp-checker/src/analyzer-shape.ts", "compareAnalyzerHintsToShape"]
  ];
  const HELPER = "packages/shp-checker/src/shape-strings.ts#normalizeShapeSourcePath";
  const viol: string[] = [],
    notes: string[] = [];
  for (const [file, name] of entries) {
    const start = graph().find((f) => f.file === file && f.name === name);
    if (!start) {
      viol.push(`entry point missing: ${file}#${name}`);
      continue;
    }
    const p = closure([start]).get(HELPER);
    if (!p) viol.push(`${name} does not reach normalizeShapeSourcePath`);
    else notes.push(`${name}: ${p.map((k) => k.split("#")[1]).join(" -> ")}`);
  }
  return {
    check: "C0 shared-normalization (call-graph formalisation)",
    memory: "ShapeSourceNormalizationContract",
    pass: viol.length === 0,
    violations: viol,
    notes
  };
}

// ---------------- C: one path normalization for coverage, bindings, analyzer (cross-surface law) ----------------
// For every spelling of a source reference to src/a.ts and every spelling of the
// changed path, coverage must accept the reference, the binding must trigger,
// and the analyzer must attribute its hint to the declared effect.
async function checkC(): Promise<Result> {
  const api = await import(join(root, "packages/shp-checker/src/index.ts"));
  const refSpellings = [
    "src/a.ts",
    "./src/a.ts",
    "src/a.ts#purge",
    "./src/a.ts#purge",
    "src/a.ts:2",
    "src/a.ts:2-3",
    "src/a.ts#purge:2"
  ];
  const changedSpellings = ["src/a.ts", "./src/a.ts", "src\\a.ts"];
  const code = 'export function purge() {\n  return db.deleteFrom("revisions");\n}\n';
  const shape = (ref: string) =>
    `module a\n\nresource revisions\n\ncomponent Store {\n  grants HardDelete<revisions>\n  fn purge\n    source ts("${ref}")\n    effects complete {\n      HardDelete<revisions>\n    }\n}\n\nimplementation StoreImpl {\n  paths {\n    "src/a.ts"\n  }\n  conforms_to Store\n  on_change require shape_update\n}\n\nbinding StoreDocs {\n  when_changed paths {\n    "src/a.ts"\n  }\n  require_changed paths {\n    "docs/a.md"\n  }\n}\n`;
  const viol: string[] = [];
  const anchorNotes = new Set<string>();
  let cells = 0;
  for (const ref of refSpellings) {
    const p = api.parseShapeModule(shape(ref), "shape/a.shape");
    if (!p.ok) {
      viol.push(`parse failed for ${ref}`);
      continue;
    }
    for (const ch of changedSpellings) {
      cells++;
      const res = api.checkShapeModules(
        [{ module: p.module, filePath: "shape/a.shape", origin: "authored" }],
        { changedFiles: [ch, "shape/a.shape"], enforceBindings: true, repoRoot: "/r" }
      );
      const kinds = res.diagnostics.map((d: { kind: string }) => d.kind);
      const covered = !kinds.some((k: string) => /coverage|shape_update/.test(k));
      const bound = kinds.some((k: string) => /bound_docs|binding/.test(k));
      const hints = api.analyzeSourceText(ch.replace(/\\/g, "/"), code);
      const warnings = api.compareAnalyzerHintsToShape(hints, [p.module]);
      // path agreement: the analyzer found declared effects for the path (no missing_declared_effect);
      // anchor-level disagreement (e.g. "#purge:2") is recorded separately, the memory is about path rules.
      const attributed =
        hints.length > 0 &&
        !warnings.some((w: { kind: string }) => w.kind === "missing_declared_effect");
      if (warnings.length > 0 && attributed)
        anchorNotes.add(
          `ref=${ref}: analyzer ${warnings.map((w: { kind: string }) => w.kind)} (anchor-level, path agreed)`
        );
      if (!(covered && bound && attributed))
        viol.push(
          `ref=${ref} changed=${ch}: coverage=${covered} binding=${bound} analyzer=${attributed} (hints ${hints.length}, warnings ${warnings.map((w: { kind: string }) => w.kind)}; diags ${kinds})`
        );
    }
  }
  // negative control: a reference to another file must not cover src/a.ts
  const neg = api.parseShapeModule(shape("src/b.ts"), "shape/a.shape");
  const negKinds = api
    .checkShapeModules([{ module: neg.module, filePath: "shape/a.shape", origin: "authored" }], {
      changedFiles: ["src/a.ts", "shape/a.shape"],
      enforceBindings: true,
      repoRoot: "/r"
    })
    .diagnostics.map((d: { kind: string }) => d.kind);
  if (!negKinds.some((k: string) => /coverage|shape_update/.test(k)))
    viol.push(`negative control not detected as uncovered: diags ${negKinds}`);
  return {
    check: "C shared-normalization (cross-surface law)",
    memory: "ShapeSourceNormalizationContract",
    pass: viol.length === 0,
    violations: viol.slice(0, 6),
    notes: [
      `cells: ${cells} (${refSpellings.length} reference spellings x ${changedSpellings.length} changed-path spellings); disagreeing cells: ${viol.length}`,
      ...anchorNotes
    ]
  };
}

// ---------------- D: formatter laws ----------------
async function checkD(): Promise<Result> {
  const api = await import(join(root, "packages/shp-checker/src/index.ts"));
  const corpus = spawnSync("git", ["ls-files", "*.shape"], { cwd: REPO, encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean);
  let parsed = 0,
    idem = 0,
    sem = 0;
  const viol: string[] = [];
  const strip = (o: unknown): unknown =>
    Array.isArray(o)
      ? o.map(strip)
      : o && typeof o === "object"
        ? Object.fromEntries(
            Object.entries(o)
              .filter(([k]) => !["file", "origin", "shapeVersion"].includes(k))
              .map(([k, v]) => [k, strip(v)])
          )
        : o;
  const inspect = (src: string) => {
    const p = api.parseShapeModule(src, "x.shape");
    return JSON.stringify(
      strip(
        api.inspectShapeModules([{ module: p.module, filePath: "x.shape", origin: "authored" }], {
          shapeVersion: "x",
          repoRoot: "/"
        })
      )
    );
  };
  for (const f of corpus) {
    const src = readFileSync(join(REPO, f), "utf8");
    const r1 = api.formatShapeSource(src, f);
    if (!r1.ok) continue;
    parsed++;
    const r2 = api.formatShapeSource(r1.formatted, f);
    if (!r2.ok || r2.formatted !== r1.formatted) {
      idem++;
      if (viol.length < 5) viol.push(`not idempotent: ${f}`);
    }
    try {
      if (inspect(src) !== inspect(r1.formatted)) {
        sem++;
        if (viol.length < 5) viol.push(`semantics changed: ${f}`);
      }
    } catch {
      /* module needing imports from other files: skip semantic comparison */
    }
  }
  // permutation law: member order and blank lines in the input do not change the output
  const effects = ["Read", "Append", "Update", "Export"],
    res = ["Alpha", "Beta", "Gamma"];
  const pool = effects.flatMap((e) => res.map((r) => `${e}<${r}>`));
  const arb = fc.record({
    grants: fc.uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: 8 }),
    fnNames: fc.uniqueArray(fc.constantFrom("load", "save", "scan", "emit"), {
      minLength: 1,
      maxLength: 3
    }),
    seed: fc.integer(),
    blank: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 })
  });
  const shuffle = <T>(xs: T[], seed: number) => {
    const a = [...xs];
    let s = seed >>> 0;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const render = (g: string[], fns: string[], blank: boolean[]) =>
    `module perm\n\nresource Alpha\n\nresource Beta\n\nresource Gamma\n\ncomponent Store {\n${g.map((x, i) => `  grants ${x}${blank[i % 12] ? "\n" : ""}`).join("\n")}\n${fns.map((n) => `  fn ${n}\n    effects complete {\n${g.map((x) => `      ${x}`).join("\n")}\n    }`).join("\n")}\n}\n`;
  const prop = fc.property(arb, ({ grants, fnNames, seed, blank }) => {
    const a = api.formatShapeSource(
      render(
        grants,
        fnNames,
        blank.map(() => false)
      )
    );
    const b = api.formatShapeSource(
      render(shuffle(grants, seed), shuffle(fnNames, seed ^ 7), blank)
    );
    return a.ok && b.ok && a.formatted === b.formatted;
  });
  const out = fc.check(prop, { numRuns: 300, seed: 424242 });
  if (out.failed)
    viol.push(
      `permutation law falsified after ${out.numRuns} runs; counterexample grants=${JSON.stringify((out.counterexample as unknown as [{ grants: string[] }])[0].grants)}`
    );
  return {
    check: "D formatter-canonical",
    memory: "FormatterCanonicalDiffs",
    pass: idem === 0 && sem === 0 && !out.failed,
    violations: viol,
    notes: [
      `corpus files: ${corpus.length}; parseable: ${parsed}; idempotence failures: ${idem}; semantic-preservation failures: ${sem}; permutation property runs: ${out.numRuns}${out.failed ? " (FAILED)" : " (passed)"}`
    ]
  };
}

// ---------------- E: forbidden-path witness law ----------------
async function checkE(): Promise<Result> {
  const api = await import(join(root, "packages/shp-checker/src/index.ts"));
  type Edge = { from: number; to: number; name: string };
  const cmp = (a: string, b: string) => {
    const x = Array.from(a),
      y = Array.from(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
      if (d) return d;
    }
    return x.length - y.length;
  };
  const cmpSeq = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = cmp(a[i], b[i]);
      if (d) return d;
    }
    return a.length - b.length;
  };
  const C = (i: number) => `C${i}`;
  function oracle(n: number, edges: Edge[]): { verts: string[]; names: string[] } | undefined {
    // all simple shortest paths from C0 to C(n-1), then the canonical minimum
    const dist = new Map<number, number>([[0, 0]]);
    const q = [0];
    while (q.length) {
      const v = q.shift()!;
      for (const e of edges)
        if (e.from === v && !dist.has(e.to)) {
          dist.set(e.to, dist.get(v)! + 1);
          q.push(e.to);
        }
    }
    const target = n - 1;
    if (!dist.has(target)) return undefined;
    const paths: Edge[][] = [];
    const dfs = (v: number, acc: Edge[]) => {
      if (acc.length === dist.get(target)) {
        if (v === target) paths.push(acc);
        return;
      }
      for (const e of edges)
        if (e.from === v && !acc.some((x) => x.from === e.to) && e.to !== 0) dfs(e.to, [...acc, e]);
    };
    dfs(0, []);
    const key = (p: Edge[]) => ({
      verts: [C(0), ...p.map((e) => C(e.to))],
      names: p.map((e) => e.name)
    });
    return paths.map(key).sort((a, b) => cmpSeq(a.verts, b.verts) || cmpSeq(a.names, b.names))[0];
  }
  const model = (n: number, edges: Edge[]) =>
    `module g\n\n${Array.from({ length: n }, (_, i) => `component ${C(i)} {\n}\n`).join("\n")}\n${edges.map((e) => `relation ${e.name} {\n  kind calls\n  connects ${C(e.from)} -> ${C(e.to)}\n}\n`).join("\n")}\nrule no_route {\n  forbid path ${C(0)} -> ${C(n - 1)} over calls\n}\n`;
  const run = (src: string) => {
    const p = api.parseShapeModule(src, "g.shape");
    if (!p.ok) throw new Error("parse failed: " + JSON.stringify(p.diagnostics).slice(0, 200));
    return api.formatDiagnostics(
      api.checkShapeModules([{ module: p.module, filePath: "g.shape", origin: "authored" }])
    ) as string;
  };
  const arb = fc.integer({ min: 2, max: 6 }).chain((n) =>
    fc.record({
      n: fc.constant(n),
      edges: fc
        .uniqueArray(
          fc.tuple(
            fc.integer({ min: 0, max: n - 1 }),
            fc.integer({ min: 0, max: n - 1 }),
            fc.integer({ min: 0, max: 99 })
          ),
          { maxLength: 14, selector: (t) => t[2] }
        )
        .map((ts) =>
          ts
            .filter(([a, b]) => a !== b)
            .map(([a, b, k]) => ({ from: a, to: b, name: `R${String(k).padStart(2, "0")}` }))
        ),
      seed: fc.integer()
    })
  );
  const shuffle = <T>(xs: T[], seed: number) => {
    const a = [...xs];
    let s = seed >>> 0;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let withPath = 0;
  const failures: string[] = [];
  const prop = fc.property(arb, ({ n, edges, seed }) => {
    const out = run(model(n, edges));
    const exp = oracle(n, edges);
    const w = out.match(/witness: (.+)$/m);
    if (!exp) {
      if (w) failures.push(`unexpected witness for unreachable target`);
      return !w;
    }
    withPath++;
    if (!w) {
      failures.push(`missing diagnostic for reachable target`);
      return false;
    }
    const verts = w[1].trim().split(" -> ");
    const names = [...out.matchAll(/^\s+calls (\S+): /gm)].map((m) => m[1]);
    const okLen = verts.length === exp.verts.length;
    const okCanon = cmpSeq(verts, exp.verts) === 0 && cmpSeq(names, exp.names) === 0;
    const okPerm = run(model(n, shuffle(edges, seed))) === out;
    if (!(okLen && okCanon && okPerm) && failures.length < 3)
      failures.push(
        `n=${n} edges=${edges.map((e) => `${e.name}:${e.from}->${e.to}`).join(",")} got ${verts.join("->")} [${names}] expected ${exp.verts.join("->")} [${exp.names}] len:${okLen} canon:${okCanon} perm:${okPerm}`
      );
    return okLen && okCanon && okPerm;
  });
  const res = fc.check(prop, { numRuns: 400, seed: 1729 });
  return {
    check: "E path-witness",
    memory: "ForbiddenPathWitness (+ findShortestPath description)",
    pass: !res.failed,
    violations: res.failed
      ? [`property falsified after ${res.numRuns} runs`, ...failures.slice(0, 2)]
      : [],
    notes: [`runs: ${res.numRuns}; runs with a reachable target: ${withPath}`]
  };
}

const want = (id: string) => only.size === 0 || only.has(id);
if (want("A")) results.push(checkA());
if (want("B")) results.push(checkB());
if (want("C0")) results.push(checkC0());
if (want("C")) results.push(await checkC());
if (want("D")) results.push(await checkD());
if (want("E")) results.push(await checkE());
console.log(JSON.stringify({ root, results }, null, 2));
