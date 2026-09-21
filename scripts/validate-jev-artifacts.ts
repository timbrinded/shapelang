import { join } from "node:path";
import {
  validateEvidence,
  validateResult,
  recommend
} from "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts";
import { isRecord } from "../packages/shp-checker/src/attestations.ts";

export async function validateArtifacts(
  directory: string,
  threshold = 0.9
): Promise<{ obligationId: string; status: string; recommendation?: string; message?: string }[]> {
  if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold > 1)
    throw new Error("Threshold must be >0.5 and <=1.");
  const check: unknown = await Bun.file(join(directory, "deterministic.json")).json();
  if (!isRecord(check) || !Array.isArray(check.obligations))
    throw new Error("No machine-readable obligations from the deterministic check.");
  const statuses = [];
  for (const obligation of check.obligations) {
    if (
      !isRecord(obligation) ||
      typeof obligation.id !== "string" ||
      !/^shp-obligation-[a-f0-9]{64}$/.test(obligation.id)
    )
      throw new Error("Invalid obligation identity.");
    const id = obligation.id;
    try {
      const input = validateEvidence(await Bun.file(join(directory, `${id}.input.json`)).json());
      if (
        input.obligation.id !== id ||
        JSON.stringify(input.obligation.paths) !== JSON.stringify(obligation.paths)
      )
        throw new Error("Evidence obligation mismatch.");
      const value: unknown = await Bun.file(join(directory, `${id}.result.json`)).json();
      if (
        isRecord(value) &&
        ["unavailable", "invalid_evidence", "invalid_response"].includes(String(value.status))
      ) {
        statuses.push({ obligationId: id, status: String(value.status) });
        continue;
      }
      const result = validateResult(value, id);
      if (Boolean(input.attestation) !== Boolean(result.assessments.attestationAssessment))
        throw new Error("Missing or unexpected plausibility assessment.");
      statuses.push({
        obligationId: id,
        status: "evaluated",
        recommendation: recommend(result, threshold)
      });
    } catch (error) {
      statuses.push({
        obligationId: id,
        status: "invalid_or_missing",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return statuses;
}
if (import.meta.main) {
  const directory = process.env.SHAPE_OUTPUT_DIR;
  if (!directory) throw new Error("SHAPE_OUTPUT_DIR is required.");
  const policy = process.env.JEV_FAILURE_POLICY ?? "warn";
  if (!["warn", "fail"].includes(policy))
    throw new Error("JEV_FAILURE_POLICY must be warn or fail.");
  const threshold = Number(process.env.JEV_THRESHOLD ?? "0.9");
  const statuses = await validateArtifacts(directory, threshold);
  const result = { version: 1, threshold, failurePolicy: policy, evaluations: statuses };
  await Bun.write(join(directory, "semantic-summary.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (policy === "fail" && statuses.some((item) => item.status !== "evaluated"))
    process.exitCode = 1;
}
