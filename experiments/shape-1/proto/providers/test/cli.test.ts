// shape1-providers CLI smoke tests: declarations, record output, and the trust/teeth commands.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTO_ROOT, REPO_ROOT } from "../common.ts";
import { PBT, cleanup, shape, tree } from "./fixture.ts";

afterAll(cleanup);

const CLI = join(PROTO_ROOT, "providers/cli.ts");

function run(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("bun", [CLI, ...args], { cwd: REPO_ROOT, maxBuffer: 1 << 26 });
  return { code: r.status ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("cli", () => {
  test("help and declarations", () => {
    expect(run(["help"]).code).toBe(0);
    const d = run(["laws", "declare", "--provider", "demo::bunLaws", "--decides", "template Deterministic", "--seed", "0a"]);
    expect(d.code).toBe(0);
    const decl = JSON.parse(d.out) as { produces: string[]; identity: string; sound: string[] };
    expect(decl.produces).toEqual(["test"]);
    expect(decl.identity).toMatch(/^ed25519\("[0-9a-f]{64}"\)$/);
    const o = run(["observe-ts", "declare", "--effects-provider", "demo::fx", "--channel", 'ts.call("Date.now")', "--calls-provider", "demo::calls"]);
    expect(JSON.parse(o.out)).toHaveLength(2);
  });

  test("an unknown provider or subcommand is named, exit 2", () => {
    for (const [provider, cmd] of [
      ["laws", "frobnicate"],
      ["observe-ts", "nope"],
      ["trust", "bogus"],
      ["teeth", "walk"]
    ]) {
      const r = run([provider as string, cmd as string]);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`unknown ${provider} command "${cmd}"`);
    }
    const u = run(["observe", "run"]);
    expect(u.code).toBe(2);
    expect(u.err).toContain('unknown provider "observe"');
  });

  test("laws run writes JSON lines; teeth run and trust rust-audit report", () => {
    const root = tree({
      "src/m.ts": "export function inc(x: number): number {\n  return x + 1;\n}\n",
      "laws/m.law.ts": `import { gen, law } from ${JSON.stringify(PBT)};\nimport { inc } from "../src/m.ts";\nlaw("demo::M.inc/Deterministic/law", gen.int(0, 9), (x) => inc(x) === x + 1);\n`,
      "src/lib.rs": "fn f() { unsafe { g() } }\n"
    });
    const src = join(root, "shape1.json");
    writeFileSync(src, JSON.stringify(shape("demo", [{ decl: "component", name: "M", owner: "alice", paths: ["src/**"], units: [{ name: "inc", attach: [{ name: "Deterministic" }] }] }])));
    const l = run(["laws", "run", "--root", root, "--source", src, "--provider", "demo::bunLaws", "--decides", "template Deterministic", "--time", "2026-10-25T10:00:00Z"]);
    expect(l.code).toBe(0);
    const lines = l.out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] as string) as { predicate: { shape: { result: string } } }).predicate.shape.result).toBe("supports");
    const t = run(["teeth", "run", "--root", root, "--source", src, "--time", "2026-10-25T12:00:00Z"]);
    expect(t.code).toBe(0);
    expect((JSON.parse(t.out) as { v: string }).v).toBe("shape.teeth.v1");
    const a = run(["trust", "rust-audit", "--root", root, "--no-typescript"]);
    expect(JSON.parse(a.out)).toEqual([{ path: "src/lib.rs", lang: "rust", vprobe: {}, manifest: { unsafe: 1 }, delta: { unsafe: 1 }, hatchComplete: true }]);
  }, 60_000);
});
