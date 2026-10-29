// laws provider: law-file API, records, Req/harness/deps citations, mutants, and derive integration.
import { afterAll, describe, expect, test } from "bun:test";
import { derive } from "../../src/derive.ts";
import { parseRecord, signerFromSeed } from "../../src/records.ts";
import type { Decl } from "../../src/source.ts";
import { manifestFor } from "../common.ts";
import { checkProperty, gen, jsonSafe } from "../laws/pbt.ts";
import { applyMutant, mutantsOf, pickEven } from "../laws/mutate.ts";
import { lawsProvider, runLaws } from "../laws/provider.ts";
import { loadTsFull } from "../ts-api.ts";
import { REPO_ROOT } from "../common.ts";
import { PBT, cleanup, input, shape, tree } from "./fixture.ts";

afterAll(cleanup);

const MATH = (hiReturn: string): string => `import { HI } from "./limits.ts";

export function clamp(x: number): number {
  if (x < 0) return 0;
  if (x > HI) return ${hiReturn};
  return x;
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
`;

const LAWS = `import { gen, law } from ${JSON.stringify(PBT)};
import { clamp, sum } from "../src/math.ts";

law("demo::ClampBounded", gen.int(-500, 500), (x) => clamp(x) === Math.min(100, Math.max(0, x)), { runs: 300, seed: 7, domain: "x in [-500, 500]" });
law("demo::Math.sum/Deterministic/law", gen.array(gen.int(-100, 100), 8), (xs) => sum(xs) === xs.reduce((a, b) => a + b, 0));
law.check("demo::Math.sum/Deterministic/law", () => sum([]) === 0, { name: "empty" });
`;

function fixture(hiReturn = "HI"): string {
  return tree({
    "src/math.ts": MATH(hiReturn),
    "src/limits.ts": "export const HI = 100;\n",
    "laws/math.law.ts": LAWS,
    "package.json": '{"name":"fx","private":true}\n'
  });
}

const signer = signerFromSeed("0a");
const info = lawsProvider({
  q: "demo::bunLaws",
  decides: ["template Bounded", "template Deterministic"],
  identity: signer.identity,
  implementation: ["tools/law-runner.cfg"]
});
const decls: Decl[] = [
  {
    decl: "component",
    name: "Math",
    owner: "alice",
    tier: "critical",
    paths: ["src/**/*.ts"],
    units: [{ name: "clamp" }, { name: "sum", attach: [{ name: "Deterministic" }] }]
  },
  {
    decl: "law",
    name: "ClampBounded",
    template: { name: "Bounded", args: ["Math.clamp", 0, 100] },
    evidence: { level: "tested" }
  },
  info.decl
];
const source = shape("demo", decls);
const TIME = "2026-10-25T10:00:00Z";

describe("pbt", () => {
  test("seeded runs are deterministic and shrink to a minimal counterexample", () => {
    const prop = (x: number): boolean => x < 37;
    const a = checkProperty(gen.int(0, 1000), prop, 500, 3);
    const b = checkProperty(gen.int(0, 1000), prop, 500, 3);
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.counterexample).toBe(37);
  });
  test("arrays shrink by dropping and shrinking elements", () => {
    const r = checkProperty(
      gen.array(gen.int(0, 50), 10),
      (xs) => xs.reduce((s, x) => s + x, 0) < 60,
      300,
      1
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect((r.counterexample as number[]).reduce((s, x) => s + x, 0)).toBeGreaterThanOrEqual(60);
  });
  test("counterexamples are float-free JSON", () => {
    expect(jsonSafe({ a: 0.5, b: [1, Number.NaN], c: new Set([2]), d: 10n })).toEqual({
      a: "0.5",
      b: [1, "NaN"],
      c: { $set: [2] },
      d: "10n"
    });
  });
});

describe("mutants", () => {
  test("operators cover relational, constant and boolean edits within the span only", async () => {
    const ts = await loadTsFull(REPO_ROOT);
    expect(ts).not.toBeNull();
    if (!ts) return;
    const text =
      "export function f(a: number): boolean { return a < 1 && true; }\nexport const g = (b: number) => b + 2;\n";
    const span = { start: 0, end: text.indexOf("\n") };
    const ms = mutantsOf(ts, "x.ts", text, span);
    expect(ms.map((m) => m.op)).toEqual([
      "relational:<→<=",
      "constant:1→2",
      "logical:&&→||",
      "boolean:true→false"
    ]);
    expect(applyMutant(text, ms[0] as (typeof ms)[number])).toContain("a <= 1");
    expect(pickEven([1, 2, 3, 4, 5, 6], 3)).toEqual([1, 3, 5]);
  });
});

describe("laws provider", () => {
  test("emits valid signed Test Result records citing Req, harness and deps", async () => {
    const root = fixture();
    const man = await manifestFor({ root });
    const { records, report } = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: ["laws/math.law.ts"],
      signer,
      time: TIME
    });
    expect(report.rejected).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(report.claims.map((c) => [c.id, c.result, c.laws])).toEqual([
      ["demo::ClampBounded", "supports", 1],
      ["demo::Math.sum/Deterministic/law", "supports", 2]
    ]);
    expect(records).toHaveLength(2);
    const r = records[0];
    if (!r) throw new Error("no record");
    const p = parseRecord(r.record);
    if ("error" in p) throw new Error(p.error);
    expect(p.signers).toEqual([signer.identity]);
    expect(p.statement.predicateType).toBe("https://in-toto.io/attestation/test-result/v0.1");
    expect(r.shape.code?.map((c) => `${c.id}@${c.projection}`)).toEqual([
      "ts:src/math.ts#clamp@unit"
    ]);
    expect(r.shape.harness?.map((c) => c.id)).toEqual(["ts:laws/math.law.ts"]);
    expect(r.shape.deps?.map((c) => c.id)).toEqual(["ts:src/limits.ts", "ts:src/math.ts"]);
    expect(r.shape.bound).toEqual({ runs: 300, seed: 7, laws: 1, domain: ["x in [-500, 500]"] });
    expect(r.shape.assumptions).toEqual([{ id: `bun@${Bun.version}`, kind: "tool" }]);
    expect(r.shape.claim?.nf).toContain("std::Bounded");
  }, 60_000);

  test("establishes the laws in derive; without records they are unestablished", async () => {
    const root = fixture();
    const man = await manifestFor({ root });
    const { records } = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: ["laws/math.law.ts"],
      signer,
      time: TIME
    });
    const withRecords = derive(
      input({
        source,
        manifest: man.statement,
        revision: man.revision,
        records: records.map((r) => r.record)
      })
    );
    expect(withRecords.rejected).toEqual([]);
    expect(withRecords.verdict).toBe("pass");
    const without = derive(input({ source, manifest: man.statement, revision: man.revision }));
    expect(without.obligations.map((o) => [o.kind, o.reason])).toEqual([
      ["unestablished", "missing"],
      ["unestablished", "missing"]
    ]);
  }, 60_000);

  test("a failing law gives a counterexample and a sound contradiction", async () => {
    const root = fixture("x");
    const man = await manifestFor({ root });
    const { records, report } = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: ["laws/math.law.ts"],
      signer,
      time: TIME
    });
    const clamp = report.claims.find((c) => c.id === "demo::ClampBounded");
    expect(clamp?.result).toBe("contradicts");
    expect(clamp?.counterexample).toBe(101);
    const out = derive(
      input({
        source,
        manifest: man.statement,
        revision: man.revision,
        records: records.map((r) => r.record)
      })
    );
    const ob = out.obligations.find((o) => o.claim?.ids.includes("demo::ClampBounded"));
    expect(ob?.kind).toBe("contradiction");
    expect(ob?.force).toBe("sound");
    expect(out.verdict).toBe("blocked");
  }, 60_000);

  test("bound.mutants: an oracle law kills mutants, a determinism law kills none", async () => {
    const root = fixture();
    const man = await manifestFor({ root });
    const { report, records } = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: ["laws/math.law.ts"],
      signer,
      time: TIME,
      mutants: 8
    });
    const clamp = report.claims.find((c) => c.id === "demo::ClampBounded")?.mutants;
    const sum = report.claims.find((c) => c.id === "demo::Math.sum/Deterministic/law")?.mutants;
    if (!clamp || "error" in clamp || !sum || "error" in sum)
      throw new Error(JSON.stringify({ clamp, sum }));
    // clamp: `return 0` → `return 1` is killed; `<`→`<=`, `>`→`>=` and the guard constant are equivalent mutants
    expect(clamp).toEqual({
      total: 4,
      killed: 1,
      survivors: [
        "ts:src/math.ts#clamp relational:<→<=@4:9",
        "ts:src/math.ts#clamp constant:0→1@4:11",
        "ts:src/math.ts#clamp relational:>→>=@5:9"
      ]
    });
    expect(sum.killed).toBe(sum.total);
    expect(
      records.find((r) => r.shape.claim?.id === "demo::ClampBounded")?.shape.bound?.mutants
    ).toEqual({ total: 4, killed: 1 });
  }, 120_000);

  test("plain bun:test files bind to claims; a crash is inconclusive", async () => {
    const root = tree({
      "src/math.ts": MATH("HI"),
      "src/limits.ts": "export const HI = 100;\n",
      "test/ok.test.ts":
        'import { test, expect } from "bun:test";\nimport { sum } from "../src/math.ts";\ntest("s", () => expect(sum([1, 2])).toBe(3));\n',
      "test/bad.test.ts":
        'import { test } from "bun:test";\ntest("s", () => { throw new Error("boom"); });\n'
    });
    const man = await manifestFor({ root });
    const ok = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: [],
      binds: [{ claim: "demo::Math.sum/Deterministic/law", file: "test/ok.test.ts" }],
      signer,
      time: TIME
    });
    expect(ok.report.claims.map((c) => c.result)).toEqual(["supports"]);
    const bad = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: [],
      binds: [
        { claim: "c:" + (ok.report.claims[0]?.fp.slice(7, 27) ?? ""), file: "test/bad.test.ts" }
      ],
      signer,
      time: TIME
    });
    expect(bad.report.claims.map((c) => c.result)).toEqual(["inconclusive"]);
  }, 60_000);

  test("law lines naming no law claim are reported, not recorded", async () => {
    const root = tree({
      "src/math.ts": MATH("HI"),
      "src/limits.ts": "export const HI = 100;\n",
      "laws/x.law.ts": `import { law } from ${JSON.stringify(PBT)};\nlaw.check("demo::NoSuchLaw", () => true);\n`
    });
    const man = await manifestFor({ root });
    const { records, report } = await runLaws({
      info,
      source,
      man,
      root,
      lawFiles: ["laws/x.law.ts"],
      signer,
      time: TIME
    });
    expect(records).toEqual([]);
    expect(report.unknown).toEqual([{ file: "laws/x.law.ts", claim: "demo::NoSuchLaw" }]);
  }, 60_000);

  test("declaration: test producer, presence-sound, decides templates, trusts bun", () => {
    expect(info.decl).toMatchObject({
      decl: "provider",
      produces: ["test"],
      sound: ["presence"],
      trusts: [["bun", Bun.version]],
      decides: ["template Bounded", "template Deterministic"],
      identity: signer.identity
    });
  });
});
