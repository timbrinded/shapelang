// @ts-nocheck
// Negative conformance suite for the Shape 1.0 checker (red team, agent).
//
// Property under test: a change that violates a claim always produces the right blocking or owed
// obligation, whatever else the change does. Each case builds a change that violates a claim and
// adds one evasion (mismatched or carried-over evidence, an unmoved fingerprint, a weakened law,
// a split or rename, an exception or policy edit, judged evidence, a provider edit), runs the
// prototype's `derive`, and grades the output:
//   blocked   — the expected obligation (or a blocking error naming the cause) is present
//   partial   — only a weaker obligation is present (owed instead of blocking, answerable instead
//               of code-only, coverage instead of a contradiction)
//   succeeded — nothing relevant is raised
// Each attack also runs through the Lean kernel (shapek), with the prototype as pre-pass.
//
// Run from the repo root:
//   bun experiments/shape-1/redteam/agent/negsuite.ts [path-to-shapek]
// Writes cases/<id>.input.json, cases/<id>.out.json (core output), results.json and summary.txt
// next to this file.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as F from "../../proto/examples/fixtures.ts";
import { auditSource } from "../../proto/examples/sources.ts";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { loadTypeScript } from "../../proto/src/fingerprint/ts.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { H, label } from "../../proto/src/jcs.ts";
import { manifestFromFiles } from "../../proto/src/manifest-build.ts";
import { gitBlobId, manifestStatement } from "../../proto/src/manifest.ts";
import {
  makeStatement,
  mergeRecords,
  parseRecord,
  scopeRoot,
  signStatement,
  signerFromSeed
} from "../../proto/src/records.ts";
import { coreOutput } from "../../proto/src/render.ts";
import { toSeconds } from "../../proto/src/util.ts";

const HERE = import.meta.dir;
const OUT = join(HERE, "cases");
mkdirSync(OUT, { recursive: true });
const SHAPEK = process.argv[2] ?? join(HERE, "../../kernel/.lake/build/bin/shapek");
const { KEYS, EX1, EX3, EX3S2, EX2, cite, signed } = F;

// ---- keys -------------------------------------------------------------------------------------------
const K = {
  attacker: signerFromSeed("e1"),
  tsCalls: signerFromSeed("0c"),
  tim: signerFromSeed("0a"),
  ann: signerFromSeed("0b"),
  bob: signerFromSeed("0d"),
  fake: signerFromSeed("0e")
};
const SIGNER = {
  "audit::sqlEffects": KEYS.sqlEffects,
  "audit::fastCheck": KEYS.fastCheck,
  "audit::tsCalls": K.tsCalls,
  "tooling::tsClockScan": KEYS.tsClockScan,
  "checker::bunTest": KEYS.bunTest,
  "ironkv::verus": KEYS.verus,
  "checker::tsCallGraph": KEYS.tsCallGraph
};

// ---- record and manifest helpers --------------------------------------------------------------------
const shapeOf = (env) =>
  JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")).predicate.shape;
const resign = (env, fn, signers = null) => {
  const s = structuredClone(shapeOf(env));
  fn(s);
  if (s.scope) s.scope.root = scopeRoot(s.scope.entries);
  return signed(s, signers ?? [SIGNER[s.provider?.id]]);
};
const recOf = (input, pred) => input.records.find((r) => pred(shapeOf(r)));
const replaceRec = (input, pred, fn) => ({
  ...input,
  records: input.records.map((r) => (pred(shapeOf(r)) ? fn(r) : r))
});
const dropRec = (input, pred) => ({
  ...input,
  records: input.records.filter((r) => !pred(shapeOf(r)))
});
const isProv = (q) => (s) => s.provider?.id === q;
function remanifest(stmt, entryFn = (es) => es, treeFn = (t) => t) {
  const p = structuredClone(stmt.predicate.shape);
  p.entries = entryFn(p.entries);
  p.tree = treeFn(p.tree);
  return manifestStatement(p);
}
const setDig = (changes) => (es) =>
  es.map((e) => {
    const c = changes.find((x) => x.id === e.id && x.projection === e.projection);
    return c ? { ...e, digest: c.digest } : e;
  });
const digestOf = (stmt, id, proj) =>
  stmt.predicate.shape.entries.find((e) => e.id === id && e.projection === proj)?.digest ?? null;
/** An honest code edit: moves head digests and re-signs every head-revision provider record citing them. */
function edit(input, changes) {
  const head = { ...input.head, manifest: remanifest(input.head.manifest, setDig(changes)) };
  const fix = (c) => {
    const ch = changes.find((x) => x.id === c.id && x.projection === c.projection);
    return ch ? { ...c, digest: ch.digest } : c;
  };
  const records = input.records.map((r) => {
    const s = shapeOf(r);
    if (s.revision !== input.head.revision || !s.provider || !SIGNER[s.provider.id]) return r;
    return resign(r, (x) => {
      if (x.code) x.code = x.code.map(fix);
      if (x.deps) x.deps = x.deps.map(fix);
      if (x.scope)
        x.scope.entries = x.scope.entries.map((e) => ({
          ...fix(e),
          complete: e.complete,
          deps: e.deps
        }));
    });
  });
  return { ...input, head, records };
}
const omit = (o, k) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
const modDecls = (src, fn) => ({
  ...src,
  modules: src.modules.map((m) => ({ ...m, decls: fn(m.decls, m.module) }))
});
const mapDecl = (src, pred, fn) => modDecls(src, (ds) => ds.map((d) => (pred(d) ? fn(d) : d)));
const isDecl = (decl, name) => (d) => d.decl === decl && d.name === name;
const onHead = (input, fn) => ({
  ...input,
  head: { ...input.head, source: fn(input.head.source) }
});
const onBoth = (input, fn) => ({
  ...input,
  head: { ...input.head, source: fn(input.head.source) },
  base: { ...input.base, source: fn(input.base.source) }
});
const addDecls = (src, mod, decls) =>
  modDecls(src, (ds, m) => (m === mod ? [...ds, ...decls] : ds));
const REV_X = "abababababababababababababababababababab";
const REV_Y = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";

// ---- grading -------------------------------------------------------------------------------------------
const ids = (o) => o.claim?.ids ?? [];
const about = (id) => (o) => ids(o).some((x) => x === id || x.startsWith(`${id}/`));
const blockingOb = (pred) => (o) => o.severity === "blocking" && pred(o);
const anyOb = (pred) => (o) => pred(o);
const errIs =
  (code, sub = "") =>
  (e) =>
    e.code === code && String(e.subject).includes(sub);
function grade(out, g) {
  const obs = out.obligations ?? [];
  const errs = out.errors ?? [];
  const answeredKeys = new Set((out.answered ?? []).map((a) => a.obligation));
  const debtKeys = new Set((out.debt ?? []).map((d) => d.obligation));
  const live = obs.filter((o) => !answeredKeys.has(o.key) && !debtKeys.has(o.key));
  const t = live.filter(g.target);
  const te = errs.filter(g.targetErr ?? (() => false));
  if (t.length > 0 || te.length > 0)
    return { outcome: "blocked", hits: [...t.map(fmtOb), ...te.map(fmtErr)] };
  const w = obs.filter(g.weaker ?? (() => false));
  const we = errs.filter(g.weakerErr ?? (() => false));
  if (w.length > 0 || we.length > 0)
    return { outcome: "partial", hits: [...w.map(fmtOb), ...we.map(fmtErr)] };
  return { outcome: "succeeded", hits: [] };
}
const fmtOb = (o) =>
  `${o.kind}${o.reason ? `(${o.reason})` : ""}${o.questions ? `[${o.questions.join(",")}]` : ""} ${o.severity} ${o.tier}${o.force ? ` ${o.force}` : ""}${o.introduced === false ? " preexisting" : ""}${o.exploited ? " exploited" : ""} ${ids(o)[0] ?? JSON.stringify(o.subject)}`;
const fmtErr = (e) => `${e.code} ${e.subject}`;
function brief(out) {
  const answered = new Map((out.answered ?? []).map((a) => [a.obligation, a.as]));
  const debt = new Set((out.debt ?? []).map((d) => d.obligation));
  return {
    verdict: out.verdict,
    errors: (out.errors ?? []).map(fmtErr),
    rejected: (out.rejected ?? []).map((r) => `${r.code} ${r.detail}`),
    obligations: (out.obligations ?? []).map(
      (o) =>
        `${fmtOb(o)}${answered.has(o.key) ? ` [${answered.get(o.key)}]` : ""}${debt.has(o.key) ? " [debt]" : ""}`
    ),
    answered: (out.answered ?? []).map((a) => `${a.as} ${a.obligation.slice(0, 19)}`)
  };
}

// ---- kernel bridge (spec pre-pass: RJ01-RJ08 drop, authenticated = signed by base identity) ----------------
function kernelCase(input, protoOut) {
  const now = toSeconds(input.now);
  const head = elaborate(input.head.source, { now });
  const base = input.base?.source ? elaborate(input.base.source, { lenient: true, now }) : null;
  const gov = input.mode === "audit" || !base ? head : base;
  const gv = buildGov(gov, gov.policy, input.authors ?? []);
  const prepassDrop = new Set(
    (protoOut.rejected ?? []).filter((r) => /^RJ0[1-8]$/.test(r.code)).map((r) => r.record)
  );
  const conv = (list) => {
    const parsed = [];
    for (const x of list ?? []) {
      const r = parseRecord(x);
      if (!r.error) parsed.push(r);
    }
    return mergeRecords(parsed)
      .filter((r) => !prepassDrop.has(r.id))
      .map((r) => {
        const p = r.shape.provider?.id
          ? gov.providers.find((x) => x.q === r.shape.provider.id)
          : null;
        const judge = r.shape.judge ? gov.actors.find((a) => a.q === r.shape.judge) : null;
        const authenticated = p?.identity
          ? r.signers.includes(p.identity)
          : judge
            ? r.signers.some((s) => judge.identities.includes(s))
            : false;
        return { id: r.id, predicate: { shape: r.shape }, authenticated };
      });
  };
  const reviews = [];
  for (const rv of input.reviews ?? []) {
    const actor = gv.byIdentity.get(rv.identity.trim());
    if (actor) reviews.push({ actor, line: rv.line, change: rv.change ?? input.change.ids[0] });
  }
  const owners = [];
  if (base && input.mode !== "audit") {
    for (const c of base.components)
      for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
    for (const c of head.components)
      for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  }
  const cells = owners.length
    ? computeCells(owners)
        .cells.filter((c) => typeof c.b === "string" && typeof c.h === "string")
        .map((c) => [c.b, c.h])
    : [];
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now: Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now),
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base:
      input.mode === "audit" || !input.base
        ? null
        : {
            revision: input.base.revision,
            esf: base ?? { shape: { q: "", owner: "" } },
            manifest: input.base.manifest
          },
    cells,
    records: conv(input.records),
    reviews,
    baseRecords: conv(input.baseRecords)
  };
}
function runKernel(input, protoOut) {
  const kc = kernelCase(input, protoOut);
  const r = spawnSync(SHAPEK, [], { input: JSON.stringify(kc), maxBuffer: 1 << 28 });
  try {
    return { kc, out: JSON.parse(r.stdout.toString()) };
  } catch {
    return {
      kc,
      out: null,
      error: `${r.status} ${r.stdout.toString().slice(0, 200)} ${r.stderr.toString().slice(0, 200)}`
    };
  }
}

// ---- two-phase: derive, read bindings, add review lines, derive again --------------------------------------
function phase2(input, mkReviews) {
  return { __p2: true, input, mk: mkReviews };
}
const withReviews = (input, reviews) => ({
  ...input,
  reviews: [...(input.reviews ?? []), ...reviews]
});
const bdOf = (out, pred) =>
  (out.obligations.find(pred)?.binding ?? "bd:0000000000000000").slice(0, 19);

// ---- scenario builders -------------------------------------------------------------------------------------
const FORBID = "audit::AuditEvent/AppendOnly/effect.forbid-HardDelete";
const LAW1 = "audit::EventsArePreserved";
const PURGE = "ts:src/audit/purge.ts#purgeOldEvents";
const STORE_FN = "ts:src/audit/store.ts#appendEvent";
const forbidTarget = {
  target: blockingOb((o) => o.kind === "contradiction" && about(FORBID)(o) && o.force === "sound")
};
const forbidWeaker = (o) =>
  (o.kind === "contradiction" && about(FORBID)(o)) ||
  o.kind === "coverage" ||
  o.kind === "loosening";
const lawTarget = (law) => ({
  target: blockingOb((o) => o.kind === "unestablished" && about(law)(o)),
  targetErr: errIs("E-provider-missing", law),
  weaker: (o) => (o.kind === "unestablished" || o.kind === "contradiction") && about(law)(o)
});

const ex1B = () => F.ex1("B");
const fastRec = (s) => s.provider?.id === "audit::fastCheck";
const obsRec = (s) => s.provider?.id === "audit::sqlEffects";

/** Example 1 shapes with extra declarations on both sides. */
function withAuditDecls(input, decls, fn = (d) => d) {
  return onBoth(input, (s) => modDecls(addDecls(s, "audit", decls), (ds) => ds.map(fn)));
}

const LAT_TEMPLATE = {
  decl: "template",
  name: "LatencyAtMost",
  params: [
    ["F", "unit"],
    ["Budget", "value"]
  ],
  body: [{ law: { evidence: { level: "tested" } } }, { order: ["Budget", "leq"] }]
};
const latLaw = (budget) => ({
  decl: "law",
  name: "AppendFast",
  template: { name: "LatencyAtMost", args: ["AuditStore.appendEvent", budget] },
  tier: "critical",
  evidence: { level: "tested", by: ["fastCheck"] }
});
const decidesToo = (extra) => (d) =>
  d.decl === "provider" && d.name === "fastCheck" ? { ...d, decides: [...d.decides, ...extra] } : d;
function lawClaim(src, id, now = toSeconds("2026-10-25T12:00:00Z")) {
  const e = elaborate(src, { now });
  return e.claims.find((c) => c.ids.includes(id));
}
function testRecord({
  rev,
  claim,
  nf,
  code,
  deps,
  result = "supports",
  counterexample,
  harness = [],
  provider = "audit::fastCheck",
  version = "3.23.0",
  time = "2026-10-25T09:12:44Z",
  signers
}) {
  return signed(
    {
      v: "shape.evidence.v1",
      kind: "test",
      result,
      provider: { id: provider, version },
      revision: rev,
      time,
      claim: { id: claim.ids[0], fp: claim.fp, ...(nf ? { nf } : {}) },
      code,
      ...(deps ? { deps } : {}),
      harness,
      assumptions: [],
      bound: { runs: 100 },
      ...(counterexample !== undefined ? { counterexample } : {})
    },
    signers ?? [SIGNER[provider]]
  );
}
function obsRecord({
  rev,
  provider,
  entries,
  facts,
  signers,
  time = "2026-10-25T09:12:44Z",
  version = "1.0.0"
}) {
  const es = entries.map((e) => ({ ...e, complete: e.complete ?? true, deps: e.deps ?? [] }));
  return signed(
    {
      v: "shape.evidence.v1",
      kind: "observation",
      result: "observes",
      provider: { id: provider, version },
      revision: rev,
      time,
      scope: { root: scopeRoot(es), entries: es },
      facts,
      harness: [],
      assumptions: []
    },
    signers ?? [SIGNER[provider]]
  );
}
const citeAll = (stmt, idsList) =>
  idsList.map((id) => {
    const e = stmt.predicate.shape.entries;
    const u = e.find((x) => x.id === id && x.projection === "unit");
    const f = e.find((x) => x.id === id && x.projection === "file");
    const o = e.find((x) => x.id === id && x.projection === "own");
    const pick = u ?? f ?? o;
    return { id, projection: pick.projection, scheme: pick.scheme, digest: pick.digest };
  });

/** The `encodeRow` world: appendEvent calls encodeRow; a unit law Deterministic<appendEvent>; a call observer. */
function encodeWorld(o) {
  const base = F.manifest(EX1.base, [
    { id: "pkgjson:package.json" },
    { id: "raw:bun.lock" },
    { id: "ts:src/audit/store.ts", file: label("store file b"), own: label("store own") },
    { id: STORE_FN, own: label("appendEvent own b"), unit: label("appendEvent unit b") },
    {
      id: "ts:src/audit/store.ts#encodeRow",
      own: label("encodeRow own b"),
      unit: label("encodeRow unit b")
    },
    { id: "ts:test/audit/history.test.ts", own: label("history.test.ts own") },
    { id: "ts:tools/calls.ts" }
  ]);
  const ap = o.appendChanged ? "h" : "b";
  const head = F.manifest(EX1.head, [
    { id: "pkgjson:package.json" },
    { id: "raw:bun.lock" },
    { id: "ts:src/audit/store.ts", file: label("store file h"), own: label("store own") },
    { id: STORE_FN, own: label(`appendEvent own ${ap}`), unit: label(`appendEvent unit ${ap}`) },
    {
      id: "ts:src/audit/store.ts#encodeRow",
      own: label("encodeRow own h"),
      unit: label("encodeRow unit h")
    },
    { id: "ts:test/audit/history.test.ts", own: label("history.test.ts own") },
    { id: "ts:tools/calls.ts" }
  ]);
  const decls = [
    {
      decl: "law",
      name: "AppendDeterministic",
      template: { name: "Deterministic", args: ["AuditStore.appendEvent"] },
      evidence: { level: "tested", by: ["fastCheck"] }
    },
    {
      decl: "provider",
      name: "tsCalls",
      produces: ["observation"],
      observes: ["call(ts)"],
      sound: ["presence", "absence"],
      identity: K.tsCalls.identity,
      implementation: { paths: ["tools/calls.ts"] }
    }
  ];
  const fix = (d) =>
    d.decl === "provider" && d.name === "fastCheck"
      ? { ...d, decides: [...d.decides, "template Deterministic"], depsComplete: true }
      : d;
  const src = modDecls(addDecls(auditSource({ ids: F.IDS }), "audit", decls), (ds) => ds.map(fix));
  const law = lawClaim(src, "audit::AppendDeterministic");
  const law1 = lawClaim(src, LAW1);
  const storeIds = ["ts:src/audit/store.ts", STORE_FN, "ts:src/audit/store.ts#encodeRow"];
  const records = [
    obsRecord({
      rev: EX1.head,
      provider: "audit::sqlEffects",
      entries: citeAll(head, storeIds),
      facts: [
        {
          type: "effect",
          at: STORE_FN,
          verb: "Append",
          resource: 'pg.table("public.audit_events")'
        }
      ]
    }),
    obsRecord({
      rev: EX1.head,
      provider: "audit::tsCalls",
      entries: citeAll(head, storeIds),
      facts: [{ type: "call", at: STORE_FN, to: "ts:src/audit/store.ts#encodeRow" }]
    }),
    testRecord({
      rev: EX1.head,
      claim: law1,
      code: [
        cite(STORE_FN, "unit", digestOf(head, STORE_FN, "unit")),
        cite("ts:src/audit/store.ts#encodeRow", "unit", label("encodeRow unit h")),
        cite("ts:src/audit/store.ts", "own", label("store own"))
      ],
      deps: [],
      harness: [cite("ts:test/audit/history.test.ts", "own", label("history.test.ts own"))]
    }),
    ...o.lawRecords({ law, head, base })
  ];
  return F.baseInput({
    head: { revision: EX1.head, source: src, manifest: head },
    base: { revision: EX1.base, source: src, manifest: base },
    records,
    authors: [{ identity: 'github("acme-code-agent[bot]")', verified: true, bot: true }]
  });
}
const DET = "audit::AppendDeterministic";
/** encodeWorld with appendEvent edited and every law freshly established: the baseline verdict is pass. */
const cleanWorld = () =>
  encodeWorld({
    appendChanged: true,
    lawRecords: ({ law, head }) => [
      testRecord({
        rev: EX1.head,
        claim: law,
        code: [cite(STORE_FN, "unit", digestOf(head, STORE_FN, "unit"))],
        deps: [
          cite(
            "ts:src/audit/store.ts#encodeRow",
            "unit",
            digestOf(head, "ts:src/audit/store.ts#encodeRow", "unit")
          )
        ]
      })
    ]
  });

/** Example 3 Step 2 with the seeded clock read, optionally at rule tier normal and a deps-complete scanner. */
function ex3s2Seeded(o = {}) {
  let input = F.ex3s2({ seededClock: true });
  const tierFix = (d) =>
    d.decl === "rule" && d.name === "CheckerNeverReadsClock" && o.ruleTier
      ? { ...d, tier: o.ruleTier }
      : d;
  const depsFix = (d) =>
    d.decl === "provider" && d.name === "tsClockScan" && o.depsComplete
      ? { ...d, depsComplete: true }
      : d;
  const openFix = (d) =>
    d.decl === "component" && d.name === "ShapeRuleEngine" && o.openRuleEngine
      ? omit(d, "grants")
      : d;
  input = onBoth(input, (s) => modDecls(s, (ds) => ds.map(tierFix).map(depsFix).map(openFix)));
  return input;
}
const CLOCK = "tooling::CheckerNeverReadsClock";
const clockTarget = {
  target: blockingOb(
    (o) =>
      o.kind === "contradiction" &&
      o.force === "sound" &&
      (about(CLOCK)(o) || ids(o).some((x) => x.startsWith("tooling::CheckerClock")))
  ),
  targetErr: errIs("E-provider-missing", "tsClockScan"),
  weaker: (o) => o.kind === "contradiction" || o.kind === "coverage" || o.kind === "loosening"
};
function scanRecord(stmt, rev, facts, o = {}) {
  const entries = stmt.predicate.shape.entries
    .filter(
      (e) =>
        e.projection === "unit" ||
        (e.projection === "own" &&
          !stmt.predicate.shape.entries.some((x) => x.id === e.id && x.projection === "unit"))
    )
    .filter((e) => !(o.omit ?? []).includes(e.id))
    .map((e) => ({ id: e.id, projection: e.projection, scheme: e.scheme, digest: e.digest }));
  return obsRecord({
    rev,
    provider: "tooling::tsClockScan",
    entries,
    facts,
    version: "0.1.0",
    time: "2026-10-25T10:00:00Z"
  });
}
const ISO_FACT = { type: "effect", at: EX3.ISO, verb: "Read", resource: 'ts.call("Date")' };
const SEED_FACT = {
  type: "effect",
  at: EX3S2.FRESH,
  verb: "Read",
  resource: 'ts.call("Date.now")'
};

/** A guarded unit (RefactorSensitive, critical) over real TypeScript trees fingerprinted by the prototype. */
async function guardWorld(baseFiles, headFiles, sym) {
  const ts = await loadTypeScript(process.cwd());
  const enc = (s) => new TextEncoder().encode(s);
  const mk = (o) => [
    ...Object.entries(o).map(([path, text]) => ({ path, mode: "100644", bytes: enc(text) })),
    { path: "shape.lock", mode: "100644", bytes: enc("{}") },
    { path: "shape/ret.shape", mode: "100644", bytes: enc("") }
  ];
  const mb = manifestStatement(
    manifestFromFiles("1111111111111111111111111111111111111111", mk(baseFiles), ts)
  );
  const mh = manifestStatement(
    manifestFromFiles(
      "2222222222222222222222222222222222222222",
      mk({ ...baseFiles, ...headFiles }),
      ts
    )
  );
  const target = `ts:src/purge.ts#${sym}`;
  const src = {
    v: "shape.source.v1",
    modules: [
      {
        module: "ret",
        imports: ["std"],
        decls: [
          { decl: "shape", name: "Ret", owner: "Maint" },
          { decl: "actor", name: "Maint", kind: "team", members: ["tim", "ann"] },
          { decl: "actor", name: "tim", kind: "person", identities: ['github("tim")'] },
          {
            decl: "actor",
            name: "ann",
            kind: "person",
            identities: ['github("ann")', K.ann.identity]
          },
          {
            decl: "actor",
            name: "claude",
            kind: "agent",
            operator: "tim",
            identities: ['github("claude[bot]")']
          },
          {
            decl: "component",
            name: "Retention",
            owner: "Maint",
            tier: "critical",
            paths: ["src/**/*.ts", "src/**/*.json"],
            units: [
              {
                name: sym,
                attach: [{ name: "RefactorSensitive" }],
                bind: `ts("src/purge.ts#${sym}")`
              }
            ]
          },
          {
            decl: "note",
            name: "RetentionMemory",
            kind: "memory",
            about: [`unit Retention.${sym}`],
            text: "Purges keep 30 days of audit history; never shorten without the auditors."
          }
        ]
      }
    ]
  };
  const law = lawClaim(src, `ret::Retention.${sym}/RefactorSensitive/law`);
  const judgment = signed(
    {
      v: "shape.evidence.v1",
      kind: "judgment",
      result: "supports",
      provider: null,
      revision: "1111111111111111111111111111111111111111",
      time: "2026-10-01T09:00:00Z",
      claim: { id: law.ids[0], fp: law.fp },
      code: [cite(target, "unit", digestOf(mb, target, "unit"))],
      judge: "ret::ann"
    },
    [K.ann]
  );
  return {
    input: F.baseInput({
      change: { ids: ["github:acme/ret#9"] },
      head: { revision: "2222222222222222222222222222222222222222", source: src, manifest: mh },
      base: { revision: "1111111111111111111111111111111111111111", source: src, manifest: mb },
      records: [judgment],
      authors: [{ identity: 'github("claude[bot]")', verified: true, bot: true }]
    }),
    moved: digestOf(mb, target, "unit") !== digestOf(mh, target, "unit"),
    law: law.ids[0]
  };
}
const PURGE_BASE =
  "export function purgeOld(now: number) {\n  return `DELETE FROM audit_events WHERE at < ${now - DAYS * 86400}`;\n}\n";

// ---- the cases ---------------------------------------------------------------------------------------------
const CASES = [];
const add = (c) => CASES.push(c);

// ===== A. subject digest does not match the change ===========================================================
add({
  id: "A1",
  cat: "subject-digest",
  name: "test record cites a superseded digest of the changed unit (revision = head)",
  steps:
    "Example 1 Variant B. Replace fastCheck's fresh record for EventsArePreserved with one that cites purgeOldEvents@unit at an earlier-draft digest; revision is the head.",
  expected: "law EventsArePreserved unestablished, blocking at critical (or E-provider-missing)",
  build: () =>
    replaceRec(ex1B(), fastRec, (r) =>
      resign(
        r,
        (s) =>
          (s.code = s.code.map((c) =>
            c.id === PURGE && c.projection === "unit"
              ? { ...c, digest: label("purge unit, earlier draft") }
              : c
          ))
      )
    ),
  control: ex1B,
  controlExpect: "no EventsArePreserved obligation",
  grade: lawTarget(LAW1)
});
add({
  id: "A2",
  cat: "subject-digest",
  name: "test record cites a superseded digest, revision is a third commit (RJ13 cannot check it)",
  steps:
    "As A1, but the record's revision is a commit that is neither base nor head, so no manifest is available to reject it.",
  expected: "law unestablished (stale), blocking at critical",
  build: () =>
    replaceRec(ex1B(), fastRec, (r) =>
      resign(r, (s) => {
        s.revision = REV_X;
        s.code = s.code.map((c) =>
          c.id === PURGE && c.projection === "unit"
            ? { ...c, digest: label("purge unit, earlier draft") }
            : c
        );
      })
    ),
  grade: lawTarget(LAW1)
});
add({
  id: "A3",
  cat: "subject-digest",
  name: "observation scope entry for the violating unit cites a wrong digest (revision = head)",
  steps:
    "Example 1 Variant B. sqlEffects' signed head observation still reports HardDelete at purgeOldEvents, but its scope entry for purgeOldEvents cites a digest the head manifest does not have.",
  expected:
    "the final AppendOnly contradiction (blocking), or a blocking E-provider-missing for sqlEffects",
  build: () =>
    replaceRec(ex1B(), obsRec, (r) =>
      resign(
        r,
        (s) =>
          (s.scope.entries = s.scope.entries.map((e) =>
            e.id === PURGE ? { ...e, digest: label("purge unit, other build") } : e
          ))
      )
    ),
  grade: {
    ...forbidTarget,
    targetErr: errIs("E-provider-missing", "sqlEffects"),
    weaker: forbidWeaker
  }
});
add({
  id: "A4",
  cat: "subject-digest",
  name: "observation from a third commit whose entries for the violating file and unit cite other digests (deps complete)",
  steps:
    "As A3, but the observation's revision is a third commit and both purge.ts entries (file and purgeOldEvents) cite digests the head lacks; sqlEffects is `deps complete`, so its entries for unchanged identities (store.ts) are reusable and the record counts as supplied.",
  expected:
    "the final AppendOnly contradiction, or a blocking E-provider-missing (no usable head entry for the changed code)",
  build: () =>
    replaceRec(ex1B(), obsRec, (r) =>
      resign(r, (s) => {
        s.revision = REV_Y;
        s.scope.entries = s.scope.entries.map((e) =>
          e.id === PURGE
            ? { ...e, digest: label("purge unit, other build") }
            : e.id === "ts:src/audit/purge.ts"
              ? { ...e, digest: label("purge file, other build") }
              : e
        );
      })
    ),
  grade: {
    ...forbidTarget,
    targetErr: errIs("E-provider-missing", "sqlEffects"),
    weaker: forbidWeaker
  }
});
add({
  id: "A5",
  cat: "subject-digest",
  name: "in-toto subject digest and predicate digest disagree (subject = head digest, predicate = old)",
  steps:
    "fastCheck statement whose subject shape:code/purgeOldEvents@unit carries the head digest while predicate.shape.code carries an older one; signed by fastCheck.",
  expected: "RJ02 rejection; law unestablished blocking (or E-provider-missing)",
  build: () =>
    replaceRec(ex1B(), fastRec, (r) => {
      const st = makeStatement(shapeOf(r));
      st.predicate.shape = structuredClone(st.predicate.shape);
      st.predicate.shape.code = st.predicate.shape.code.map((c) =>
        c.id === PURGE && c.projection === "unit"
          ? { ...c, digest: label("purge unit, earlier draft") }
          : c
      );
      return signStatement(st, [KEYS.fastCheck]);
    }),
  grade: lawTarget(LAW1)
});
add({
  id: "A6",
  cat: "subject-digest",
  name: "in-toto subject digest wrong, predicate digest right",
  steps:
    "fastCheck statement whose predicate cites the head digest but whose subject for purgeOldEvents@unit names an older digest.",
  expected: "RJ02 rejection; law unestablished blocking (or E-provider-missing)",
  build: () =>
    replaceRec(ex1B(), fastRec, (r) => {
      const st = makeStatement(shapeOf(r));
      st.subject = st.subject.map((x) =>
        x.name === `shape:code/${PURGE}@unit`
          ? { ...x, digest: { sha256: label("purge unit, earlier draft").slice(7) } }
          : x
      );
      return signStatement(st, [KEYS.fastCheck]);
    }),
  grade: lawTarget(LAW1)
});

// ===== B. claim fingerprint does not match ===================================================================
add({
  id: "B1",
  cat: "claim-fingerprint",
  name: "test record names the law's id but carries another claim's fingerprint",
  steps:
    "fastCheck record with claim.id = audit::EventsArePreserved and claim.fp = the fp of an unrelated Deterministic law (8620c3be…); subjects consistent; signed.",
  expected: "record not applicable; law unestablished blocking (or E-provider-missing)",
  build: () =>
    replaceRec(ex1B(), fastRec, (r) =>
      resign(
        r,
        (s) =>
          (s.claim = {
            id: LAW1,
            fp: "sha256:8620c3bead39262d509d30d813c84d79db4e1ce51b1dd92c904225082519b8c3"
          })
      )
    ),
  grade: lawTarget(LAW1)
});
function latencyCase(recordBudget) {
  let input = cleanWorld();
  input = withAuditDecls(
    input,
    [LAT_TEMPLATE, latLaw("250ms")],
    decidesToo(["template LatencyAtMost"])
  );
  const weakerSrc = modDecls(input.head.source, (ds) =>
    ds.map((d) => (d.decl === "law" && d.name === "AppendFast" ? latLaw(recordBudget) : d))
  );
  const weak = lawClaim(weakerSrc, "audit::AppendFast");
  const nf = JSON.stringify({ v: "shape.claim.v1", op: weak.op, args: weak.args });
  const rec = testRecord({
    rev: EX1.head,
    claim: { ids: ["audit::AppendFast"], fp: H(JSON.parse(nf)) },
    nf,
    code: [cite(STORE_FN, "unit", digestOf(input.head.manifest, STORE_FN, "unit"))]
  });
  return { ...input, records: [...input.records, rec] };
}
add({
  id: "B2",
  cat: "claim-fingerprint",
  name: "record for a weaker template instance establishes a stronger one through string order",
  steps:
    'Template LatencyAtMost<F: unit, Budget: value> with `order Budget by leq`; law AppendFast = LatencyAtMost<AuditStore.appendEvent, "250ms"> (critical, tested by fastCheck). The change edits appendEvent; the only record is a fresh test of the instance Budget = "1000ms" (nf supplied, hashes to its fp).',
  expected: "AppendFast unestablished, blocking (a 1000 ms budget does not imply a 250 ms one)",
  build: () => latencyCase("1000ms"),
  control: () => latencyCase("300ms"),
  controlExpect: "AppendFast unestablished (300ms is weaker in both orders)",
  grade: lawTarget("audit::AppendFast")
});
add({
  id: "B3",
  cat: "claim-fingerprint",
  name: "record for the base instance of a law the head tightened",
  steps:
    "Base law Bounded<AuditStore.appendEvent, 0, 100>; head tightens it to Bounded<…, 0, 50> and edits appendEvent. The only record is a fresh test whose claim fp is the base instance (Hi = 100).",
  expected: "head law unestablished, blocking at critical",
  build: () => {
    let input = cleanWorld();
    const law = (hi) => ({
      decl: "law",
      name: "AppendBounded",
      template: { name: "Bounded", args: ["AuditStore.appendEvent", 0, hi] },
      evidence: { level: "tested", by: ["fastCheck"] }
    });
    input = {
      ...input,
      base: {
        ...input.base,
        source: modDecls(addDecls(input.base.source, "audit", [law(100)]), (ds) =>
          ds.map(decidesToo(["template Bounded"]))
        )
      },
      head: {
        ...input.head,
        source: modDecls(addDecls(input.head.source, "audit", [law(50)]), (ds) =>
          ds.map(decidesToo(["template Bounded"]))
        )
      }
    };
    const baseLaw = lawClaim(input.base.source, "audit::AppendBounded");
    return {
      ...input,
      records: [
        ...input.records,
        testRecord({
          rev: EX1.head,
          claim: baseLaw,
          code: [cite(STORE_FN, "unit", digestOf(input.head.manifest, STORE_FN, "unit"))]
        })
      ]
    };
  },
  grade: lawTarget("audit::AppendBounded")
});

add({
  id: "B4",
  cat: "claim-fingerprint",
  name: "a fresh supporting record alongside a fresh contradicting one for the same law",
  steps:
    "Clean encodeRow world (appendEvent edited). fastCheck supplies two fresh head records for AppendDeterministic: one supports, one contradicts with a counterexample (presence-sound provider).",
  expected:
    "sound law contradiction, introduced, blocking (evidence never waives; contradicting beats supporting)",
  build: () => {
    const i = cleanWorld();
    const law = lawClaim(i.head.source, DET);
    const bad = testRecord({
      rev: EX1.head,
      claim: law,
      result: "contradicts",
      counterexample: { input: [7] },
      time: "2026-10-25T09:13:00Z",
      code: [cite(STORE_FN, "unit", digestOf(i.head.manifest, STORE_FN, "unit"))],
      deps: [
        cite(
          "ts:src/audit/store.ts#encodeRow",
          "unit",
          digestOf(i.head.manifest, "ts:src/audit/store.ts#encodeRow", "unit")
        )
      ]
    });
    return { ...i, records: [...i.records, bad] };
  },
  control: () => cleanWorld(),
  controlExpect: "pass (baseline of the clean world)",
  grade: {
    target: blockingOb((o) => o.kind === "contradiction" && about(DET)(o) && o.force === "sound"),
    weaker: (o) => about(DET)(o)
  }
});

// ===== C. evidence carried over from an earlier commit ======================================================
const baseFast = (input, fn = () => {}) =>
  resign(recOf(input, fastRec), (s) => {
    s.revision = EX1.base;
    s.code = s.code.filter((c) => !c.id.startsWith("ts:src/audit/purge.ts"));
    fn(s);
  });
add({
  id: "C1",
  cat: "carried-over",
  name: "base-revision test record replaces the fresh one",
  steps:
    "Example 1 Variant B. Drop fastCheck's head record; supply its genuine base-revision record (cites store.ts only).",
  expected: "law unestablished (stale), introduced, blocking at critical; E-provider-missing",
  build: () => {
    const i = ex1B();
    return { ...dropRec(i, fastRec), records: [...dropRec(i, fastRec).records, baseFast(i)] };
  },
  grade: lawTarget(LAW1)
});
add({
  id: "C2",
  cat: "carried-over",
  name: "deps-complete provider reuses a base record whose citations no longer cover Req",
  steps:
    "As C1, with fastCheck declared `deps complete` in base and head and the base record carrying deps: [].",
  expected: "law unestablished (stale: Req grew), blocking",
  build: () => {
    let i = onBoth(ex1B(), (s) =>
      mapDecl(s, isDecl("provider", "fastCheck"), (d) => ({ ...d, depsComplete: true }))
    );
    const rec = baseFast(i, (s) => (s.deps = []));
    i = dropRec(i, fastRec);
    return { ...i, records: [...i.records, rec] };
  },
  grade: lawTarget(LAW1)
});
add({
  id: "C3",
  cat: "carried-over",
  name: "deps-complete base record reused although an observed callee of the law's unit changed (deps: [])",
  steps:
    "Unit law AppendDeterministic = Deterministic<AuditStore.appendEvent>, fastCheck deps complete. appendEvent calls encodeRow (call fact from an authenticated call observer). The change edits encodeRow only; appendEvent's unit digest is unchanged. The only record is fastCheck's base-revision record citing appendEvent@unit with deps: [].",
  expected: "AppendDeterministic unestablished (stale), blocking at critical",
  build: () =>
    encodeWorld({
      lawRecords: ({ law, base }) => [
        testRecord({
          rev: EX1.base,
          claim: law,
          code: [cite(STORE_FN, "unit", digestOf(base, STORE_FN, "unit"))],
          deps: []
        })
      ]
    }),
  grade: lawTarget(DET)
});
add({
  id: "C3b",
  cat: "carried-over",
  name: "as C3, but the base record honestly lists the callee in deps",
  steps: "As C3, with the base record's deps = [encodeRow@unit at its base digest].",
  expected: "AppendDeterministic unestablished (stale), blocking at critical",
  build: () =>
    encodeWorld({
      lawRecords: ({ law, base }) => [
        testRecord({
          rev: EX1.base,
          claim: law,
          code: [cite(STORE_FN, "unit", digestOf(base, STORE_FN, "unit"))],
          deps: [
            cite(
              "ts:src/audit/store.ts#encodeRow",
              "unit",
              digestOf(base, "ts:src/audit/store.ts#encodeRow", "unit")
            )
          ]
        })
      ]
    }),
  grade: lawTarget(DET)
});
function c4(useBaseObs) {
  let i = ex3s2Seeded({ ruleTier: "normal", depsComplete: true });
  if (!useBaseObs) return i;
  i = dropRec(i, isProv("tooling::tsClockScan"));
  return { ...i, records: [...i.records, scanRecord(i.base.manifest, EX3S2.base, [ISO_FACT])] };
}
add({
  id: "C4",
  cat: "carried-over",
  name: "base-revision observation from a deps-complete observer replaces the head one (normal tier)",
  steps:
    "Example 3 Step 2 with a Date.now() seeded into checkFreshness; CheckerNeverReadsClock at tier normal; tsClockScan `deps complete`. Drop the head scan; supply the genuine base-revision scan (before the seed).",
  expected:
    "sound contradiction of CheckerNeverReadsClock, blocking (rule 7), or E-provider-missing",
  build: () => c4(true),
  control: () => c4(false),
  controlExpect: "blocking sound contradiction",
  grade: clockTarget
});
function c5(push, otherChange = false) {
  let i = F.ex1("C-answered");
  if (otherChange)
    i = { ...i, reviews: i.reviews.map((r) => ({ ...r, change: "github:acme/audit#99" })) };
  if (!push) return i;
  return edit(i, [
    { id: PURGE, projection: "unit", digest: label("purge unit, pushed after review") },
    { id: PURGE, projection: "own", digest: label("purge own, pushed after review") },
    {
      id: "ts:src/audit/purge.ts",
      projection: "file",
      digest: label("purge file, pushed after review")
    }
  ]);
}
const looseTarget = {
  target: blockingOb((o) => o.kind === "loosening"),
  weaker: (o) => o.kind === "loosening"
};
add({
  id: "C5",
  cat: "carried-over",
  name: "answers from before a push that edits the purge",
  steps:
    "Example 1 Variant C with bob's and carol's approve lines (refs bd:8d771e08…, bd:2785f31d…); then the agent pushes an edit to purgeOldEvents (honest providers re-run).",
  expected: "both L1 loosenings reopen and block",
  build: () => c5(true),
  control: () => c5(false),
  controlExpect: "both loosenings answered (pass)",
  grade: looseTarget
});
add({
  id: "C6",
  cat: "carried-over",
  name: "answers given on another change id",
  steps: "Example 1 Variant C with the same approve lines written on github:acme/audit#99.",
  expected: "both loosenings stay open and block",
  build: () => c5(false, true),
  grade: looseTarget
});
function c7(nHead, nBase) {
  let i = ex3s2Seeded();
  i = replaceRec(i, isProv("tooling::tsClockScan"), (r) =>
    resign(
      r,
      (s) =>
        (s.facts = s.facts.map((f) => (f.at === EX3S2.FRESH && nHead ? { ...f, n: nHead } : f)))
    )
  );
  return {
    ...i,
    baseRecords: [
      scanRecord(i.base.manifest, EX3S2.base, [
        ISO_FACT,
        { ...SEED_FACT, ...(nBase ? { n: nBase } : {}) }
      ])
    ]
  };
}
add({
  id: "C7",
  cat: "carried-over",
  name: "base record of a preexisting violation masks a second violation in the same function (no n)",
  steps:
    "Example 3 Step 2: checkFreshness already read Date.now() at base (base-revision scan reports it, no n). The change adds a second Date.now() call in checkFreshness; the head scan reports the fact once, without n.",
  expected: "introduced sound contradiction, blocking (critical)",
  build: () => c7(null, null),
  control: () => c7(2, 1),
  controlExpect: "introduced blocking contradiction (n 2 > 1)",
  grade: {
    target: blockingOb((o) => o.kind === "contradiction" && about(CLOCK)(o)),
    weaker: (o) => o.kind === "contradiction" && about(CLOCK)(o)
  }
});

// ===== D. a code change that leaves a fingerprint unchanged ==================================================
add({
  id: "D1",
  cat: "fingerprint-unchanged",
  name: "head manifest keeps base digests for an edited file (blob changed)",
  steps:
    "Example 3 Step 2 with the seeded Date.now(). The head manifest lists guards.ts and checkFreshness with their base digests although guards.ts's tree blob changed; the head scan reports the Date.now fact at the (unmoved) entry.",
  expected: "introduced sound contradiction, blocking; or invalid input",
  build: () => {
    let i = ex3s2Seeded();
    const bm = i.base.manifest;
    const ch = ["ts:packages/shp-checker/src/checker/rules/guards.ts", EX3S2.FRESH].flatMap((id) =>
      ["own", "unit", "file"]
        .map((p) => ({ id, projection: p, digest: digestOf(bm, id, p) }))
        .filter((x) => x.digest)
    );
    const head = {
      ...i.head,
      manifest: remanifest(i.head.manifest, setDig(ch), (t) =>
        t.map((e) =>
          e.path === "packages/shp-checker/src/checker/rules/guards.ts"
            ? { ...e, blob: gitBlobId(Buffer.from("guards.ts with Date.now()")) }
            : e
        )
      )
    };
    i = { ...i, head };
    return replaceRec(i, isProv("tooling::tsClockScan"), () =>
      scanRecord(head.manifest, EX3S2.head, [ISO_FACT, SEED_FACT])
    );
  },
  grade: {
    target: blockingOb((o) => o.kind === "contradiction" && about(CLOCK)(o)),
    targetErr: () => false,
    weaker: (o) => o.kind === "contradiction" && about(CLOCK)(o)
  }
});
const guardGrade = (law) => ({
  target: anyOb((o) => o.kind === "unestablished" && about(law)(o) && o.severity === "blocking"),
  weaker: (o) => o.kind === "unestablished" && about(law)(o)
});
const guardCases = [
  {
    id: "D2",
    name: "guarded unit reads a const imported from another file; the const changes",
    steps:
      "Real TypeScript, fingerprinted by the prototype. purgeOld (RefactorSensitive, tier critical, judged by ann at its base unit digest) uses RETENTION_DAYS imported from src/config.ts; the change sets it from 30 to 0.",
    base: {
      "src/config.ts": "export const DAYS = 30;\n",
      "src/purge.ts": `import { DAYS } from "./config.ts";\n${PURGE_BASE}`
    },
    head: { "src/config.ts": "export const DAYS = 0;\n" }
  },
  {
    id: "D3",
    name: "guarded unit reads an imported JSON file; the JSON changes",
    steps: "As D2, but purgeOld reads cfg.days from src/retention.json, changed from 30 to 0.",
    base: {
      "src/retention.json": '{ "days": 30 }\n',
      "src/purge.ts": `import cfg from "./retention.json";\nconst DAYS_FN = () => cfg.days;\n${PURGE_BASE.replace("DAYS * 86400", "cfg.days * 86400")}`
    },
    head: { "src/retention.json": '{ "days": 0 }\n' }
  },
  {
    id: "D4",
    name: "guarded unit passes a same-file const as `{ days: days }`; the const changes",
    steps:
      "As D2, but `const days = 30` is in purge.ts and purgeOld calls run({ table, days: days }); the change sets days to 0.",
    base: {
      "src/purge.ts":
        'const days = 30;\nfunction run(q: { table: string; n: number }) {\n  return q;\n}\nexport function purgeOld() {\n  return run({ table: "audit_events", n: 0, days: days } as never);\n}\n'
    },
    head: {
      "src/purge.ts":
        'const days = 0;\nfunction run(q: { table: string; n: number }) {\n  return q;\n}\nexport function purgeOld() {\n  return run({ table: "audit_events", n: 0, days: days } as never);\n}\n'
    }
  },
  {
    id: "D5",
    name: "guarded unit uses a same-file enum; the enum value changes",
    steps: "As D2, with `enum Days { Keep = 30 }` in purge.ts changed to 0.",
    base: {
      "src/purge.ts":
        "enum Days {\n  Keep = 30\n}\nexport function purgeOld(now: number) {\n  return now - Days.Keep * 86400;\n}\n"
    },
    head: {
      "src/purge.ts":
        "enum Days {\n  Keep = 0\n}\nexport function purgeOld(now: number) {\n  return now - Days.Keep * 86400;\n}\n"
    }
  },
  {
    id: "D6",
    name: "control: the guarded unit's own body changes",
    steps: "As D2, but the literal 30 inside purgeOld changes to 0.",
    base: {
      "src/purge.ts": "export function purgeOld(now: number) {\n  return now - 30 * 86400;\n}\n"
    },
    head: {
      "src/purge.ts": "export function purgeOld(now: number) {\n  return now - 0 * 86400;\n}\n"
    }
  }
];
for (const g of guardCases)
  add({
    id: g.id,
    cat: "fingerprint-unchanged",
    name: g.name,
    steps: g.steps,
    expected: "the RefactorSensitive law unestablished (stale), blocking at critical",
    buildAsync: async () => (await guardWorld(g.base, g.head, "purgeOld")).input,
    grade: guardGrade("ret::Retention.purgeOld/RefactorSensitive/law")
  });
add({
  id: "D7",
  cat: "fingerprint-unchanged",
  name: "an optimisation in a callee breaks a unit law; the law's unit fingerprint is unchanged",
  steps:
    "encodeRow world: the change optimises encodeRow; appendEvent's digests do not move. fastCheck reruns at head: the test of AppendDeterministic fails with a counterexample (presence-sound provider), citing appendEvent@unit and deps encodeRow@unit (head).",
  expected: "sound law contradiction, introduced, blocking",
  build: () =>
    encodeWorld({
      lawRecords: ({ law, head }) => [
        testRecord({
          rev: EX1.head,
          claim: law,
          result: "contradicts",
          counterexample: { input: [3, 1] },
          code: [cite(STORE_FN, "unit", digestOf(head, STORE_FN, "unit"))],
          deps: [
            cite(
              "ts:src/audit/store.ts#encodeRow",
              "unit",
              digestOf(head, "ts:src/audit/store.ts#encodeRow", "unit")
            )
          ]
        })
      ]
    }),
  control: () =>
    encodeWorld({
      appendChanged: true,
      lawRecords: ({ law, head }) => [
        testRecord({
          rev: EX1.head,
          claim: law,
          result: "contradicts",
          counterexample: { input: [3, 1] },
          code: [cite(STORE_FN, "unit", digestOf(head, STORE_FN, "unit"))],
          deps: [
            cite(
              "ts:src/audit/store.ts#encodeRow",
              "unit",
              digestOf(head, "ts:src/audit/store.ts#encodeRow", "unit")
            )
          ]
        })
      ]
    }),
  controlExpect: "blocking sound law contradiction (appendEvent itself edited)",
  grade: {
    target: blockingOb((o) => o.kind === "contradiction" && about(DET)(o) && o.force === "sound"),
    weaker: (o) => about(DET)(o)
  }
});

// ===== E. claim, resource or binding split or renamed out of jurisdiction ======================================
add({
  id: "E1",
  cat: "split-rename",
  name: "guarded unit's logic lives in a same-file helper; the helper changes",
  steps:
    "Real TypeScript. isoToday (RefactorSensitive, critical, judged by ann) returns fmt(new Date()); the change rewrites fmt to toLocaleDateString(). isoToday's own text is unchanged.",
  expected: "the RefactorSensitive law unestablished (stale), blocking at critical",
  buildAsync: async () =>
    (
      await guardWorld(
        {
          "src/purge.ts":
            "function fmt(d: Date) {\n  return d.toISOString().slice(0, 10);\n}\nexport function isoToday() {\n  return fmt(new Date());\n}\n"
        },
        {
          "src/purge.ts":
            "function fmt(d: Date) {\n  return d.toLocaleDateString();\n}\nexport function isoToday() {\n  return fmt(new Date());\n}\n"
        },
        "isoToday"
      )
    ).input,
  grade: guardGrade("ret::Retention.isoToday/RefactorSensitive/law")
});
function scopedWorld({ split }) {
  // AuditStore with open authority, a component-scoped critical forbid, no AppendOnly, no law
  const fix = (paths) => (s) =>
    modDecls(s, (ds) =>
      ds
        .filter((d) => !(d.decl === "law") && !(d.decl === "provider" && d.name === "fastCheck"))
        .map((d) =>
          d.decl === "resource" && d.name === "AuditEvent"
            ? { ...d, attach: [], tier: "critical" }
            : d
        )
        .map((d) =>
          d.decl === "component" && d.name === "AuditStore" ? { ...omit(d, "grants"), paths } : d
        )
    );
  const rule = {
    decl: "rule",
    name: "NoDeleteInStore",
    owner: "AuditTeam",
    tier: "critical",
    clauses: [
      { forbid: "effect", atom: "HardDelete<AuditEvent>", within: ["component AuditStore"] }
    ]
  };
  const jobs = {
    decl: "component",
    name: "AuditJobs",
    owner: "AuditTeam",
    tier: "normal",
    paths: ["src/audit/jobs/**/*.ts"]
  };
  const baseSrc = addDecls(fix(["src/audit/**/*.ts"])(auditSource({ ids: F.IDS })), "audit", [
    rule
  ]);
  const headSrc = split
    ? addDecls(fix(["src/audit/store.ts"])(auditSource({ ids: F.IDS })), "audit", [rule, jobs])
    : baseSrc;
  const P = "ts:src/audit/jobs/purge.ts#purgeOldEvents";
  const baseIds = [
    { id: "pkgjson:package.json" },
    { id: "raw:bun.lock" },
    { id: "ts:src/audit/store.ts", file: EX1.STORE_FILE },
    { id: STORE_FN, unit: EX1.STORE_UNIT }
  ];
  const headIds = [
    ...baseIds,
    { id: "ts:src/audit/jobs/purge.ts", file: label("jobs purge file") },
    { id: P, unit: label("jobs purge unit") }
  ];
  const mb = F.manifest(EX1.base, baseIds);
  const mh = F.manifest(EX1.head, headIds);
  const obs = obsRecord({
    rev: EX1.head,
    provider: "audit::sqlEffects",
    version: "2.3.1",
    entries: citeAll(mh, ["ts:src/audit/store.ts", STORE_FN, "ts:src/audit/jobs/purge.ts", P]),
    facts: [
      { type: "effect", at: P, verb: "HardDelete", resource: 'pg.table("public.audit_events")' }
    ]
  });
  return F.baseInput({
    head: { revision: EX1.head, source: headSrc, manifest: mh },
    base: { revision: EX1.base, source: baseSrc, manifest: mb },
    records: [obs],
    authors: [{ identity: 'github("acme-code-agent[bot]")', verified: true, bot: true }]
  });
}
add({
  id: "E2",
  cat: "split-rename",
  name: "component split moves the violating code out of a component-scoped forbid",
  steps:
    "rule NoDeleteInStore { forbid HardDelete<AuditEvent> within component AuditStore } (critical; AuditStore has open authority). The change narrows AuditStore to src/audit/store.ts, adds component AuditJobs for src/audit/jobs/**, and adds jobs/purge.ts whose purgeOldEvents hard-deletes (observed, sound).",
  expected: "L1/L6 loosening of NoDeleteInStore, exploited, blocking (or a blocking contradiction)",
  build: () => scopedWorld({ split: true }),
  control: () => scopedWorld({ split: false }),
  controlExpect: "blocking sound contradiction of NoDeleteInStore",
  grade: {
    target: blockingOb(
      (o) =>
        (o.kind === "loosening" && (o.exploited ?? true)) ||
        (o.kind === "contradiction" && about("audit::NoDeleteInStore")(o))
    ),
    weaker: (o) => o.kind === "loosening" || o.kind === "coverage"
  }
});
add({
  id: "E3",
  cat: "split-rename",
  name: "rule renamed and narrowed in the same change that violates it",
  steps:
    "Example 3 Step 2 with the seeded Date.now() in ShapeRuleEngine (open authority on both sides). The head renames CheckerNeverReadsClock to CheckerClockPolicy and drops ShapeRuleEngine from its `within` list.",
  expected: "L1 loosening of the base rule, exploited, blocking",
  build: () =>
    onHead(ex3s2Seeded({ openRuleEngine: true }), (s) =>
      mapDecl(s, isDecl("rule", "CheckerNeverReadsClock"), (d) => ({
        ...d,
        name: "CheckerClockPolicy",
        clauses: d.clauses.map((c) => ({
          ...c,
          within: c.within.filter((w) => !w.includes("ShapeRuleEngine"))
        }))
      }))
    ),
  control: () => ex3s2Seeded({ openRuleEngine: true }),
  controlExpect: "blocking sound contradiction",
  grade: {
    target: blockingOb(
      (o) =>
        (o.kind === "loosening" && o.exploited !== false) ||
        (o.kind === "contradiction" && o.force === "sound")
    ),
    weaker: (o) => o.kind === "loosening" || o.kind === "contradiction" || o.kind === "coverage"
  }
});
add({
  id: "E4",
  cat: "split-rename",
  name: "resource renamed (same bindings, no `was`) in the same change that violates its forbid",
  steps:
    "As the Example 3 Step 2 seeded change, but the head renames SystemClock to WallClock everywhere (bindings identical, so ρ maps it by binding).",
  expected: "sound contradiction of the renamed rule, blocking (heir by ρ)",
  build: () => {
    const ren = (s) => JSON.parse(JSON.stringify(s).replaceAll("SystemClock", "WallClock"));
    return onHead(ex3s2Seeded(), ren);
  },
  grade: {
    target: blockingOb((o) => o.kind === "contradiction" && o.force === "sound"),
    weaker: (o) => o.kind === "contradiction" || o.kind === "loosening" || o.kind === "coverage"
  }
});
add({
  id: "E5",
  cat: "split-rename",
  name: "resource binding narrowed so the new read's resource code is unmapped",
  steps:
    'Example 3 Step 2 with a performance.now() read seeded into checkFreshness; the same change drops ts.call("performance.now") from SystemClock\'s bindings.',
  expected: "L1 loosening (unmapping a resource code loosens), exploited, blocking at critical",
  build: () => {
    let i = ex3s2Seeded();
    i = replaceRec(i, isProv("tooling::tsClockScan"), (r) =>
      resign(
        r,
        (s) =>
          (s.facts = s.facts.map((f) =>
            f.at === EX3S2.FRESH ? { ...f, resource: 'ts.call("performance.now")' } : f
          ))
      )
    );
    return onHead(i, (s) =>
      mapDecl(s, isDecl("resource", "SystemClock"), (d) => ({
        ...d,
        bind: d.bind.filter((b) => !b.includes("performance"))
      }))
    );
  },
  grade: {
    target: blockingOb(
      (o) =>
        (o.kind === "loosening" && about(CLOCK)(o)) ||
        (o.kind === "contradiction" && o.force === "sound")
    ),
    weaker: (o) => o.kind === "loosening" || o.kind === "coverage" || o.kind === "contradiction"
  }
});
add({
  id: "E6",
  cat: "split-rename",
  name: "append-only log rewritten (UPDATE … SET payload = NULL) from code outside the law's component",
  steps:
    'Example 1 Variant B′ (scripts/purge-audit.ts, ungoverned), but the purge rewrites rows: the signed sound observation reports Update on pg.table("audit_events"). AuditEvent is AppendOnly (final); HistoryPreserved<AuditEvent> is a law on component AuditStore.',
  expected: "a blocking obligation (contradiction of AppendOnly or of HistoryPreserved)",
  build: () =>
    replaceRec(F.ex1("Bprime"), obsRec, (r) =>
      resign(
        r,
        (s) =>
          (s.facts = s.facts.map((f) => (f.verb === "HardDelete" ? { ...f, verb: "Update" } : f)))
      )
    ),
  control: () => F.ex1("Bprime"),
  controlExpect: "blocking final contradiction (HardDelete)",
  grade: {
    target: blockingOb(
      (o) => o.kind === "contradiction" || (o.kind === "unestablished" && about(LAW1)(o))
    ),
    weaker: (o) => o.kind !== "loosening"
  }
});
add({
  id: "E7",
  cat: "split-rename",
  name: "unit law re-bound to a decoy while the real function is broken",
  steps:
    "encodeWorld: the head re-binds unit appendEvent to a new decoy identity store.ts#appendEventV2 and edits the real store.ts#appendEvent (now AuditStore.*). fastCheck's fresh head record tests the decoy and supports AppendDeterministic.",
  expected: "L6 loosening (the law no longer governs the real function), blocking at critical",
  build: () => {
    let i = encodeWorld({ appendChanged: true, lawRecords: () => [] });
    const V2 = "ts:src/audit/store.ts#appendEventV2";
    const p = structuredClone(i.head.manifest.predicate.shape);
    p.entries.push(
      ...["own", "unit"].map((proj) => ({
        id: V2,
        projection: proj,
        scheme: `ts.${proj}.v2`,
        digest: label(`appendEventV2 ${proj}`),
        kind: "function",
        parent: "ts:src/audit/store.ts"
      }))
    );
    i = { ...i, head: { ...i.head, manifest: manifestStatement(p) } };
    i = onHead(i, (s) =>
      mapDecl(s, isDecl("component", "AuditStore"), (d) => ({
        ...d,
        units: d.units.map((u) =>
          u.name === "appendEvent" ? { ...u, bind: 'ts("src/audit/store.ts#appendEventV2")' } : u
        )
      }))
    );
    const law = lawClaim(i.head.source, DET);
    return {
      ...i,
      records: [
        ...i.records,
        testRecord({
          rev: EX1.head,
          claim: law,
          code: [cite(V2, "unit", label("appendEventV2 unit"))],
          deps: []
        })
      ]
    };
  },
  grade: {
    target: blockingOb((o) => o.kind === "loosening" || (about(DET)(o) && o.kind !== "loosening")),
    weaker: (o) => o.kind === "loosening" || o.kind === "coverage" || about(DET)(o)
  }
});

// ===== F. exception or policy edit covering a final forbid ===================================================
const exc = (target, extra = {}) => ({
  decl: "exception",
  name: "PurgeAccepted",
  waives: ["contradiction"],
  target,
  for: [`code ts("src/audit/purge.ts#purgeOldEvents")`],
  owner: "AuditTeam",
  expires: "2026-12-15",
  ...extra
});
const withBob = (s) =>
  mapDecl(s, isDecl("actor", "bob"), (d) => ({
    ...d,
    identities: ['github("bob")', K.bob.identity]
  }));
const bobApproves = (pred) => (out) => [
  { identity: 'github("bob")', line: `shape approve ${bdOf(out, pred)}`, change: EX1.change }
];
const isForbidOb = (o) => o.kind === "contradiction" && about(FORBID)(o);
function fCase(target, extra = {}, headFn = (s) => s) {
  const i = onHead(ex1B(), (s) => headFn(addDecls(s, "audit", [exc(target, extra)])));
  return phase2(i, bobApproves(isForbidOb));
}
const finalKept = { ...forbidTarget, weaker: (o) => isForbidOb(o) };
add({
  id: "F1",
  cat: "exception-policy",
  name: "exception names the final forbid by claim id, with an exception answer",
  steps:
    "Example 1 Variant B; the head adds `exception PurgeAccepted { waives contradiction of claim audit::AuditEvent/AppendOnly/effect.forbid-HardDelete for code ts(purge) owner AuditTeam expires 2026-12-15 }`; bob writes `shape approve <binding>`.",
  expected: "E-exception; the final contradiction stays blocking, not debt",
  build: () => fCase(`claim ${FORBID}`),
  grade: finalKept
});
add({
  id: "F2",
  cat: "exception-policy",
  name: "component exception on AuditStore (non-final target) covering the purge, with an exception answer",
  steps: "As F1 with target `component AuditStore` (tier critical, so no E-exception).",
  expected: "the exception does not match (tier* final); contradiction stays blocking",
  build: () => fCase("component AuditStore"),
  grade: finalKept
});
add({
  id: "F3",
  cat: "exception-policy",
  name: "exception names the final forbid by fingerprint prefix",
  steps: "As F1 with target `claim c:ccfcbabf10265d64`.",
  expected: "E-exception; contradiction stays blocking",
  build: () => fCase("claim c:ccfcbabf10265d64"),
  grade: finalKept
});
add({
  id: "F4",
  cat: "exception-policy",
  name: "head lowers AuditEvent from final to critical and adds a component exception, with an exception answer",
  steps:
    "As F2, and the head also sets AuditEvent's tier to critical (the forbid's head tier becomes critical; its base heir is final).",
  expected: "tier* stays final; no match; contradiction blocking; L7 loosening",
  build: () =>
    fCase("component AuditStore", {}, (s) =>
      mapDecl(s, isDecl("resource", "AuditEvent"), (d) => ({ ...d, tier: "critical" }))
    ),
  grade: finalKept
});
add({
  id: "F5",
  cat: "exception-policy",
  name: "head restates the final forbid at tier low and drops AppendOnly",
  steps:
    "Example 1 Variant B; the head removes `: AppendOnly` and adds `rule Cleanup { forbid HardDelete<AuditEvent> tier low }` (equal NF to the base final forbid).",
  expected: "contradiction with tier* final, blocking (rule 2)",
  build: () =>
    onHead(ex1B(), (s) =>
      addDecls(
        mapDecl(s, isDecl("resource", "AuditEvent"), (d) => ({ ...d, attach: [] })),
        "audit",
        [
          {
            decl: "rule",
            name: "Cleanup",
            tier: "low",
            clauses: [{ forbid: "effect", atom: "HardDelete<AuditEvent>" }]
          }
        ]
      )
    ),
  grade: {
    target: blockingOb(
      (o) => o.kind === "contradiction" && o.force === "sound" && o.tier === "final"
    ),
    weaker: (o) => o.kind === "contradiction" || o.kind === "loosening"
  }
});
add({
  id: "F6",
  cat: "exception-policy",
  name: "head policy stops blocking unestablished at critical while dropping the law's evidence",
  steps:
    "Example 1 Variant B without fastCheck's record; the head adds policy Lax (critical: floor declared, blocks nothing, judges owner, agents) and `shape AuditService { policy Lax }`.",
  expected: "law unestablished, blocking (policy* unions blocks, highest floor)",
  build: () => {
    const lax = {
      decl: "policy",
      name: "Lax",
      tiers: {
        low: { floor: "declared" },
        normal: { floor: "declared" },
        critical: { floor: "declared", blocks: [], judges: ["owner", "agents"] }
      }
    };
    return onHead(dropRec(ex1B(), fastRec), (s) =>
      addDecls(
        mapDecl(
          s,
          (d) => d.decl === "shape",
          (d) => ({ ...d, policy: "Lax" })
        ),
        "audit",
        [lax]
      )
    );
  },
  grade: lawTarget(LAW1)
});
add({
  id: "F7",
  cat: "exception-policy",
  name: "head policy admits agents as critical judges; a non-author agent approves Variant C's final loosening",
  steps:
    "Example 1 Variant C; base and head declare agent opsAgent (operator carol); the head policy adds `judges owner, agents` at critical; opsAgent and carol write approve lines for both bindings.",
  expected: "both loosenings stay blocking (loosenings never answered by agents; judges from base)",
  build: () => {
    const ops = {
      decl: "actor",
      name: "opsAgent",
      kind: "agent",
      operator: "carol",
      identities: ['github("ops-agent[bot]")']
    };
    const pol = {
      decl: "policy",
      name: "Agents",
      tiers: {
        low: {},
        normal: { blocks: ["latent-loosening"] },
        critical: {
          floor: "tested",
          blocks: ["unestablished", "coverage", "latent-loosening"],
          judges: ["owner", "agents"],
          maxAge: 90
        }
      }
    };
    let i = onBoth(F.ex1("C"), (s) => addDecls(s, "audit", [ops]));
    i = onHead(i, (s) =>
      addDecls(
        mapDecl(
          s,
          (d) => d.decl === "shape",
          (d) => ({ ...d, policy: "Agents" })
        ),
        "audit",
        [pol]
      )
    );
    return {
      ...i,
      reviews: [
        {
          identity: 'github("ops-agent[bot]")',
          line: "shape approve bd:8d771e08d86d43b2 bd:2785f31d20281bdd",
          change: EX1.change
        },
        {
          identity: 'github("carol")',
          line: "shape approve bd:8d771e08d86d43b2",
          change: EX1.change
        }
      ]
    };
  },
  grade: looseTarget
});
add({
  id: "F8",
  cat: "exception-policy",
  name: "preexisting final violation under a whole-component exception declared in base and head",
  steps:
    "purgeOldEvents already hard-deleted at base (genuine base-revision observation); base and head declare `exception OldPurge { waives contradiction of component AuditStore owner AuditTeam expires 2026-12-15 }`. The change touches only README.",
  expected: "final contradiction blocks (preexisting final still blocks; no exception on final)",
  build: () => {
    const i = ex1B();
    const ex = {
      decl: "exception",
      name: "OldPurge",
      waives: ["contradiction"],
      target: "component AuditStore",
      owner: "AuditTeam",
      expires: "2026-12-15"
    };
    const both = onBoth(i, (s) => addDecls(s, "audit", [ex]));
    const baseMan = { ...both.base, manifest: remanifest(both.head.manifest) };
    const p = structuredClone(baseMan.manifest.predicate.shape);
    p.revision = EX1.base;
    const baseManifest = manifestStatement(p);
    const baseObs = resign(recOf(i, obsRec), (s) => (s.revision = EX1.base));
    return { ...both, base: { ...both.base, manifest: baseManifest }, baseRecords: [baseObs] };
  },
  grade: finalKept
});

// ===== G. judged evidence where mechanical evidence is required =============================================
const noFast = () => dropRec(ex1B(), fastRec);
add({
  id: "G1",
  cat: "judged-for-mechanical",
  name: "`shape judge` line for a law that requires tested evidence",
  steps:
    "Example 1 Variant B without fastCheck's record; bob (AuditTeam, eligible owner) writes `shape judge audit::EventsArePreserved`.",
  expected: "law unestablished (weak), blocking",
  build: () => ({
    ...noFast(),
    reviews: [{ identity: 'github("bob")', line: `shape judge ${LAW1}`, change: EX1.change }]
  }),
  grade: lawTarget(LAW1)
});
add({
  id: "G2",
  cat: "judged-for-mechanical",
  name: "signed judgment record for a law that requires tested evidence",
  steps:
    "As G1 with a judgment record signed by bob's ed25519 key (declared in base), citing the head Req.",
  expected: "law unestablished (weak), blocking",
  build: () => {
    const i = onBoth(noFast(), withBob);
    const law = lawClaim(i.head.source, LAW1);
    const code = shapeOf(recOf(ex1B(), fastRec)).code;
    const j = signed(
      {
        v: "shape.evidence.v1",
        kind: "judgment",
        result: "supports",
        provider: null,
        revision: EX1.head,
        time: "2026-10-25T10:00:00Z",
        claim: { id: LAW1, fp: law.fp },
        code,
        judge: "audit::bob"
      },
      [K.bob]
    );
    return { ...i, records: [...i.records, j] };
  },
  grade: lawTarget(LAW1)
});
add({
  id: "G3",
  cat: "judged-for-mechanical",
  name: "head adds `or judged` to the law, then judges it",
  steps: "As G1, and the head changes the law's evidence to `tested or judged`.",
  expected: "law unestablished (R* judged needs base and head), blocking; L7",
  build: () =>
    onHead(
      {
        ...noFast(),
        reviews: [{ identity: 'github("bob")', line: `shape judge ${LAW1}`, change: EX1.change }]
      },
      (s) =>
        mapDecl(s, isDecl("law", "EventsArePreserved"), (d) => ({
          ...d,
          evidence: { ...d.evidence, orJudged: true }
        }))
    ),
  grade: lawTarget(LAW1)
});
add({
  id: "G4",
  cat: "judged-for-mechanical",
  name: "`shape approve` of the unestablished law's binding",
  steps: "As G1, but bob approves the unestablished obligation's binding instead of judging.",
  expected: "nothing discharged (no answer discharger for missing); blocking",
  build: () =>
    phase2(
      noFast(),
      bobApproves((o) => o.kind === "unestablished")
    ),
  grade: lawTarget(LAW1)
});
add({
  id: "G5",
  cat: "judged-for-mechanical",
  name: "judgment and approval offered against the final forbid's contradiction",
  steps:
    "Example 1 Variant B; bob writes `shape judge audit::AuditEvent/AppendOnly/effect.forbid-HardDelete` and approves the contradiction's binding; a signed bob judgment record supporting the forbid's fp is also supplied.",
  expected: "contradiction stays blocking",
  build: () => {
    let i = onBoth(ex1B(), withBob);
    const fpF = lawClaim(i.head.source, FORBID).fp;
    const j = signed(
      {
        v: "shape.evidence.v1",
        kind: "judgment",
        result: "supports",
        provider: null,
        revision: EX1.head,
        time: "2026-10-25T10:00:00Z",
        claim: { id: FORBID, fp: fpF },
        code: [cite(PURGE, "unit", EX1.PURGE_UNIT)],
        judge: "audit::bob"
      },
      [K.bob]
    );
    i = {
      ...i,
      records: [...i.records, j],
      reviews: [{ identity: 'github("bob")', line: `shape judge ${FORBID}`, change: EX1.change }]
    };
    return phase2(i, bobApproves(isForbidOb));
  },
  grade: finalKept
});
function g6(result) {
  let i = F.ex3s2({ harnessEdited: true });
  i = edit(i, [
    { id: EX3S2.CSM, projection: "unit", digest: label("csm unit, edited") },
    { id: EX3S2.CSM, projection: "own", digest: label("csm own, edited") }
  ]);
  i = replaceRec(i, isProv("checker::bunTest"), (r) => resign(r, (s) => (s.result = result)));
  return phase2(i, (out) => [
    {
      identity: 'github("ann")',
      line: `shape approve ${bdOf(out, (o) => o.kind === "unestablished" && about("checker::CheckIsDeterministic")(o))}`,
      change: "github:smoothbrains/shapelang#202"
    }
  ]);
}
add({
  id: "G6",
  cat: "judged-for-mechanical",
  name: "a failing (inconclusive) test plus a harness edit turns the law into an answerable producer-changed obligation",
  steps:
    "Example 3 Step 2: the change edits checkShapeModules and determinism.test.ts (the test's harness). bunTest's fresh head record is `inconclusive` (failed without counterexample). ann approves the obligation's binding.",
  expected:
    "CheckIsDeterministic unestablished (missing: an inconclusive record holds no reason, A.5.4.3), blocking, not answerable",
  build: () => g6("inconclusive"),
  control: () => g6("supports"),
  controlExpect: "producer-changed, discharged by ann's answer (designed path)",
  grade: lawTarget("checker::CheckIsDeterministic")
});
add({
  id: "G7",
  cat: "judged-for-mechanical",
  name: "producer change masks an undeclared assume (an answer substitutes for removing or declaring it)",
  steps:
    "Example 2 (agent inserts assume in set; the fresh proof's cone holds the undeclared hatch). The same change bumps ironkv/Cargo.lock (verus' implementation). dana approves the SetRefinesSpec obligation's binding.",
  expected: "SetRefinesSpec unestablished (assumption), blocking; no answer discharges it",
  build: () => {
    let i = F.ex2();
    const ch = [
      { id: "raw:ironkv/Cargo.lock", projection: "file", digest: label("Cargo.lock bumped") },
      { id: "raw:ironkv/Cargo.lock", projection: "own", digest: label("Cargo.lock own bumped") }
    ];
    i = { ...i, head: { ...i.head, manifest: remanifest(i.head.manifest, setDig(ch)) } };
    return phase2(i, (out) => [
      {
        identity: 'github("dana")',
        line: `shape approve ${bdOf(out, (o) => o.kind === "unestablished" && about("ironkv::SetRefinesSpec")(o))}`,
        change: EX2.change
      }
    ]);
  },
  grade: { ...lawTarget("ironkv::SetRefinesSpec"), targetErr: () => false }
});

add({
  id: "G8",
  cat: "judged-for-mechanical",
  name: "producer change masks an undeclared named assumption (no hatch involved)",
  steps:
    "Example 2 without the assume (set edited, no marker). The fresh proof lists the named assumption NetworkDelivers, which no base boundary `assumes`. The same change bumps ironkv/Cargo.lock; dana approves the SetRefinesSpec obligation's binding.",
  expected: "SetRefinesSpec unestablished (assumption), blocking; no answer discharges it (EM-4)",
  build: () => {
    let i = F.ex2();
    const p = structuredClone(i.head.manifest.predicate.shape);
    p.entries = p.entries.map((e) => (e.id === EX2.SET ? omit(e, "markers") : e));
    p.entries = setDig([
      { id: "raw:ironkv/Cargo.lock", projection: "file", digest: label("Cargo.lock bumped") },
      { id: "raw:ironkv/Cargo.lock", projection: "own", digest: label("Cargo.lock own bumped") }
    ])(p.entries);
    i = { ...i, head: { ...i.head, manifest: manifestStatement(p) } };
    i = replaceRec(i, isProv("ironkv::verus"), (r) =>
      resign(
        r,
        (s) =>
          (s.assumptions = [
            { id: "NetworkDelivers", kind: "named" },
            { id: "z3@4.12.5", kind: "tool" },
            { id: "verus@dccae1d", kind: "tool" }
          ])
      )
    );
    return phase2(i, (out) => [
      {
        identity: 'github("dana")',
        line: `shape approve ${bdOf(out, (o) => o.kind === "unestablished" && about("ironkv::SetRefinesSpec")(o))}`,
        change: EX2.change
      }
    ]);
  },
  control: () => {
    let i = F.ex2();
    const p = structuredClone(i.head.manifest.predicate.shape);
    p.entries = p.entries.map((e) => (e.id === EX2.SET ? omit(e, "markers") : e));
    i = { ...i, head: { ...i.head, manifest: manifestStatement(p) } };
    return replaceRec(i, isProv("ironkv::verus"), (r) =>
      resign(
        r,
        (s) =>
          (s.assumptions = [
            { id: "NetworkDelivers", kind: "named" },
            { id: "z3@4.12.5", kind: "tool" },
            { id: "verus@dccae1d", kind: "tool" }
          ])
      )
    );
  },
  controlExpect: "SetRefinesSpec unestablished (assumption), blocking",
  grade: { ...lawTarget("ironkv::SetRefinesSpec"), targetErr: () => false }
});

// ===== W. a law weakened in the same change that re-establishes it ==========================================
function weakenCase({
  templates = [],
  baseLaw,
  headLaw,
  recordFrom = "head",
  decides = [],
  dropFast = false,
  headOnly = null
}) {
  let input = cleanWorld();
  input = {
    ...input,
    base: {
      ...input.base,
      source: modDecls(addDecls(input.base.source, "audit", [...templates, baseLaw]), (ds) =>
        ds.map(decidesToo(decides))
      )
    },
    head: {
      ...input.head,
      source: modDecls(
        addDecls(input.head.source, "audit", [
          ...templates,
          headLaw,
          ...(headOnly ? [headOnly] : [])
        ]),
        (ds) => ds.map(decidesToo(decides))
      )
    }
  };
  const c = lawClaim(
    recordFrom === "head" ? input.head.source : input.base.source,
    `audit::${headLaw.name}`
  );
  if (dropFast) input = dropRec(input, fastRec);
  return {
    input,
    rec: (o = {}) =>
      testRecord({
        rev: EX1.head,
        claim: c,
        code: [cite(STORE_FN, "unit", digestOf(input.head.manifest, STORE_FN, "unit"))],
        ...o
      })
  };
}
const weakTarget = (law) => ({
  target: blockingOb(
    (o) =>
      (o.kind === "loosening" && about(law)(o)) || (o.kind === "unestablished" && about(law)(o))
  ),
  targetErr: errIs("E-provider-missing", law),
  weaker: (o) => about(law)(o)
});
const bnd = (hi, extra = {}) => ({
  decl: "law",
  name: "AppendBounded",
  template: { name: "Bounded", args: ["AuditStore.appendEvent", 0, hi] },
  evidence: { level: "tested", by: ["fastCheck"] },
  ...extra
});
add({
  id: "W1",
  cat: "law-weakened",
  name: "integer bound widened in the change that supplies a test of the widened law",
  steps:
    "Base law AppendBounded = Bounded<AuditStore.appendEvent, 0, 50>; the change edits appendEvent and widens the law to Bounded<…, 0, 100>; a fresh fastCheck record supports the widened instance.",
  expected: "L4 loosening of the base law (no heir), blocking at critical",
  build: () => {
    const w = weakenCase({ baseLaw: bnd(50), headLaw: bnd(100), decides: ["template Bounded"] });
    return { ...w.input, records: [...w.input.records, w.rec()] };
  },
  grade: weakTarget("audit::AppendBounded")
});
add({
  id: "W2",
  cat: "law-weakened",
  name: 'string budget widened ("250ms" to "1000ms") in the change that supplies a test of the widened law',
  steps:
    'Base law AppendFast = LatencyAtMost<AuditStore.appendEvent, "250ms"> (`order Budget by leq`); the change edits appendEvent and widens Budget to "1000ms"; a fresh fastCheck record supports the widened instance.',
  expected: "L4 loosening (the head law is weaker, so not an heir), blocking at critical",
  build: () => {
    const w = weakenCase({
      templates: [LAT_TEMPLATE],
      baseLaw: latLaw("250ms"),
      headLaw: latLaw("1000ms"),
      decides: ["template LatencyAtMost"]
    });
    return { ...w.input, records: [...w.input.records, w.rec()] };
  },
  control: () => {
    const w = weakenCase({
      templates: [LAT_TEMPLATE],
      baseLaw: latLaw("250ms"),
      headLaw: latLaw("300ms"),
      decides: ["template LatencyAtMost"]
    });
    return { ...w.input, records: [...w.input.records, w.rec()] };
  },
  controlExpect: "L4 loosening (300ms is weaker in both orders)",
  grade: weakTarget("audit::AppendFast")
});
add({
  id: "W3",
  cat: "law-weakened",
  name: "law requirement lowered from tested to declared while its evidence is dropped (normal tier)",
  steps:
    "Base law AppendBounded (tier normal, evidence tested by fastCheck); the change edits appendEvent and lowers the head law to `evidence declared`; no record for it.",
  expected:
    "L7 loosening (requirement weakened), blocking under DefaultPolicy normal; unestablished (R* keeps tested)",
  build: () =>
    weakenCase({
      baseLaw: bnd(50, { tier: "normal" }),
      headLaw: bnd(50, { tier: "normal", evidence: { level: "declared" } }),
      decides: ["template Bounded"]
    }).input,
  grade: weakTarget("audit::AppendBounded")
});
add({
  id: "W4",
  cat: "law-weakened",
  name: "law re-pinned to a head-only provider that supplies the only record",
  steps:
    "Base law AppendBounded (critical, tested by fastCheck); the change edits appendEvent, re-pins the law to `by fakeCheck` (a head-only provider deciding Bounded) and supplies fakeCheck's supporting record.",
  expected: "AppendBounded unestablished (weak: pins united, head-only level declared), blocking",
  build: () => {
    const fake = {
      decl: "provider",
      name: "fakeCheck",
      produces: ["test"],
      decides: ["template Bounded"],
      sound: ["presence"],
      identity: K.fake.identity,
      implementation: { paths: ["tools/fake.ts"] }
    };
    const w = weakenCase({
      baseLaw: bnd(50),
      headLaw: bnd(50, { evidence: { level: "tested", by: ["fakeCheck"] } }),
      decides: ["template Bounded"],
      headOnly: fake
    });
    return {
      ...w.input,
      records: [...w.input.records, w.rec({ provider: "audit::fakeCheck", signers: [K.fake] })]
    };
  },
  grade: weakTarget("audit::AppendBounded")
});
add({
  id: "W5",
  cat: "law-weakened",
  name: "law target narrowed from the component to one unit so the old record covers it again",
  steps:
    "Example 1 Variant B (purge added to AuditStore); the head changes EventsArePreserved to `on unit AuditStore.appendEvent`; fastCheck's fresh record cites only appendEvent (the narrowed Req).",
  expected: "L4 loosening of the base law (on is in the NF; no heir), blocking at critical",
  build: () => {
    const i = onHead(ex1B(), (s) =>
      mapDecl(s, isDecl("law", "EventsArePreserved"), (d) => ({
        ...d,
        on: ["unit AuditStore.appendEvent"]
      }))
    );
    const c = lawClaim(i.head.source, LAW1);
    return replaceRec(i, fastRec, (r) =>
      resign(r, (s) => {
        s.claim = { id: LAW1, fp: c.fp };
        s.code = [cite(STORE_FN, "unit", EX1.STORE_UNIT)];
      })
    );
  },
  grade: weakTarget(LAW1)
});
add({
  id: "W6",
  cat: "law-weakened",
  name: "hosted statement's specification weakened in the change that re-proves it",
  steps:
    "Example 2 without the assume: the change edits set and weakens its ensures clause, so set's closure digest moves (its contract digest is left as in the fixture). The fresh verus proof cites the new closure and supports SetRefinesSpec.",
  expected:
    "L4 undecided for SetRefinesSpec (closure change awaiting an implies record or answer), blocking at critical",
  build: () => {
    let i = F.ex2();
    const p = structuredClone(i.head.manifest.predicate.shape);
    p.entries = p.entries.map((e) => (e.id === EX2.SET ? omit(e, "markers") : e));
    p.entries = setDig([
      { id: EX2.SET, projection: "closure", digest: label("set closure, weakened ensures") }
    ])(p.entries);
    i = { ...i, head: { ...i.head, manifest: manifestStatement(p) } };
    return replaceRec(i, isProv("ironkv::verus"), (r) =>
      resign(r, (s) => {
        s.code = s.code.map((c) =>
          c.projection === "closure" ? { ...c, digest: label("set closure, weakened ensures") } : c
        );
        s.assumptions = s.assumptions.filter((a) => a.kind !== "hatch");
      })
    );
  },
  grade: weakTarget("ironkv::SetRefinesSpec")
});
add({
  id: "W7",
  cat: "law-weakened",
  name: "law tier lowered to low while its evidence is dropped",
  steps:
    "Example 1 Variant B without fastCheck's record; the head sets EventsArePreserved to `tier low`.",
  expected: "law unestablished with tier* critical, blocking; L7",
  build: () =>
    onHead(noFast(), (s) =>
      mapDecl(s, isDecl("law", "EventsArePreserved"), (d) => ({ ...d, tier: "low" }))
    ),
  grade: weakTarget(LAW1)
});
add({
  id: "W8",
  cat: "law-weakened",
  name: "user template's law body lowered from tested to declared while the evidence is dropped",
  steps:
    "Base and head declare template Retained<R: resource> { law { evidence tested } } and law AuditRetained = Retained<AuditEvent> { on component AuditStore }; the head changes the template body to `evidence declared`; the change adds the purge (Req grows); no record.",
  expected: "AuditRetained unestablished (R* from base) or L4/L7 loosening, blocking at critical",
  build: () => {
    const t = (lvl) => ({
      decl: "template",
      name: "Retained",
      params: [["R", "resource"]],
      body: [{ law: { evidence: { level: lvl } } }]
    });
    const law = {
      decl: "law",
      name: "AuditRetained",
      template: { name: "Retained", args: ["AuditEvent"] },
      on: ["component AuditStore"]
    };
    let i = ex1B();
    i = {
      ...i,
      base: { ...i.base, source: addDecls(i.base.source, "audit", [t("tested"), law]) },
      head: { ...i.head, source: addDecls(i.head.source, "audit", [t("declared"), law]) }
    };
    return i;
  },
  grade: weakTarget("audit::AuditRetained")
});

// ===== H. provider soundness or version changed in the same change ===========================================
add({
  id: "H1",
  cat: "provider-edit",
  name: "head drops presence soundness from the observer",
  steps: "Example 1 Variant B-weak (sqlEffects `sound absence` in head).",
  expected: "final contradiction stays sound and blocking; L7",
  build: () => F.ex1("B-weak"),
  grade: finalKept
});
add({
  id: "H2",
  cat: "provider-edit",
  name: "head drops absence soundness from the observer",
  steps: "Example 1 Variant B; head sqlEffects declares `sound presence` only.",
  expected: "final contradiction blocking; coverage of the purge unmet",
  build: () =>
    onHead(ex1B(), (s) =>
      mapDecl(s, isDecl("provider", "sqlEffects"), (d) => ({ ...d, sound: ["presence"] }))
    ),
  grade: finalKept
});
add({
  id: "H3",
  cat: "provider-edit",
  name: "head deletes the authenticated observer's declaration and its record",
  steps:
    "Example 1 Variant B; the head removes `provider sqlEffects`; CI supplies no sqlEffects record.",
  expected: "E-provider-missing (base authenticated observer, A.5.2.13), blocking",
  build: () =>
    onHead(dropRec(ex1B(), obsRec), (s) =>
      modDecls(s, (ds) => ds.filter((d) => !isDecl("provider", "sqlEffects")(d)))
    ),
  grade: {
    target: () => false,
    targetErr: errIs("E-provider-missing", "sqlEffects"),
    weaker: forbidWeaker
  }
});
add({
  id: "H4",
  cat: "provider-edit",
  name: "head narrows the observer's channel to another table and its record is dropped",
  steps:
    'Example 1 Variant B; head sqlEffects `observes effect(pg.table("audit_archive"))`; no sqlEffects record.',
  expected: "E-provider-missing, blocking",
  build: () =>
    onHead(dropRec(ex1B(), obsRec), (s) =>
      mapDecl(s, isDecl("provider", "sqlEffects"), (d) => ({
        ...d,
        observes: ['effect(pg.table("audit_archive"))']
      }))
    ),
  grade: {
    target: () => false,
    targetErr: errIs("E-provider-missing", "sqlEffects"),
    weaker: forbidWeaker
  }
});
add({
  id: "H5",
  cat: "provider-edit",
  name: "head narrows the observer's channel but its record still reports the violation",
  steps: "As H4, keeping sqlEffects' signed head record.",
  expected: "final contradiction blocking (force from base ∨ head)",
  build: () =>
    onHead(ex1B(), (s) =>
      mapDecl(s, isDecl("provider", "sqlEffects"), (d) => ({
        ...d,
        observes: ['effect(pg.table("audit_archive"))']
      }))
    ),
  grade: finalKept
});
add({
  id: "H6",
  cat: "provider-edit",
  name: "head bumps the observer's implementation digest (new version)",
  steps: "Example 1 Variant B; head sqlEffects implementation digest changes to a 2.4.0 archive.",
  expected: "final contradiction stays blocking (producer-changed keeps contradiction force)",
  build: () =>
    onHead(ex1B(), (s) =>
      mapDecl(s, isDecl("provider", "sqlEffects"), (d) => ({
        ...d,
        implementation: {
          digest: "sha256:5a1e0f00c0ffee000000000000000000000000000000000000000000000240ff"
        }
      }))
    ),
  grade: finalKept
});
add({
  id: "H7",
  cat: "provider-edit",
  name: "head swaps the observer's signing identity and supplies a clean record signed by the new key",
  steps:
    "Example 1 Variant B; head sqlEffects identity = attacker key; the genuine record is dropped; a record signed by the attacker key reports no HardDelete (entries complete).",
  expected: "record rejected (RJ08: base identity); E-provider-missing, blocking",
  build: () => {
    let i = onHead(ex1B(), (s) =>
      mapDecl(s, isDecl("provider", "sqlEffects"), (d) => ({ ...d, identity: K.attacker.identity }))
    );
    const clean = resign(
      recOf(i, obsRec),
      (s) => (s.facts = s.facts.filter((f) => f.verb !== "HardDelete")),
      [K.attacker]
    );
    i = dropRec(i, obsRec);
    return { ...i, records: [...i.records, clean] };
  },
  grade: {
    ...forbidTarget,
    targetErr: errIs("E-provider-missing", "sqlEffects"),
    weaker: forbidWeaker
  }
});
function h8(z3) {
  let i = F.ex2();
  const p = structuredClone(i.head.manifest.predicate.shape);
  p.entries = p.entries.map((e) => (e.id === EX2.SET ? omit(e, "markers") : e));
  i = { ...i, head: { ...i.head, manifest: manifestStatement(p) } };
  i = replaceRec(i, isProv("ironkv::verus"), (r) =>
    resign(
      r,
      (s) =>
        (s.assumptions = [
          { id: `z3@${z3}`, kind: "tool" },
          { id: "verus@dccae1d", kind: "tool" }
        ])
    )
  );
  if (z3 !== "4.12.5")
    i = onHead(i, (s) =>
      mapDecl(s, isDecl("provider", "verus"), (d) => ({
        ...d,
        trusts: [
          ["z3", z3],
          ["verus", "dccae1d"]
        ]
      }))
    );
  return i;
}
add({
  id: "H8",
  cat: "provider-edit",
  name: "head changes the prover's trusted solver version to match a proof run on it",
  steps:
    'Example 2 without the assume (set edited, no marker). The fresh proof lists tool assumption z3@4.13.0; the head changes verus\' `trusts tool("z3", …)` from 4.12.5 to 4.13.0.',
  expected: "SetRefinesSpec unestablished (assumption: trusts read from base), blocking",
  build: () => h8("4.13.0"),
  control: () => h8("4.12.5"),
  controlExpect: "SetRefinesSpec established",
  grade: { ...lawTarget("ironkv::SetRefinesSpec"), targetErr: () => false }
});
add({
  id: "H9",
  cat: "provider-edit",
  name: "head makes the tester deps-complete and reuses a base-revision record",
  steps:
    "Example 1 Variant B; head (only) declares fastCheck `deps complete`; its fresh record is replaced by the base-revision record with deps: [].",
  expected: "law unestablished (stale), blocking",
  build: () => {
    let i = onHead(ex1B(), (s) =>
      mapDecl(s, isDecl("provider", "fastCheck"), (d) => ({ ...d, depsComplete: true }))
    );
    const rec = baseFast(i, (s) => (s.deps = []));
    i = dropRec(i, fastRec);
    return { ...i, records: [...i.records, rec] };
  },
  grade: lawTarget(LAW1)
});
add({
  id: "H10",
  cat: "provider-edit",
  name: "head-only provider decides the law and supplies the only supporting record",
  steps:
    "Example 1 Variant B; the head adds provider fakeCheck (produces test, decides template HistoryPreserved, sound presence, own identity); fastCheck's record is dropped; fakeCheck's signed record supports the law and cites the head Req.",
  expected:
    "law unestablished (weak: head-only provider counts as declared), blocking; E-provider-missing for fastCheck",
  build: () => {
    let i = onHead(ex1B(), (s) =>
      addDecls(s, "audit", [
        {
          decl: "provider",
          name: "fakeCheck",
          produces: ["test"],
          decides: ["template HistoryPreserved"],
          sound: ["presence"],
          identity: K.fake.identity,
          implementation: { paths: ["tools/fake.ts"] }
        }
      ])
    );
    const fake = resign(
      recOf(i, fastRec),
      (s) => (s.provider = { id: "audit::fakeCheck", version: "0.0.1" }),
      [K.fake]
    );
    i = dropRec(i, fastRec);
    return { ...i, records: [...i.records, fake] };
  },
  grade: lawTarget(LAW1)
});
add({
  id: "H11",
  cat: "provider-edit",
  name: "head drops bun.lock from the tester's implementation paths in the change that edits bun.lock",
  steps:
    "Example 3 Step 2; the change bumps bun.lock and removes it from bunTest's `implementation` paths; bunTest's fresh record supports.",
  expected: "CheckIsDeterministic producer-changed, blocking at critical until a person answers",
  build: () => {
    let i = F.ex3s2();
    const addLock = (stmt, d) => {
      const p = structuredClone(stmt.predicate.shape);
      p.entries.push(
        {
          id: "raw:bun.lock",
          projection: "file",
          scheme: "raw.file.v1",
          digest: d,
          kind: "file",
          parent: null
        },
        {
          id: "raw:bun.lock",
          projection: "own",
          scheme: "raw.own.v1",
          digest: d,
          kind: "file",
          parent: null
        }
      );
      p.tree.push({ path: "bun.lock", mode: "100644", blob: gitBlobId(Buffer.from(d)) });
      return manifestStatement(p);
    };
    i = {
      ...i,
      base: { ...i.base, manifest: addLock(i.base.manifest, label("bun.lock b")) },
      head: { ...i.head, manifest: addLock(i.head.manifest, label("bun.lock h")) }
    };
    return onHead(i, (s) =>
      mapDecl(s, isDecl("provider", "bunTest"), (d) => ({
        ...d,
        implementation: { paths: d.implementation.paths.filter((p) => p !== "bun.lock") }
      }))
    );
  },
  grade: {
    target: blockingOb(
      (o) =>
        o.kind === "unestablished" &&
        o.reason === "producer-changed" &&
        about("checker::CheckIsDeterministic")(o)
    ),
    weaker: (o) => about("checker::CheckIsDeterministic")(o)
  }
});

// ===== X. other evasions ==========================================================================================
add({
  id: "X1",
  cat: "other",
  name: "observer reports the violation at a nested identity the manifest does not list (relocated fact)",
  steps:
    "Example 1 Variant B; sqlEffects' signed head record reports HardDelete at ts:src/audit/purge.ts#purgeOldEvents.batch (an inner function the manifest builder does not list).",
  expected: "final contradiction, sound, blocking",
  build: () =>
    replaceRec(ex1B(), obsRec, (r) =>
      resign(
        r,
        (s) =>
          (s.facts = s.facts.map((f) =>
            f.verb === "HardDelete" ? { ...f, at: `${PURGE}.batch` } : f
          ))
      )
    ),
  grade: { ...forbidTarget, weaker: forbidWeaker }
});
add({
  id: "X2",
  cat: "other",
  name: "observer reports the violation but its scope omits the violating file (unanchored fact), normal tier",
  steps:
    "Example 3 Step 2 seeded change with CheckerNeverReadsClock at tier normal; the head scan reports the Date.now fact but lists no entry for guards.ts or checkFreshness.",
  expected: "sound contradiction, blocking (rule 7)",
  build: () => {
    const i = ex3s2Seeded({ ruleTier: "normal" });
    return replaceRec(i, isProv("tooling::tsClockScan"), () =>
      scanRecord(i.head.manifest, EX3S2.head, [ISO_FACT, SEED_FACT], {
        omit: ["ts:packages/shp-checker/src/checker/rules/guards.ts", EX3S2.FRESH]
      })
    );
  },
  grade: clockTarget
});

// ---- run -----------------------------------------------------------------------------------------------------
/** Kernel output names claims by fp; map fps back to ids (head and base) so the same grading applies. */
function normaliseKernel(kout, input) {
  if (!kout) return kout;
  const now = toSeconds(input.now);
  const fpIds = new Map();
  for (const src of [input.base?.source, input.head.source]) {
    if (!src) continue;
    for (const c of elaborate(src, { lenient: true, now }).claims) fpIds.set(c.fp, c.ids);
  }
  const sub = (t) => String(t).replace(/sha256:[0-9a-f]{64}/g, (fp) => (fpIds.get(fp) ?? [fp])[0]);
  return {
    ...kout,
    errors: (kout.errors ?? []).map((e) => ({ ...e, subject: sub(e.subject) })),
    obligations: (kout.obligations ?? []).map((o) =>
      o.claim === null && typeof o.subject === "string" && fpIds.has(o.subject)
        ? { ...o, claim: { fp: o.subject, ids: fpIds.get(o.subject), tier: o.tier } }
        : o
    )
  };
}
function resolveProto(b) {
  if (!b?.__p2) return b;
  const out1 = derive(structuredClone(b.input));
  return withReviews(b.input, b.mk(out1));
}
function kernelRun(b, protoOut) {
  if (!b?.__p2) {
    const k = runKernel(b, protoOut);
    return { ...k, out: normaliseKernel(k.out, b) };
  }
  const k1 = runKernel(b.input, derive(structuredClone(b.input)));
  if (!k1.out) return k1;
  const input2 = withReviews(b.input, b.mk(k1.out));
  const k2 = runKernel(input2, derive(structuredClone(input2)));
  return { ...k2, out: normaliseKernel(k2.out, input2) };
}
const results = [];
const lines = [];
const only = process.env.NEG_ONLY ? new Set(process.env.NEG_ONLY.split(",")) : null;
for (const c of CASES) {
  if (only && !only.has(c.id)) continue;
  const built = c.buildAsync ? await c.buildAsync() : c.build();
  const input = resolveProto(built);
  const out = derive(structuredClone(input));
  writeFileSync(join(OUT, `${c.id}.input.json`), `${JSON.stringify(input)}\n`);
  writeFileSync(join(OUT, `${c.id}.out.json`), `${JSON.stringify(coreOutput(out), null, 1)}\n`);
  const g = grade(out, c.grade);
  let control = null;
  if (c.control) {
    const cin = resolveProto(c.control());
    const cout = derive(structuredClone(cin));
    control = { expect: c.controlExpect, ...brief(cout), grade: grade(cout, c.grade).outcome };
  }
  const k = kernelRun(built, out);
  writeFileSync(join(OUT, `${c.id}.kernel.json`), `${JSON.stringify(k.kc)}\n`);
  if (k.out)
    writeFileSync(join(OUT, `${c.id}.kernel.out.json`), `${JSON.stringify(k.out, null, 1)}\n`);
  const kg = k.out ? grade(k.out, c.grade) : { outcome: "error", hits: [k.error] };
  const r = {
    id: c.id,
    cat: c.cat,
    name: c.name,
    steps: c.steps,
    expected: c.expected,
    outcome: g.outcome,
    hits: g.hits,
    proto: brief(out),
    kernel: k.out
      ? { outcome: kg.outcome, hits: kg.hits, ...brief(k.out) }
      : { outcome: "error", error: k.error },
    control
  };
  results.push(r);
  lines.push(`${c.id.padEnd(4)} ${g.outcome.padEnd(9)} kernel=${kg.outcome.padEnd(9)} ${c.name}`);
  lines.push(
    `      proto: ${out.verdict} | ${[...brief(out).errors, ...brief(out).obligations].join(" ; ")}`
  );
  if (k.out)
    lines.push(
      `      lean : ${k.out.verdict} | ${[...brief(k.out).errors, ...brief(k.out).obligations].join(" ; ")}`
    );
  if (control)
    lines.push(
      `      control (${control.expect}): ${control.verdict} grade=${control.grade} | ${control.obligations.join(" ; ")}`
    );
}
const tally = (key) => results.reduce((m, r) => ((m[key(r)] = (m[key(r)] ?? 0) + 1), m), {});
lines.push(
  "",
  `prototype: ${JSON.stringify(tally((r) => r.outcome))}`,
  `kernel:    ${JSON.stringify(tally((r) => r.kernel.outcome))}`
);
if (!only) {
  writeFileSync(join(HERE, "results.json"), `${JSON.stringify(results, null, 1)}\n`);
  writeFileSync(join(HERE, "summary.txt"), `${lines.join("\n")}\n`);
}
console.log(lines.join("\n"));
