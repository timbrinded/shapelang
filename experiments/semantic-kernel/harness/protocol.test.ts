import { describe, expect, test } from "bun:test";
import { parseKernelResponseV1 } from "./protocol.ts";

const candidateCause = {
  role: "candidate_effect",
  provenance: { label: "candidate effect Candidate" }
};
const anchorCause = {
  role: "anchor",
  provenance: { label: "resource Anchor" }
};
const actualCause = {
  role: "actual_fingerprint",
  provenance: { label: "resource Anchor fingerprint" }
};

function responseJson(causes: readonly unknown[], actual?: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    ok: false,
    diagnostics: [
      {
        kind: "candidate_pin_fingerprint_mismatch",
        candidateEffect: "module::Candidate",
        anchor: "module::Anchor",
        provider: "ast.semantic_subtree_v1",
        expected: "sha256:expected",
        ...(actual === undefined ? {} : { actual }),
        causes
      }
    ]
  });
}

describe("semantic kernel protocol v1", () => {
  test("accepts the exact cause sequence for missing and stale fingerprints", () => {
    expect(
      parseKernelResponseV1(responseJson([candidateCause, anchorCause])).diagnostics[0]?.causes
    ).toHaveLength(2);
    expect(
      parseKernelResponseV1(
        responseJson([candidateCause, anchorCause, actualCause], "sha256:actual")
      ).diagnostics[0]?.causes
    ).toHaveLength(3);
  });

  test("rejects missing, reversed, and actual-inconsistent cause sequences", () => {
    const invalidResponses = [
      responseJson([]),
      responseJson([anchorCause, candidateCause]),
      responseJson([candidateCause, anchorCause, actualCause]),
      responseJson([candidateCause, anchorCause], "sha256:actual")
    ];

    for (const invalid of invalidResponses) {
      expect(() => parseKernelResponseV1(invalid)).toThrow(
        "The semantic kernel returned an invalid protocol-v1 response."
      );
    }
  });
});
