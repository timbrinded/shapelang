import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("retries rejected probabilities once without changing the evidence or repairing the answer", async () => {
  const requests: RequestInit[] = [];
  const rejected = response();
  rejected.answers.semanticChange.probabilities.none = 0.96;
  const result = await evaluateJev(evidence, {
    apiKey: "secret-key",
    fetch: async (_url, init) => {
      requests.push(init);
      return Response.json(requests.length === 1 ? rejected : response());
    }
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]?.body).toBe(requests[1]?.body);
  expect(requests[0]?.signal).toBe(requests[1]?.signal);
  expect(result.assessments.semanticChange).toEqual(
    response().answers.semanticChange.probabilities
  );
  expect(result.attemptFailures).toHaveLength(1);
  expect(result.attemptFailures?.[0]).toMatchObject({
    attempt: 1,
    code: "invalid_response",
    distribution: {
      question: "semanticChange",
      probabilities: rejected.answers.semanticChange.probabilities,
      sum: 0.99,
      unexpectedLabels: 0
    }
  });
});

test("persistent invalid distributions stop after two requests and retain both failures", async () => {
  let calls = 0;
  const raw = response();
  raw.answers.shapeUpdateRequirement.probabilities.required = 0.2;
  await expect(
    evaluateJev(evidence, {
      apiKey: "secret-key",
      fetch: async () => {
        calls++;
        return Response.json(raw);
      }
    })
  ).rejects.toMatchObject({
    code: "invalid_response",
    attemptFailures: [
      { attempt: 1, distribution: { question: "shapeUpdateRequirement", sum: 1.19 } },
      { attempt: 2, distribution: { question: "shapeUpdateRequirement", sum: 1.19 } }
    ]
  });
  expect(calls).toBe(2);
});

test("diagnostics retain fixed numeric labels without provider strings or unknown keys", async () => {
  const raw = response();
  Object.assign(raw.answers.semanticChange, {
    probabilities: {
      none: "secret-key",
      local: -0.2,
      architectural: null,
      uncertain: 0.2,
      "secret-key": 1
    }
  });
  try {
    await evaluateJev(evidence, {
      apiKey: "secret-key",
      fetch: async () => Response.json(raw)
    });
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toMatchObject({
      code: "invalid_response",
      details: {
        distribution: {
          probabilities: { none: null, local: -0.2, architectural: null, uncertain: 0.2 },
          sum: null,
          unexpectedLabels: 1
        }
      }
    });
    expect(JSON.stringify(error)).not.toContain("secret-key");
  }
});

test("transient HTTP errors retry but permanent authentication and input errors do not", async () => {
  for (const status of [408, 429, 503, 529, 401, 403, 422]) {
    let calls = 0;
    const result = evaluateJev(evidence, {
      apiKey: "secret-key",
      fetch: async () => {
        calls++;
        return calls === 1 ? new Response("secret-key", { status }) : Response.json(response());
      }
    });
    if ([408, 429, 503, 529].includes(status)) {
      expect((await result).attemptFailures).toMatchObject([{ attempt: 1, httpStatus: status }]);
      expect(calls).toBe(2);
    } else {
      await expect(result).rejects.toMatchObject({
        code: "unavailable",
        attemptFailures: [{ httpStatus: status }]
      });
      expect(calls).toBe(1);
    }
  }
});

test("a completed uncertain decision is never retried to seek a stronger recommendation", async () => {
  let calls = 0;
  const raw = response();
  raw.answers.semanticChange.probabilities = {
    none: 0.25,
    local: 0.25,
    architectural: 0.25,
    uncertain: 0.25
  };
  const result = await evaluateJev(evidence, {
    apiKey: "test-key",
    fetch: async () => {
      calls++;
      return Response.json(raw);
    }
  });
  expect(calls).toBe(1);
  expect(result.attemptFailures).toBeUndefined();
  expect(recommend(result, 0.9)).toBe("inspect");
});

test("the shared deadline stops retries and classifies interrupted response bodies as unavailable", async () => {
  const controller = new AbortController();
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  let calls = 0;
  try {
    await expect(
      evaluateJev(evidence, {
        apiKey: "test-key",
        fetch: async () => {
          calls++;
          controller.abort();
          return new Response("interrupted body");
        }
      })
    ).rejects.toMatchObject({ code: "unavailable", attemptFailures: [{ attempt: 1 }] });
    expect(calls).toBe(1);
    expect(timeout).toHaveBeenCalledWith(30_000);
  } finally {
    timeout.mockRestore();
  }
});

test("the helper CLI writes rejected probability evidence for recovered and exhausted retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-artifacts-"));
  const input = join(directory, "input.json");
  const output = join(directory, "result.json");
  const preload = join(directory, "provider.ts");
  const rejected = response();
  rejected.answers.semanticChange.probabilities.none = 0.96;
  try {
    await Bun.write(input, JSON.stringify(evidence));
    for (const recover of [false, true]) {
      await Bun.write(
        preload,
        `let calls = 0; globalThis.fetch = async () => Response.json(++calls === 2 && ${recover} ? ${JSON.stringify(response())} : ${JSON.stringify(rejected)});`
      );
      const child = Bun.spawn(
        [
          process.execPath,
          "--preload",
          preload,
          join(
            import.meta.dir,
            "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts"
          ),
          input,
          output
        ],
        { env: { ...process.env, TYPESAFE_API_KEY: "secret-key" }, stdout: "pipe", stderr: "pipe" }
      );
      expect(await child.exited).toBe(recover ? 0 : 1);
      const artifact = await Bun.file(output).json();
      expect(artifact.attemptFailures).toHaveLength(recover ? 1 : 2);
      expect(artifact.attemptFailures[0].distribution).toMatchObject({
        question: "semanticChange",
        sum: 0.99
      });
      expect(JSON.stringify(artifact)).not.toContain("secret-key");
      if (recover)
        expect(
          validateResult(artifact, evidence.obligation.id).assessments.semanticChange.none
        ).toBe(0.97);
      else expect(artifact.status).toBe("invalid_response");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized provider responses are cancelled and never copied to failure artifacts", async () => {
  let cancelled = 0;
  await expect(
    evaluateJev(evidence, {
      apiKey: "secret-key",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("secret-key".repeat(7000)));
            },
            cancel() {
              cancelled++;
            }
          })
        )
    })
  ).rejects.toMatchObject({
    code: "invalid_response",
    message: "Jev response exceeds 64 KiB.",
    attemptFailures: [{ attempt: 1 }, { attempt: 2 }]
  });
  expect(cancelled).toBe(2);
});
