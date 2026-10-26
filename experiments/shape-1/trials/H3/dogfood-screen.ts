// @ts-nocheck
// H3 dogfood arm, step 1: screen source mutants of the code behind Shape's own tested laws.
// For each dogfood law with an executable property test that holds today, the law's bound unit
// (Req for a `Property<F, text>` law is F's identity at `unit`) and the same-file functions it
// calls (outside Req, inside its behaviour) are mutated with the laws provider's operators
// (proto/providers/laws/mutate.ts). Each mutant is run against the law's own test file in a
// materialised copy of the tree; a mutant the law test rejects is "law-tagged" for the dogfood.
//   bun experiments/shape-1/trials/H3/dogfood-screen.ts --out <screen.json> [--per 8]
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimIndex, materialize, readModel, unitBindings } from "../../dogfood/tools/lib.ts";
import { applyMutant, mutantsOf, pickEven } from "../../proto/providers/laws/mutate.ts";
import { identitySpans, loadTsFull, scriptKindOf } from "../../proto/providers/ts-api.ts";
import { WORK } from "./lib.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = opt("out", join(WORK, "dog-screen.json"));
const PER = Number(opt("per", "8"));
// --where unit,callee,import selects the mutant locations; "import" = functions the unit calls that
// its file imports from another repository file (cross-file callees)
const WHERE = new Set((opt("where", "unit,callee") as string).split(","));
const BOX = opt("box", "screen");
const LAWS_DIR = "experiments/shape-1/dogfood/laws";
const REPO = join(import.meta.dir, "..", "..", "..", "..");

const dir = materialize("HEAD", join(WORK, "dog", BOX));
const ts = await loadTsFull(REPO);
const source = readModel();
const { claims } = claimIndex(source, Math.floor(Date.parse("2026-10-26T00:00:00Z") / 1000));
const binds = unitBindings(source);
const lawFiles = readdirSync(join(dir, LAWS_DIR)).filter((f) => f.endsWith(".law.test.ts")).sort();

function lawVerdicts(file: string): { verdicts: Map<string, boolean>; exit: number; ms: number } {
  const tmp = mkdtempSync(join(WORK, "dog", "v-"));
  const res = join(tmp, "v.jsonl");
  const t0 = Date.now();
  const r = spawnSync("bun", ["test", `${LAWS_DIR}/${file}`], { cwd: dir, env: { ...process.env, SHAPE_LAW_RESULTS: res }, timeout: 300_000, maxBuffer: 1 << 26 });
  const verdicts = new Map();
  if (existsSync(res)) for (const l of readFileSync(res, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l);
    verdicts.set(x.law, x.holds);
  }
  rmSync(tmp, { recursive: true, force: true });
  return { verdicts, exit: r.status ?? 124, ms: Date.now() - t0 };
}

const out = [];
for (const file of lawFiles) {
  const text = readFileSync(join(dir, LAWS_DIR, file), "utf8");
  const ids = [...text.matchAll(/lawTest\("([^"]+)", "(holds|fails)"/g)].map((m) => ({ law: m[1], expect: m[2] }));
  const base = lawVerdicts(file);
  for (const { law, expect } of ids) {
    if (expect !== "holds" || base.verdicts.get(law) !== true) continue;
    const c = claims.find((x) => x.op === "law" && x.ids.includes(law));
    const on = (c?.args?.on ?? []).filter((t) => t.startsWith("unit "));
    if (on.length !== 1) {
      out.push({ law, file, skipped: `on ${JSON.stringify(c?.args?.on)}` });
      continue;
    }
    const unitQ = on[0].slice(5);
    const id = binds.get(unitQ);
    if (!id?.startsWith("ts:")) {
      out.push({ law, file, unit: unitQ, skipped: `binding ${id}` });
      continue;
    }
    const path = id.slice(3).split("#")[0];
    const src = readFileSync(join(dir, path), "utf8");
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, scriptKindOf(ts, path));
    const spans = identitySpans(ts, sf, path);
    const unit = spans.find((s) => s.id === id);
    if (!unit) {
      out.push({ law, file, unit: unitQ, id, skipped: "no span" });
      continue;
    }
    // same-file top-level functions the unit calls (not nested in it, not itself)
    const body = src.slice(unit.start, unit.end);
    const callees = spans.filter((s) => s.symbol && !s.symbol.includes(".") && s.id !== id && s.kind !== "file" && (s.start >= unit.end || s.end <= unit.start) && new RegExp(`\\b${s.symbol.replace(/[$]/g, "\\$")}\\s*[(<]`).test(body));
    const inUnit = WHERE.has("unit") ? pickEven(mutantsOf(ts, path, src, unit), PER).map((m) => ({ where: "unit", at: id, path, src, m })) : [];
    const inCallees = WHERE.has("callee") ? pickEven(callees.flatMap((s) => mutantsOf(ts, path, src, s).map((m) => ({ where: "callee", at: s.id, path, src, m }))), PER) : [];
    // cross-file callees: names the unit calls that the file imports from a relative module
    const imported = [];
    if (WHERE.has("import")) {
      for (const st of sf.statements) {
        if (st.kind !== ts.SyntaxKind.ImportDeclaration || !st.moduleSpecifier?.text?.startsWith(".")) continue;
        const spec = st.moduleSpecifier.text;
        const cand = [spec, spec.replace(/\.js$/, ".ts"), `${spec}.ts`, `${spec}/index.ts`].map((x) => join(path, "..", x).replace(/\\/g, "/"));
        const target = cand.find((x) => existsSync(join(dir, x)) && x.endsWith(".ts"));
        if (!target) continue;
        const names = [];
        const visit = (n) => {
          if (n.kind === ts.SyntaxKind.ImportSpecifier && !n.isTypeOnly) names.push({ local: n.name.text, orig: (n.propertyName ?? n.name).text });
          ts.forEachChild(n, visit);
        };
        if (st.importClause && !st.importClause.isTypeOnly) visit(st.importClause);
        const tsrc = readFileSync(join(dir, target), "utf8");
        const tsf = ts.createSourceFile(target, tsrc, ts.ScriptTarget.Latest, true, scriptKindOf(ts, target));
        const tspans = identitySpans(ts, tsf, target);
        for (const nm of names) {
          if (!new RegExp(`\\b${nm.local}\\s*[(<]`).test(body)) continue;
          const sp = tspans.find((x) => x.symbol === nm.orig);
          if (sp) imported.push({ path: target, src: tsrc, span: sp });
        }
      }
    }
    const inImports = pickEven(imported.flatMap((x) => mutantsOf(ts, x.path, x.src, x.span).map((m) => ({ where: "import", at: x.span.id, path: x.path, src: x.src, m }))), PER);
    const cands = [];
    for (const k of [...inUnit, ...inCallees, ...inImports]) {
      writeFileSync(join(dir, k.path), applyMutant(k.src, k.m));
      const v = lawVerdicts(file);
      writeFileSync(join(dir, k.path), k.src);
      const holds = v.verdicts.get(law);
      cands.push({ where: k.where, at: k.at, path: k.path, mutant: k.m, killed: holds !== true, verdict: holds ?? null, exit: v.exit, otherLawsFailing: [...v.verdicts.entries()].filter(([l, h]) => l !== law && h === false && ids.find((x) => x.law === l)?.expect === "holds").map(([l]) => l), ms: v.ms });
      process.stderr.write(`${law} ${k.where} ${k.at.split("#")[1]} ${k.m.id} -> ${holds === true ? "survives" : "killed"} (${v.ms} ms)\n`);
    }
    out.push({ law, file, unit: unitQ, id, path, callees: callees.map((s) => s.id), imported: imported.map((x) => x.span.id), candidates: cands });
  }
}
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
process.stderr.write(`wrote ${OUT}\n`);
