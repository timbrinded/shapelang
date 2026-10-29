// @ts-nocheck
// H2 drift trial harness: materialises copies of the repository, seeds one edit per copy, runs the
// dogfood providers on base and head, derives the change with the 1.0 prototype, and keeps a
// compact record of every obligation so the classifier can diff each run against the no-op run.
//
// Arms:
//   A  the dogfood model exactly as built (experiments/shape-1/dogfood/shape1.yaml)
//   X  A plus declared intent the dogfood leaves out, applied identically to base and head:
//      - `relations complete over calls` on every component (relations read as the full call set)
//      - tsCalls declared absence-sound, its scope entries marked complete (COUNTERFACTUAL: the
//        scanner drops calls through injected objects, callbacks and dynamic dispatch, so this
//        absence claim is not established; it isolates what the checker does given one)
//      - an ed25519 identity for timbrinded and base-era signed claim judgments of every law that
//        admits judgment (RefactorSensitive guards, DocumentedBy laws), so editing their Req makes
//        them stale rather than missing
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { indexManifest } from "../../proto/src/manifest.ts";
import {
  makeStatement,
  scopeRoot,
  signStatement,
  signerFromSeed
} from "../../proto/src/records.ts";
import { buildWorld, compCode } from "../../proto/src/world.ts";
import { runLaws } from "../../dogfood/providers/bun-test.ts";
import { PROVIDERS, cite, emit, recordTime, viewOf } from "../../dogfood/providers/common.ts";
import { callScan } from "../../dogfood/providers/ts-calls.ts";
import { clockScan } from "../../dogfood/providers/ts-clock-scan.ts";
import {
  composeModel,
  manifestFor,
  materialize,
  readOverlay,
  treeFiles
} from "../../dogfood/tools/lib.ts";

export const NOW = "2026-10-26T00:00:00Z";
export const NOW_S = Math.floor(Date.parse(NOW) / 1000);
export const JUDGE_SEED = createHash("sha256").update("shape-h2-judge-timbrinded").digest("hex");
export const JUDGE = signerFromSeed(JUDGE_SEED);
export const JUDGE_Q = "shape.governance::timbrinded";
export const AUTHORS = [
  { identity: 'github("timbrinded")', verified: true, bot: false },
  { identity: 'github("claude[bot]")', verified: true, bot: true }
];

// ---- tree edits -------------------------------------------------------------------------------

export class Tree {
  touched = new Set<string>();
  constructor(public dir: string) {}
  path(p: string): string {
    return join(this.dir, p);
  }
  read(p: string): string {
    return readFileSync(this.path(p), "utf8");
  }
  write(p: string, s: string): void {
    mkdirSync(dirname(this.path(p)), { recursive: true });
    writeFileSync(this.path(p), s);
    this.touched.add(p);
  }
  /** replace the unique occurrence of `from` */
  rep(p: string, from: string, to: string): void {
    const t = this.read(p);
    const i = t.indexOf(from);
    if (i < 0)
      throw new Error(`rep: anchor not found in ${p}: ${JSON.stringify(from.slice(0, 80))}`);
    if (t.indexOf(from, i + 1) >= 0)
      throw new Error(`rep: anchor not unique in ${p}: ${JSON.stringify(from.slice(0, 80))}`);
    this.write(p, t.slice(0, i) + to + t.slice(i + from.length));
  }
  /** insert text right after the unique anchor */
  ins(p: string, anchor: string, text: string): void {
    this.rep(p, anchor, anchor + text);
  }
  pre(p: string, text: string): void {
    this.write(p, text + this.read(p));
  }
  append(p: string, text: string): void {
    this.write(p, this.read(p) + text);
  }
  mv(from: string, to: string): void {
    mkdirSync(dirname(this.path(to)), { recursive: true });
    renameSync(this.path(from), this.path(to));
    this.touched.add(to);
  }
  /** word-boundary rename in the given files; returns the number of replacements */
  renameWord(files: string[], from: string, to: string): number {
    let n = 0;
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    for (const f of files) {
      if (!existsSync(this.path(f))) continue;
      const t = this.read(f);
      const m = t.match(re);
      if (!m) continue;
      n += m.length;
      this.write(f, t.replace(re, to));
    }
    if (n === 0) throw new Error(`renameWord: ${from} not found`);
    return n;
  }
  /** cut a top-level function (header through its matching closing brace) out of a file */
  cutFunction(p: string, header: string): string {
    const t = this.read(p);
    const i = t.indexOf(header);
    if (i < 0) throw new Error(`cutFunction: ${header} not in ${p}`);
    const open = t.indexOf("{\n", i);
    let depth = 0;
    let j = open;
    for (; j < t.length; j += 1) {
      if (t[j] === "{") depth += 1;
      else if (t[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    // take preceding doc comment too
    let start = i;
    const before = t.slice(0, i);
    const doc = before.lastIndexOf("/**");
    if (
      doc >= 0 &&
      before.slice(doc).trimEnd().endsWith("*/") &&
      !before.slice(doc).includes("\n\n")
    )
      start = doc;
    const fn = t.slice(start, j + 1);
    this.write(p, t.slice(0, start) + t.slice(j + 2));
    return `${fn}\n`;
  }
}

/** All TypeScript-family files under the code roots a rename would touch (an IDE rename). */
export function codeFiles(dir: string): string[] {
  const out: string[] = [];
  const roots = [
    "packages",
    "docs-site/scripts",
    "scripts",
    ".github/scripts",
    "experiments/semantic-kernel/harness",
    "experiments/shape-1/dogfood/laws"
  ];
  const walk = (rel: string): void => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    for (const n of readdirSync(abs)) {
      if (n === "node_modules" || n === "generated" || n === "dist") continue;
      const r = `${rel}/${n}`;
      if (statSync(join(dir, r)).isDirectory()) walk(r);
      else if (/\.(ts|mts|mjs|tsx|js)$/.test(n)) out.push(r);
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

// ---- arms --------------------------------------------------------------------------------------

export type Arm = "A" | "X";

function componentsOf(source): { module: string; name: string }[] {
  const out = [];
  for (const m of source.modules)
    for (const d of m.decls)
      if (d.decl === "component") out.push({ module: m.module, name: d.name });
  return out;
}

export function overlayFor(arm: Arm, comps: { module: string; name: string }[]) {
  const o = structuredClone(readOverlay());
  if (arm === "A") return o;
  const mod = (m: string) => {
    let x = o.modules.find((mm) => mm.module === m);
    if (!x) {
      x = { module: m, imports: [], decls: [] };
      o.modules.push(x);
    }
    return x;
  };
  for (const c of comps)
    mod(c.module).decls.push({ decl: "component", name: c.name, relationsComplete: ["calls"] });
  const g = mod("shape.governance");
  g.decls.push({ decl: "provider", name: "tsCalls", sound: ["presence", "absence"] });
  g.decls.push({
    decl: "actor",
    name: "timbrinded",
    identities: ['github("timbrinded")', JUDGE.identity]
  });
  return o;
}

const decode = (env) => JSON.parse(Buffer.from(env.payload, "base64").toString("utf8"));

/** tsCalls record with every scope entry marked complete (arm X counterfactual). */
function completeCalls(env) {
  const stmt = decode(env);
  const rec = stmt.predicate.shape;
  const entries = rec.scope.entries.map((e) => ({ ...e, complete: true }));
  return emit(PROVIDERS.tsCalls, { ...rec, scope: { root: scopeRoot(entries), entries } }).envelope;
}

/** Req for a claim judgment (mirrors proto/src/laws.ts reqOf for kind "judgment"). */
function judgmentReq(W, M, c): { id: string; projection: string }[] {
  const out = [];
  const projection = c.requirement?.projection ?? "unit";
  const has = (id, p) => !!M.ids.get(id)?.digests.has(p);
  for (const t of c.args.on ?? []) {
    if (t.startsWith("unit ")) {
      const x = W.unitBind.get(t.slice(5)) ?? null;
      if (!x) return [];
      out.push({ id: x, projection });
    } else if (t.startsWith("component ")) {
      const code = compCode(W, t.slice(10));
      const codeSet = new Set(code);
      for (const x of code) {
        const info = M.ids.get(x);
        if (!info?.symbol || !has(x, projection)) continue;
        const parent = info.parent;
        const parentFile = !parent || !M.ids.get(parent)?.symbol;
        if (parentFile || !has(parent, projection) || !codeSet.has(parent))
          out.push({ id: x, projection });
      }
      if (projection === "unit")
        for (const x of code) if (!M.ids.get(x)?.symbol) out.push({ id: x, projection: "own" });
    } else if (t.startsWith("code ")) {
      const x = t.slice(5);
      out.push({ id: x, projection: has(x, "unit") ? "unit" : "file" });
    }
  }
  return out;
}

function judgments(source, manifest) {
  const esf = elaborate(source, { now: NOW_S });
  const M = indexManifest(manifest).index;
  const W = buildWorld(esf, M, { side: "h" });
  const v = viewOf(manifest);
  const out = [];
  const skipped = [];
  for (const c of esf.claims) {
    if (c.op !== "law" || !c.requirement?.judged) continue;
    const req = judgmentReq(W, M, c);
    const code = req.map((p) => cite(v, p.id, p.projection)).filter(Boolean);
    if (req.length === 0 || code.length !== req.length) {
      skipped.push(c.ids[0]);
      continue;
    }
    const seen = new Set();
    const cites = code
      .filter((x) => {
        const k = `${x.id}@${x.projection}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.projection < b.projection ? -1 : 1));
    const rec = {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "supports",
      provider: null,
      revision: v.revision,
      time: recordTime(NOW),
      claim: { id: c.ids[0], fp: c.fp, nf: c.nf },
      code: cites,
      judge: JUDGE_Q
    };
    out.push({ law: c.ids[0], envelope: signStatement(makeStatement(rec), [JUDGE]) });
  }
  return { records: out, skipped };
}

// ---- base --------------------------------------------------------------------------------------

export interface Base {
  arm: Arm;
  revision: string;
  manifest: unknown;
  source: unknown;
  overlay: unknown;
  baseRecords: unknown[];
  judgments: unknown[];
  judged: string[];
  judgmentSkipped: string[];
}

export async function prepareBase(arm: Arm, work: string): Promise<Base> {
  const dir = materialize("HEAD", join(work, "trees", `base-${arm}`));
  const m = await manifestFor(treeFiles(dir));
  const comps = componentsOf(composeModel(m.statement, undefined, dir).source);
  const overlay = overlayFor(arm, comps);
  const source = composeModel(m.statement, overlay, dir).source;
  const clock = await clockScan({ root: dir, manifest: m.statement, now: NOW });
  const calls = await callScan({ root: dir, manifest: m.statement, now: NOW });
  const callsEnv = arm === "X" ? completeCalls(calls.envelope) : calls.envelope;
  const j = arm === "X" ? judgments(source, m.statement) : { records: [], skipped: [] };
  const base = {
    arm,
    revision: m.revision,
    manifest: m.statement,
    source,
    overlay,
    baseRecords: [clock.envelope, callsEnv, ...j.records.map((r) => r.envelope)],
    judgments: j.records.map((r) => r.envelope),
    judged: j.records.map((r) => r.law),
    judgmentSkipped: j.skipped
  };
  writeFileSync(join(work, `base-${arm}.json`), JSON.stringify(base));
  rmSync(dir, { recursive: true, force: true });
  return base;
}

export function loadBase(arm: Arm, work: string): Base {
  return JSON.parse(readFileSync(join(work, `base-${arm}.json`), "utf8"));
}

// ---- one run -----------------------------------------------------------------------------------

/** the compact form of an obligation kept per run */
function compact(o) {
  return {
    key: o.key,
    kind: o.kind,
    reason: o.reason,
    questions: o.questions,
    introduced: o.introduced,
    severity: o.severity,
    tier: o.tier,
    force: o.force,
    budget: o.budget,
    group: o.group,
    claim: o.claim ? o.claim.ids[0] : null,
    claimFp: o.claim ? o.claim.fp : null,
    subject: o.subject,
    witness: o.witness,
    facts: Object.values(o.facts ?? {}).map((f) => ({
      type: f.type,
      at: f.at,
      to: f.to ?? null,
      verb: f.verb ?? null,
      resource: f.resource ?? null,
      claim: f.claim ?? null
    })),
    affected: o.affected ?? [],
    rule: o.rule ?? null,
    exception: o.exception,
    exploited: o.exploited,
    causes: (o.causes ?? []).map((c) => ({ type: c.type, id: c.id }))
  };
}

export async function runSeed(arm: Arm, seed, work: string, base: Base) {
  const t0 = performance.now();
  const dir = materialize("HEAD", join(work, "trees", `${arm}-${seed.id}`));
  const tree = new Tree(dir);
  let applyError = null;
  try {
    seed.apply(tree);
  } catch (e) {
    applyError = String(e);
  }
  const touched = [...tree.touched].sort();
  const parseErrors = await parseCheck(dir, touched);
  const hm = await manifestFor(treeFiles(dir));
  const head = composeModel(hm.statement, base.overlay, dir).source;
  const clock = await clockScan({ root: dir, manifest: hm.statement, now: NOW });
  const calls = await callScan({ root: dir, manifest: hm.statement, now: NOW });
  const callsEnv = arm === "X" ? completeCalls(calls.envelope) : calls.envelope;
  const laws = await runLaws({ root: dir, manifest: hm.statement, source: head, now: NOW });
  const input = {
    contract: "shape.check.input/v1",
    mode: "change",
    now: NOW,
    head: { revision: hm.revision, source: head, manifest: hm.statement },
    base: { revision: base.revision, source: base.source, manifest: base.manifest },
    change: { ids: [`github:timbrinded/shapelang#h2-${seed.id}`] },
    authors: AUTHORS,
    reviews: [],
    records: [clock.envelope, callsEnv, ...laws.records.map((r) => r.envelope), ...base.judgments],
    baseRecords: base.baseRecords,
    persisted: { base: [], head: [] },
    options: { health: true, teeth: false }
  };
  if (process.env.H2_DUMP_INPUT)
    writeFileSync(
      join(process.env.H2_DUMP_INPUT, `${arm}-${seed.id}.input.json`),
      JSON.stringify(input)
    );
  const t1 = performance.now();
  const out = derive(input);
  const t2 = performance.now();
  const clockFacts = decode(clock.envelope).predicate.shape.facts;
  const clockIncomplete = decode(clock.envelope)
    .predicate.shape.scope.entries.filter((e) => !e.complete)
    .map((e) => e.id);
  const h = out.health ?? {};
  const row = {
    arm,
    seed: seed.id,
    cat: seed.cat,
    kind: seed.kind,
    title: seed.title,
    applyError,
    parseErrors,
    touched,
    revision: hm.revision,
    verdict: out.verdict,
    errors: out.errors.map((e) => ({ code: e.code, subject: e.subject, message: e.message })),
    rejected: out.rejected,
    obligations: out.obligations.map(compact),
    loosening: out.loosening,
    renames: out.renames,
    debt: out.debt,
    laws: laws.records.map((r) => ({ law: r.law, result: r.result })),
    lawsUnprovable: laws.unprovable,
    clockFacts,
    clockIncomplete,
    health: {
      coverage: h.coverage ?? null,
      unobservable: Array.isArray(h.unobservable) ? h.unobservable.length : null,
      unmapped: h.unmapped ?? null
    },
    seconds: {
      total: Number(((performance.now() - t0) / 1000).toFixed(1)),
      derive: Number(((t2 - t1) / 1000).toFixed(1))
    }
  };
  rmSync(dir, { recursive: true, force: true });
  return row;
}

/** TypeScript parse diagnostics of the edited files (an edit must not break parsing). */
async function parseCheck(dir: string, files: string[]): Promise<{ file: string; n: number }[]> {
  const { loadTs } = await import("../../dogfood/providers/ts-ident.ts");
  const ts = await loadTs(dir);
  const out = [];
  for (const f of files) {
    if (!/\.(ts|mts|mjs|js)$/.test(f) || !existsSync(join(dir, f))) continue;
    const sf = ts.createSourceFile(
      f,
      readFileSync(join(dir, f), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const n = (sf.parseDiagnostics ?? []).length;
    if (n > 0) out.push({ file: f, n });
  }
  return out;
}
