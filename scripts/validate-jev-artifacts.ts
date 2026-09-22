import { join } from "node:path";
import {
  validateEvidence,
  validateResult,
  recommend,
  type EnforcementInputV1,
  type EnforcementResultV1
} from "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts";
import {
  isRecord,
  parseAttestationBundle,
  type CheckTransition
} from "../packages/shp-checker/src/attestations.ts";

export type SemanticEvaluation = {
  obligationId: string;
  paths: string[];
  status: string;
  recommendation?: string;
  contradiction?: boolean;
  model?: string;
  assessments?: EnforcementResultV1["assessments"];
  message?: string;
};
export type SemanticPolicy = {
  threshold: number;
  failurePolicy: "warn" | "fail";
  reviewPolicy: "warn" | "fail";
};

export function semanticPolicy(env: Record<string, string | undefined>): SemanticPolicy {
  const threshold = Number(env.JEV_THRESHOLD ?? "0.9");
  const failurePolicy = env.JEV_FAILURE_POLICY ?? "warn";
  const reviewPolicy = env.JEV_REVIEW_POLICY ?? "warn";
  if (!Number.isFinite(threshold) || threshold <= 0.5 || threshold > 1)
    throw new Error("Threshold must be >0.5 and <=1.");
  if (failurePolicy !== "warn" && failurePolicy !== "fail")
    throw new Error("JEV_FAILURE_POLICY must be warn or fail.");
  if (reviewPolicy !== "warn" && reviewPolicy !== "fail")
    throw new Error("JEV_REVIEW_POLICY must be warn or fail.");
  return { threshold, failurePolicy, reviewPolicy };
}

/** The initial check retains obligations which a PR attestation later satisfies. */
export async function readEnforcementContext(directory: string) {
  const check: unknown = await Bun.file(join(directory, "deterministic.json")).json();
  if (
    !isRecord(check) ||
    !isRecord(check.transition) ||
    ![check.transition.base, check.transition.head].every(
      (value) => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
    ) ||
    !Array.isArray(check.obligations) ||
    !Array.isArray(check.diagnostics)
  )
    throw new Error(
      "No exact transition and machine-readable obligations from the deterministic check."
    );
  const transition = check.transition as CheckTransition;
  const obligations: EnforcementInputV1["obligation"][] = [];
  for (const value of check.obligations) {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !/^shp-obligation-[a-f0-9]{64}$/.test(value.id) ||
      value.type !== "shape-change-or-attestation" ||
      typeof value.message !== "string" ||
      !Array.isArray(value.paths) ||
      value.paths.length === 0 ||
      !value.paths.every((path) => typeof path === "string" && path.length > 0) ||
      obligations.some((item) => item.id === value.id)
    )
      throw new Error("Invalid or duplicate obligation identity.");
    obligations.push(value as EnforcementInputV1["obligation"]);
  }
  const bundleFile = Bun.file(join(directory, "attestations.json"));
  const bundle = (await bundleFile.exists())
    ? parseAttestationBundle(await bundleFile.json())
    : undefined;
  if (bundle && (bundle.base !== transition.base || bundle.head !== transition.head))
    throw new Error("Attestation base/head does not match the semantic review transition.");
  if (
    bundle?.attestations.some((claim) => !obligations.some((item) => item.id === claim.obligation))
  )
    throw new Error("Attestation refers to an unknown semantic review obligation.");
  return { transition, obligations, bundle, diagnostics: check.diagnostics };
}

export async function validateArtifacts(
  directory: string,
  threshold = 0.9
): Promise<SemanticEvaluation[]> {
  semanticPolicy({ JEV_THRESHOLD: String(threshold) });
  const { obligations, bundle } = await readEnforcementContext(directory);
  const statuses: SemanticEvaluation[] = [];
  for (const obligation of obligations) {
    const id = obligation.id;
    const identity = { obligationId: id, paths: obligation.paths };
    try {
      const value: unknown = await Bun.file(join(directory, `${id}.result.json`)).json();
      if (
        isRecord(value) &&
        ["unavailable", "invalid_evidence", "invalid_response"].includes(String(value.status))
      ) {
        statuses.push({
          ...identity,
          status: String(value.status),
          message: typeof value.message === "string" ? value.message : undefined
        });
        continue;
      }
      const input = validateEvidence(await Bun.file(join(directory, `${id}.input.json`)).json());
      if (
        input.obligation.id !== id ||
        input.obligation.type !== obligation.type ||
        input.obligation.message !== obligation.message ||
        JSON.stringify(input.obligation.paths) !== JSON.stringify(obligation.paths)
      )
        throw new Error("Evidence obligation mismatch.");
      const claim = bundle?.attestations.find((item) => item.obligation === id);
      if (
        input.attestation?.rationale !== claim?.rationale ||
        input.attestation?.kind !== claim?.kind
      )
        throw new Error("Evidence claim does not match the current PR attestation.");
      const result = validateResult(value, id);
      if (Boolean(input.attestation) !== Boolean(result.assessments.attestationAssessment))
        throw new Error("Missing or unexpected plausibility assessment.");
      statuses.push({
        ...identity,
        status: "evaluated",
        recommendation: recommend(result, threshold),
        // Scope alone is not proof that the supplied model or claim is wrong.
        contradiction:
          result.assessments.shapeUpdateRequirement.required >= threshold ||
          (result.assessments.attestationAssessment?.unsupported ?? 0) >= threshold,
        model: result.model,
        assessments: result.assessments
      });
    } catch (error) {
      statuses.push({
        ...identity,
        status: "invalid_or_missing",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return statuses;
}

export function semanticExitCode(
  evaluations: SemanticEvaluation[],
  policy: SemanticPolicy
): number {
  return evaluations.some(
    (item) =>
      (policy.failurePolicy === "fail" && item.status !== "evaluated") ||
      (policy.reviewPolicy === "fail" && item.contradiction)
  )
    ? 1
    : 0;
}

export async function publishSemanticReport(
  directory: string,
  evaluations: SemanticEvaluation[],
  policy: SemanticPolicy
) {
  const exitCode = semanticExitCode(evaluations, policy);
  const lines = [
    `Jev semantic review: ${exitCode ? "failed" : evaluations.length ? "completed" : "no coverage obligations"}`,
    `Threshold: ${policy.threshold}; contradictions: ${policy.reviewPolicy}; provider/evidence failures: ${policy.failurePolicy}.`,
    "Jev reviews source against authored claims. Its probabilities do not certify correctness or clear deterministic failures.",
    ...(evaluations.length
      ? []
      : ["No provider calls were needed. This is not a semantic review of the whole PR."])
  ];
  for (const item of evaluations) {
    lines.push(
      "",
      `${item.paths.join(", ")}: ${item.recommendation ?? item.status}`,
      `Obligation: ${item.obligationId}`
    );
    if (item.model) lines.push(`Model: ${item.model}`);
    if (item.assessments) lines.push(`Assessments: ${JSON.stringify(item.assessments)}`);
    if (item.message) lines.push(item.message);
    if (item.contradiction)
      lines.push(
        "Action: update the authored Shape claims or correct the implementation/attestation; the supplied evidence contradicts the claim."
      );
    else if (item.recommendation === "attestation-candidate")
      lines.push(
        "Action: inspect the evidence and provide a specific attestation if the model remains faithful. Nothing is auto-approved."
      );
    else if (item.status === "evaluated")
      lines.push(
        "Action: inspect the evidence. Jev has not established a high-confidence contradiction."
      );
    else
      lines.push(
        "Action: repair the provider/evidence failure and rerun. No semantic verdict was obtained."
      );
  }
  const text = lines.join("\n") + "\n";
  const fence = "`".repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1))
  );
  const markdown = `## Jev semantic review\n\n${fence}text\n${text}${fence}\n\nExact inputs, provider results and retry diagnostics are retained in the workflow artifact.\n`;
  const result = { version: 1, ...policy, exitCode, evaluations };
  await Bun.write(join(directory, "semantic-summary.json"), JSON.stringify(result, null, 2) + "\n");
  await Bun.write(join(directory, "recommendations.md"), markdown);
  if (process.env.GITHUB_ACTIONS === "true") {
    const token = crypto.randomUUID();
    process.stdout.write(`::stop-commands::${token}\n${text}::${token}::\n`);
    const escape = (value: string) =>
      value
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A")
        .replaceAll(",", "%2C")
        .replaceAll(":", "%3A");
    for (const item of evaluations.filter(
      (item) =>
        item.contradiction ||
        item.status !== "evaluated" ||
        item.recommendation !== "attestation-candidate"
    )) {
      const blocking = semanticExitCode([item], policy) !== 0;
      const file = item.paths[0];
      process.stdout.write(
        `::${blocking ? "error" : "warning"} title=Jev semantic review${file ? `,file=${escape(file)}` : ""}::${escape(`${item.recommendation ?? item.status}. ${item.message ?? "Inspect the evidence and recommendation in the job summary."}`)}\n`
      );
    }
  } else process.stdout.write(text);
  return result;
}

if (import.meta.main) {
  const directory = process.env.SHAPE_OUTPUT_DIR;
  if (!directory) throw new Error("SHAPE_OUTPUT_DIR is required.");
  const policy = semanticPolicy(process.env);
  const result = await publishSemanticReport(
    directory,
    await validateArtifacts(directory, policy.threshold),
    policy
  );
  process.exitCode = result.exitCode;
}
