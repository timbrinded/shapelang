// teeth provider: closed-form W1/W2/P1/M2 kill sets, vacuous and redundant claims, per-source
// redundancy of path forbids, unused grants, gap classes, law teeth, and agreement with derive.
import { afterAll, describe, expect, test } from "bun:test";
import { makeStatement } from "../../src/records.ts";
import type { Decl } from "../../src/source.ts";
import { manifestFor } from "../common.ts";
import { runTeeth, teethStatement } from "../teeth/provider.ts";
import { cleanup, shape, tree } from "./fixture.ts";

afterAll(cleanup);

const FILES = {
  "src/a.ts": "export function a1(): number {\n  return 1;\n}\nexport function a2(): number {\n  return 2;\n}\n",
  "src/b.ts": "export function b(): number {\n  return 3;\n}\n",
  "src/c.ts": "export function c(): number {\n  return 4;\n}\n",
  "src/d.ts": "export function d(): number {\n  return 5;\n}\n"
};

const DECLS: Decl[] = [
  { decl: "resource", name: "Ledger", attach: [{ name: "AppendOnly" }], owner: "alice" },
  { decl: "resource", name: "Cache", owner: "alice" },
  {
    decl: "component",
    name: "A",
    owner: "alice",
    paths: ["src/a.ts"],
    grants: ["Read<Ledger>", "Append<Ledger>"],
    units: [
      { name: "a1", effects: { mode: "complete", atoms: [{ atom: "Read<Ledger>" }] } },
      { name: "a2", effects: { mode: "complete", atoms: [{ atom: "Append<Ledger>" }] } }
    ]
  },
  { decl: "component", name: "B", owner: "alice", paths: ["src/b.ts"], grants: ["Read<Ledger>", "Update<Cache>"] },
  { decl: "component", name: "C", owner: "alice", paths: ["src/c.ts"] },
  { decl: "component", name: "D", owner: "alice", paths: ["src/d.ts"], grants: "none" },
  { decl: "relation", name: "AB", kind: "calls", connects: ["A", "B"] },
  { decl: "rule", name: "Empty", clauses: [{ forbid: "effect", atom: "Write<Cache>", within: ["component A"], except: ["component A"] }] },
  { decl: "rule", name: "Isolation", clauses: [{ forbid: "path", from: ["component A", "component B"], to: ["component D"], over: ["calls"] }] },
  { decl: "rule", name: "Acyclic", clauses: [{ forbid: "cycle", over: ["calls"] }] }
];

describe("teeth", () => {
  test("kill sets: vacuous, redundant sources, unused grants, P1 gaps, coupling classes", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const run = runTeeth({ source: shape("demo", DECLS), man, time: "2026-10-25T12:00:00Z" });
    const r = run.report;
    expect(run.errors).toEqual([]);
    expect(r.vacuous).toEqual(["demo::Empty"]);
    expect(r.sources).toEqual([
      { claim: "demo::Isolation", source: "demo::A", kills: 2, redundantWith: [] },
      { claim: "demo::Isolation", source: "demo::B", kills: 1, redundantWith: ["demo::A"] }
    ]);
    // B has no conduct at all, so both its grants are unused; A uses both of its grants
    expect(r.unusedGrants).toEqual(["demo::B Read<demo::Ledger>", "demo::B Update<demo::Cache>"]);
    expect(r.gaps.P1).toEqual({ resources: 2, uncaught: ["demo::Cache"], caught: ["demo::Ledger"] });
    const calls = Object.fromEntries(r.gaps.W2.filter((g) => g.kind === "calls").map((g) => [g.class, [g.killed, g.total]]));
    // B→A closes a cycle; C→D and A→D, B→D are isolation; A→C and B→C, C→A, C→B, D→* are new couplings
    expect(calls["back-edge"]).toEqual([1, 1]);
    expect(r.operators.find((o) => o.op === "M2")).toEqual({ op: "M2", mutants: 4, killed: 2 });
    const forbid = r.claims.find((c) => c.id.startsWith("demo::Ledger/AppendOnly"));
    expect(forbid?.kills.P1).toBe(9);
    expect(r.notAssessed).toContain("demo::AB");
    expect(r.gaps.W1["open-authority"]).toBeGreaterThan(0);
  });

  test("the report is invariant under declaration order (T1 for teeth)", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const a = runTeeth({ source: shape("demo", DECLS), man, time: "2026-10-25T12:00:00Z" }).report;
    const b = runTeeth({ source: shape("demo", [...DECLS].reverse()), man, time: "2026-10-25T12:00:00Z" }).report;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("the closed form agrees with derive on every sampled mutant", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const run = runTeeth({ source: shape("demo", DECLS), man, time: "2026-10-25T12:00:00Z", validate: 25 });
    expect(run.validation?.disagreements).toEqual([]);
    expect(run.validation?.sampled).toBeGreaterThanOrEqual(60);
  }, 60_000);

  test("law teeth come from bound.mutants in test records", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const decls: Decl[] = [
      ...DECLS,
      { decl: "law", name: "A1Det", template: { name: "Deterministic", args: ["A.a1"] }, evidence: { level: "tested" } },
      { decl: "law", name: "A2Det", template: { name: "Deterministic", args: ["A.a2"] }, evidence: { level: "tested" } }
    ];
    const src = shape("demo", decls);
    const first = runTeeth({ source: src, man, time: "2026-10-25T12:00:00Z" });
    const fp = (id: string): string => first.report.laws.find((l) => l.id === id)?.fp ?? "";
    const rec = (id: string, mutants: { total: number; killed: number }): unknown =>
      makeStatement({ v: "shape.evidence.v1", kind: "test", result: "supports", provider: { id: "demo::t", version: "0" }, revision: man.revision, time: "2026-10-25T10:00:00Z", claim: { id, fp: fp(id) }, code: [], harness: [], bound: { mutants } });
    const run = runTeeth({ source: src, man, time: "2026-10-25T12:00:00Z", records: [rec("demo::A1Det", { total: 6, killed: 0 }), rec("demo::A2Det", { total: 6, killed: 5 })] });
    expect(run.report.laws.map((l) => [l.id, l.verdict])).toEqual([
      ["demo::A1Det", "vacuous"],
      ["demo::A2Det", "teeth"]
    ]);
  });

  test("the report wraps as an in-toto statement whose subjects are the assessed claims", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const run = runTeeth({ source: shape("demo", DECLS), man, time: "2026-10-25T12:00:00Z" });
    const st = teethStatement(run.report, man, null) as { subject: { name: string }[]; predicate: { attributes: { attribute: string }[] } };
    expect(st.predicate.attributes[0]?.attribute).toBe("SHAPE_TEETH");
    expect(st.subject.length).toBe(run.report.claims.length + 1);
  });
});
