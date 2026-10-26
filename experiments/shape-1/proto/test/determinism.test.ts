// T1: permuted inputs give byte-identical output (full and core), and the same inputDigest.
import { describe, expect, test } from "bun:test";
import { ex1, ex2, ex3, ex3s2, ex4 } from "../examples/fixtures.ts";
import type { CheckInput } from "../src/io-types.ts";
import { coreOutput } from "../src/render.ts";
import { permute, run } from "./helpers.ts";

const cases: [string, () => CheckInput][] = [
  ["ex1 audit", () => ex1("audit")],
  ["ex1 empty base", () => ex1("empty-base")],
  ["ex1 A", () => ex1("A")],
  ["ex1 B", () => ex1("B")],
  ["ex1 B-weak", () => ex1("B-weak")],
  ["ex1 B′", () => ex1("Bprime")],
  ["ex1 B″", () => ex1("Bsecond")],
  ["ex1 C", () => ex1("C")],
  ["ex1 C answered", () => ex1("C-answered")],
  ["ex2", () => ex2()],
  ["ex2 exception+approve", () => ex2({ exception: true, approve: true })],
  ["ex3", () => ex3()],
  ["ex3 judged", () => ex3({ judgeLine: true })],
  ["ex3 step 2 harness", () => ex3s2({ harnessEdited: true })],
  ["ex3 step 2 seeded clock", () => ex3s2({ seededClock: true })],
  ["ex3 step 2 L4", () => ex3s2({ removeRefactorSensitive: true })],
  ["ex4", () => ex4()],
  ["ex4 closing the set", () => ex4({ complete: true, headDiagnostics: true })]
];

describe("permutation invariance (T1)", () => {
  for (const [name, mk] of cases) {
    test(name, () => {
      const ref = run(mk());
      const refFull = JSON.stringify(ref);
      const refCore = JSON.stringify(coreOutput(ref));
      for (let seed = 1; seed <= 6; seed += 1) {
        const out = run(permute(mk(), seed));
        expect(out.inputDigest).toBe(ref.inputDigest);
        expect(JSON.stringify(coreOutput(out))).toBe(refCore);
        expect(JSON.stringify(out)).toBe(refFull);
      }
    });
  }
  test("repeated runs are identical and outputs carry no floats", () => {
    const a = JSON.stringify(run(ex1("C")));
    const b = JSON.stringify(run(ex1("C")));
    expect(a).toBe(b);
    expect(/\d\.\d/.test(a.replace(/"[^"]*"/g, '""'))).toBe(false);
  });
  test("obligations are sorted by (severity, kind, key) and errors by (code, subject)", () => {
    const out = run(ex1("A"));
    const keys = out.obligations.map((o) => `${o.severity}|${o.kind}|${o.key}`);
    expect(keys).toEqual([...keys].sort());
    const errs = out.errors.map((e) => `${e.code}|${e.subject}`);
    expect(errs).toEqual([...errs].sort());
  });
});
