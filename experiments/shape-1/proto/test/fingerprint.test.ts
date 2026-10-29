// Code identities and digests: TypeScript (compiler API and fallback), Rust/Verus markers, raw and
// command code, git tree rebuilding (A.3.2, A.5.7.2, A.12.2-3, A.12.7.5).
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fingerprintRust } from "../src/fingerprint/rust.ts";
import { fingerprintTs, loadTypeScript } from "../src/fingerprint/ts.ts";
import { filesFromGit, manifestFromFiles } from "../src/manifest-build.ts";
import { gitBlobId, gitTreeId, indexManifest, manifestStatement } from "../src/manifest.ts";

const REPO = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
const ts = await loadTypeScript(REPO);
const fp = (src: string, useTs = true) =>
  Object.fromEntries(
    fingerprintTs("src/a.ts", src, useTs ? ts : null, { resolve: () => null }).map((i) => [i.id, i])
  );
const dig = (m: ReturnType<typeof fp>, id: string, p: string): string | undefined =>
  m[id]?.digests.find((d) => d.projection === p)?.digest;

const A = `const LIMIT = { days: 0 };\n// a comment\nexport function f(x: number) {\n  function g() { return 'a' }\n  return x + LIMIT.days;\n}\n`;

describe("TypeScript digests", () => {
  test("the compiler API is found", () => {
    expect(ts).not.toBeNull();
  });
  test("formatting, quotes, trailing commas and inert comments do not move digests", () => {
    const b = `const LIMIT = {days: 0}\nexport function f(x: number) { /* inert */\n  function g() {\n    return "a";\n  }\n  return x + LIMIT.days;\n}\n`;
    for (const id of ["ts:src/a.ts", "ts:src/a.ts#f", "ts:src/a.ts#f.g"])
      for (const p of ["own", "unit"]) expect(dig(fp(A), id, p)).toBe(dig(fp(b), id, p));
  });
  test("a hatch marker moves digests and is counted in own text", () => {
    const c = A.replace("return x", "// @ts-ignore\n  return x");
    expect(dig(fp(c), "ts:src/a.ts#f", "unit")).not.toBe(dig(fp(A), "ts:src/a.ts#f", "unit"));
    expect(fp(c)["ts:src/a.ts#f"]?.markers).toEqual({ ts_ignore: 1 });
    expect(fp(c)["ts:src/a.ts"]?.markers).toEqual({});
  });
  // version 7 (A.12.2.8 [D20]): @ts-expect-error and @ts-nocheck are hatch markers too, with and
  // without the compiler
  test("ts_expect_error and ts_nocheck are counted where they occur", () => {
    const c = `// @ts-nocheck\n${A.replace("return x", "// @ts-expect-error\n  return x")}`;
    for (const useTs of [true, false]) {
      expect(fp(c, useTs)["ts:src/a.ts#f"]?.markers).toEqual({ ts_expect_error: 1 });
      expect(fp(c, useTs)["ts:src/a.ts"]?.markers).toEqual({ ts_nocheck: 1 });
    }
  });
  test("a nested change moves the parent's unit, not its own; env tracks data initialisers", () => {
    const d = A.replace("return 'a'", "return 'b'");
    expect(dig(fp(d), "ts:src/a.ts#f", "own")).toBe(dig(fp(A), "ts:src/a.ts#f", "own"));
    expect(dig(fp(d), "ts:src/a.ts#f", "unit")).not.toBe(dig(fp(A), "ts:src/a.ts#f", "unit"));
    const e = A.replace("days: 0", "days: 30");
    expect(dig(fp(e), "ts:src/a.ts#f", "unit")).not.toBe(dig(fp(A), "ts:src/a.ts#f", "unit"));
  });
  test("parents and identities: classes, methods, private names", () => {
    const m = fp("export class C { m() { return 1 } #p = () => 2 }\n");
    expect(Object.keys(m).sort()).toEqual([
      "ts:src/a.ts",
      "ts:src/a.ts#C",
      "ts:src/a.ts#C.%23p",
      "ts:src/a.ts#C.m"
    ]);
    expect(m["ts:src/a.ts#C.m"]?.parent).toBe("ts:src/a.ts#C");
  });
  test("lexical fallback: top-level identities, comment-insensitive", () => {
    const x = fp(A, false);
    expect(Object.keys(x).sort()).toEqual(["ts:src/a.ts", "ts:src/a.ts#f"]);
    expect(dig(fp(A.replace("// a comment", "// other"), false), "ts:src/a.ts#f", "unit")).toBe(
      dig(x, "ts:src/a.ts#f", "unit")
    );
  });
});

describe("Rust and Verus", () => {
  const V = `verus! {\nimpl DelegationMap {\n  pub fn set(&mut self, k: K)\n    requires old(self).valid(),\n    ensures self.valid(),\n  {\n    self.m.insert(k);\n  }\n}\n#[verifier::external_body]\nfn host_send() {}\n}\n`;
  const ids = (src: string) =>
    Object.fromEntries(fingerprintRust("ironkv/src/d.rs", src).map((i) => [i.id, i]));
  test("Verus identities and the assume marker; contract and closure ignore the body", () => {
    const a = ids(V);
    const b = ids(V.replace("self.m.insert(k);", "assume(self.valid());\n    self.m.insert(k);"));
    const set = "verus:ironkv/src/d.rs#DelegationMap::set";
    expect(Object.keys(a).sort()).toEqual([
      "verus:ironkv/src/d.rs",
      "verus:ironkv/src/d.rs#DelegationMap::set",
      "verus:ironkv/src/d.rs#host_send"
    ]);
    expect(b[set]?.markers).toEqual({ assume: 1 });
    expect(a["verus:ironkv/src/d.rs#host_send"]?.markers).toEqual({ external_body: 1 });
    const d = (m: typeof a, p: string) => m[set]?.digests.find((x) => x.projection === p)?.digest;
    expect(d(b, "unit")).not.toBe(d(a, "unit"));
    expect(d(b, "contract")).toBe(d(a, "contract"));
    expect(d(b, "closure")).toBe(d(a, "closure"));
  });
  test("item-producing macros make identities not hatch-complete", () => {
    expect(
      fingerprintRust("x.rs", "macro_rules! m { () => {} }\nfn f() {}\n")[0]?.hatchComplete
    ).toBe(false);
    expect(fingerprintRust("x.rs", "fn f() {}\n")[0]?.hatchComplete).toBe(true);
  });
  // version 7 (A.12.2.8 [D20]): Rust unsafe counts on blocks, fn, impl and trait; never in Verus files
  test("Rust unsafe markers: blocks, fn, impl and trait", () => {
    const r = Object.fromEntries(
      fingerprintRust(
        "x.rs",
        "unsafe trait T {}\nunsafe impl T for u8 {}\npub unsafe fn f() {}\nfn g() { unsafe { f() } }\n"
      ).map((i) => [i.id, i])
    );
    expect(r["rust:x.rs"]?.markers).toEqual({ unsafe: 2 });
    expect(r["rust:x.rs#f"]?.markers).toEqual({ unsafe: 1 });
    expect(r["rust:x.rs#g"]?.markers).toEqual({ unsafe: 1 });
    expect(ids(`${V}fn u() { unsafe { } }\n`)["verus:ironkv/src/d.rs#u"]?.markers).toEqual({});
  });
});

describe("manifests", () => {
  const files = [
    {
      path: "package.json",
      mode: "100644",
      bytes: Buffer.from('{"name":"x","scripts":{"build":"tsc"}}')
    },
    {
      path: "scripts/purge.sh",
      mode: "100644",
      bytes: Buffer.from("#!/bin/sh\npsql -c 'DELETE FROM audit_events'\n")
    },
    { path: "data/x.json", mode: "100644", bytes: Buffer.from("{}") },
    { path: "shape/a.shape", mode: "100644", bytes: Buffer.from("module a") },
    { path: "src/a.ts", mode: "100644", bytes: Buffer.from(A) },
    {
      path: ".github/workflows/ci.yml",
      mode: "100644",
      bytes: Buffer.from("jobs:\n  t:\n    steps:\n      - run: bun test\n")
    }
  ];
  test("registry: command code, raw executables, raw data, shape files excluded", () => {
    const m = indexManifest(manifestStatement(manifestFromFiles("r1", files, ts)));
    expect(m.problems).toEqual([]);
    const ids = [...(m.index?.ids.keys() ?? [])].sort();
    expect(ids).toContain("pkgjson:package.json#scripts.build");
    expect(ids).toContain("gha:.github/workflows/ci.yml#jobs.t.steps.0");
    expect(m.index?.ids.get("raw:scripts/purge.sh")?.executable).toBe(true);
    expect(m.index?.ids.get("raw:data/x.json")?.executable).toBe(false);
    expect(ids.some((i) => i.includes("shape/a.shape"))).toBe(false);
  });
  test("an omitted tracked path makes the manifest invalid", () => {
    const p = manifestFromFiles("r1", files, ts);
    p.entries = p.entries.filter((e) => !e.id.startsWith("raw:data/"));
    expect(indexManifest(manifestStatement(p)).problems.map((x) => x.code)).toContain(
      "omitted-path"
    );
  });
  test("the rebuilt git tree equals git's own tree id for HEAD", () => {
    const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: REPO })
      .stdout.toString()
      .trim();
    const all = filesFromGit(REPO, "HEAD");
    expect(all.length).toBeGreaterThan(100);
    const treeEntries = all.map((f) => ({ path: f.path, mode: f.mode, blob: gitBlobId(f.bytes) }));
    expect(gitTreeId(treeEntries)).toBe(tree);
  });
});
