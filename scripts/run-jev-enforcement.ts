#!/usr/bin/env bun
/** Source-grounded semantic review, kept outside the deterministic checker. */
import { resolve, join } from "node:path";
import { rm } from "node:fs/promises";
import { assembleEvidence } from "./assemble-jev-evidence.ts";
import {
  evaluateJev,
  JevError
} from "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts";
import {
  readEnforcementContext,
  validateArtifacts,
  publishSemanticReport,
  semanticPolicy,
  type SemanticPolicy
} from "./validate-jev-artifacts.ts";

export async function runJevEnforcement(options: {
  directory: string;
  repoRoot: string;
  apiKey?: string;
  model?: string;
  policy: SemanticPolicy;
  evaluate?: typeof evaluateJev;
}) {
  const { transition, obligations, bundle, diagnostics } = await readEnforcementContext(
    options.directory
  );
  if (
    diagnostics.some(
      (item) =>
        typeof item !== "object" ||
        item === null ||
        !("kind" in item) ||
        item.kind !== "missing_shape_update"
    )
  )
    throw new Error("Fix non-attestable deterministic failures before requesting a Jev review.");
  const evaluate = options.evaluate ?? evaluateJev;
  for (const obligation of obligations) {
    const inputPath = join(options.directory, `${obligation.id}.input.json`);
    const resultPath = join(options.directory, `${obligation.id}.result.json`);
    // Reusing an output directory must never reuse a previous model verdict.
    await rm(inputPath, { force: true });
    await rm(resultPath, { force: true });
    try {
      if (obligations.length > 20)
        throw new JevError(
          "invalid_evidence",
          "More than 20 obligations; split this change or review the evidence manually."
        );
      const claim = bundle?.attestations.find((item) => item.obligation === obligation.id);
      const input = await assembleEvidence({
        repoRoot: options.repoRoot,
        transition,
        obligation,
        attestation: claim ? { kind: claim.kind, rationale: claim.rationale } : undefined
      });
      await Bun.write(inputPath, JSON.stringify(input, null, 2) + "\n");
      const result = await evaluate(input, { apiKey: options.apiKey, model: options.model });
      await Bun.write(resultPath, JSON.stringify(result, null, 2) + "\n");
    } catch (error) {
      await Bun.write(
        resultPath,
        JSON.stringify(
          {
            version: 1,
            obligationId: obligation.id,
            status: error instanceof JevError ? error.code : "invalid_evidence",
            message: error instanceof Error ? error.message : "Evidence assembly failed.",
            ...(error instanceof JevError && error.attemptFailures.length
              ? { attemptFailures: error.attemptFailures }
              : {})
          },
          null,
          2
        ) + "\n"
      );
    }
  }
  return publishSemanticReport(
    options.directory,
    await validateArtifacts(options.directory, options.policy.threshold),
    options.policy
  );
}

if (import.meta.main) {
  const directory = process.env.SHAPE_OUTPUT_DIR;
  if (!directory) throw new Error("SHAPE_OUTPUT_DIR is required.");
  const result = await runJevEnforcement({
    directory: resolve(directory),
    repoRoot: process.cwd(),
    apiKey: process.env.TYPESAFE_API_KEY,
    model: process.env.JEV_MODEL,
    policy: semanticPolicy(process.env)
  });
  process.exitCode = result.exitCode;
}
