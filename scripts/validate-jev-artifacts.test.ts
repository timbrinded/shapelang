import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateArtifacts,
  semanticExitCode,
  semanticPolicy,
  publishSemanticReport
} from "./validate-jev-artifacts.ts";

test("artifact gate reports missing, unavailable, invalid and uncertain enrichment separately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shape-jev-gate-"));
  const id = `shp-obligation-${"a".repeat(64)}`;
  const obligation = {
    id,
    type: "shape-change-or-attestation",
    message: "Changed",
    paths: ["a.ts"]
  };
  try {
    await Bun.write(
      join(directory, "deterministic.json"),
      JSON.stringify({
        transition: { base: "b".repeat(40), head: "c".repeat(40) },
        diagnostics: [],
        obligations: [obligation],
        ok: false,
        exitCode: 1
      })
    );
    expect((await validateArtifacts(directory))[0]?.status).toBe("invalid_or_missing");
    await Bun.write(
      join(directory, `${id}.input.json`),
      JSON.stringify({
        version: 1,
        obligation,
        diff: { files: [{ path: "a.ts", patch: "diff" }] },
        shapeContext: { declarations: ["component App"], annotations: [] }
      })
    );
    for (const status of ["unavailable", "invalid_response", "invalid_evidence"]) {
      await Bun.write(join(directory, `${id}.result.json`), JSON.stringify({ version: 1, status }));
      expect((await validateArtifacts(directory))[0]?.status).toBe(status);
    }
    const result = {
      version: 1,
      obligationId: id,
      questionContract: "v1",
      provider: "typesafe",
      model: "jev-fixture",
      assessments: {
        semanticChange: { none: 0.4, local: 0.2, architectural: 0.2, uncertain: 0.2 },
        shapeUpdateRequirement: { required: 0.2, not_required: 0.4, uncertain: 0.4 }
      }
    };
    await Bun.write(join(directory, `${id}.result.json`), JSON.stringify(result));
    expect((await validateArtifacts(directory))[0]).toMatchObject({
      status: "evaluated",
      recommendation: "inspect",
      contradiction: false
    });
    const policy = semanticPolicy({ JEV_REVIEW_POLICY: "fail", JEV_FAILURE_POLICY: "fail" });
    expect(semanticExitCode(await validateArtifacts(directory), policy)).toBe(0);
    // Architectural scope alone must not be treated as a contradicted model.
    result.assessments.semanticChange = { none: 0, local: 0, architectural: 1, uncertain: 0 };
    result.assessments.shapeUpdateRequirement = { required: 0, not_required: 1, uncertain: 0 };
    await Bun.write(join(directory, `${id}.result.json`), JSON.stringify(result));
    expect(semanticExitCode(await validateArtifacts(directory), policy)).toBe(0);
    result.assessments.shapeUpdateRequirement = { required: 1, not_required: 0, uncertain: 0 };
    await Bun.write(join(directory, `${id}.result.json`), JSON.stringify(result));
    const contradicted = await validateArtifacts(directory);
    expect(semanticExitCode(contradicted, policy)).toBe(1);
    expect(semanticExitCode(contradicted, { ...policy, reviewPolicy: "warn" })).toBe(0);
    const report = await publishSemanticReport(directory, contradicted, policy);
    expect(report.exitCode).toBe(1);
    expect(await Bun.file(join(directory, "recommendations.md")).text()).toContain(
      "correct the implementation/attestation"
    );
    // Provider failure and semantic contradiction use independent policies.
    const unavailable = [{ obligationId: id, paths: ["a.ts"], status: "unavailable" }];
    expect(semanticExitCode(unavailable, { ...policy, failurePolicy: "warn" })).toBe(0);
    expect(semanticExitCode(unavailable, policy)).toBe(1);
    // A forged claim must never stand in for the actual PR rationale.
    const input = await Bun.file(join(directory, `${id}.input.json`)).json();
    await Bun.write(
      join(directory, `${id}.input.json`),
      JSON.stringify({ ...input, attestation: { kind: "no-shape-change", rationale: "forged" } })
    );
    expect((await validateArtifacts(directory))[0]?.status).toBe("invalid_or_missing");
    await Bun.write(join(directory, `${id}.input.json`), JSON.stringify(input));
    await expect(validateArtifacts(directory, 0.1)).rejects.toThrow();
    await Bun.write(
      join(directory, `${id}.result.json`),
      JSON.stringify({ ...result, obligationId: "other" })
    );
    expect((await validateArtifacts(directory))[0]?.status).toBe("invalid_or_missing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
