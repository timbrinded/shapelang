// E4: classify every authored claim in shape/*.shape by verification route.
// Usage: bun e4-classify.ts [outDir]   (run from anywhere; reads the repo)
// Routes: i = enforced inside the checker/CLI today; ii = deterministically
// source-verifiable with existing artefacts (AST, call graph, scan);
// ii-b = deterministic only after a resource->code binding is authored
// (the resource has no code-level name today); iii = behavioural law that a
// property test or proof could decide; iv = judgment only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ts } from "./callgraph.ts";

const REPO = "/home/user/shapelang";
const OUT = process.argv[2] ?? "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad/bendexp/work/E/e4";
mkdirSync(OUT, { recursive: true });
const SHP = ["bun", `${REPO}/packages/shp-cli/src/index.ts`];
const run = (args: string[]) => spawnSync(SHP[0], [...SHP.slice(1), ...args], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
const shapeFiles = ["checker", "delivery", "incremental-checker", "language", "runtime", "tooling"].map((n) => `shape/${n}.shape`);
const model = JSON.parse(run(["inspect", "--json", ...shapeFiles]).stdout);
const descRoutes: Record<string, string> = JSON.parse(readFileSync(new URL("./e4-descriptions.json", import.meta.url), "utf8")).routes;
const mem = JSON.parse(readFileSync(new URL("./e5-memories.json", import.meta.url), "utf8")).entries as { name: string; kind: string; proxy?: boolean; clauses: { route: string }[] }[];
const gitFiles = new Set(spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).stdout.split("\n"));
const local = (id: string) => id.split("::").pop()!;

// ---- code-name binding for resources (exact PascalCase type/identifier or camelCase identifier)
const codeFiles = [...gitFiles].filter((f) => /\.(ts|mjs|js)$/.test(f) && !f.includes("/generated/") && !f.startsWith("fixtures/") && !f.startsWith("experiments/") && !f.endsWith(".test.ts"));
const codeText = codeFiles.map((f) => readFileSync(join(REPO, f), "utf8")).join("\n");
const bound = new Map<string, boolean>();
for (const r of model.resources) {
  const n = r.name as string;
  const camel = n[0].toLowerCase() + n.slice(1);
  bound.set(r.id, new RegExp(`\\b(${n}|${camel})\\b`).test(codeText));
}

// ---- anchor existence (deterministic per language)
const anchorCache = new Map<string, Set<string>>();
function anchorsOf(file: string): Set<string> {
  if (anchorCache.has(file)) return anchorCache.get(file)!;
  const s = new Set<string>();
  const text = existsSync(join(REPO, file)) ? readFileSync(join(REPO, file), "utf8") : "";
  if (/\.(ts|mjs|js|tsx)$/.test(file)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (n: import("typescript").Node, cls?: string) => {
      const nm = (n as { name?: import("typescript").Node }).name;
      if (nm && ts.isIdentifier(nm) && (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isClassDeclaration(n) || ts.isMethodDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isPropertyAssignment(n))) {
        s.add(nm.text);
        if (cls && ts.isMethodDeclaration(n)) s.add(`${cls}.${nm.text}`);
      }
      n.forEachChild((c) => visit(c, ts.isClassDeclaration(n) && n.name ? n.name.text : cls));
    };
    visit(sf);
  } else if (/\.ya?ml$/.test(file)) {
    for (const m of text.matchAll(/^\s*(?:-\s*)?name:\s*["']?(.+?)["']?\s*$/gm)) s.add(m[1]);
    for (const m of text.matchAll(/^\s{2}([\w-]+):\s*$/gm)) s.add(m[1]);
  } else if (file.endsWith(".rs")) {
    for (const m of text.matchAll(/\bfn\s+(\w+)/g)) s.add(m[1]);
  } else if (file.endsWith(".sh")) {
    for (const m of text.matchAll(/^(\w+)\s*\(\)\s*\{/gm)) s.add(m[1]);
  }
  anchorCache.set(file, s);
  return s;
}
const refStatus = (path: string) => {
  const [file, anchor] = path.split("#");
  if (!gitFiles.has(file)) return "file-missing";
  if (!anchor) return "file-ok";
  return anchorsOf(file).has(anchor) ? "anchor-ok" : "anchor-missing";
};

// ---- component code regions
const globRe = (g: string) =>
  new RegExp("^" + g.split(/(\*\*\/|\*\*|\*|\?)/).map((t) => (t === "**/" ? "(?:.*/)?" : t === "**" ? ".*" : t === "*" ? "[^/]*" : t === "?" ? "." : t.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("") + "$");
const compAnchored = new Map<string, boolean>();
for (const c of model.components) {
  const hasFnSrc = model.functions.some((f: { component: string; source?: unknown }) => f.component === c.id && f.source);
  const hasImpl = model.implementations.some((i: { conformsTo?: string }) => i.conformsTo === c.id);
  compAnchored.set(c.id, hasFnSrc || hasImpl);
}

type Atom = { id: string; kind: string; conformance: boolean; route: string; note: string; mech?: string };
const atoms: Atom[] = [];
const add = (a: Atom) => atoms.push(a);

for (const r of model.resources) add({ id: `resource ${local(r.id)}`, kind: "resource", conformance: false, route: "iv", note: "vocabulary; no storage/code referent declared" });
for (const t of model.resources.flatMap((r: { id: string; traits: string[] }) => r.traits.map((x) => `${local(r.id)}:${x}`))) add({ id: `trait ${t}`, kind: "resource-trait", conformance: false, route: "i", note: "trait forbids enforced by checker" });
for (const c of model.components) {
  add({ id: `component ${local(c.id)}`, kind: "component", conformance: false, route: "iv", note: "decomposition choice" });
  for (const o of c.owns) add({ id: `${local(c.id)} owns ${local(o)}`, kind: "owns", conformance: true, route: bound.get(o) ? "ii" : "ii-b", note: bound.get(o) ? "resource has a code name: type defined/held in component paths" : "no code referent for resource" });
  for (const g of c.grants) add({ id: `${local(c.id)} grants ${g.name}<${local(g.target ?? "")}>`, kind: "grant", conformance: false, route: "i", note: "permission; effects-within-grants enforced by checker" });
}
for (const f of model.functions) {
  const fid = local(f.id);
  if (f.source) {
    const st = refStatus(f.source.path);
    const anchored = f.source.path.includes("#");
    add({ id: `${fid} source ${f.source.path}`, kind: "fn-source", conformance: true, route: anchored ? "ii" : "i", note: anchored ? "anchor existence via AST (file existence already by --check-cited-paths)" : "file existence enforced by --check-cited-paths in shape:ci", mech: st });
  }
  for (const e of f.effects) {
    const b = e.target ? bound.get(e.target) : false;
    add({ id: `${fid} effect ${e.name}<${local(e.target ?? "")}>`, kind: "effect", conformance: true, route: b ? "ii" : "ii-b", note: b ? "resource has code name: type-flow/mutation scan" : "abstract resource; needs resource->code binding", mech: e.evidence ? refStatus(e.evidence.path) : "no-evidence" });
  }
  const allBound = f.effects.every((e: { target?: string }) => e.target && bound.get(e.target));
  add({ id: `${fid} effects complete (${f.effects.length})`, kind: "effects-complete", conformance: true, route: f.effects.length === 0 ? "ii" : allBound ? "ii" : "ii-b", note: f.effects.length === 0 ? "purity scan" : allBound ? "closure over bound resources + I/O scan" : "closure needs bindings for every effect resource" });
  if (f.description) add({ id: `${fid} description`, kind: "description", conformance: true, route: descRoutes[fid] ?? "UNCLASSIFIED", note: f.description.summary.slice(0, 90) });
  for (const t of f.shapeTraits ?? []) add({ id: `${fid} : ${t}`, kind: "fn-trait", conformance: false, route: "i", note: "require_context enforced by checker" });
}
for (const r of model.relations) {
  const ends = r.endpoints.map((e: { id: string }) => e.id);
  let route = "ii", note = "call graph between component code regions";
  if (r.kind === "provides") {
    route = bound.get(r.to) ? "ii" : "ii-b";
    note = bound.get(r.to) ? "producer of a code-named type" : "provided resource has no code referent";
  } else if (!ends.every((e: string) => compAnchored.get(e) ?? bound.get(e))) {
    route = "ii-b"; note = "an endpoint has no code anchor";
  }
  if (r.kind === "coordinated_call") note += "; ordering via call order in one body";
  add({ id: `relation ${r.kind} ${ends.map(local).join(" -> ")}`, kind: `relation-${r.kind}`, conformance: true, route, note });
}
for (const i of model.implementations) {
  const files = [...gitFiles];
  const resolved = i.paths.every((g: string) => files.some((f) => globRe(g).test(f)));
  const comp = i.conformsTo;
  const fnSrcs = model.functions.filter((f: { component: string; source?: { path: string } }) => f.component === comp && f.source).map((f: { source: { path: string } }) => f.source.path.split("#")[0]);
  // union of every implementation that conforms to the same component
  const unionGlobs = model.implementations.filter((j: { conformsTo?: string }) => j.conformsTo === comp).flatMap((j: { paths: string[] }) => j.paths);
  const outside = fnSrcs.filter((p: string) => !unionGlobs.some((g: string) => globRe(g).test(p)));
  const inside = outside.length === 0;
  if (!inside) console.error(`implementation ${local(i.id)} (${local(comp ?? "")}): fn sources outside union of paths: ${outside.join(", ")}`);
  add({ id: `implementation ${local(i.id)}`, kind: "implementation", conformance: true, route: "ii", note: "globs resolve; conforms_to fn sources inside paths", mech: `${resolved ? "globs-resolve" : "glob-unresolved"},${inside ? "fn-sources-inside" : "fn-source-outside"}` });
}
for (const b of model.bindings) add({ id: `binding ${local(b.id)}`, kind: "binding", conformance: false, route: "i", note: "enforced by check --changed-files" });
for (const r of model.rules) {
  const n = r.forbidEffects.length + r.forbidProvides.length + r.forbidHypercycles.length + r.forbidPaths.length;
  for (let k = 0; k < n; k++) add({ id: `rule ${local(r.id)} clause ${k + 1}`, kind: "rule-clause", conformance: false, route: "i", note: "enforced by checker" });
}
for (const m of mem) {
  const normative = m.clauses.filter((c) => c.route !== "rationale");
  const det = normative.filter((c) => c.route !== "judgment");
  const routeOf = (c: { route: string }) => (c.route === "law" ? "iii" : c.route === "judgment" ? "iv" : "ii");
  const dominant = det.length === 0 ? "iv" : det.some((c) => c.route === "law") && det.every((c) => c.route === "law") ? "iii" : routeOf(det.find((c) => c.route !== "law") ?? det[0]);
  add({ id: `${m.kind} ${m.name}`, kind: m.kind, conformance: true, route: dominant, note: `${det.length}/${normative.length} normative clauses deterministic${m.proxy ? " (proxy)" : ""}` });
}

// ---- outside inspect: review records
const authored = shapeFiles.map((f) => readFileSync(join(REPO, f), "utf8")).join("\n");
const reevals = (authored.match(/^reevaluation\s/gm) ?? []).length;
const attests = (authored.match(/^attest\s/gm) ?? []).length;

// ---- summaries
const by = (pred: (a: Atom) => boolean) => atoms.filter(pred);
const routes = ["i", "ii", "ii-b", "iii", "iv"];
const kinds = [...new Set(atoms.map((a) => a.kind))];
const lines: string[] = [];
lines.push(`atoms: ${atoms.length}; review records outside inspect: reevaluation ${reevals}, attest ${attests}`);
lines.push(`| kind | n | conformance | ${routes.join(" | ")} |`);
lines.push(`|---|---|---|${routes.map(() => "---").join("|")}|`);
for (const k of kinds) {
  const xs = by((a) => a.kind === k);
  lines.push(`| ${k} | ${xs.length} | ${xs[0].conformance ? "yes" : "no"} | ${routes.map((r) => xs.filter((a) => a.route === r).length).join(" | ")} |`);
}
const all = atoms.length;
lines.push(`| total | ${all} | ${by((a) => a.conformance).length} | ${routes.map((r) => by((a) => a.route === r).length).join(" | ")} |`);
const conf = by((a) => a.conformance);
const share = (xs: Atom[], rs: string[]) => xs.filter((a) => rs.includes(a.route)).length;
lines.push("");
lines.push(`source-conformance claims: ${conf.length}`);
lines.push(`  (ii)+(iii) now: ${share(conf, ["ii", "iii"])} = ${(100 * share(conf, ["ii", "iii"]) / conf.length).toFixed(1)}%`);
lines.push(`  (i) already enforced among conformance: ${share(conf, ["i"])}`);
lines.push(`  (i)+(ii)+(iii): ${share(conf, ["i", "ii", "iii"])} = ${(100 * share(conf, ["i", "ii", "iii"]) / conf.length).toFixed(1)}%`);
lines.push(`  (ii-b) needs binding: ${share(conf, ["ii-b"])} = ${(100 * share(conf, ["ii-b"]) / conf.length).toFixed(1)}%`);
lines.push(`  with bindings authored, (i)+(ii)+(ii-b)+(iii): ${share(conf, ["i", "ii", "ii-b", "iii"])} = ${(100 * share(conf, ["i", "ii", "ii-b", "iii"]) / conf.length).toFixed(1)}%`);
lines.push(`  (iv) judgment: ${share(conf, ["iv"])}`);
const exEff = conf.filter((a) => a.kind !== "effect");
lines.push(`  excluding individual effect entries (n=${exEff.length}): (i)+(ii)+(iii) = ${(100 * share(exEff, ["i", "ii", "iii"]) / exEff.length).toFixed(1)}%`);
const resBound = [...bound.values()].filter(Boolean).length;
lines.push(`resources with a code-level name: ${resBound}/${bound.size}`);
const mechCount = (k: string) => { const c: Record<string, number> = {}; for (const a of by((x) => x.kind === k)) c[a.mech ?? "-"] = (c[a.mech ?? "-"] ?? 0) + 1; return JSON.stringify(c); };
lines.push(`mechanical: fn-source ${mechCount("fn-source")}; effect evidence ${mechCount("effect")}; implementation ${mechCount("implementation")}`);
const missing = atoms.filter((a) => a.mech && /missing|unresolved|outside/.test(a.mech));
lines.push(`mechanical discrepancies: ${missing.length}`);
for (const a of missing) lines.push(`  ${a.kind}: ${a.id} -> ${a.mech}`);
writeFileSync(join(OUT, "atoms.json"), JSON.stringify(atoms.map(({ ...a }) => a), null, 1));
writeFileSync(join(OUT, "summary.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));

// ---- seeded random sample of 40 for hand-check
let seed = 20261024;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const idx = new Set<number>();
while (idx.size < 40) idx.add(Math.floor(rnd() * atoms.length));
const sample = [...idx].sort((a, b) => a - b).map((i) => ({ i, ...atoms[i] }));
writeFileSync(join(OUT, "sample40.json"), JSON.stringify(sample, null, 1));
