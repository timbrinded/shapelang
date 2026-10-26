// laws (tested): runs bun:test law files bound to law claims and emits one Test Result record per
// claim, citing Req(c, test) from the head manifest (A.5.3.4), the law files as harness, the code's
// module closure as deps, the tested bound {runs, seed, domain, mutants} and, for failures, the
// shrunk counterexample. Soundness: presence (a counterexample is a replayable input on which the
// property fails at the cited code); never absence (tests sample).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Ctx } from "../../src/context.ts";
import { globMatches } from "../../src/globs.ts";
import { claimMatches, reqOf } from "../../src/laws.ts";
import type { Claim, JsonValue } from "../../src/model.ts";
import type { CodeCite, ShapeRecord, Signer } from "../../src/records.ts";
import type { SourceDoc } from "../../src/source.ts";
import { cmpStr } from "../../src/util.ts";
import { buildWorld } from "../../src/world.ts";
import {
  type Emitted,
  type Manifested,
  type ProviderInfo,
  REPO_ROOT,
  cite,
  elaborateAt,
  emit,
  fileIdentity,
  providerName,
  selfValidate,
  sortCites
} from "../common.ts";
import { diskClosure, moduleClosure } from "../modgraph.ts";
import { identitySpans, loadTsFull, scriptKindOf } from "../ts-api.ts";
import { applyMutant, mutantsOf, pickEven } from "./mutate.ts";
import type { LawLine } from "./pbt.ts";

export const LAWS_VERSION = "0.1.0";
export const DEFAULT_LAWS_IMPLEMENTATION = ["experiments/shape-1/proto/providers/laws/**", "package.json", "bun.lock"];

/** The provider declaration the shape carries for a laws runner. */
export function lawsProvider(o: {
  q: string;
  decides: string[];
  identity?: string;
  implementation?: string[];
  depsComplete?: boolean;
  version?: string;
}): ProviderInfo {
  return {
    q: o.q,
    version: o.version ?? `${LAWS_VERSION} bun@${Bun.version}`,
    decl: {
      decl: "provider",
      name: providerName(o.q),
      produces: ["test"],
      decides: [...o.decides].sort(cmpStr),
      sound: ["presence"],
      trusts: [["bun", Bun.version]],
      ...(o.depsComplete ? { depsComplete: true } : {}),
      ...(o.identity ? { identity: o.identity } : {}),
      implementation: { paths: [...(o.implementation ?? DEFAULT_LAWS_IMPLEMENTATION)].sort(cmpStr) }
    }
  };
}

export interface LawsOptions {
  info: ProviderInfo;
  source: SourceDoc;
  man: Manifested;
  /** absolute directory holding the manifest's tree; law files run with it as cwd */
  root: string;
  /** repo-relative law files using providers/laws/pbt.ts */
  lawFiles: string[];
  /** plain bun:test files bound to a claim: pass → supports, fail → inconclusive */
  binds?: { claim: string; file: string }[];
  signer: Signer | null;
  time: string;
  /** mutants per claim for bound.mutants (0: none) */
  mutants?: number;
  timeoutMs?: number;
  /** base directory for sandboxes (default $SHAPE_TMP or the OS temp dir) */
  tmp?: string;
  seed?: number;
}

export interface ClaimResult {
  id: string;
  fp: string;
  result: "supports" | "contradicts" | "inconclusive";
  runs: number;
  laws: number;
  record: string | null;
  counterexample?: JsonValue;
  mutants?: { total: number; killed: number; survivors: string[] } | { error: string };
  error?: string;
}

export interface LawsReport {
  v: "shape.laws.report.v1";
  provider: string;
  revision: string;
  files: { file: string; exit: number; lines: number; ms: number }[];
  claims: ClaimResult[];
  unknown: { file: string; claim: string }[];
  rejected: { record: string; code: string; detail: string }[];
}

interface FileRun {
  exit: number;
  lines: LawLine[];
  ms: number;
  timedOut: boolean;
  stderr: string;
}

function readTextOrNull(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function tmpBase(o: { tmp?: string }): string {
  return o.tmp ?? process.env.SHAPE_TMP ?? tmpdir();
}

/** Runs one law file under bun test with SHAPE_LAWS_OUT and returns its JSON lines. */
export function runLawFile(root: string, file: string, opts: { timeoutMs?: number; seed?: number; tmp?: string }): FileRun {
  const dir = mkdtempSync(join(tmpBase(opts), "shape-laws-out-"));
  const out = join(dir, "lines.jsonl");
  writeFileSync(out, "");
  const t0 = Date.now();
  const r = spawnSync("bun", ["test", resolve(root, file)], {
    cwd: root,
    env: { ...process.env, SHAPE_LAWS_OUT: out, SHAPE_LAWS_SEED: String(opts.seed ?? 42) },
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 1 << 26
  });
  const ms = Date.now() - t0;
  const lines = readFileSync(out, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LawLine);
  rmSync(dir, { recursive: true, force: true });
  const timedOut = r.error !== undefined && /ETIMEDOUT|timed out/i.test(String(r.error));
  return { exit: r.status ?? (timedOut ? 124 : 1), lines, ms, timedOut, stderr: (r.stderr?.toString() ?? "").slice(-2000) };
}

function minimalCtx(world: ReturnType<typeof buildWorld>, man: Manifested): Ctx {
  // reqOf reads only ctx.Wh and ctx.Mh (src/laws.ts); a full Ctx is built only inside derive.
  return { Wh: world, Mh: man.index } as unknown as Ctx;
}

export async function runLaws(o: LawsOptions): Promise<{ records: Emitted[]; report: LawsReport }> {
  const esf = elaborateAt(o.source, o.time);
  const world = buildWorld(esf, o.man.index, { side: "h" });
  const ctx = minimalCtx(world, o.man);
  const laws = esf.claims.filter((c) => c.op === "law");
  const implGlobs = o.info.decl.implementation?.paths ?? [];
  const isImpl = (p: string): boolean => implGlobs.some((g) => globMatches(g, p));
  const report: LawsReport = { v: "shape.laws.report.v1", provider: o.info.q, revision: o.man.revision, files: [], claims: [], unknown: [], rejected: [] };

  // 1. run every law file once
  const byClaim = new Map<string, { claim: Claim; lines: LawLine[]; files: Set<string>; failedFiles: Set<string> }>();
  const touch = (c: Claim): { claim: Claim; lines: LawLine[]; files: Set<string>; failedFiles: Set<string> } => {
    const e = byClaim.get(c.fp) ?? { claim: c, lines: [], files: new Set<string>(), failedFiles: new Set<string>() };
    byClaim.set(c.fp, e);
    return e;
  };
  const resolveClaim = (sel: string): Claim | undefined => laws.find((c) => claimMatches(sel, c));
  const runs = new Map<string, FileRun>();
  const allFiles = [...new Set([...o.lawFiles, ...(o.binds ?? []).map((b) => b.file)])].sort(cmpStr);
  for (const f of allFiles) {
    const run = runLawFile(o.root, f, { timeoutMs: o.timeoutMs, seed: o.seed, tmp: o.tmp });
    runs.set(f, run);
    report.files.push({ file: f, exit: run.exit, lines: run.lines.length, ms: run.ms });
    for (const line of run.lines) {
      const c = resolveClaim(line.claim);
      if (!c) {
        report.unknown.push({ file: f, claim: line.claim });
        continue;
      }
      const e = touch(c);
      e.lines.push({ ...line, file: f });
      e.files.add(f);
    }
  }
  for (const b of o.binds ?? []) {
    const c = resolveClaim(b.claim);
    const run = runs.get(b.file);
    if (!c || !run) {
      report.unknown.push({ file: b.file, claim: b.claim });
      continue;
    }
    const e = touch(c);
    e.files.add(b.file);
    if (run.exit !== 0) e.failedFiles.add(b.file);
    else if (!e.lines.some((l) => l.file === b.file)) e.lines.push({ claim: b.claim, name: "", file: b.file, result: "supports", runs: 1, seed: 0 });
  }
  // a law file that crashed before reporting leaves its claims inconclusive
  for (const e of byClaim.values()) for (const f of e.files) if ((runs.get(f)?.exit ?? 0) !== 0 && !e.lines.some((l) => l.file === f && l.result === "contradicts")) e.failedFiles.add(f);

  // 2. one record per claim
  const ts = await loadTsFull(REPO_ROOT);
  const records: Emitted[] = [];
  for (const e of [...byClaim.values()].sort((a, b) => cmpStr(a.claim.ids[0] ?? a.claim.fp, b.claim.ids[0] ?? b.claim.fp))) {
    const c = e.claim;
    const id = c.ids[0] ?? c.fp;
    const req = reqOf(ctx, c, "test", "unit");
    const code: CodeCite[] = [];
    let error: string | undefined;
    for (const p of req) {
      const ci = cite(o.man.index, p.id, p.projection);
      if (!ci) error = `Req ${p.id}@${p.projection} is not in the head manifest`;
      else code.push(ci);
    }
    if (code.length === 0) error = error ?? "empty Req";
    const lines = [...e.lines].sort((a, b) => cmpStr(a.file, b.file) || cmpStr(a.name, b.name));
    const contra = lines.find((l) => l.result === "contradicts" && l.counterexample !== undefined && l.counterexample !== null);
    const result: ClaimResult["result"] = contra ? "contradicts" : e.failedFiles.size > 0 || lines.length === 0 || lines.some((l) => l.result !== "supports") ? "inconclusive" : "supports";
    const runsTotal = lines.reduce((s, l) => s + (Number.isSafeInteger(l.runs) ? l.runs : 0), 0);
    const cr: ClaimResult = { id, fp: c.fp, result, runs: runsTotal, laws: lines.length, record: null };
    if (contra) cr.counterexample = contra.counterexample as JsonValue;
    if (error) {
      cr.error = error;
      report.claims.push(cr);
      continue;
    }
    // harness: law files and their local imports beyond the code under test and the runner
    const codeFiles = [...new Set(code.map((x) => o.man.index.ids.get(x.id)?.path).filter((p): p is string => !!p))];
    const depPaths = moduleClosure(codeFiles, o.man.index.paths, o.man.read);
    const lawClosure = moduleClosure([...e.files], o.man.index.paths, o.man.read);
    const harness: CodeCite[] = [];
    for (const p of lawClosure) {
      if (depPaths.includes(p) || isImpl(p)) continue;
      const fid = fileIdentity(o.man.index, p);
      const ci = fid ? cite(o.man.index, fid, "file") : null;
      if (ci) harness.push(ci);
    }
    const reqKeys = new Set(code.map((x) => `${x.id}@${x.projection}`));
    const deps: CodeCite[] = [];
    for (const p of depPaths) {
      const fid = fileIdentity(o.man.index, p);
      const ci = fid ? cite(o.man.index, fid, "file") : null;
      if (ci && !reqKeys.has(`${ci.id}@${ci.projection}`)) deps.push(ci);
    }
    // mutants of the cited code (law teeth)
    if ((o.mutants ?? 0) > 0 && result === "supports") {
      cr.mutants = ts ? mutationRun(o, ts, code, [...e.files].sort(cmpStr), c, lawClosure, depPaths) : { error: "no TypeScript compiler found" };
    }
    const seeds = lines.map((l) => l.seed).filter((s) => Number.isSafeInteger(s));
    const domains = [...new Set(lines.map((l) => l.domain).filter((d): d is string => typeof d === "string"))].sort(cmpStr);
    const bound: Record<string, JsonValue> = { runs: runsTotal, seed: seeds.length > 0 ? Math.min(...seeds) : 0, laws: lines.length };
    if (domains.length > 0) bound.domain = domains;
    if (cr.mutants && !("error" in cr.mutants)) bound.mutants = { total: cr.mutants.total, killed: cr.mutants.killed };
    const rec: ShapeRecord = {
      v: "shape.evidence.v1",
      kind: "test",
      result,
      provider: { id: o.info.q, version: o.info.version },
      revision: o.man.revision,
      time: o.time,
      claim: { id, fp: c.fp, nf: c.nf },
      code: sortCites(code),
      deps: sortCites(deps),
      harness: sortCites(harness),
      assumptions: [{ id: `bun@${Bun.version}`, kind: "tool" }],
      bound,
      ...(contra ? { counterexample: { law: contra.name || null, input: contra.counterexample as JsonValue, ...(contra.error ? { error: contra.error } : {}) } } : {})
    };
    const em = emit(rec, o.signer);
    const rej = selfValidate(em, o.info, o.man.index, o.time);
    if (rej) report.rejected.push(rej);
    else records.push(em);
    cr.record = em.id;
    report.claims.push(cr);
  }
  report.unknown.sort((a, b) => cmpStr(a.file, b.file) || cmpStr(a.claim, b.claim));
  return { records, report };
}

/** Runs the claim's law files against source mutants of its cited TS code in a sandbox copy of
 *  the module closure; a mutant is killed when the claim no longer only supports. */
function mutationRun(
  o: LawsOptions,
  ts: NonNullable<Awaited<ReturnType<typeof loadTsFull>>>,
  code: CodeCite[],
  lawFiles: string[],
  c: Claim,
  lawClosure: string[],
  depPaths: string[]
): { total: number; killed: number; survivors: string[] } | { error: string } {
  const targets: { path: string; text: string; start: number; end: number; id: string }[] = [];
  for (const ci of code) {
    const info = o.man.index.ids.get(ci.id);
    if (!info || info.lang !== "ts" || !info.symbol) continue;
    const text = o.man.read(info.path);
    if (text === null) continue;
    const sf = ts.createSourceFile(info.path, text, ts.ScriptTarget.Latest as number, true, scriptKindOf(ts, info.path));
    const span = identitySpans(ts, sf, info.path).find((s) => s.id === ci.id);
    if (span) targets.push({ path: info.path, text, start: span.start, end: span.end, id: ci.id });
  }
  if (targets.length === 0) return { error: "no TypeScript unit to mutate" };
  const all = targets.flatMap((t) => mutantsOf(ts, t.path, t.text, t).map((m) => ({ t, m })));
  const chosen = pickEven(all, o.mutants ?? 0);
  // sandbox: the law and code module closures plus root configuration
  const box = mkdtempSync(join(tmpBase(o), "shape-laws-mut-"));
  try {
    // tracked closures from the manifest's view, plus untracked law files and helpers from disk
    const files = [...new Set([...lawClosure, ...depPaths, ...diskClosure(o.root, [...lawFiles, ...targets.map((t) => t.path)])])];
    for (const p of files) {
      const text = o.man.read(p) ?? readTextOrNull(join(o.root, p));
      if (text === null) continue;
      mkdirSync(dirname(join(box, p)), { recursive: true });
      writeFileSync(join(box, p), text);
    }
    for (const cfg of ["package.json", "tsconfig.json", "bunfig.toml"]) {
      const src = join(o.root, cfg);
      if (existsSync(src) && !existsSync(join(box, cfg))) copyFileSync(src, join(box, cfg));
    }
    if (existsSync(join(o.root, "node_modules"))) symlinkSync(join(o.root, "node_modules"), join(box, "node_modules"));
    const supportsOnly = (): boolean => {
      let any = false;
      for (const f of lawFiles) {
        const r = runLawFile(box, f, { timeoutMs: Math.min(o.timeoutMs ?? 30_000, 30_000), seed: o.seed, tmp: o.tmp });
        const mine = r.lines.filter((l) => claimMatches(l.claim, c));
        if (r.timedOut) return false;
        if (mine.some((l) => l.result !== "supports")) return false;
        if (mine.length === 0 && r.exit !== 0) return false;
        if (mine.length > 0) any = true;
      }
      return any;
    };
    if (!supportsOnly()) return { error: "the unmutated law does not pass in the sandbox" };
    let killed = 0;
    const survivors: string[] = [];
    for (const { t, m } of chosen) {
      writeFileSync(join(box, t.path), applyMutant(t.text, m));
      const alive = supportsOnly();
      writeFileSync(join(box, t.path), t.text);
      if (alive) survivors.push(`${t.id} ${m.id}`);
      else killed += 1;
    }
    return { total: chosen.length, killed, survivors: survivors.slice(0, 20) };
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}
