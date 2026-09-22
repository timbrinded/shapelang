import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJevCanary } from "./jev-canary.ts";
import {
  normalizeJevResponse,
  validateEvidence
} from "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts";

// Provider inference is deliberately a fixture here. The same canary runs with the
// actual TypeSafe provider in the hosted workflow and retains its real responses.
test("Git changes and PR claims reach semantic gate without an orchestrating model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shape-jev-flow-"));
  let calls = 0;
  try {
    const summary = await runJevCanary({
      directory,
      evaluate: async (value) => {
        calls++;
        const input = validateEvidence(value);
        expect(input.shapeContext.declarations.join("\n")).toContain("AppendOnly");
        expect(input.attestation?.rationale).toBeTruthy();
        const harmful = input.diff.files.some((file) =>
          /log\.length = 0|log\.splice\(0\)/.test(file.patch)
        );
        return normalizeJevResponse(input, {
          model: "fixture",
          answers: {
            semanticChange: {
              type: "choice",
              probabilities: {
                none: harmful ? 0 : 1,
                local: harmful ? 1 : 0,
                architectural: 0,
                uncertain: 0
              }
            },
            shapeUpdateRequirement: {
              type: "choice",
              probabilities: {
                required: harmful ? 1 : 0,
                not_required: harmful ? 0 : 1,
                uncertain: 0
              }
            },
            attestationAssessment: {
              type: "choice",
              probabilities: {
                supported: harmful ? 0 : 1,
                unsupported: harmful ? 1 : 0,
                uncertain: 0
              }
            }
          }
        });
      }
    });
    expect(calls).toBe(3);
    expect(summary.map((item) => item.exitCode)).toEqual([0, 1, 1]);
    expect(summary.every((item) => item.passed)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
