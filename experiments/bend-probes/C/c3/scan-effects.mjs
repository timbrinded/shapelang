// C3: purity/throw scan of every authored Shape function with a
// `source ts("path#symbol")` reference, compared with its declared effects.
// Usage: bun scan-effects.mjs  (writes $CWORK/c3/effects.json, prints tables)
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO, WORK } from "../lib/work.mjs";
import { buildProgram, createGraph, findSourceUnit } from "./graph.mjs";
import { justifiedChannels, PHYSICAL_ONLY } from "./effects-map.mjs";

const OUT = join(WORK, "c3");
const DEPTHS = [0, 1, 2, 3, 4, 6, 8, Infinity];
const IGNORED = new Set(["bun-other-pure"]);

function inspect(files) {
  const r = spawnSync("bun", [join(REPO, "packages/shp-cli/src/index.ts"), "inspect", "--json", ...files], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

// Base variants of the behavioural fixtures: base/ overlaid on candidate/.
const OVERLAY = join(OUT, "overlay");
rmSync(OVERLAY, { recursive: true, force: true });
const overlayFiles = [];
for (const fx of ["root-cause-grouping", "cross-object"]) {
  const src = join(REPO, "fixtures/skills/review", fx);
  const dir = join(OVERLAY, `${fx}-base`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(src, "candidate"), dir, { recursive: true });
  cpSync(join(src, "base"), dir, { recursive: true });
  for (const f of readdirSync(dir)) overlayFiles.push(join(dir, f));
}
const fixtureFiles = [];
for (const fx of ["root-cause-grouping", "cross-object", "stale-model"]) {
  const dir = join(REPO, "fixtures/skills/review", fx, "candidate");
  for (const f of readdirSync(dir)) fixtureFiles.push(join(dir, f));
}

const env = buildProgram([...fixtureFiles, ...overlayFiles], [OVERLAY]);
const graph = createGraph(env);

const models = [
  { name: "shape", files: ["shape/checker.shape", "shape/delivery.shape", "shape/incremental-checker.shape", "shape/language.shape", "shape/runtime.shape", "shape/tooling.shape"] },
  ...["root-cause-grouping", "cross-object", "stale-model"].map((fx) => ({ name: `fixture:${fx}`, files: [`fixtures/skills/review/${fx}/shape/model.shape`] }))
];

function summarize(fn, sourcePath, unit) {
  const { depthAll, depthUncaught, pathTo } = graph.closure(unit);
  const declared = justifiedChannels(fn.effects);
  const byDepth = {};
  for (const D of DEPTHS) {
    const channels = new Set();
    let throws = false;
    let unknown = 0;
    let external = 0;
    let units = 0;
    for (const [u, d] of depthAll) {
      if (d > D) continue;
      units++;
      const f = graph.analyze(u);
      for (const s of f.sites) channels.add(s.channel);
      unknown += f.unknown.length;
      external += f.external.length;
    }
    for (const [u, d] of depthUncaught) {
      if (d > D) continue;
      if (graph.analyze(u).throws.some((t) => !t.caught)) throws = true;
    }
    const undeclared = [...channels].filter((c) => !declared.has(c) && !IGNORED.has(c)).sort();
    const unobserved = Object.entries(PHYSICAL_ONLY)
      .filter(([res, ch]) => fn.effects.some((e) => e.target?.endsWith(`::${res}`)) && !channels.has(ch))
      .map(([res]) => res);
    byDepth[D === Infinity ? "inf" : D] = { units, channels: [...channels].sort(), throws, unknown, external, undeclared, unobserved };
  }
  const maxDepth = Math.max(...depthAll.values());
  // Evidence for every undeclared channel at full depth: sites with their call path.
  const evidence = {};
  for (const c of byDepth.inf.undeclared) {
    evidence[c] = [];
    for (const [u, d] of [...depthAll].sort((a, b) => a[1] - b[1])) {
      for (const s of graph.analyze(u).sites.filter((s) => s.channel === c)) {
        if (evidence[c].length < 4) evidence[c].push({ depth: d, unit: graph.analyze(u).key, line: s.line, api: s.api, text: s.text, path: pathTo(u) });
      }
    }
  }
  const throwSites = [];
  for (const [u, d] of [...depthUncaught].sort((a, b) => a[1] - b[1])) {
    for (const t of graph.analyze(u).throws.filter((t) => !t.caught)) if (throwSites.length < 3) throwSites.push({ depth: d, unit: graph.analyze(u).key, line: t.line, text: t.text });
  }
  return { maxDepth, declaredChannels: [...declared].sort(), byDepth, evidence, throwSites };
}

const rows = [];
for (const model of models) {
  const doc = inspect(model.files);
  for (const fn of doc.functions) {
    if (fn.origin !== "authored") continue;
    const row = { model: model.name, id: fn.id, component: fn.component, source: fn.source ? `${fn.source.language}:${fn.source.path}` : null,
      effectsComplete: fn.effectsComplete, effects: fn.effects.map((e) => `${e.name}<${e.target?.split("::").pop() ?? ""}>`) };
    rows.push(row);
    if (!fn.source || fn.source.language !== "ts") { row.status = "no ts source"; continue; }
    if (!fn.source.path.includes("#")) { row.status = "file-only ts source"; continue; }
    const [file, symbol] = fn.source.path.split("#");
    const found = findSourceUnit(env, graph, join(REPO, file), symbol);
    if (found.error) { row.status = `unresolved: ${found.error}`; continue; }
    row.status = "resolved";
    Object.assign(row, summarize(fn, file, found.unit));
    if (model.name.startsWith("fixture:") && file.includes("/candidate/")) {
      const fx = model.name.slice(8);
      const baseFile = join(OVERLAY, `${fx}-base`, file.split("/candidate/")[1]);
      const baseFound = findSourceUnit(env, graph, baseFile, symbol);
      if (!baseFound.error) row.base = summarize(fn, baseFile, baseFound.unit);
    }
  }
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "effects.json"), JSON.stringify(rows, null, 2));

const count = (f) => rows.filter(f).length;
console.log(`authored fns: ${rows.length}; with ts#symbol: ${count((r) => r.status === "resolved" || r.status?.startsWith("unresolved"))}; resolved: ${count((r) => r.status === "resolved")}; file-only ts: ${count((r) => r.status === "file-only ts source")}; other languages/no source: ${count((r) => r.status === "no ts source")}`);
for (const D of ["0", "1", "2", "3", "4", "6", "8", "inf"]) {
  const res = rows.filter((r) => r.status === "resolved");
  const consistent = res.filter((r) => r.byDepth[D].undeclared.length === 0 && r.byDepth[D].unobserved.length === 0);
  const flagged = res.filter((r) => r.byDepth[D].undeclared.length > 0);
  const pairs = res.reduce((n, r) => n + r.byDepth[D].undeclared.length, 0);
  const unobs = res.filter((r) => r.byDepth[D].unobserved.length > 0);
  const thr = res.filter((r) => r.byDepth[D].throws);
  const closed = consistent.filter((r) => r.byDepth[D].unknown === 0 && r.byDepth[D].external === 0);
  console.log(`depth ${D}: consistent and closed (no unresolved or external-package calls) ${closed.length}`);
  console.log(`depth ${D}: consistent ${consistent.length}/${res.length}; fns with undeclared channel ${flagged.length} (${pairs} fn-channel pairs); declared-clock-unobserved ${unobs.length}; can throw ${thr.length}; mean units ${(res.reduce((n, r) => n + r.byDepth[D].units, 0) / res.length).toFixed(1)}`);
}
for (const r of rows.filter((r) => r.status === "resolved")) {
  const b = r.byDepth.inf;
  console.log(`${r.model.padEnd(30)} ${r.id.split("::").pop().padEnd(55)} depth=${String(r.maxDepth).padStart(2)} units=${String(b.units).padStart(4)} ch=[${b.channels.join(",")}] undeclared=[${b.undeclared.join(",")}] unobs=[${b.unobserved.join(",")}] throws=${b.throws} unknown=${b.unknown}` + (r.base ? `  BASE: ch=[${r.base.byDepth.inf.channels}] throws=${r.base.byDepth.inf.throws}` : ""));
}
