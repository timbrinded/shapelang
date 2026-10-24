// C4: derive component-to-component call edges from the TypeScript call graph
// over Shape source references and compare them with authored `calls`
// relations. Usage: bun calls.mjs  (writes $CWORK/c4/calls.json, prints tables)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO, WORK } from "../lib/work.mjs";
import { buildProgram, createGraph, findSourceUnit, ts } from "../c3/graph.mjs";

const OUT = join(WORK, "c4");
mkdirSync(OUT, { recursive: true });
const fixtureFiles = [];
for (const fx of ["root-cause-grouping", "cross-object", "stale-model"]) {
  const dir = join(REPO, "fixtures/skills/review", fx, "candidate");
  for (const f of readdirSync(dir)) fixtureFiles.push(join(dir, f));
}
const env = buildProgram(fixtureFiles);
const graph = createGraph(env);

function inspect(files) {
  const r = spawnSync("bun", [join(REPO, "packages/shp-cli/src/index.ts"), "inspect", "--json", ...files], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

function topLevelUnits(file) {
  const sf = env.program.getSourceFile(file);
  if (!sf) return [];
  const out = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) out.push(graph.unitOf(st));
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) out.push(graph.unitOf(d));
  }
  return out.filter(Boolean);
}

function analyzeModel(name, files, membership = "symbol") {
  const doc = inspect(files);
  const short = (id) => id.split("::").pop();
  const fns = new Map(doc.functions.map((f) => [f.id, f]));
  const members = new Map(); // component -> Set(unit)
  const memberOf = new Map(); // unit -> Set(component)
  const notes = {};
  for (const c of doc.components) {
    const set = new Set();
    for (const fid of c.functions) {
      const fn = fns.get(fid);
      if (fn?.source?.language !== "ts") continue;
      const [file, symbol] = fn.source.path.split("#");
      if (symbol) {
        const found = findSourceUnit(env, graph, join(REPO, file), symbol);
        if (found.unit) set.add(found.unit);
        if (membership === "file") for (const u of topLevelUnits(join(REPO, file))) set.add(u);
      } else {
        for (const u of topLevelUnits(join(REPO, file))) set.add(u);
        (notes[short(c.id)] ??= []).push(`file-level members from ${file}`);
      }
    }
    members.set(c.id, set);
    for (const u of set) (memberOf.get(u) ?? memberOf.set(u, new Set()).get(u)).add(c.id);
  }

  // Observed edges, two variants: "direct" (a member's own body calls or
  // references another component's member) and "transitive" (through
  // repo-local units that belong to no component). Each variant is computed
  // with all edge kinds and with call/new edges only.
  const observed = { direct: new Map(), transitive: new Map(), directCallsOnly: new Map(), transitiveCallsOnly: new Map() };
  const openness = new Map(); // component -> unresolved call count in its transitive closure
  for (const [cid, set] of members) {
    if (set.size === 0) continue;
    let unknown = 0;
    for (const variant of ["direct", "transitive", "directCallsOnly", "transitiveCallsOnly"]) {
      const callsOnly = variant.endsWith("CallsOnly");
      const transitive = variant.startsWith("transitive");
      const seen = new Set(set);
      const queue = [...set].map((u) => ({ u, path: [graph.analyze(u).key] }));
      while (queue.length) {
        const { u, path } = queue.shift();
        const facts = graph.analyze(u);
        if (variant === "transitive") unknown += facts.unknown.length;
        for (const e of facts.edges) {
          if (callsOnly && !(e.kind === "call" || e.kind === "new")) continue;
          const owners = memberOf.get(e.target);
          if (owners && !owners.has(cid)) {
            for (const other of owners) {
              const k = `${cid} -> ${other}`;
              if (!observed[variant].has(k)) observed[variant].set(k, [...path, `-${e.kind}@${e.line}-> ${graph.analyze(e.target).key}`]);
            }
            continue;
          }
          if (seen.has(e.target)) continue;
          if (!owners && !transitive) continue;
          seen.add(e.target);
          queue.push({ u: e.target, path: [...path, `-${e.kind}@${e.line}-> ${graph.analyze(e.target).key}`] });
        }
      }
    }
    openness.set(cid, unknown);
  }

  const authored = doc.relations.filter((r) => r.kind === "calls" && r.origin === "authored");
  const pairs = new Map();
  for (const r of authored) {
    const k = `${r.from} -> ${r.to}`;
    (pairs.get(k) ?? pairs.set(k, []).get(k)).push(r.name);
  }
  const result = { name, membership, relations: authored.length, pairs: [], undeclared: {}, notes, members: {} };
  for (const [cid, set] of members) result.members[short(cid)] = [...set].map((u) => graph.analyze(u).key);
  for (const [k, names] of pairs) {
    const [from, to] = k.split(" -> ");
    const row = { from: short(from), to: short(to), names };
    if ((members.get(from)?.size ?? 0) === 0) row.status = "uncheckable (source has no ts members)";
    else {
      for (const v of Object.keys(observed)) row[v] = observed[v].has(k);
      row.witness = observed.transitive.get(k) ?? null;
      row.sourceUnresolvedCalls = openness.get(from);
      row.targetMembers = members.get(to)?.size ?? 0;
      if (row.transitive) row.status = "confirmed";
      else row.status = openness.get(from) === 0 ? "contradicted (closed source closure)" : "unconfirmed (source closure has unresolved calls)";
    }
    result.pairs.push(row);
  }
  for (const v of Object.keys(observed)) {
    result.undeclared[v] = [...observed[v]].filter(([k]) => !pairs.has(k)).map(([k, path]) => {
      const [from, to] = k.split(" -> ");
      return { from: short(from), to: short(to), witness: path };
    });
  }
  return result;
}

const SHAPE_FILES = ["shape/checker.shape", "shape/delivery.shape", "shape/incremental-checker.shape", "shape/language.shape", "shape/runtime.shape", "shape/tooling.shape"];
const results = [
  analyzeModel("shape", SHAPE_FILES),
  ...["root-cause-grouping", "cross-object", "stale-model"].map((fx) => analyzeModel(`fixture:${fx}`, [`fixtures/skills/review/${fx}/shape/model.shape`])),
  analyzeModel("shape", SHAPE_FILES, "file")
];
writeFileSync(join(OUT, "calls.json"), JSON.stringify(results, null, 2));
for (const r of results) {
  const by = (s) => r.pairs.filter((p) => p.status.startsWith(s)).length;
  console.log(`\n## ${r.name} (${r.membership}-level membership): ${r.relations} authored calls relations, ${r.pairs.length} distinct pairs; confirmed ${by("confirmed")}, contradicted ${by("contradicted")}, unconfirmed-open ${by("unconfirmed")}, uncheckable ${by("uncheckable")}`);
  for (const v of ["direct", "transitive", "directCallsOnly", "transitiveCallsOnly"]) {
    const checkable = r.pairs.filter((p) => !p.status.startsWith("uncheckable"));
    console.log(`  ${v}: authored confirmed ${checkable.filter((p) => p[v]).length}/${checkable.length}; undeclared observed ${r.undeclared[v].length}`);
  }
  for (const p of r.pairs) console.log(`  ${p.status.padEnd(52)} ${p.from} -> ${p.to}  [d=${p.direct ? 1 : 0} t=${p.transitive ? 1 : 0} dc=${p.directCallsOnly ? 1 : 0} tc=${p.transitiveCallsOnly ? 1 : 0}] unresolved=${p.sourceUnresolvedCalls ?? "-"} targetMembers=${p.targetMembers ?? "-"}`);
  for (const u of r.undeclared.transitive) console.log(`  UNDECLARED ${u.from} -> ${u.to}: ${u.witness.join(" ")}`);
}
