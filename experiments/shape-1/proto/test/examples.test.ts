// The worked examples (examples §1–4, A.14) end to end through derive.
import { describe, expect, test } from "bun:test";
import { EX1, cite, ex1, ex2, ex3, ex3s2, ex4, signed } from "../examples/fixtures.ts";
import type { Decl } from "../src/source.ts";
import { label } from "../src/jcs.ts";
import { scopeRoot, signerFromSeed } from "../src/records.ts";
import { ob, obsOf, run } from "./helpers.ts";

// version 7 keys (m0/golden/deltas.json): the AppendOnly clause forbids Update [D13], which renames
// Variant B's contradiction and Variant C's forbid loosening; the authority key is unchanged
const B = "ob:98ff6f5f02010232";
const C_FORBID = "ob:e8ec989a6cf48d9a";
const C_AUTH = "ob:ca99c5461b8ff9a8";

describe("Example 1: an agent PR adds a purge to an append-only log", () => {
  test("audit mode on the base passes", () => {
    const out = run(ex1("audit"));
    expect(out.verdict).toBe("pass");
    expect(out.errors).toEqual([]);
  });
  // version 7 (A.5.4.3, A.6.2.6 [D9]): fastCheck is head-only, so its record never establishes and
  // holds no reason; the law is preexisting missing, not weak (EXAMPLES Example 1 "Empty base")
  test("an empty base (first adoption) is owed: the law is preexisting missing", () => {
    const out = run(ex1("empty-base"));
    expect(out.verdict).toBe("owed");
    const u = obsOf(out, "unestablished")[0];
    expect(u?.reason).toBe("missing");
    expect(u?.introduced).toBe(false);
    expect(u?.severity).toBe("owed");
    expect(out.obligations.filter((o) => o.kind === "loosening")).toEqual([]);
  });
  test("Variant B: one sound, introduced, final, blocking contradiction against the forbid", () => {
    const out = run(ex1("B"));
    expect(out.verdict).toBe("blocked");
    expect(out.obligations.length).toBe(1);
    const o = ob(out, B);
    expect(o?.force).toBe("sound");
    expect(o?.introduced).toBe(true);
    expect(o?.tier).toBe("final");
    expect(o?.severity).toBe("blocking");
    expect(o?.rule).toBe(2);
    // version 7 [D13]: the AppendOnly clause is forbid Update, which HardDelete implies
    expect(o?.claim?.ids).toEqual(["audit::AuditEvent/AppendOnly/effect.forbid-Update"]);
    expect(o?.subject).toEqual({
      code: "ts:src/audit/purge.ts#purgeOldEvents",
      atom: "HardDelete<audit::AuditEvent>"
    });
    expect(o?.dischargers.map((d) => d.act)).toEqual(["edit-code", "edit-shape"]);
    expect(o?.dischargers[0]?.agentSafe).toBe(true);
    expect(o?.dischargers[1]?.creates).toEqual({
      kind: "loosening",
      tier: "final",
      answers: 2,
      owners: ["audit::AuditTeam", "audit::Platform"]
    });
    expect(
      o?.causes.some(
        (c) =>
          c.type === "claim" &&
          c.id === "sha256:987106a04014478f6935873a3a96a3fc65c384de7b145c679dbf6cc9d082eaa4"
      )
    ).toBe(true);
    expect(o?.budget).toBe("mechanical");
    // coverage met by complete absence-sound entries; the fresh fastCheck record establishes the law
    expect(obsOf(out, "coverage")).toEqual([]);
    expect(obsOf(out, "unestablished")).toEqual([]);
  });
  test("a weakened observer keeps the contradiction sound and is an L7 question (A.14.1.5)", () => {
    const out = run(ex1("B-weak"));
    expect(ob(out, B)?.force).toBe("sound");
    const l7 = obsOf(out, "loosening").find((o) => o.subject === "provider audit::sqlEffects");
    expect(l7?.questions).toEqual(["L7"]);
    expect(l7?.tier).toBe("final");
    expect(out.loosening.find((r) => r.subject === "provider audit::sqlEffects")?.answer).toBe(
      "undecided"
    );
    expect(out.verdict).toBe("blocked");
  });
  test("B′: an ungoverned purge still violates the * forbid", () => {
    // version 7 key: the Update forbid [D13]
    const o = ob(run(ex1("Bprime")), "ob:66055a3355822d3b");
    expect(o?.severity).toBe("blocking");
    expect(o?.force).toBe("sound");
  });
  test("B″: a shell purge needs final coverage answered by bob and carol (alice is an author)", () => {
    const out = run(ex1("Bsecond"));
    const o = ob(out, "ob:155fa0bf253e0793");
    expect(o?.kind).toBe("coverage");
    expect(o?.tier).toBe("final");
    expect(o?.severity).toBe("blocking");
    expect(o?.rule).toBe(4);
    expect(o?.dischargers[0]?.eligible).toEqual(["audit::bob", "audit::carol"]);
  });
  // version 7 (A.8.2.3 L1 [D17], A.4.5.1 [D2]; deltas ex1-A): HardDelete and Update are newly in A
  // but the final Update forbid still excludes them, so no authority part, and the new summary needs
  // no call(ts) coverage; the verdict is blocked by the E-conduct error alone, and the head is
  // tighter (its new summary bounds purgeOldEvents)
  test("Variant A: E-conduct blocks alone; L1 is implied and the head is tighter", () => {
    const out = run(ex1("A"));
    expect(out.errors.map((e) => e.code)).toEqual(["E-conduct"]);
    expect(ob(out, C_AUTH)).toBeUndefined();
    expect(out.obligations).toEqual([]);
    expect(out.order).toBe("tighter");
    expect(out.verdict).toBe("blocked");
  });
  test("Variant C: two exploited L1 loosenings with the vector bindings", () => {
    const out = run(ex1("C"));
    const f = ob(out, C_FORBID);
    const a = ob(out, C_AUTH);
    expect(f?.tier).toBe("final");
    expect(a?.tier).toBe("critical");
    expect(f?.exploited && a?.exploited).toBe(true);
    expect(f?.severity).toBe("blocking");
    expect(a?.severity).toBe("blocking");
    expect(f?.group).toBe(a?.group as string);
    const rows = out.loosening.filter((r) => r.obligation.startsWith(C_FORBID));
    expect(rows[0]?.affected).toContain('cell:["audit::AuditStore.*","audit::AuditStore.*"]');
    expect(rows[0]?.affected).toContain('cell:["ungoverned","ungoverned"]');
    // the phase-1 approve line names both refs (version 7 bindings, A.12.11)
    expect(
      out.summary?.some(
        (s) =>
          s.approve?.includes("bd:a7514dcb4cfb7068") && s.approve.includes("bd:6bca5b3fe0d0787d")
      )
    ).toBe(true);
  });
  // version 7 (A.4.5.1 [D2], A.7.4.2 [D3]; deltas ex1-C): summaries are direct, so the new complete
  // summary has no call(ts) channel and raises no coverage; with or without a call observer the
  // two loosenings form the vectors.py group of Variant C
  test("Variant C: the new complete summary needs no call(ts) coverage; the group is the vector's", () => {
    const plain = run(ex1("C"));
    expect(obsOf(plain, "coverage").length).toBe(0);
    expect(plain.obligations.map((o) => o.group)).toEqual([
      "g:9f2b9e1c945e64187b39b5210fdc1218ca8249dfff9d7f26654c29d954985f2c",
      "g:9f2b9e1c945e64187b39b5210fdc1218ca8249dfff9d7f26654c29d954985f2c"
    ]);
    const inp = ex1("C");
    const K = signerFromSeed("31");
    const prov: Decl = {
      decl: "provider",
      name: "callGraph",
      produces: ["observation"],
      observes: ["call(ts)"],
      sound: ["presence", "absence"],
      identity: K.identity,
      implementation: { paths: ["tools/cg.ts"] }
    };
    for (const side of [inp.head, inp.base]) side?.source?.modules[0]?.decls.push(prov);
    const es = [
      {
        ...cite("ts:src/audit/purge.ts", "own", label("ts:src/audit/purge.ts own, head")),
        complete: true,
        deps: []
      },
      {
        ...cite("ts:src/audit/purge.ts#purgeOldEvents", "unit", EX1.PURGE_UNIT),
        complete: true,
        deps: []
      }
    ];
    inp.records.push(
      signed(
        {
          v: "shape.evidence.v1",
          kind: "observation",
          result: "observes",
          provider: { id: "audit::callGraph", version: "1" },
          revision: EX1.head,
          time: "2026-10-25T09:00:00Z",
          scope: { root: scopeRoot(es), entries: es },
          facts: [],
          harness: [],
          assumptions: []
        },
        [K]
      )
    );
    const out = run(inp);
    expect(out.obligations.map((o) => o.group)).toEqual([
      "g:9f2b9e1c945e64187b39b5210fdc1218ca8249dfff9d7f26654c29d954985f2c",
      "g:9f2b9e1c945e64187b39b5210fdc1218ca8249dfff9d7f26654c29d954985f2c"
    ]);
  });
  test("Variant C answered: bob and carol discharge both loosenings", () => {
    const out = run(ex1("C-answered"));
    expect(out.answered.map((a) => a.obligation.slice(0, 19)).sort()).toEqual(
      [C_FORBID, C_AUTH].sort()
    );
    expect(out.answered.every((a) => a.as === "discharge")).toBe(true);
    expect(ob(out, C_FORBID)).toBeUndefined();
  });
  test("an answer for another change id never matches", () => {
    const inp = ex1("C-answered");
    inp.change = { ids: ["github:acme/audit#58"] };
    for (const r of inp.reviews) r.change = "github:acme/audit#57";
    expect(run(inp).answered).toEqual([]);
  });
  // version 7: the answers are the base relay's records (A.7.6.3, A.16.4(c); a base relay makes
  // review lines act on nothing), and the forbid's ref is bd:a7514dcb4cfb7068 [D13]; carol's
  // answer alone is one person for a final loosening (A.6.3.4)
  test("carol alone cannot discharge the final loosening (two persons)", () => {
    const inp = ex1("C-answered");
    const carol = inp.records.filter((r) => {
      const st = JSON.parse(Buffer.from((r as { payload: string }).payload, "base64").toString());
      return st.predicate.shape.judge !== "audit::bob";
    });
    inp.records = carol;
    expect(run(inp).answered).toEqual([]);
  });
});

describe("Example 2: a Verus change adds an assume", () => {
  test("two blocking mechanical obligations in one group, budget 0", () => {
    const out = run(ex2());
    const c = ob(out, "ob:815d7ebb9678dbea");
    const u = ob(out, "ob:8b9a1c953f7ed31c");
    expect(c?.force).toBe("sound");
    expect(c?.introduced).toBe(true);
    expect(c?.severity).toBe("blocking");
    expect(c?.budget).toBe("mechanical");
    expect(u?.reason).toBe("assumption");
    expect(u?.severity).toBe("blocking");
    expect(u?.budget).toBe("mechanical");
    expect(c?.group).toBe(u?.group as string);
    expect(out.budget.used).toBe(0);
    expect(out.verdict).toBe("blocked");
    // SetContractFaithful's contract did not move: its judgment stays usable
    expect(out.obligations.some((o) => o.claim?.ids.includes("ironkv::SetContractFaithful"))).toBe(
      false
    );
  });
  test("the approve line without the exception answers nothing (A.14.2.6)", () => {
    const out = run(ex2({ approve: true }));
    expect(ob(out, "ob:815d7ebb9678dbea")?.severity).toBe("blocking");
    expect(ob(out, "ob:8b9a1c953f7ed31c")?.severity).toBe("blocking");
    expect(out.answered).toEqual([]);
    expect(out.verdict).toBe("blocked");
  });
  test("the exception alone does not lower the severity of new work", () => {
    const out = run(ex2({ exception: true }));
    expect(ob(out, "ob:815d7ebb9678dbea")?.severity).toBe("blocking");
    expect(out.debt).toEqual([]);
  });
  test("exception plus a person's exception answer makes both debt, 51 days to expiry", () => {
    const out = run(ex2({ exception: true, approve: true }));
    // version 7 (A.16.28): debt rows have no flagged field; the 14-day flag is display, read here
    // from expiresInDays
    expect(
      out.debt.map((d) => [d.obligation.slice(0, 19), d.expiresInDays, d.expiresInDays <= 14])
    ).toEqual([
      ["ob:815d7ebb9678dbea", 51, false],
      ["ob:8b9a1c953f7ed31c", 51, false]
    ]);
    expect(out.answered.every((a) => a.as === "exception-answer")).toBe(true);
    expect(ob(out, "ob:815d7ebb9678dbea")?.severity).toBe("owed");
    expect(ob(out, "ob:815d7ebb9678dbea")?.exception).toBe("ironkv::SetAssumeAccepted");
  });
  // version 7 (A.4.2.4, A.12.8.1 [D1]; deltas ex2): forbid hatch * gives one clause per declared hatch
  // verb plus Undeclared and no Hatch clause, so the boundary-allowed external_body at Host::send
  // raises nothing; the Undeclared clause is declared-only
  test("D1: no Hatch clause, so the boundary-allowed external_body at Host::send raises nothing", () => {
    const out = run(ex2());
    const host = out.obligations.find(
      (o) => (o.subject as { atom?: string } | null)?.atom === "external_body<std::Trust>"
    );
    expect(host).toBeUndefined();
    expect(out.preexisting).toEqual([]);
    expect(
      (out.health.declaredOnly as { claim: string }[]).map((d) => d.claim)
    ).toContain("sha256:6cd2e34ae382f2271643ee1e21eb71ea70700a980a610cd7ab8e9442b5698cd7");
  });
});

describe("Example 3: a memory whose checkable part became a law", () => {
  test("Step 1: a refactor stales the informal law; owed at normal", () => {
    const out = run(ex3());
    const u = ob(out, "ob:5b2b722c136fd4da");
    expect(u?.reason).toBe("stale");
    expect(u?.severity).toBe("owed");
    expect(u?.tier).toBe("normal");
    expect(u?.dischargers[0]?.act).toBe("judge");
    expect(u?.dischargers[0]?.command).toBe(
      "shape judge tooling::ShpCli.isoToday/RefactorSensitive/law"
    );
  });
  test("Step 1: one shape judge line through the self fallback re-establishes it", () => {
    const out = run(ex3({ judgeLine: true }));
    expect(ob(out, "ob:5b2b722c136fd4da")).toBeUndefined();
    expect((out.health.self as string[]).length).toBe(1);
  });
  test("Step 2: established, no judgment obligation", () => {
    const out = run(ex3s2());
    expect(out.verdict).toBe("pass");
  });
  test("Step 2: editing the test's harness makes the law producer-changed, blocking", () => {
    const out = run(ex3s2({ harnessEdited: true }));
    const u = ob(out, "ob:79b18d16e2bc560c");
    expect(u?.reason).toBe("producer-changed");
    expect(u?.severity).toBe("blocking");
    expect(u?.dischargers[0]?.act).toBe("answer");
    expect(u?.dischargers[0]?.eligible).toEqual(["tooling::ann"]);
  });
  test("Step 2: dropping the record instead is E-provider-missing", () => {
    const out = run(ex3s2({ harnessEdited: true, dropRecord: true }));
    expect(out.errors.map((e) => e.code)).toContain("E-provider-missing");
    expect(out.verdict).toBe("blocked");
  });
  test("Step 2: a seeded Date.now() in checkFreshness is a sound, introduced, blocking contradiction", () => {
    const out = run(ex3s2({ seededClock: true }));
    const c = ob(out, "ob:d4218b3063c6f1b9");
    expect(c?.force).toBe("sound");
    expect(c?.introduced).toBe(true);
    expect(c?.severity).toBe("blocking");
    // authority (grants none) also excludes the fact
    expect(c?.causes.some((x) => x.type === "claim")).toBe(true);
  });
  test("removing RefactorSensitive is L4 loosened, latent, blocked by DefaultPolicy at normal", () => {
    const out = run(ex3s2({ removeRefactorSensitive: true }));
    const l = ob(out, "ob:a4a8d01ab841cdac");
    expect(l?.questions).toEqual(["L4"]);
    expect(l?.exploited).toBe(false);
    expect(l?.tier).toBe("normal");
    expect(l?.severity).toBe("blocking");
  });
});

describe("Example 4: observed drift on a calls relation", () => {
  test("one heuristic, preexisting, owed cycle contradiction; budget one group", () => {
    const out = run(ex4());
    expect(out.verdict).toBe("owed");
    const c = ob(out, "ob:6efc5ef79a4f52af");
    expect(c?.force).toBe("heuristic");
    expect(c?.introduced).toBe(false);
    expect(c?.severity).toBe("owed");
    expect(c?.subject).toEqual({
      nodes: ["checker::ShapeModelLowerer", "checker::ShapeRuleEngine"]
    });
    expect(out.budget.used).toBe(1);
    // version 7 (A.4.5.6, A.10.4 [D3]; deltas ex4): the relation and the cycle rule are listed as
    // declared-only claims with route contradiction-only (tsCallGraph declares call(ts), sound none)
    const dOnly = out.health.declaredOnly as { claim: string; route: string }[];
    expect(dOnly.map((d) => [d.claim.slice(0, 23), d.route])).toEqual([
      ["sha256:8a8f0d5a3028807a", "contradiction-only"],
      ["sha256:d1d638be608c2992", "contradiction-only"]
    ]);
  });
  test("closing the set: a new calls relation widens exceptTo; L3 loosened, exploited", () => {
    const out = run(ex4({ complete: true, headDiagnostics: true }));
    const l = ob(out, "ob:03dbcad44e521c74");
    expect(l?.questions).toEqual(["L3"]);
    expect(l?.exploited).toBe(true);
    expect(l?.severity).toBe("blocking");
    expect(l?.counterexample).toEqual([
      { from: "checker::ShapeRuleEngine", kind: "calls", to: "checker::ShapeDiagnostics" }
    ]);
  });
  test("the maintainer's dismissing answer discharges the heuristic contradiction (self fallback)", () => {
    const inp = ex4();
    const out0 = run(inp);
    const bd = (ob(out0, "ob:6efc5ef79a4f52af")?.binding ?? "").slice(0, 19);
    inp.reviews = [{ identity: 'github("tim")', line: `shape approve ${bd}` }];
    const out = run(inp);
    expect(out.answered.map((a) => [a.obligation.slice(0, 19), a.self])).toEqual([
      ["ob:6efc5ef79a4f52af", true]
    ]);
    expect(out.verdict).toBe("pass");
  });
});
