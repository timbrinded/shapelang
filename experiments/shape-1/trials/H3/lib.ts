// @ts-nocheck
// H3 shared library: the three Bend-probe generation tasks (T1 wrap board, T3 audit log, T4 ledger)
// modelled in Shape 1.0 form, a law-suite provider adapter, and the derive driver.
//
// The adapter runs an agent-written plain bun:test law suite (bendexp/g8/<task>/test/laws.test.ts)
// with bun's JUnit reporter, maps each test case to a contract law by its name, and emits one
// Test Result record per law claim through the prototype's record library. A law whose tests all
// pass is `supports`; a failing test with an error message is `contradicts` with that message as
// the counterexample (mapping "contra"), or `inconclusive` without one (mapping "inconcl", which is
// what the stock `laws run --bind` route does for plain bun:test files).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { reqOf } from "../../proto/src/laws.ts";
import { signerFromSeed } from "../../proto/src/records.ts";
import { buildWorld } from "../../proto/src/world.ts";
import {
  cite,
  elaborateAt,
  emit,
  fileIdentity,
  manifestFor,
  sortCites
} from "../../proto/providers/common.ts";
import { moduleClosure } from "../../proto/providers/modgraph.ts";

export const SCRATCH =
  "/tmp/claude-0/-home-user-shapelang/83ff80bc-0161-572f-9e5a-9075cccad6d0/scratchpad";
export const BENDEXP = `${SCRATCH}/bendexp`;
export const WORK = `${SCRATCH}/shape1work/H3`;
export const H3_DIR = import.meta.dir;

export const NOW = "2026-10-26T00:00:00Z";
export const REC_TIME = "2026-10-25T23:00:00Z";
export const AUTHORS = [{ identity: 'github("acme-code-agent[bot]")', verified: true, bot: true }];
export const PROVIDER_SEED = createHash("sha256")
  .update("shape-h3-law-suite-provider")
  .digest("hex");
export const SIGNER = signerFromSeed(PROVIDER_SEED);

// ---- tasks -------------------------------------------------------------------------------------

/** A contract law: `named` are the API units its statement mentions, `principal` the one unit a
 *  dogfood-style `Property<F, text>` binding would name. */
export interface Law {
  key: string;
  name: string;
  text: string;
  named: string[];
  principal: string;
}

export interface Task {
  id: "T1" | "T3" | "T4";
  module: string;
  mod: string;
  comp: string;
  shapeName: string;
  units: Record<string, string[]>;
  resources: { name: string; attach?: { name: string }[] }[];
  grants: string[];
  templates: unknown[];
  laws: Law[];
  /** law key of a JUnit test case, or null for a harness self-check */
  lawOf: (classname: string, name: string) => string | null;
  extraFiles: string[];
}

const lawNum = (s: string): string | null => {
  const m = /^(?:Law |L)(\d)\b/.exec(s);
  return m ? `L${m[1]}` : null;
};

export const TASKS: Record<string, Task> = {
  T1: {
    id: "T1",
    module: "src/game.ts",
    mod: "wrapboard",
    comp: "Game",
    shapeName: "WrapBoard",
    units: {
      isWall: ["Read<Level>"],
      isWon: [],
      replay: [],
      start: ["Read<Level>"],
      step: ["Read<Level>"]
    },
    resources: [{ name: "Board" }, { name: "Level" }],
    grants: ["Read<Level>"],
    templates: [],
    laws: [
      {
        key: "L1",
        name: "NoWin",
        text: "for every finite ms, isWon(replay(start(), ms)) is false",
        named: ["isWon", "replay", "start"],
        principal: "step"
      },
      {
        key: "L2",
        name: "FlagUnreachable",
        text: "for every finite ms, the player in replay(start(), ms) is not on (1, 1)",
        named: ["replay", "start"],
        principal: "step"
      },
      {
        key: "L3",
        name: "FlagIsLive",
        text: "stepping onto (1, 1) from each of its four neighbours wins",
        named: ["isWon", "step"],
        principal: "step"
      },
      {
        key: "L4",
        name: "ReplayInOrder",
        text: "replay(g, []) = g and replay(g, [m, ...ms]) = replay(step(m, g), ms) for every board",
        named: ["replay", "step"],
        principal: "replay"
      }
    ],
    lawOf: (cls, name) => lawNum(cls) ?? lawNum(name),
    extraFiles: ["package.json", "TASK.md", "test/visible.test.ts"]
  },
  T3: {
    id: "T3",
    module: "src/audit.ts",
    mod: "audit",
    comp: "AuditStore",
    shapeName: "AuditService",
    units: {
      append: ["Append<AuditLog>"],
      emptyLog: [],
      get: ["Read<AuditLog>"],
      list: ["Read<AuditLog>"],
      purge: ["Read<AuditLog>", "Redact<AuditLog>"]
    },
    resources: [{ name: "AuditLog", attach: [{ name: "AppendOnly" }] }],
    grants: ["Append<AuditLog>", "Read<AuditLog>", "Redact<AuditLog>"],
    templates: [],
    laws: [
      {
        key: "L0",
        name: "ValuesAndViews",
        text: "no call changes a log it is given; get(L, i) equals list(L)[i] in range and is undefined elsewhere",
        named: ["append", "get", "list", "purge"],
        principal: "get"
      },
      {
        key: "L1",
        name: "IdsPrefix",
        text: "ids(L) is a prefix of ids(L2) for every later log L2",
        named: ["append", "list", "purge"],
        principal: "purge"
      },
      {
        key: "L2",
        name: "NoShrinking",
        text: "count(L2) >= count(L) for every later log L2",
        named: ["append", "list", "purge"],
        principal: "purge"
      },
      {
        key: "L3",
        name: "FixedMetadata",
        text: "later logs keep id, timestamp and actor at every position of L",
        named: ["append", "list", "purge"],
        principal: "purge"
      },
      {
        key: "L4",
        name: "PurgeScope",
        text: "purge keeps the count, keeps unexpired entries equal and expired ones' id, timestamp and actor",
        named: ["list", "purge"],
        principal: "purge"
      },
      {
        key: "L5",
        name: "AppendEntry",
        text: "append adds exactly one entry with id count(L) and the given fields; payloads are kept until purged",
        named: ["append", "list", "purge"],
        principal: "append"
      }
    ],
    lawOf: (cls, name) => lawNum(cls) ?? lawNum(name),
    extraFiles: ["package.json", "TASK.md", "test/visible.test.ts"]
  },
  T4: {
    id: "T4",
    module: "src/ledger.ts",
    mod: "ledger",
    comp: "LedgerService",
    shapeName: "LedgerSystem",
    units: {
      balance: ["Read<Ledger>"],
      total: ["Read<Ledger>"],
      feeFor: [],
      transfer: ["Read<Ledger>", "Update<Ledger>"]
    },
    resources: [{ name: "Ledger", attach: [{ name: "Conserved" }] }],
    grants: ["Read<Ledger>", "Update<Ledger>"],
    templates: [
      {
        decl: "template",
        name: "Conserved",
        params: [["T", "resource"]],
        body: [
          { forbid: "effect", final: true, atom: "HardDelete<T>" },
          { forbid: "effect", final: true, atom: "Truncate<T>" }
        ]
      }
    ],
    laws: [
      {
        key: "L0",
        name: "Reads",
        text: "balance(l, x) is l[x] and total(l) is the sum of all four balances",
        named: ["balance", "total"],
        principal: "total"
      },
      {
        key: "L1",
        name: "Conservation",
        text: "total(after) = total(before), applied or not",
        named: ["total", "transfer"],
        principal: "transfer"
      },
      {
        key: "L2",
        name: "NoNegativeBalance",
        text: "every balance of after is a non-negative integer",
        named: ["transfer"],
        principal: "transfer"
      },
      {
        key: "L3",
        name: "FailureChangesNothing",
        text: "if r.ok is false, after equals before",
        named: ["transfer"],
        principal: "transfer"
      },
      {
        key: "L4",
        name: "ExactEffect",
        text: "between different accounts, ok iff amount >= 1 and before[from] >= amount + fee; then exact balances",
        named: ["feeFor", "transfer"],
        principal: "transfer"
      },
      {
        key: "L5",
        name: "SelfTransferChangesNothing",
        text: "if from = to, after equals before, applied or not",
        named: ["transfer"],
        principal: "transfer"
      }
    ],
    // T4 names its tests "L1 Conservation: ..." under one describe; "the generated cases ..." is a
    // generator self-check, not a law.
    lawOf: (_cls, name) => lawNum(name),
    extraFiles: ["TASK.md", "test/visible.test.ts"]
  }
};

export type Arm = "C" | "N" | "P";
export type Tier = "normal" | "critical";
export interface ProvVariant {
  identity: boolean;
  depsComplete: boolean;
}

/** The task's module in Shape 1.0 form (shape.source.v1). */
export function sourceFor(T: Task, arm: Arm, tier: Tier, pv: ProvVariant) {
  const decls: unknown[] = [];
  decls.push({ decl: "shape", name: T.shapeName, owner: "Maintainers" });
  decls.push({ decl: "actor", name: "Maintainers", kind: "team", members: ["alice", "bob"] });
  decls.push({ decl: "actor", name: "alice", kind: "person", identities: ['github("alice")'] });
  decls.push({ decl: "actor", name: "bob", kind: "person", identities: ['github("bob")'] });
  decls.push({
    decl: "actor",
    name: "codeAgent",
    kind: "agent",
    operator: "alice",
    identities: ['github("acme-code-agent[bot]")']
  });
  decls.push(...T.templates);
  for (const r of T.resources)
    decls.push({ decl: "resource", name: r.name, ...(r.attach ? { attach: r.attach } : {}) });
  decls.push({
    decl: "component",
    name: T.comp,
    owner: "Maintainers",
    tier: "normal",
    paths: ["src/**"],
    grants: T.grants,
    units: Object.entries(T.units).map(([u, atoms]) => ({
      name: u,
      bind: `ts("${T.module}#${u}")`,
      effects: { mode: "complete", atoms: atoms.map((a) => ({ atom: a })) }
    }))
  });
  decls.push({
    decl: "template",
    name: "Contract",
    params: [["Statement", "value"]],
    body: [{ law: { evidence: { level: "tested" } } }]
  });
  for (const l of T.laws) {
    const on =
      arm === "C"
        ? [`component ${T.comp}`]
        : arm === "N"
          ? l.named.map((u) => `unit ${T.comp}.${u}`)
          : [`unit ${T.comp}.${l.principal}`];
    decls.push({
      decl: "law",
      name: l.name,
      template: { name: "Contract", args: [`${l.key}: ${l.text}`] },
      on,
      tier,
      evidence: { level: "tested", by: ["lawSuite"] }
    });
  }
  decls.push({
    decl: "provider",
    name: "lawSuite",
    produces: ["test"],
    decides: [`template ${T.mod}::Contract`],
    sound: ["presence"],
    trusts: [["bun", Bun.version]],
    ...(pv.depsComplete ? { depsComplete: true } : {}),
    ...(pv.identity ? { identity: SIGNER.identity } : {}),
    implementation: { paths: ["package.json"] }
  });
  return { v: "shape.source.v1", modules: [{ module: T.mod, imports: ["std"], decls }] };
}

// ---- trees and manifests -----------------------------------------------------------------------

/** Code under test: repo-relative path → text (the task module plus any files a refactor adds). */
export type Code = Record<string, string>;

const codeKey = (code: Code): string =>
  JSON.stringify(Object.entries(code).sort((a, b) => (a[0] < b[0] ? -1 : 1)));

/** The task workspace as tracked files, with `code` as the code under test. */
export function treeFiles(T: Task, code: Code) {
  const g8 = join(BENDEXP, "g8", T.id);
  const files = Object.entries(code).map(([path, text]) => ({
    path,
    mode: "100644",
    bytes: new Uint8Array(Buffer.from(text))
  }));
  for (const p of ["test/laws.test.ts", ...T.extraFiles]) {
    const abs = join(g8, p);
    if (existsSync(abs))
      files.push({ path: p, mode: "100644", bytes: new Uint8Array(readFileSync(abs)) });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const manCache = new Map<string, unknown>();
export async function manifestOf(T: Task, code: Code) {
  const k = `${T.id}\u0000${codeKey(code)}`;
  const hit = manCache.get(k);
  if (hit) return hit;
  const m = await manifestFor({ files: treeFiles(T, code) });
  manCache.set(k, m);
  return m;
}

/** Identities whose digest moved or that are new/removed, per projection. */
export function movedIdentities(mb, mh): { id: string; projections: string[] }[] {
  const out = [];
  const ids = new Set([...mb.index.ids.keys(), ...mh.index.ids.keys()]);
  for (const id of [...ids].sort()) {
    const b = mb.index.ids.get(id);
    const h = mh.index.ids.get(id);
    if (!b || !h) {
      out.push({ id, projections: [b ? "removed" : "added"] });
      continue;
    }
    const ps = [];
    for (const [p, d] of h.digests) if (b.digests.get(p) !== d) ps.push(p);
    if (ps.length) out.push({ id, projections: ps.sort() });
  }
  return out;
}

// ---- the law suite -----------------------------------------------------------------------------

export interface TestCase {
  classname: string;
  name: string;
  law: string | null;
  pass: boolean;
  message: string | null;
}
export interface SuiteRun {
  exit: number;
  ms: number;
  cases: TestCase[];
  perLaw: Record<
    string,
    { pass: boolean; tests: number; failed: string | null; message: string | null }
  >;
  selfCheckFailed: boolean;
}

const xmlUnescape = (s: string): string =>
  s
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

export function parseJunit(
  xml: string
): { classname: string; name: string; pass: boolean; message: string | null }[] {
  const out = [];
  const re = /<testcase\s+([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs = m[1] as string;
    const attr = (k: string): string =>
      xmlUnescape((new RegExp(`\\b${k}="([^"]*)"`).exec(attrs)?.[1] ?? "") as string);
    const body = m[3] ?? "";
    const fail = /<(failure|error)\b([^>]*)>/.exec(body);
    let message: string | null = null;
    if (fail)
      message =
        xmlUnescape((/\bmessage="([^"]*)"/.exec(fail[2] ?? "")?.[1] ?? "") as string) || "failed";
    const skipped = /<skipped\b/.test(body);
    if (skipped) continue;
    out.push({ classname: attr("classname"), name: attr("name"), pass: !fail, message });
  }
  return out;
}

const suiteCache = new Map<string, SuiteRun>();

/** Runs the agent-written law suite (or another suite file) against `code` in a sandbox. */
export function runSuite(
  T: Task,
  code: Code,
  opts: { suiteDir?: string; file?: string } = {}
): SuiteRun {
  const suiteDir = opts.suiteDir ?? join(BENDEXP, "g8", T.id);
  const file = opts.file ?? "test/laws.test.ts";
  const key = `${T.id}\u0000${suiteDir}\u0000${file}\u0000${codeKey(code)}`;
  const hit = suiteCache.get(key);
  if (hit) return hit;
  const box = join(WORK, "box", `${T.id}-${process.pid}`);
  rmSync(box, { recursive: true, force: true });
  mkdirSync(join(WORK, "box"), { recursive: true });
  cpSync(suiteDir, box, { recursive: true });
  rmSync(join(box, ".gate_log"), { force: true });
  for (const [p, text] of Object.entries(code)) {
    mkdirSync(join(box, p, ".."), { recursive: true });
    writeFileSync(join(box, p), text);
  }
  const xml = join(box, "junit.xml");
  const t0 = Date.now();
  const r = spawnSync("bun", ["test", file, "--reporter=junit", `--reporter-outfile=${xml}`], {
    cwd: box,
    timeout: 900_000,
    maxBuffer: 1 << 26
  });
  const ms = Date.now() - t0;
  const raw = existsSync(xml) ? parseJunit(readFileSync(xml, "utf8")) : [];
  const cases: TestCase[] = raw.map((c) => ({ ...c, law: T.lawOf(c.classname, c.name) }));
  const perLaw = {};
  for (const l of T.laws) perLaw[l.key] = { pass: true, tests: 0, failed: null, message: null };
  let selfCheckFailed = false;
  for (const c of cases) {
    if (!c.law) {
      if (!c.pass) selfCheckFailed = true;
      continue;
    }
    const e = perLaw[c.law];
    if (!e) continue;
    e.tests += 1;
    if (!c.pass && e.pass) {
      e.pass = false;
      e.failed = `${c.classname} > ${c.name}`;
      e.message = c.message;
    }
  }
  const run = { exit: r.status ?? 124, ms, cases, perLaw, selfCheckFailed };
  rmSync(box, { recursive: true, force: true });
  suiteCache.set(key, run);
  return run;
}

// ---- records -----------------------------------------------------------------------------------

export type Mapping = "contra" | "inconcl";

/** One Test Result record per law claim of `source`, citing Req(c, test) from `man` (A.5.3.4). */
export function lawRecords(
  T: Task,
  source,
  man,
  suite: SuiteRun,
  opts: { signed: boolean; mapping: Mapping; time?: string }
) {
  const time = opts.time ?? REC_TIME;
  const esf = elaborateAt(source, time);
  const world = buildWorld(esf, man.index, { side: "h" });
  const ctx = { Wh: world, Mh: man.index };
  const out = [];
  for (const c of esf.claims) {
    if (c.op !== "law") continue;
    const law = T.laws.find((l) => c.ids.includes(`${T.mod}::${l.name}`));
    if (!law) throw new Error(`no law for ${c.ids.join(",")}`);
    const r = suite.perLaw[law.key];
    const req = reqOf(ctx, c, "test", "unit");
    const code = req.map((p) => cite(man.index, p.id, p.projection));
    if (code.some((x) => !x) || code.length === 0)
      throw new Error(`Req not citable for ${c.ids[0]}: ${JSON.stringify(req)}`);
    const codeFiles = [...new Set(code.map((x) => man.index.ids.get(x.id)?.path).filter(Boolean))];
    const depPaths = moduleClosure(codeFiles, man.index.paths, man.read);
    const reqKeys = new Set(code.map((x) => `${x.id}@${x.projection}`));
    const deps = [];
    for (const p of depPaths) {
      const fid = fileIdentity(man.index, p);
      const ci = fid ? cite(man.index, fid, "file") : null;
      if (ci && !reqKeys.has(`${ci.id}@${ci.projection}`)) deps.push(ci);
    }
    const harness = [];
    for (const p of moduleClosure(["test/laws.test.ts"], man.index.paths, man.read)) {
      if (depPaths.includes(p)) continue;
      const fid = fileIdentity(man.index, p);
      const ci = fid ? cite(man.index, fid, "file") : null;
      if (ci) harness.push(ci);
    }
    const failed = !r.pass || suite.selfCheckFailed || r.tests === 0;
    const contra = failed && opts.mapping === "contra" && !r.pass && !!r.message;
    const result = !failed ? "supports" : contra ? "contradicts" : "inconclusive";
    const rec = {
      v: "shape.evidence.v1",
      kind: "test",
      result,
      provider: { id: `${T.mod}::lawSuite`, version: `h3-adapter bun@${Bun.version}` },
      revision: man.revision,
      time,
      claim: { id: c.ids[0], fp: c.fp, nf: c.nf },
      code: sortCites(code),
      deps: sortCites(deps),
      harness: sortCites(harness),
      assumptions: [{ id: `bun@${Bun.version}`, kind: "tool" }],
      bound: { runs: r.tests, seed: 0, laws: r.tests },
      ...(contra
        ? { counterexample: { law: r.failed, input: String(r.message).slice(0, 1500) } }
        : {})
    };
    out.push({ law: law.key, claim: c.ids[0], result, em: emit(rec, opts.signed ? SIGNER : null) });
  }
  return out;
}

// ---- derive ------------------------------------------------------------------------------------

export function checkInput(
  T: Task,
  label: string,
  base: { man; source },
  head: { man; source },
  records: unknown[],
  baseRecords: unknown[]
) {
  return {
    contract: "shape.check.input/v1",
    mode: "change",
    now: NOW,
    head: { revision: head.man.revision, source: head.source, manifest: head.man.statement },
    base: { revision: base.man.revision, source: base.source, manifest: base.man.statement },
    change: { ids: [`github:acme/${T.id.toLowerCase()}#${label}`] },
    authors: AUTHORS,
    reviews: [],
    records,
    baseRecords,
    persisted: { base: [], head: [] },
    options: { health: true, teeth: false }
  };
}

export function compact(o) {
  return {
    key: o.key,
    kind: o.kind,
    reason: o.reason,
    introduced: o.introduced,
    severity: o.severity,
    tier: o.tier,
    force: o.force,
    budget: o.budget,
    claim: o.claim ? o.claim.ids[0] : null,
    subject: o.subject,
    rule: o.rule ?? null,
    questions: o.questions ?? null
  };
}

export function runDerive(input) {
  const t0 = performance.now();
  const out = derive(input);
  return {
    verdict: out.verdict,
    errors: out.errors.map((e) => ({ code: e.code, subject: e.subject })),
    rejected: out.rejected.map((r) => ({ code: r.code, detail: r.detail })),
    obligations: out.obligations.map(compact),
    ms: Math.round(performance.now() - t0)
  };
}
