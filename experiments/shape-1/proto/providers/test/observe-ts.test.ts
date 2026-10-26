// observe-ts provider: effect facts on bound resource code, call facts, completeness, SQL, and the
// checker lifting them through bindings (contradictions, coverage).
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { derive } from "../../src/derive.ts";
import { signerFromSeed } from "../../src/records.ts";
import type { Decl } from "../../src/source.ts";
import { REPO_ROOT, manifestFor } from "../common.ts";
import { callsProvider, channelsFromShape, effectsProvider, runObserveTs } from "../observe-ts/provider.ts";
import { sqlEffect } from "../observe-ts/scan.ts";
import { cleanup, input, shape, tree } from "./fixture.ts";

afterAll(cleanup);

const FILES: Record<string, string> = {
  "src/clock.ts": `export function now(): number {
  return Date.now();
}
export const stamp = (): string => new Date().toISOString();
export function parse(s: string): Date {
  return new Date(s);
}
export function alias(): number {
  const d = Date;
  return d.now();
}
export function viaGlobal(): number {
  return globalThis.Date.now();
}
export function supply(): number[] {
  return [1].map(Date.now);
}
export function check(x: unknown): boolean {
  return x instanceof Date;
}
export function nested(): () => number {
  function inner(): number {
    return performance.now();
  }
  return inner;
}
`,
  "src/db.ts": `export function purge(db: { query(s: string): void }): void {
  db.query("DELETE FROM public.audit_events WHERE created_at < now() - interval '90 days'");
}
export function dyn(db: { query(s: string): void }, t: string): void {
  db.query(\`DELETE FROM \${t}\`);
}
export function prose(): string {
  return "update the docs, then select one from the menu";
}
`,
  "src/use.ts": `import { now } from "./clock.ts";
import { other } from "some-unknown-pkg";

export function caller(): number {
  return now() + 1;
}
function double(x: number): number {
  return x * 2;
}
export function cb(xs: number[]): number[] {
  return xs.map(double);
}
export function viaParam(f: () => number): number {
  return f();
}
export function ext(): unknown {
  return other();
}
`,
  "src/pure.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n"
};

const CLOCK = ['ts.call("Date.now")', 'ts.call("Date")', 'ts.call("performance.now")', 'pg.table("*")'];
const es = signerFromSeed("21");
const cs = signerFromSeed("22");
const effects = effectsProvider({ q: "demo::tsEffects", channels: CLOCK, identity: es.identity });
const calls = callsProvider({ q: "demo::tsCalls", identity: cs.identity });

describe("sql", () => {
  test("literal statements give verbs and canonical tables; prose does not match", () => {
    expect(sqlEffect("DELETE FROM public.AUDIT_EVENTS WHERE x")).toEqual({ verb: "HardDelete", table: 'pg.table("audit_events")' });
    expect(sqlEffect('INSERT INTO "Audit" (a) VALUES (1)')).toEqual({ verb: "Append", table: 'pg.table("Audit")' });
    expect(sqlEffect("UPDATE t SET a = 1")).toEqual({ verb: "Update", table: 'pg.table("t")' });
    expect(sqlEffect("TRUNCATE TABLE logs")).toEqual({ verb: "Truncate", table: 'pg.table("logs")' });
    expect(sqlEffect("SELECT a FROM t WHERE b")).toEqual({ verb: "Read", table: 'pg.table("t")' });
    for (const prose of ["update the docs", "select one from the menu", "delete from the list please", "truncate the string"]) expect(sqlEffect(prose)).toBeNull();
  });
});

describe("observe-ts", () => {
  test("effect facts land on the nearest enclosing identity, with exact site counts", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const { scan, report } = await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: effects, channels: CLOCK, signer: es }, calls: { info: calls, signer: cs } });
    expect(report.rejected).toEqual([]);
    expect(scan.effects.map((f) => (f.type === "effect" ? `${f.at} ${f.verb} ${f.resource}` : ""))).toEqual([
      'ts:src/clock.ts#alias Read ts.call("Date.now")',
      'ts:src/clock.ts#nested.inner Read ts.call("performance.now")',
      'ts:src/clock.ts#now Read ts.call("Date.now")',
      'ts:src/clock.ts#stamp Read ts.call("Date")',
      'ts:src/clock.ts#supply Read ts.call("Date.now")',
      'ts:src/clock.ts#viaGlobal Read ts.call("Date.now")',
      'ts:src/db.ts#purge HardDelete pg.table("audit_events")'
    ]);
    const inc = (id: string): string[] => scan.identities.get(id)?.effectsIncomplete ?? ["missing"];
    // a const alias forwards its root: `const d = Date; d.now()` is the fact itself
    expect(inc("ts:src/clock.ts#alias")).toEqual([]);
    expect(inc("ts:src/db.ts#dyn")).toEqual(["dynamic:sql"]);
    expect(inc("ts:src/use.ts#ext")).toEqual(["external:some-unknown-pkg"]);
    expect(inc("ts:src/clock.ts#parse")).toEqual([]);
    expect(inc("ts:src/clock.ts#check")).toEqual([]);
    expect(inc("ts:src/db.ts#prose")).toEqual([]);
    expect(inc("ts:src/clock.ts")).toEqual([]);
    expect(scan.calls.map((f) => (f.type === "call" ? `${f.at} -> ${f.to}` : ""))).toEqual(["ts:src/use.ts#caller -> ts:src/clock.ts#now", "ts:src/use.ts#cb -> ts:src/use.ts#double"]);
    expect(scan.identities.get("ts:src/use.ts#viaParam")?.callsIncomplete).toEqual(["unresolved:callback-or-local"]);
  }, 60_000);

  test("presence: shadowed globals, parameters, members and type positions report nothing", async () => {
    const root = tree({
      "src/shadow.ts": `const Date = { now: (): number => 7 };
export function shadowed(): number {
  return Date.now();
}
export function param(performance: { now(): number }): number {
  return performance.now();
}
export function obj(o: { fetch(): void; now(): number }): number {
  o.fetch();
  return o.now();
}
export function typeOnly(x: typeof globalThis.Date): string {
  return typeof x;
}
`,
      "src/real.ts": "export function real(): number {\n  return performance.now();\n}\n"
    });
    const man = await manifestFor({ root });
    const all = ['ts.call("*")'];
    const { scan } = await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: effectsProvider({ q: "demo::all", channels: all }), channels: all, signer: null } });
    expect(scan.effects).toEqual([{ type: "effect", at: "ts:src/real.ts#real", verb: "Read", resource: 'ts.call("performance.now")' }]);
    expect([...scan.identities.values()].filter((s) => s.effectsIncomplete.length > 0)).toEqual([]);
  }, 60_000);

  test("records are deterministic: same tree, same record ids", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const once = async (): Promise<string[]> =>
      (await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: effects, channels: CLOCK, signer: es }, calls: { info: calls, signer: cs } })).records.map((r) => r.id);
    expect(await once()).toEqual(await once());
  }, 60_000);

  test("channels come from the shape's bindings", () => {
    const src = shape("demo", [{ decl: "resource", name: "SystemClock", bind: ['ts.call("globalThis.Date.now")', 'ts.call("Date")', 'pg.table("public.Audit_Events")'] }]);
    expect(channelsFromShape(src)).toEqual(['pg.table("audit_events")', 'ts.call("Date")', 'ts.call("Date.now")']);
  });

  const clockShape = (extra: Decl[] = []): Decl[] => [
    { decl: "resource", name: "SystemClock", bind: ['ts.call("Date.now")', 'ts.call("Date")', 'ts.call("performance.now")'] },
    { decl: "component", name: "Core", owner: "alice", tier: "critical", paths: ["src/clock.ts", "src/pure.ts"] },
    { decl: "component", name: "Edge", owner: "bob", paths: ["src/use.ts", "src/db.ts"] },
    { decl: "rule", name: "CoreNeverReadsClock", tier: "critical", clauses: [{ forbid: "effect", atom: "Read<SystemClock>", within: ["component Core"] }] },
    { ...effects.decl },
    ...extra
  ];

  test("derive lifts the facts through bindings: sound contradictions per reading identity", async () => {
    const root = tree(FILES);
    const man = await manifestFor({ root });
    const { records } = await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: effects, channels: CLOCK, signer: es } });
    const src = shape("demo", clockShape());
    const out = derive(input({ source: src, manifest: man.statement, revision: man.revision, records: records.map((r) => r.record) }));
    expect(out.rejected).toEqual([]);
    const contra = out.obligations.filter((o) => o.kind === "contradiction");
    expect(contra.map((o) => (o.subject as { code: string }).code).sort()).toEqual([
      "ts:src/clock.ts#alias",
      "ts:src/clock.ts#nested.inner",
      "ts:src/clock.ts#now",
      "ts:src/clock.ts#stamp",
      "ts:src/clock.ts#supply",
      "ts:src/clock.ts#viaGlobal"
    ]);
    expect(contra.every((o) => o.force === "sound")).toBe(true);
    // the pg.table fact has no binding: unmapped, not a contradiction
    expect(out.health.unmapped).toBeDefined();
  }, 60_000);

  test("change mode: complete absence-sound entries cover new code; a supplied root leaves it uncovered", async () => {
    const baseFiles = { ...FILES, "src/clock.ts": "export function now(): number {\n  return 1;\n}\n" };
    const baseRoot = tree(baseFiles);
    const headPure = { ...baseFiles, "src/pure.ts": "export function add(a: number, b: number): number {\n  return a + b + 0;\n}\n" };
    // Date handed on inside an array: a supply the scan does not follow (alias:Date)
    const headAlias = { ...baseFiles, "src/pure.ts": "export function add(a: number, b: number): number {\n  const box = [Date];\n  return a + b + box.length;\n}\n" };
    const bman = await manifestFor({ root: baseRoot });
    const src = shape("demo", clockShape());
    for (const [files, covered] of [
      [headPure, true],
      [headAlias, false]
    ] as const) {
      const root = tree(files);
      const man = await manifestFor({ root });
      const { records } = await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: effects, channels: CLOCK, signer: es } });
      const out = derive(
        input({ source: src, manifest: man.statement, revision: man.revision, records: records.map((r) => r.record), mode: "change", base: { revision: bman.revision, source: src, manifest: bman.statement } })
      );
      expect(out.obligations.some((o) => o.kind === "coverage")).toBe(!covered);
    }
  }, 60_000);

  test("declarations: effects presence+absence on bound channels; calls sound none by default", () => {
    expect(effects.decl).toMatchObject({ produces: ["observation"], sound: ["presence", "absence"], observes: ['effect(pg.table("*"))', 'effect(ts.call("Date"))', 'effect(ts.call("Date.now"))', 'effect(ts.call("performance.now"))'] });
    expect(calls.decl.sound).toBeUndefined();
    expect(calls.decl.observes).toEqual(["call(ts)"]);
  });
});

// Regression (gate, repair pass): roots reached through the global object, aliases and modules.
// An entry may be complete only if every route to a watched API in its span yields a fact.
describe("observe-ts: every route to a root", () => {
  const TS_PLAIN = JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [] }, include: ["src/**/*.ts"] });
  // the repository's own settings (lib ESNext, types ["bun"]): `global` is Node's typeof globalThis
  const TS_REPO = JSON.stringify({
    compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, types: ["bun"], typeRoots: [join(REPO_ROOT, "node_modules/@types")], allowImportingTsExtensions: true, noEmit: true },
    include: ["src/**/*.ts"]
  });
  const scanOf = async (files: Record<string, string>, channels: string[]): Promise<{ facts: string[]; inc: Record<string, string[]> }> => {
    const root = tree(files);
    const man = await manifestFor({ root });
    const { scan } = await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: effectsProvider({ q: "demo::e", channels }), channels, signer: null } });
    const facts = scan.effects.map((f) => (f.type === "effect" ? `${f.at.replace(/^ts:src\//, "")} ${f.verb} ${f.resource}` : ""));
    const inc: Record<string, string[]> = {};
    for (const x of scan.identities.values()) if (x.effectsIncomplete.length > 0 && !x.effectsIncomplete.every((r) => r.startsWith("child:"))) inc[x.id.replace(/^ts:src\//, "")] = x.effectsIncomplete.filter((r) => !r.startsWith("child:"));
    return { facts, inc };
  };
  const CLOCK3 = ['ts.call("Date.now")', 'ts.call("Date")', 'ts.call("performance.now")'];
  const GLOBALS = `export function dot(): number { return globalThis.Date.now(); }
export function element(): number { return globalThis["Date"].now(); }
export function alias(): number { const g = globalThis; return g.Date.now(); }
export function key(k: "Date"): number { return globalThis[k].now(); }
export function node(): number { return global.Date.now(); }
export function viaSelf(): number { return self.performance.now(); }
export function twice(): number { return globalThis.globalThis.Date.now(); }
export function cast(): number { return (globalThis as typeof globalThis).Date!.now(); }
export function template(): number { return globalThis[\`Date\`].now(); }
export function destructured(): number { const { Date: D } = globalThis; return D.now(); }
export function member(): number { const { now } = Date; return now(); }
const G = globalThis;
export function moduleScope(): number { return G.Date.now(); }
export function reflect(): number { return Reflect.get(globalThis, "Date").now(); }
`;

  for (const [name, cfg] of [
    ["types []", TS_PLAIN],
    ['repo settings, types ["bun"]', TS_REPO]
  ] as const) {
    test(`global object: globalThis["Date"], aliases, global, self, keys (${name})`, async () => {
      const { facts, inc } = await scanOf({ "tsconfig.json": cfg, "src/g.ts": GLOBALS }, CLOCK3);
      expect(facts).toEqual([
        'g.ts#alias Read ts.call("Date.now")',
        'g.ts#cast Read ts.call("Date.now")',
        'g.ts#destructured Read ts.call("Date.now")',
        'g.ts#dot Read ts.call("Date.now")',
        'g.ts#element Read ts.call("Date.now")',
        'g.ts#member Read ts.call("Date.now")',
        'g.ts#moduleScope Read ts.call("Date.now")',
        'g.ts#node Read ts.call("Date.now")',
        'g.ts#template Read ts.call("Date.now")',
        'g.ts#twice Read ts.call("Date.now")',
        'g.ts#viaSelf Read ts.call("performance.now")'
      ]);
      // Reflect.get(globalThis, "Date") supplies globalThis, and its result is typed DateConstructor
      expect(inc).toEqual({ "g.ts#key": ["dynamic:globalThis[]"], "g.ts#reflect": ["alias-type:Date", "alias:globalThis"] });
    }, 60_000);
  }

  test("supplies: a root handed on leaves the supplying entry (and readers of a rebound binding) incomplete", async () => {
    const { facts, inc } = await scanOf(
      {
        "tsconfig.json": TS_REPO,
        "src/s.ts": `import * as fs from "node:fs";
import { parse } from "some-unknown-pkg";
export function or(flag: boolean): number { const D = (flag && Date) || Date; return D.now(); }
export function shorthand(): unknown { return { Date }; }
export class Fixed extends Date {}
export function assign(): unknown { let D: unknown = null; D = Date; return D; }
export function rebound(): number { let D = Date; D = Date; return D.now(); }
export function handOn(use: (m: typeof fs) => void): void { use(fs); }
export function lazy(): Promise<void> { return import("node:fs").then((m) => m.rmSync("x")); }
export function callback(xs: string[]): unknown[] { return xs.map(parse); }
`
      },
      [...CLOCK3, 'ts.call("fs.rmSync")']
    );
    expect(facts).toEqual([]);
    expect(inc).toEqual({
      "s.ts#Fixed": ["alias:Date"],
      "s.ts#assign": ["alias:Date"],
      "s.ts#callback": ["external:some-unknown-pkg"],
      "s.ts#handOn": ["alias:fs"],
      "s.ts#lazy": ["alias:fs"],
      "s.ts#or": ["alias:Date"],
      "s.ts#rebound": ["alias:Date"],
      "s.ts#shorthand": ["alias:Date"]
    });
  }, 60_000);

  test("presence: comparisons, assignment targets, shadowed global objects and other members report nothing", async () => {
    const { facts, inc } = await scanOf(
      {
        "tsconfig.json": TS_REPO,
        "src/p.ts": `export function compare(x: unknown): boolean { return x === Date || x instanceof Date || typeof globalThis.Date === "function" || "now" in Date; }
export function patch(c: DateConstructor): void { globalThis.Date = c; }
export function shadow(): number { const global = { Date: { now: (): number => 7 } }; return global.Date.now(); }
export function env(k: string): string | undefined { return process.env[k]; }
export function utc(): number { const D = Date; return D.UTC(2020, 0, 1); }
export function parsed(s: string): number { return new globalThis.Date(s).getTime(); }
`
      },
      CLOCK3
    );
    expect(facts).toEqual([]);
    expect(inc).toEqual({});
  }, 60_000);

  test("modules: aliases, barrels, import-equals, require and await import reach fs.rmSync", async () => {
    const { facts, inc } = await scanOf(
      {
        "tsconfig.json": TS_REPO,
        "src/barrel.ts": 'export { rmSync } from "node:fs";\n',
        "src/m.ts": `import * as fs from "node:fs";
import { rmSync as viaBarrel } from "./barrel.ts";
import fsq = require("node:fs");
export function alias(): void { const f = fs; f.rmSync("x"); }
export function barrel(): void { viaBarrel("x"); }
export function importEquals(): void { fsq.rmSync("x"); }
export function required(): void { require("node:fs").rmSync("x"); }
export async function awaited(): Promise<void> { (await import("node:fs")).rmSync("x"); }
export async function bound(): Promise<void> { const m = await import("node:fs"); m.rmSync("x"); }
`
      },
      ['ts.call("fs.rmSync")']
    );
    expect(facts).toEqual(["alias", "awaited", "barrel", "bound", "importEquals", "required"].map((f) => `m.ts#${f} HardDelete ts.call("fs.rmSync")`));
    expect(inc).toEqual({});
  }, 60_000);

  test("prototype route: a Date instance's constructor is Date, a function's is Function", async () => {
    const { facts, inc } = await scanOf(
      {
        "tsconfig.json": TS_REPO,
        "src/c.ts": `export function protoCtor(): number { return Date.prototype.constructor.now(); }
export function instCtor(): number { return new Date(0).constructor.now(); }
export function paramCtor(d: Date): number { return d["constructor"].now(); }
export function fnCtor(): unknown { return (() => 0).constructor("return 1")(); }
export function apiCtor(): unknown { return Date.now.constructor("return 1")(); }
export function anyCtor(x: any): unknown { return x.constructor; }
export function classCtor(o: Map<string, number>): string { return o.constructor.name; }
`
      },
      CLOCK3
    );
    expect(facts).toEqual(["instCtor", "paramCtor", "protoCtor"].map((f) => `c.ts#${f} Read ts.call("Date.now")`));
    // calling what Function returns (any) is an untyped callee besides
    expect(inc).toEqual({
      "c.ts#anyCtor": ["unresolved:untyped-receiver"],
      "c.ts#apiCtor": ["dynamic:constructor", "unresolved:untyped-callee"],
      "c.ts#fnCtor": ["dynamic:constructor", "unresolved:untyped-callee"]
    });
  }, 60_000);

  test("returns, fields, parameters and inheritance: a value typed as the root is read as the root", async () => {
    const { facts, inc } = await scanOf(
      {
        "tsconfig.json": TS_REPO,
        "src/t.ts": `const getG = (): typeof globalThis => globalThis;
export function viaReturn(): number { return getG().Date.now(); }
export class Holder { clock = Date; read(): number { return this.clock.now(); } }
export function injected(d: DateConstructor): number { return d.now(); }
export function construct(D: DateConstructor): Date { return new D(); }
export class F extends Date {}
export function inherited(): number { return F.now(); }
export function structural(c: { now(): number }): number { return c.now(); }
export function mock(): number { const fake = { now: (): number => 0 }; return fake.now(); }
`
      },
      CLOCK3
    );
    expect(facts).toEqual([]);
    // structural shapes (a mock, an injected clock interface) stay complete: the root's supply is
    // flagged where it escapes (getG, Holder, F)
    expect(inc).toEqual({
      "t.ts#F": ["alias:Date"],
      "t.ts#Holder": ["alias:Date"],
      "t.ts#Holder.read": ["alias-type:Date"],
      "t.ts#construct": ["alias-type:Date"],
      "t.ts#getG": ["alias:globalThis"],
      "t.ts#inherited": ["alias-type:Date"],
      "t.ts#injected": ["alias-type:Date"],
      "t.ts#viaReturn": ["alias-type:Date", "alias-type:globalThis"]
    });
  }, 60_000);

  // the gate's end-to-end case: no grants, SystemClock bound to ts.call("Date.now")
  const fxShape = (identity: string): Decl[] => [
    { decl: "resource", name: "SystemClock", bind: ['ts.call("Date.now")'] },
    { decl: "component", name: "A", owner: "alice", tier: "critical", paths: ["src/a/**"], grants: [] },
    { decl: "component", name: "B", owner: "alice", tier: "critical", paths: ["src/b/**"], grants: [] },
    effectsProvider({ q: "demo::fxEffects", channels: ['ts.call("Date.now")'], identity }).decl
  ];
  const fxSigner = signerFromSeed("23");
  const fxInfo = effectsProvider({ q: "demo::fxEffects", channels: ['ts.call("Date.now")'], identity: fxSigner.identity });
  const recordsOf = async (root: string): Promise<{ man: Awaited<ReturnType<typeof manifestFor>>; records: unknown[] }> => {
    const man = await manifestFor({ root });
    const { records } = await runObserveTs({ man, root, time: "2026-10-25T10:00:00Z", effects: { info: fxInfo, channels: ['ts.call("Date.now")'], signer: fxSigner } });
    return { man, records: records.map((r) => r.record) };
  };

  test('derive: globalThis["Date"].now() is a sound authority contradiction, like globalThis.Date.now()', async () => {
    const root = tree({ "tsconfig.json": TS_PLAIN, "src/a/stamp.ts": "export function stampA(): number {\n  return globalThis.Date.now();\n}\n", "src/b/stamp.ts": 'export function stampB(): number {\n  return globalThis["Date"].now();\n}\n' });
    const { man, records } = await recordsOf(root);
    const out = derive(input({ source: shape("demo", fxShape(fxSigner.identity)), manifest: man.statement, revision: man.revision, records }));
    expect(out.rejected).toEqual([]);
    const contra = out.obligations.filter((o) => o.kind === "contradiction");
    expect(contra.map((o) => `${o.claim?.ids.join(",")} ${(o.subject as { code: string }).code} ${o.force} ${o.severity}`).sort()).toEqual([
      "demo::A/authority ts:src/a/stamp.ts#stampA sound blocking",
      "demo::B/authority ts:src/b/stamp.ts#stampB sound blocking"
    ]);
    expect(out.verdict).toBe("blocked");
  }, 60_000);

  test("derive (change): globalThis[k].now() in new code is uncovered, never silently complete", async () => {
    const files = { "tsconfig.json": TS_PLAIN, "src/a/stamp.ts": "export function stampA(): number {\n  return 1;\n}\n" };
    const base = await recordsOf(tree(files));
    const head = await recordsOf(tree({ ...files, "src/b/stamp.ts": 'export function stampB(k: "Date"): number {\n  return globalThis[k].now();\n}\n' }));
    const src = shape("demo", fxShape(fxSigner.identity));
    const out = derive(input({ source: src, manifest: head.man.statement, revision: head.man.revision, records: head.records, mode: "change", base: { revision: base.man.revision, source: src, manifest: base.man.statement } }));
    expect(out.rejected).toEqual([]);
    const coverage = out.obligations.filter((o) => o.kind === "coverage");
    expect(coverage.length).toBe(1);
    expect(JSON.stringify(coverage[0])).toContain("ts:src/b/stamp.ts#stampB");
    expect(out.obligations.filter((o) => o.kind === "contradiction")).toEqual([]);
  }, 60_000);
});
