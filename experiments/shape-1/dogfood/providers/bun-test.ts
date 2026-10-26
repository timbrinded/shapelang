// bunTest: runs the dogfood law tests (experiments/shape-1/dogfood/laws/*.law.test.ts) with
// `bun test` and emits one Test Result record per law claim.
//
// A law test is named by its claim id and reports the property's verdict through lawkit
// ($SHAPE_LAW_RESULTS), so a law the code contradicts yields a `contradicts` record with its
// counterexample even though the repository's test suite stays green. Each record cites Req for a
// test (the bound unit at `unit`), lists the law files the test imports as `harness` and the
// repository code it imports as `deps` (at `file`). Soundness: presence (a failing case is a
// replayable input on which the property fails); tests sample, so never absence.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { Statement } from "../../proto/src/manifest.ts";
import type { CodeCite, ShapeRecord } from "../../proto/src/records.ts";
import type { SourceDoc } from "../../proto/src/source.ts";
import { type ClaimInfo, claimIndex, unitBindings } from "../tools/lib.ts";
import { PROVIDERS, cite, emit, fileCite, recordTime, sortCites, viewOf } from "./common.ts";

export const LAWS_DIR = "experiments/shape-1/dogfood/laws";
/** The templates bunTest declares it decides (shape1.yaml). */
export const DECIDES = ["shape.governance::Property", "shape.governance::Idempotent", "shape.governance::ShortestWitness", "std::Deterministic"];

interface Verdict {
  law: string;
  holds: boolean;
  cases: number;
  seed: number;
  counterexample: { index: number; detail: string } | null;
  /** set for a decided law with no test: emitted as `inconclusive` */
  untested?: true;
}

export interface LawRun {
  records: { envelope: unknown; id: string; law: string; result: string }[];
  verdicts: Verdict[];
  missingClaims: string[];
  unprovable: { law: string; reason: string }[];
  exitCode: number | null;
}

/** Relative imports of a TS file, resolved to repository paths, transitively. */
function importClosure(root: string, start: string): string[] {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const p = stack.pop() as string;
    if (seen.has(p)) continue;
    seen.add(p);
    let text: string;
    try {
      text = readFileSync(join(root, p), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const spec = m[1] ?? "";
      const target = relative(root, resolve(root, dirname(p), spec)).replace(/\\/g, "/");
      if (existsSync(join(root, target))) stack.push(target);
    }
  }
  return [...seen].sort();
}

export async function runLaws(opts: { root: string; manifest: Statement; source: SourceDoc; now: string }): Promise<LawRun> {
  const v = viewOf(opts.manifest);
  const tmp = mkdtempSync(join(tmpdir(), "shape-laws-"));
  const results = join(tmp, "verdicts.jsonl");
  const run = spawnSync("bun", ["test", LAWS_DIR], { cwd: opts.root, env: { ...process.env, SHAPE_LAW_RESULTS: results }, encoding: "utf8", maxBuffer: 1 << 28 });
  const verdicts = new Map<string, Verdict>();
  if (existsSync(results)) for (const line of readFileSync(results, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(line) as Verdict;
    verdicts.set(x.law, x);
  }
  rmSync(tmp, { recursive: true, force: true });
  const { claims } = claimIndex(opts.source, Math.floor(Date.parse(opts.now) / 1000));
  const byId = new Map<string, ClaimInfo>();
  for (const c of claims) for (const id of c.ids) if (c.op === "law") byId.set(id, c);
  const binds = unitBindings(opts.source);
  const lawFiles = readdirSync(join(opts.root, LAWS_DIR)).filter((f) => f.endsWith(".law.test.ts")).sort().map((f) => `${LAWS_DIR}/${f}`);
  const fileOf = (law: string): string | undefined => lawFiles.find((f) => readFileSync(join(opts.root, f), "utf8").includes(`"${law}"`));
  const out: LawRun = { records: [], verdicts: [...verdicts.values()].sort((a, b) => (a.law < b.law ? -1 : 1)), missingClaims: [], unprovable: [], exitCode: run.status };
  // Laws this provider decides (by template) but has no test for get an `inconclusive` record:
  // an authenticated provider must answer for every law it decides (E-provider-missing).
  const decided = (c: ClaimInfo): boolean => DECIDES.includes(String((c.args.statement as { schema?: string } | undefined)?.schema ?? ""));
  const untested = [...new Map([...byId.entries()].filter(([id, c]) => decided(c) && !verdicts.has(id) && c.ids[0] === id)).keys()].sort();
  const todo: Verdict[] = [...out.verdicts, ...untested.map((law): Verdict => ({ law, holds: false, cases: 0, seed: 0, counterexample: null, untested: true }))];
  for (const verdict of todo) {
    const claim = byId.get(verdict.law);
    if (!claim) {
      out.missingClaims.push(verdict.law);
      continue;
    }
    const code: CodeCite[] = [];
    let reason: string | null = null;
    for (const t of (claim.args.on as string[]) ?? []) {
      if (!t.startsWith("unit ")) {
        reason = `target ${t} is not a unit`;
        continue;
      }
      const id = binds.get(t.slice(5));
      const c = id ? cite(v, id, "unit") : null;
      if (!c) reason = `${t} binds ${id ?? "nothing"}, which has no unit projection in the manifest`;
      else code.push(c);
    }
    if (reason || code.length === 0) {
      out.unprovable.push({ law: verdict.law, reason: reason ?? "no code" });
      continue;
    }
    const file = fileOf(verdict.law);
    const closure = file ? importClosure(opts.root, file) : [];
    const harness = sortCites(closure.filter((p) => p.startsWith(`${LAWS_DIR}/`)).flatMap((p) => fileCite(v, p) ?? []));
    const deps = sortCites(closure.filter((p) => !p.startsWith(`${LAWS_DIR}/`)).flatMap((p) => fileCite(v, p) ?? []));
    const rec: ShapeRecord = {
      v: "shape.evidence.v1",
      kind: "test",
      result: "untested" in verdict ? "inconclusive" : verdict.holds ? "supports" : "contradicts",
      provider: { id: PROVIDERS.bunTest.q, version: PROVIDERS.bunTest.version },
      revision: v.revision,
      time: recordTime(opts.now),
      claim: { id: verdict.law, fp: claim.fp, nf: claim.nf },
      code: sortCites(code),
      deps,
      harness,
      assumptions: [],
      bound: { cases: verdict.cases, seed: verdict.seed },
      counterexample: verdict.counterexample ? { index: verdict.counterexample.index, seed: verdict.seed, detail: verdict.counterexample.detail } : null
    };
    const { envelope, id } = emit(PROVIDERS.bunTest, rec);
    out.records.push({ envelope, id, law: verdict.law, result: rec.result });
  }
  return out;
}
