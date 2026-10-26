// @ts-nocheck
// H6 step 3: law adequacy on Shape's own model. For every TypeScript function some dogfood law is
// bound to (`on unit Q`), source mutants of its span (the laws provider's operators,
// proto/providers/laws/mutate.ts: relational/equality/arithmetic/logical swaps, boolean flips,
// integer +1, dropped negation) are run against the dogfood law suite. A mutant is killed by law L
// when L's verdict (lawkit's $SHAPE_LAW_RESULTS) differs from the unmutated baseline, or the test
// run loses L's verdict (crash or timeout). A mutant no law kills is a gap of the law layer.
//
//   bun experiments/shape-1/trials/H6/law-adequacy.ts --work <dir> [--per 12] [--plan] [--shard i/n]
//
// Static filter (stated assumption): a law test can only kill a mutant in a file inside the test
// file's relative-import closure (all dogfood law files import repository code by relative path);
// mutants in files no law test reaches are recorded as survivors without running.
// Order per mutant: the law files of laws bound to the mutated unit first, then every other law file
// whose closure reaches the file. All reaching files are run (to attribute kills to own/other laws).
// The tree is a materialised copy of HEAD plus the dogfood files (<work>/tree), never the repository.
// Rows -> <work>/law-rows-<i>of<n>.jsonl; plan -> <work>/law-plan.json.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { REPO, claimIndex, materialize, readModel, unitBindings } from "../../dogfood/tools/lib.ts";
import { applyMutant, mutantsOf, pickEven } from "../../proto/providers/laws/mutate.ts";
import { identitySpans, loadTsFull, scriptKindOf } from "../../proto/providers/ts-api.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const WORK = resolve(opt("work", "h6-work"));
const PER = Number(opt("per", "12"));
const PER_CALLEE = Number(opt("per-callee", "8"));
const [SHARD, NSHARD] = (opt("shard", "0/1") as string).split("/").map(Number);
const LAWS_DIR = "experiments/shape-1/dogfood/laws";
const TIMEOUT = 120_000;
const tree = join(WORK, NSHARD > 1 ? `tree-${SHARD}` : "tree");
if (!existsSync(join(tree, LAWS_DIR)) || argv.includes("--fresh")) materialize("HEAD", tree);
const ts = await loadTsFull(REPO);
const source = readModel();
const { claims } = claimIndex(source, Math.floor(Date.parse("2026-10-26T00:00:00Z") / 1000));
const binds = unitBindings(source);
const lawFiles = readdirSync(join(tree, LAWS_DIR)).filter((f) => f.endsWith(".law.test.ts")).sort().map((f) => `${LAWS_DIR}/${f}`);
const fileText = new Map(lawFiles.map((f) => [f, readFileSync(join(tree, f), "utf8")]));

function closure(start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const p = stack.pop() as string;
    if (seen.has(p)) continue;
    seen.add(p);
    let text: string;
    try {
      text = readFileSync(join(tree, p), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const spec = m[1] ?? "";
      const base = relative(tree, resolve(tree, dirname(p), spec)).replace(/\\/g, "/");
      for (const cand of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}/index.ts`]) if (existsSync(join(tree, cand)) && /\.[cm]?[tj]sx?$/.test(cand)) {
        stack.push(cand);
        break;
      }
    }
  }
  return seen;
}
const reach = new Map(lawFiles.map((f) => [f, closure(f)]));

function runAll(): { verdicts: Map<string, boolean>; exit: number; ms: number } {
  return runFile(LAWS_DIR);
}
function runFile(file: string): { verdicts: Map<string, boolean>; exit: number; ms: number } {
  const tmp = mkdtempSync(join(WORK, "v-"));
  const res = join(tmp, "v.jsonl");
  const t0 = Date.now();
  const r = spawnSync("bun", ["test", file], { cwd: tree, env: { ...process.env, SHAPE_LAW_RESULTS: res }, timeout: TIMEOUT, maxBuffer: 1 << 26 });
  const verdicts = new Map<string, boolean>();
  if (existsSync(res)) for (const l of readFileSync(res, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l);
    verdicts.set(x.law, x.holds);
  }
  rmSync(tmp, { recursive: true, force: true });
  return { verdicts, exit: r.status ?? 124, ms: Date.now() - t0 };
}

// ---- plan: law-bound TS units, their laws and mutants -------------------------------------------
const lawsOfFile = new Map(lawFiles.map((f) => [f, [...(fileText.get(f) as string).matchAll(/lawTest\("([^"]+)"/g)].map((m) => m[1])]));
const testedLaw = new Map<string, string>();
for (const [f, ids] of lawsOfFile) for (const id of ids) testedLaw.set(id, f);
const units = new Map();
const nonUnitLaws = [];
for (const c of claims.filter((x) => x.op === "law")) {
  const id = c.ids[0];
  const st = c.args.statement;
  const kind = st.text ? (id.includes("/RefactorSensitive/") ? "informal:RefactorSensitive" : id.includes("Documented") ? "informal:DocumentedBy" : "informal:other") : testedLaw.has(id) ? "tested" : "untested";
  for (const t of c.args.on) {
    if (!t.startsWith("unit ")) {
      nonUnitLaws.push({ law: id, target: t, kind });
      continue;
    }
    const q = t.slice(5);
    const u = units.get(q) ?? { unit: q, id: binds.get(q) ?? null, laws: [] };
    u.laws.push({ law: id, kind, tier: c.tier, file: testedLaw.get(id) ?? null });
    units.set(q, u);
  }
}
const plan = [];
for (const u of [...units.values()].sort((a, b) => (a.unit < b.unit ? -1 : 1))) {
  const row = { ...u, path: null, span: null, mutants: 0, chosen: [], reachedBy: [], skip: null };
  if (!u.id?.startsWith("ts:")) {
    row.skip = `binding ${u.id}`;
    plan.push(row);
    continue;
  }
  const path = u.id.slice(3).split("#")[0];
  row.path = path;
  const text = readFileSync(join(tree, path), "utf8");
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(ts, path));
  const span = identitySpans(ts, sf, path).find((s) => s.id === u.id);
  if (!span) {
    row.skip = "no span";
    plan.push(row);
    continue;
  }
  const ms = mutantsOf(ts, path, text, span);
  row.span = [span.start, span.end];
  row.mutants = ms.length;
  row.chosen = pickEven(ms, PER).map((m) => ({ ...m, where: "unit", at: u.id }));
  // same-file top-level functions the unit calls (outside its span): behaviour Req's unit digest
  // also fingerprints (free names resolve into the unit projection), as in H3's "callee" location
  const spans = identitySpans(ts, sf, path);
  const body = text.slice(span.start, span.end);
  const callees = spans.filter((s) => s.symbol && !s.symbol.includes(".") && s.id !== u.id && s.kind !== "file" && (s.start >= span.end || s.end <= span.start) && new RegExp(`\\b${s.symbol.replace(/[$]/g, "\\$")}\\s*[(<]`).test(body));
  const cm = callees.flatMap((s) => mutantsOf(ts, path, text, s).map((m) => ({ ...m, where: "callee", at: s.id })));
  row.callees = callees.map((s) => s.id);
  row.calleeMutants = cm.length;
  row.chosen.push(...pickEven(cm, PER_CALLEE));
  row.reachedBy = lawFiles.filter((f) => reach.get(f).has(path));
  plan.push(row);
}
writeFileSync(join(WORK, "law-plan.json"), JSON.stringify({ per: PER, lawFiles, nonUnitLaws, units: plan.map((p) => ({ ...p, chosen: p.chosen.map((m) => `${m.where} ${m.at} ${m.id}`) })) }, null, 1));
const tot = plan.reduce((a, p) => a + p.chosen.length, 0);
const reachedJobs = plan.filter((p) => !p.skip && p.reachedBy.length > 0).reduce((a, p) => a + p.chosen.length, 0);
process.stderr.write(`plan: ${plan.length} law-bound units (${plan.filter((p) => !p.skip).length} TS functions), ${plan.reduce((a, p) => a + p.mutants, 0)} mutants, ${tot} chosen, ${plan.filter((p) => !p.skip && p.reachedBy.length === 0).length} units no law file reaches; ${reachedJobs} mutants to run\n`);
if (argv.includes("--plan")) process.exit(0);

// ---- baseline verdicts ------------------------------------------------------------------------
const basePath = join(WORK, "law-baseline.json");
let baseline: Record<string, Record<string, boolean>>;
if (existsSync(basePath)) baseline = JSON.parse(readFileSync(basePath, "utf8"));
else {
  baseline = { all: Object.fromEntries(runAll().verdicts) };
  writeFileSync(basePath, JSON.stringify(baseline, null, 1));
}

// ---- run ----------------------------------------------------------------------------------------
const jobs = plan.filter((p) => !p.skip).flatMap((p) => p.chosen.map((m) => ({ p, m })));
const mine = jobs.filter((_, i) => i % NSHARD === SHARD);
const out = join(WORK, `law-rows-${SHARD}of${NSHARD}.jsonl`);
writeFileSync(out, "");
for (const { p, m } of mine) {
  const row = { unit: p.unit, id: p.id, path: p.path, where: m.where, at: m.at, mutant: m.id, op: m.op, laws: p.laws.map((l) => `${l.kind}:${l.law}`), reached: p.reachedBy.length, ran: false, exit: null, killedBy: [], ms: 0 };
  if (p.reachedBy.length > 0) {
    const text = readFileSync(join(tree, p.path), "utf8");
    writeFileSync(join(tree, p.path), applyMutant(text, m));
    try {
      const r = runAll();
      row.ran = true;
      row.ms = r.ms;
      row.exit = r.exit;
      for (const [law, holds] of Object.entries(baseline.all)) if (r.verdicts.get(law) !== holds) row.killedBy.push(law);
    } finally {
      writeFileSync(join(tree, p.path), text);
    }
  }
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  process.stderr.write(`${p.unit} ${m.where} ${m.id} -> ${row.killedBy.length > 0 ? `killed by ${row.killedBy.length}` : row.ran ? "SURVIVES" : "unreached"} (${row.ms} ms)\n`);
}
process.stderr.write(`done ${mine.length}\n`);
