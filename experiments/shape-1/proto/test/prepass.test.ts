// The exported pre-pass (src/prepass.ts) agrees with derive on what only the pre-pass computes:
// inputDigest, the rejected section, clockClamped and the invalid verdict (A.11.2.1, A.16.3).
import { describe, expect, test } from "bun:test";
import { ex1, ex2, ex3, ex3s2, ex4 } from "../examples/fixtures.ts";
import type { CheckInput } from "../src/io-types.ts";
import { jcs } from "../src/jcs.ts";
import { prepass } from "../src/prepass.ts";
import { run } from "./helpers.ts";

const cases: [string, () => CheckInput][] = [
  ["ex1 audit", () => ex1("audit")],
  ["ex1 empty base", () => ex1("empty-base")],
  ["ex1 B", () => ex1("B")],
  ["ex1 C answered", () => ex1("C-answered")],
  ["ex2 exception+approve", () => ex2({ exception: true, approve: true })],
  ["ex3 judged", () => ex3({ judgeLine: true })],
  ["ex3 step 2 seeded clock", () => ex3s2({ seededClock: true })],
  ["ex4 closing the set", () => ex4({ complete: true, headDiagnostics: true })]
];

describe("prepass agrees with derive", () => {
  for (const [name, mk] of cases) {
    test(name, () => {
      const input = mk();
      const out = run(input);
      const pp = prepass(input);
      expect(pp.ok).toBe(true);
      if (!pp.ok) return;
      expect(pp.inputDigest).toBe(out.inputDigest);
      expect(jcs(pp.rejected)).toBe(jcs(out.rejected));
      expect(pp.clockClamped).toBe(out.health.clockClamped as boolean);
      expect(pp.records.filter((r) => r.rejection !== null).length).toBe(
        out.rejected.filter((r) => pp.records.some((x) => x.id === r.record)).length
      );
      for (const r of pp.records)
        if (r.rejection === null && r.parsed?.shape.kind === "judgment")
          expect(r.authenticated).toBe(true);
    });
  }
  test("a malformed input is invalid in both", () => {
    const input = { ...ex1("A"), now: "not a time" } as CheckInput;
    expect(run(input).verdict).toBe("invalid");
    const pp = prepass(input);
    expect(pp.ok).toBe(false);
    if (!pp.ok) expect(pp.inputDigest).toBe(run(input).inputDigest);
  });
});
