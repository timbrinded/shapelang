// Each obligation kind and reason, coherence errors, refutation, records validation outcomes,
// exceptions, invalid inputs (A.4.4, A.5.3-5, A.7, A.8, A.12.6).
import { describe, expect, test } from "bun:test";
import { type IdSpec, baseInput, cite, manifest, signed } from "../examples/fixtures.ts";
import type { CheckInput } from "../src/io-types.ts";
import { H, label } from "../src/jcs.ts";
import { type Fact, type ShapeRecord, makeStatement, scopeRoot, signerFromSeed } from "../src/records.ts";
import type { Decl, SourceDoc } from "../src/source.ts";
import { clone, obsOf, run } from "./helpers.ts";

const OBS = signerFromSeed("21");
const HEUR = signerFromSeed("22");
const TEST = signerFromSeed("23");
const P1 = signerFromSeed("24");
const NOW = "2026-10-25T12:00:00Z";

interface W {
  grantsK?: string[] | "none" | null;
  forbidJ?: boolean;
  summary?: string[];
  summaryMode?: "complete" | "partial";
  relationKJ?: boolean;
  edgeForbidKJ?: boolean;
  pathForbid?: boolean;
  law?: { tier?: "normal" | "critical"; level?: "tested" | "declared"; lo?: number; hi?: number } | null;
  informal?: boolean;
  testerSound?: boolean;
  exception?: Decl;
  policy?: Decl | null;
  extra?: Decl[];
  unitName?: string;
  unitBind?: string;
}

function world(o: W = {}): SourceDoc {
  const decls: Decl[] = [
    { decl: "shape", name: "S", owner: "Team", ...(o.policy ? { policy: "Loose" } : {}) },
    { decl: "actor", name: "Team", kind: "team", members: ["p1", "p2"] },
    { decl: "actor", name: "p1", kind: "person", identities: ['github("p1")', P1.identity] },
    { decl: "actor", name: "p2", kind: "person", identities: ['github("p2")'] },
    { decl: "actor", name: "bot", kind: "agent", operator: "p1", identities: ['github("bot[bot]")'] },
    { decl: "resource", name: "R", bind: ['pg.table("r")'] },
    {
      decl: "component",
      name: "K",
      paths: ["src/k/**/*.ts"],
      ...(o.grantsK === null ? {} : { grants: o.grantsK ?? ["Read<R>"] }),
      units: [
        {
          name: o.unitName ?? "f",
          ...(o.unitBind ? { bind: o.unitBind } : {}),
          ...(o.summary ? { effects: { mode: o.summaryMode ?? "complete", atoms: o.summary.map((a) => ({ atom: a })) } } : {})
        }
      ]
    },
    { decl: "component", name: "J", paths: ["src/j/**/*.ts"] },
    ...(o.forbidJ ? [{ decl: "rule" as const, name: "NoJWrites", clauses: [{ forbid: "effect" as const, atom: "Write<R>", within: ["component J"] }] }] : []),
    ...(o.relationKJ ? [{ decl: "relation" as const, name: "KCallsJ", kind: "calls", connects: ["K", "J"] }] : []),
    ...(o.edgeForbidKJ ? [{ decl: "rule" as const, name: "NoKJ", clauses: [{ forbid: "edge" as const, kind: "calls", from: ["K"], to: ["J"] }] }] : []),
    ...(o.pathForbid ? [{ decl: "rule" as const, name: "NoPath", clauses: [{ forbid: "path" as const, from: ["J"], to: ["K"], over: ["calls"] }] }] : []),
    ...(o.law
      ? [
          {
            decl: "law" as const,
            name: "FBounded",
            template: { name: "Bounded", args: ["K.f", o.law.lo ?? 0, o.law.hi ?? 100] },
            tier: o.law.tier ?? "critical",
            ...(o.law.level ? { evidence: { level: o.law.level } } : {})
          }
        ]
      : []),
    ...(o.informal ? [{ decl: "law" as const, name: "FReviewed", on: ["unit K.f"], informal: "f stays readable.", tier: "normal" as const }] : []),
    {
      decl: "provider",
      name: "obs",
      produces: ["observation"],
      observes: ['effect(pg.table("*"))', "call(ts)"],
      sound: ["presence", "absence"],
      identity: OBS.identity,
      implementation: { paths: ["tools/obs.ts"] }
    },
    {
      decl: "provider",
      name: "heur",
      produces: ["observation"],
      observes: ['effect(pg.table("*"))'],
      sound: [],
      identity: HEUR.identity,
      implementation: { paths: ["tools/heur.ts"] }
    },
    {
      decl: "provider",
      name: "tester",
      produces: ["test"],
      decides: ["template Bounded"],
      sound: o.testerSound === false ? [] : ["presence"],
      identity: TEST.identity,
      implementation: { paths: ["tools/test.ts"] }
    },
    ...(o.exception ? [o.exception] : []),
    ...(o.policy ? [o.policy] : []),
    ...(o.extra ?? [])
  ];
  return { v: "shape.source.v1", modules: [{ module: "m", imports: ["std"], decls }] };
}

const FA = "ts:src/k/a.ts#f";
const GB = "ts:src/j/b.ts#g";
const ids = (side: "b" | "h", changed: string[] = []): IdSpec[] => {
  const d = (id: string, p: string): string => label(`${id} ${p} ${side === "h" && changed.includes(id) ? "h" : "b"}`);
  return [
    { id: "ts:src/k/a.ts", own: d("ts:src/k/a.ts", "own") },
    { id: FA, own: d(FA, "own"), unit: d(FA, "unit") },
    { id: "ts:src/j/b.ts", own: d("ts:src/j/b.ts", "own") },
    { id: GB, own: d(GB, "own"), unit: d(GB, "unit") },
    { id: "ts:tools/obs.ts" },
    { id: "ts:tools/heur.ts" },
    { id: "ts:tools/test.ts", own: d("ts:tools/test.ts", "own") }
  ];
};

const BASE = "aaaa000000000000000000000000000000000000";
const HEAD = "bbbb000000000000000000000000000000000000";

function obsRecord(signer = OBS, provider = "m::obs", facts: Fact[] = [], idsList = ids("h"), complete = true): unknown {
  const es = idsList
    .filter((x) => x.id.startsWith("ts:src/"))
    .map((x) => ({ ...cite(x.id, x.unit ? "unit" : "own", (x.unit ?? x.own) as string), complete, deps: [] }));
  const r: ShapeRecord = {
    v: "shape.evidence.v1",
    kind: "observation",
    result: "observes",
    provider: { id: provider, version: "1" },
    revision: HEAD,
    time: "2026-10-25T10:00:00Z",
    scope: { root: scopeRoot(es), entries: es },
    facts,
    harness: [],
    assumptions: []
  };
  return signed(r, [signer]);
}

function input(base: SourceDoc | null, head: SourceDoc, o: { changed?: string[]; records?: unknown[]; reviews?: CheckInput["reviews"]; noObs?: boolean } = {}): CheckInput {
  return baseInput({
    now: NOW,
    change: { ids: ["c#1"] },
    head: { revision: HEAD, source: head, manifest: manifest(HEAD, ids("h", o.changed ?? []), ["shape.lock", "shape/m.shape"]) },
    base: { revision: BASE, source: base, manifest: manifest(BASE, ids("b"), ["shape.lock", "shape/m.shape"]) },
    records: [...(o.noObs ? [] : [obsRecord(OBS, "m::obs", [], ids("h", o.changed ?? []))]), ...(o.records ?? [])],
    authors: [{ identity: 'github("bot[bot]")', verified: true, bot: true }],
    reviews: o.reviews ?? []
  });
}

const write = (at: string, verb = "Update"): Fact => ({ type: "effect", at, verb, resource: 'pg.table("r")' });

describe("contradictions", () => {
  test("heuristic: a sound-none observer's violating fact is owed, not blocking", () => {
    const w = world({ forbidJ: true });
    const out = run(input(w, w, { changed: [GB], records: [obsRecord(HEUR, "m::heur", [write(GB)], ids("h", [GB]))] }));
    const c = obsOf(out, "contradiction")[0];
    expect(c?.force).toBe("heuristic");
    expect(c?.introduced).toBe(true);
    expect(c?.severity).toBe("owed");
    expect(c?.budget).toBe("judgment");
  });
  test("sound and introduced: a presence-sound violating fact at changed code blocks (rule 7)", () => {
    const w = world({ forbidJ: true });
    const out = run(input(w, w, { changed: [GB], records: [obsRecord(OBS, "m::obs", [write(GB)], ids("h", [GB]))], noObs: true }));
    const c = obsOf(out, "contradiction")[0];
    expect([c?.force, c?.severity, c?.rule]).toEqual(["sound", "blocking", 7]);
  });
  test("preexisting: the same fact at unchanged code is owed (rule 6)", () => {
    const w = world({ forbidJ: true });
    const out = run(input(w, w, { records: [obsRecord(OBS, "m::obs", [write(GB)])], noObs: true }));
    const c = obsOf(out, "contradiction")[0];
    expect([c?.introduced, c?.severity, c?.rule]).toEqual([false, "owed", 6]);
    expect(out.preexisting.length).toBe(1);
  });
  test("authority: an ungranted atom at K violates authority(K)", () => {
    const w = world();
    const out = run(input(w, w, { changed: [FA], records: [obsRecord(OBS, "m::obs", [write(FA)], ids("h", [FA]))], noObs: true }));
    const c = obsOf(out, "contradiction")[0];
    expect(c?.claim?.ids).toEqual(["m::K/authority"]);
  });
  test("structure: an observed call K→J violates edge.forbid; a declared one is E-structure", () => {
    const w = world({ edgeForbidKJ: true });
    const call: Fact = { type: "call", at: FA, to: GB };
    const out = run(input(w, w, { changed: [FA], records: [obsRecord(OBS, "m::obs", [call], ids("h", [FA]))], noObs: true }));
    const c = obsOf(out, "contradiction")[0];
    expect(c?.subject).toEqual({ from: "m::K", to: "m::J" });
    expect(c?.force).toBe("sound");
    const wd = world({ edgeForbidKJ: true, relationKJ: true });
    expect(run(input(wd, wd)).errors.map((e) => e.code)).toContain("E-structure");
  });
  test("structure: path.forbid J ⇝ K via an observed call", () => {
    const w = world({ pathForbid: true });
    const out = run(input(w, w, { changed: [GB], records: [obsRecord(OBS, "m::obs", [{ type: "call", at: GB, to: FA }], ids("h", [GB]))], noObs: true }));
    expect(obsOf(out, "contradiction")[0]?.subject).toEqual({ from: "m::J", to: "m::K" });
  });
  test("refutation: complete absence-sound observation of K with no K→J call refutes the relation", () => {
    const w = world({ relationKJ: true });
    const out = run(input(w, w));
    const c = obsOf(out, "contradiction").find((o) => o.claim?.ids.includes("m::KCallsJ"));
    expect(c?.subject).toBeNull();
    expect(c?.force).toBe("sound");
  });
  test("refutation: a partial summary's atom never observed in its complete reach", () => {
    const w = world({ summary: ["Read<R>"], summaryMode: "partial" });
    const out = run(input(w, w));
    const c = obsOf(out, "contradiction").find((o) => o.claim?.ids.includes("m::K.f/effects.lower"));
    expect(c?.subject).toEqual({ unit: "m::K.f", atom: "Read<m::R>" });
  });
  test("conduct: an observed atom outside a complete summary contradicts effects.upper", () => {
    const w = world({ summary: ["Read<R>"], grantsK: null });
    const out = run(input(w, w, { changed: [FA], records: [obsRecord(OBS, "m::obs", [write(FA, "Append")], ids("h", [FA]))], noObs: true }));
    const c = obsOf(out, "contradiction").find((o) => o.claim?.ids.includes("m::K.f/effects.upper"));
    expect(c?.subject).toEqual({ unit: "m::K.f", atom: "Append<m::R>" });
  });
  test("coherence: a declared summary atom forbidden in its unit is E-conduct", () => {
    const w = world({ summary: ["Update<R>"] });
    expect(run(input(w, w)).errors.map((e) => e.code)).toContain("E-conduct");
  });
});

function testRecord(result: "supports" | "contradicts", o: { lo?: number; hi?: number; counterexample?: boolean; digest?: string; harness?: string; revision?: string } = {}): unknown {
  const claim = { op: "law", args: { on: ["unit m::K.f"], statement: { schema: "std::Bounded", schemaFp: "sha256:a8a3741ae3f04fdbd835de17c9106feb7a9ec709d55553b200a3accd603e33d3", args: ["unit m::K.f", o.lo ?? 0, o.hi ?? 100] } } };
  const nf = JSON.stringify({ v: "shape.claim.v1", op: claim.op, args: claim.args });
  const fp = H({ v: "shape.claim.v1", op: claim.op, args: claim.args });
  return signed(
    {
      v: "shape.evidence.v1",
      kind: "test",
      result,
      provider: { id: "m::tester", version: "1" },
      revision: o.revision ?? HEAD,
      time: "2026-10-25T10:00:00Z",
      claim: { id: "m::FBounded", fp, nf },
      code: [cite(FA, "unit", o.digest ?? label(`${FA} unit h`))],
      harness: o.harness ? [cite("ts:tools/test.ts", "own", o.harness)] : [],
      assumptions: [],
      ...(o.counterexample ? { counterexample: { input: 101 } } : {})
    },
    [TEST]
  );
}

describe("laws", () => {
  test("missing: a critical tested law with no record is unestablished(missing), introduced when its unit changed", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA] }));
    const u = obsOf(out, "unestablished")[0];
    expect([u?.reason, u?.introduced, u?.severity]).toEqual(["missing", true, "blocking"]);
  });
  test("established by a stronger instance's test (Bounded<f,0,50> establishes Bounded<f,0,100>)", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA], records: [testRecord("supports", { hi: 50 })] }));
    expect(obsOf(out, "unestablished")).toEqual([]);
  });
  test("a weaker instance's test does not establish (Bounded<f,-1000,100>)", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA], records: [testRecord("supports", { lo: -1000 })] }));
    expect(obsOf(out, "unestablished")[0]?.reason).toBe("missing");
  });
  test("stale: a record citing a moved digest", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA], records: [testRecord("supports", { digest: label(`${FA} unit b`), revision: BASE })] }));
    expect(obsOf(out, "unestablished")[0]?.reason).toBe("stale");
  });
  test("producer-changed: the harness changed in the change", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: ["ts:tools/test.ts"], records: [testRecord("supports", { digest: label(`${FA} unit b`), harness: label("ts:tools/test.ts own h") })] }));
    const u = obsOf(out, "unestablished")[0];
    expect(u?.reason).toBe("producer-changed");
    expect(u?.dischargers[0]?.act).toBe("answer");
  });
  test("sound contradiction: a presence-sound failing test with a counterexample blocks", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA], records: [testRecord("contradicts", { counterexample: true })] }));
    const c = obsOf(out, "contradiction")[0];
    expect([c?.force, c?.severity]).toEqual(["sound", "blocking"]);
    expect(obsOf(out, "unestablished")).toEqual([]);
  });
  test("A.11.2.4: a failing test from a sound-none provider is an owed heuristic contradiction plus blocking unestablished(missing)", () => {
    const w = world({ law: {}, testerSound: false });
    const out = run(input(w, w, { changed: [FA], records: [testRecord("contradicts", { counterexample: true })] }));
    const c = obsOf(out, "contradiction")[0];
    const u = obsOf(out, "unestablished")[0];
    expect([c?.force, c?.severity]).toEqual(["heuristic", "owed"]);
    expect([u?.reason, u?.introduced, u?.severity]).toEqual(["missing", true, "blocking"]);
    expect(out.verdict).toBe("blocked");
  });
  test("a failing test without a counterexample is inconclusive", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA], records: [testRecord("contradicts")] }));
    expect(obsOf(out, "contradiction")).toEqual([]);
    expect(obsOf(out, "unestablished")[0]?.reason).toBe("missing");
  });
  test("expired: a judgment older than max_age", () => {
    const w = world({ informal: true });
    const j = signed(
      {
        v: "shape.evidence.v1",
        kind: "judgment",
        result: "supports",
        provider: null,
        revision: BASE,
        time: "2024-01-01T00:00:00Z",
        claim: { id: "m::FReviewed", fp: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
        code: [cite(FA, "unit", label(`${FA} unit b`))],
        judge: "m::p1"
      },
      [P1]
    );
    // fix the claim fp to the real one
    const fp = run(input(w, w)).obligations.find((o) => o.claim?.ids.includes("m::FReviewed"))?.claim?.fp as string;
    const stmt = JSON.parse(Buffer.from((j as { payload: string }).payload, "base64").toString()) as ReturnType<typeof makeStatement>;
    const rec = (stmt.predicate.shape as ShapeRecord);
    rec.claim = { id: "m::FReviewed", fp };
    const out = run(input(w, w, { records: [signed(rec, [P1])] }));
    expect(obsOf(out, "unestablished")[0]?.reason).toBe("expired");
  });
  test("weak: a judgment for a law that admits none", () => {
    const w = world({ law: {} });
    const out = run(input(w, w, { changed: [FA], reviews: [{ identity: 'github("p2")', line: "shape judge m::FBounded" }] }));
    expect(obsOf(out, "unestablished")[0]?.reason).toBe("weak");
  });
  test("E-route: a tested law no provider decides", () => {
    const w = world({ extra: [{ decl: "law", name: "Orphan", template: { name: "Deterministic", args: ["K.f"] }, tier: "critical" }] });
    expect(run(input(w, w)).errors.map((e) => e.code)).toContain("E-route");
  });
});

describe("loosening questions", () => {
  test("L0: an unreadable base blocks until the base shape owner answers", () => {
    const w = world();
    const out = run(input(null, w));
    const l = obsOf(out, "loosening")[0];
    expect(l?.questions).toEqual(["L0"]);
    expect(l?.severity).toBe("blocking");
    expect(l?.rule).toBe(3);
  });
  test("L1: removing a forbid lowers protection at every covered position", () => {
    const out = run(input(world({ forbidJ: true }), world()));
    const l = obsOf(out, "loosening")[0];
    expect(l?.questions).toEqual(["L1"]);
    expect(out.loosening[0]?.affected).toContain(GB);
  });
  test("L1: tightening (adding a forbid) raises nothing", () => {
    expect(obsOf(run(input(world(), world({ forbidJ: true }))), "loosening")).toEqual([]);
  });
  test("L2: a widened complete summary", () => {
    const out = run(input(world({ summary: ["Read<R>"] }), world({ summary: ["Read<R>", "Append<R>"], grantsK: ["Read<R>", "Append<R>"] })));
    const l = obsOf(out, "loosening").find((o) => o.questions?.includes("L2"));
    expect(l).toBeDefined();
  });
  test("L3: a removed path forbid with a type-correct counterexample", () => {
    const out = run(input(world({ pathForbid: true }), world()));
    const l = obsOf(out, "loosening").find((o) => o.questions?.includes("L3"));
    expect(l?.counterexample).toEqual([{ from: "m::J", kind: "calls", to: "m::K" }]);
    expect(l?.exploited).toBe(false);
  });
  test("L4: a removed law; undecided for a changed one", () => {
    const removed = run(input(world({ law: {} }), world()));
    expect(removed.loosening.find((r) => r.question === "L4")?.answer).toBe("loosened");
    const changed = run(input(world({ law: { hi: 100 } }), world({ law: { hi: 200 } })));
    expect(changed.loosening.find((r) => r.question === "L4")?.answer).toBe("undecided");
    const tightened = run(input(world({ law: { hi: 100 } }), world({ law: { hi: 50 } })));
    expect(tightened.loosening.find((r) => r.question === "L4")).toBeUndefined();
  });
  test("L6: a unit rebound leaves its old code without the law (A.6.4.6)", () => {
    const b = world({ informal: true, unitName: "f" });
    const h = world({ informal: true, unitName: "f", unitBind: 'ts("src/k/a.ts")' });
    const out = run(input(b, h));
    expect(out.loosening.some((r) => r.question === "L6")).toBe(false);
    const h2 = world({ informal: true, unitName: "f", unitBind: 'ts("src/j/b.ts#g")' });
    const out2 = run(input(b, h2));
    expect(out2.loosening.some((r) => r.question === "L6")).toBe(true);
  });
  test("L7: a weakened policy entry", () => {
    const loose: Decl = { decl: "policy", name: "Loose", tiers: { normal: { floor: "declared", blocks: [], maxAge: 365, judges: ["owner", "agents"] } } };
    const out = run(input(world(), world({ policy: loose })));
    const l = obsOf(out, "loosening").find((o) => o.subject === "policy normal");
    expect(l?.questions).toEqual(["L7"]);
  });
});

describe("coverage", () => {
  test("changed code under a claim without a complete absence-sound entry", () => {
    const w = world({ forbidJ: true });
    const out = run(input(w, w, { changed: [GB], noObs: true }));
    const c = obsOf(out, "coverage")[0];
    expect(c?.subject).toBe("component m::J");
    expect(c?.affected).toContain(GB);
  });
  test("covered by the observer's complete entries", () => {
    const w = world({ forbidJ: true });
    expect(obsOf(run(input(w, w, { changed: [GB] })), "coverage")).toEqual([]);
  });
  test("vocabulary coverage: a new fact on an unmapped table of a bound kind", () => {
    const w = world({ forbidJ: true });
    const f: Fact = { type: "effect", at: GB, verb: "Update", resource: 'pg.table("audit_log")' };
    const out = run(input(w, w, { changed: [GB], records: [obsRecord(OBS, "m::obs", [f], ids("h", [GB]))], noObs: true }));
    const v = obsOf(out, "coverage").find((o) => o.subject === 'resourceCode pg.table("audit_log")');
    expect(v).toBeDefined();
    expect(v?.owner).toBe("m::Team");
  });
});

describe("governance, exceptions, records, input integrity", () => {
  test("E-exception: an exception on a final claim or beyond 365 days", () => {
    const fin = world({ extra: [{ decl: "rule", name: "Fin", clauses: [{ forbid: "effect", final: true, atom: "HardDelete<R>" }] }], exception: { decl: "exception", name: "E1", target: "rule Fin", owner: "Team", expires: "2026-12-01" } });
    expect(run(input(fin, fin)).errors.map((e) => e.code)).toContain("E-exception");
    const far = world({ forbidJ: true, exception: { decl: "exception", name: "E2", target: "rule NoJWrites", owner: "Team", expires: "2028-01-01" } });
    expect(run(input(far, far)).errors.map((e) => e.code)).toContain("E-exception");
  });
  test("a matched preexisting obligation is debt (rule 5); exceptions never touch loosenings", () => {
    const w = world({ forbidJ: true, exception: { decl: "exception", name: "E3", target: "component J", owner: "Team", expires: "2026-11-01" } });
    const out = run(input(w, w, { records: [obsRecord(OBS, "m::obs", [write(GB)])], noObs: true }));
    expect(out.debt.map((d) => [d.exception, d.expiresInDays, d.flagged])).toEqual([["m::E3", 7, true]]);
  });
  test("RJ07/RJ08: an authenticated provider's unsigned or wrongly signed record is rejected", () => {
    const w = world({ forbidJ: true });
    const unsigned = makeStatement({ v: "shape.evidence.v1", kind: "observation", result: "observes", provider: { id: "m::obs", version: "1" }, revision: HEAD, time: "2026-10-25T10:00:00Z", scope: { root: scopeRoot([]), entries: [] }, facts: [], harness: [], assumptions: [] });
    const wrong = obsRecord(HEUR, "m::obs");
    const out = run(input(w, w, { records: [unsigned, wrong], noObs: true }));
    expect(out.rejected.map((r) => r.code).sort()).toEqual(["RJ07", "RJ08"]);
  });
  test("RJ06/RJ03/RJ13: future-dated, bad scope root, digest contradicting the head manifest", () => {
    const w = world();
    const base: ShapeRecord = { v: "shape.evidence.v1", kind: "observation", result: "observes", provider: { id: "m::obs", version: "1" }, revision: HEAD, time: "2027-01-01T00:00:00Z", scope: { root: scopeRoot([]), entries: [] }, facts: [], harness: [], assumptions: [] };
    const future = signed(base, [OBS]);
    const badRoot = signed({ ...base, time: "2026-10-25T10:00:00Z", scope: { root: "sha256:00", entries: [] } }, [OBS]);
    const es = [{ ...cite(FA, "unit", label("wrong")), complete: true, deps: [] }];
    const rj13 = signed({ ...base, time: "2026-10-25T10:00:00Z", scope: { root: scopeRoot(es), entries: es } }, [OBS]);
    const codes = run(input(w, w, { records: [future, badRoot, rj13] })).rejected.map((r) => r.code).sort();
    expect(codes).toEqual(["RJ03", "RJ06", "RJ13"]);
  });
  test("E-evidence-path and E-evidence-rewrite", () => {
    const w = world();
    const inp = input(w, w);
    const rec = obsRecord();
    inp.persisted = { base: [{ path: "shape/evidence/00/abc.json", record: rec }], head: [{ path: "shape/evidence/ff/wrong.json", record: rec }] };
    const codes = run(inp).errors.map((e) => e.code);
    expect(codes).toContain("E-evidence-path");
    expect(codes).toContain("E-evidence-rewrite");
  });
  test("invalid: a manifest that omits a tracked path", () => {
    const w = world();
    const inp = input(w, w);
    const m = clone(inp.head.manifest);
    (m.predicate.shape as { tree: { path: string; mode: string; blob: string }[] }).tree.push({ path: "src/k/hidden.ts", mode: "100644", blob: "00".repeat(20) });
    inp.head.manifest = m;
    const out = run(inp);
    expect(out.verdict).toBe("invalid");
  });
  test("an agent never answers a loosening; a person does", () => {
    const b = world({ forbidJ: true });
    const h = world();
    const out0 = run(input(b, h));
    const ref = (out0.obligations[0]?.binding ?? "").slice(0, 19);
    const agent = run(input(b, h, { reviews: [{ identity: 'github("bot[bot]")', line: `shape approve ${ref}` }] }));
    expect(agent.answered).toEqual([]);
    const person = run(input(b, h, { reviews: [{ identity: 'github("p2")', line: `shape approve ${ref}` }] }));
    expect(person.answered.length).toBe(1);
  });
});
