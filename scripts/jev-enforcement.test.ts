import { expect, test } from "bun:test";
import {
  evaluateJev,
  normalizeJevResponse,
  validateEvidence,
  recommend,
  validateResult,
  QUESTIONS_V1
} from "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts";
const evidence = {
  version: 1,
  obligation: {
    id: `shp-obligation-${"a".repeat(64)}`,
    type: "shape-change-or-attestation",
    message: "Source changed",
    paths: ["src/a.ts"]
  },
  diff: { files: [{ path: "src/a.ts", patch: "-const x = 1\n+const y = 1" }] },
  shapeContext: { declarations: ["component App"], annotations: ["production"] },
  attestation: { kind: "no-shape-change", rationale: "Local rename" }
};
function response() {
  return {
    model: "jev-test",
    answers: {
      semanticChange: {
        type: "choice",
        probabilities: { none: 0.97, local: 0.01, architectural: 0.01, uncertain: 0.01 }
      },
      shapeUpdateRequirement: {
        type: "choice",
        probabilities: { required: 0.01, not_required: 0.98, uncertain: 0.01 }
      },
      attestationAssessment: {
        type: "choice",
        probabilities: { supported: 0.98, unsupported: 0.01, uncertain: 0.01 }
      }
    }
  };
}
test("actual HTTP boundary sends fixed questions and normalizes probabilities", async () => {
  let request: unknown;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      expect(req.headers.get("authorization")).toBe("Bearer test-key");
      request = await req.json();
      return Response.json(response());
    }
  });
  try {
    const result = await evaluateJev(evidence, {
      apiKey: "test-key",
      fetch: (url, init) => {
        expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
        return fetch(server.url, init);
      }
    });
    expect(request).toEqual({ model: "jev-latest", state: evidence, questions: QUESTIONS_V1 });
    expect(result.obligationId).toBe(evidence.obligation.id);
    expect(result.assessments.semanticChange.none).toBe(0.97);
    expect(recommend(result, 0.9)).toBe("attestation-candidate");
    result.assessments.shapeUpdateRequirement = {
      required: 0.95,
      not_required: 0.04,
      uncertain: 0.01
    };
    expect(recommend(result, 0.9)).toBe("shape-update");
    result.assessments.shapeUpdateRequirement = {
      required: 0.3,
      not_required: 0.4,
      uncertain: 0.3
    };
    expect(recommend(result, 0.9)).toBe("inspect");
  } finally {
    server.stop(true);
  }
});
test("missing claim omits plausibility assessment", async () => {
  const { attestation: _claim, ...withoutClaim } = evidence;
  const raw = response();
  const { attestationAssessment: _assessment, ...answers } = raw.answers;
  const result = normalizeJevResponse(validateEvidence(withoutClaim), { ...raw, answers });
  expect(result.assessments.attestationAssessment).toBeUndefined();
});
test("rejects missing labels, invalid numbers, and unnormalised distributions", () => {
  for (const probabilities of [
    { none: 1 },
    { none: 1, local: 0, architectural: -1, uncertain: 1 },
    { none: NaN, local: 0, architectural: 0, uncertain: 0 },
    { none: 0.5, local: 0, architectural: 0, uncertain: 0 },
    { none: 1, local: 0, architectural: 0, uncertain: 0, extra: 0 }
  ]) {
    const raw = response();
    Object.assign(raw.answers.semanticChange, { probabilities });
    expect(() => normalizeJevResponse(validateEvidence(evidence), raw)).toThrow();
  }
});
test("bounded evidence rejects unrelated paths, omissions and oversized inputs", () => {
  for (const input of [
    null,
    { ...evidence, version: 2 },
    { ...evidence, diff: { files: [] } },
    { ...evidence, diff: { files: [{ path: "other.ts", patch: "diff" }] } },
    { ...evidence, shapeContext: { declarations: ["é".repeat(40000)], annotations: [] } }
  ]) {
    expect(() => validateEvidence(input)).toThrow();
  }
});
test("unavailability and invalid responses remain distinct failures", async () => {
  await expect(evaluateJev(evidence)).rejects.toMatchObject({ code: "unavailable" });
  await expect(
    evaluateJev(evidence, {
      apiKey: "test",
      fetch: async () => new Response("no", { status: 429 })
    })
  ).rejects.toMatchObject({ code: "unavailable" });
  await expect(
    evaluateJev(evidence, { apiKey: "test", fetch: async () => new Response("bad JSON") })
  ).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    evaluateJev(evidence, {
      apiKey: "test",
      fetch: async () => {
        throw new Error("secret");
      }
    })
  ).rejects.toMatchObject({ code: "unavailable", message: "Jev request failed or timed out." });
});

test("stored results reject another obligation and invalid probabilities", () => {
  const result = normalizeJevResponse(validateEvidence(evidence), response());
  expect(validateResult(result, evidence.obligation.id)).toEqual(result);
  expect(() => validateResult(result, "other-id")).toThrow();
  expect(() => validateResult({ ...result, assessments: {} }, evidence.obligation.id)).toThrow();
});
