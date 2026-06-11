// Shared harness for skill-driven CI reviews (shape-contract-guard,
// shape-index, future skills). A skill runner contributes prompts, allowed
// tools, and a result validator; this module owns the run -> validate ->
// normalize -> emit pipeline and the gate-script main. Result emission always
// goes through the strict validators in shape-skill-contract.mjs so model
// output can never reach GITHUB_OUTPUT unchecked.
import { appendFileSync, writeFileSync } from "node:fs";
import {
  claudeNormalizerArgs,
  JSON_ONLY_SYSTEM_PROMPT,
  loadJsonSchema,
  rawReviewTextForNormalizer,
  runClaude
} from "./run-claude-shape-review.mjs";
import { parseJsonText, writeGitHubOutput } from "./shape-review-contract.mjs";
import { requireValidResult, selectResultFromClaudeOutput } from "./shape-skill-contract.mjs";

export function emitSkillResult(label, source, result) {
  const structuredOutput = JSON.stringify(result);
  console.log(`Claude ${label} output source: ${source}`);
  if (!writeGitHubOutput("structured_output", structuredOutput)) {
    console.log(structuredOutput);
  }
  return result;
}

function skillReviewArgs(prompt, jsonSchema, allowedTools) {
  return [
    "-p",
    prompt,
    "--max-turns",
    "100",
    "--output-format",
    "json",
    "--append-system-prompt",
    JSON_ONLY_SYSTEM_PROMPT,
    "--allowedTools",
    allowedTools,
    "--disallowedTools",
    "Write,Edit",
    "--json-schema",
    jsonSchema
  ];
}

async function runClaudeOrThrow(args, resultPath, label) {
  const run = await runClaude(args);
  writeFileSync(resultPath, run.stdout);
  if (run.exitCode !== 0) {
    const detail = run.stderr.trim() || run.stdout.trim();
    throw new Error(`${label} failed with exit ${run.exitCode}${detail ? `: ${detail}` : ""}`);
  }
  return run.stdout;
}

/**
 * Run a skill review through Claude with a no-tools JSON normalizer fallback.
 *
 * skill: {
 *   label: short name used in log lines ("guard");
 *   title: human name used in errors ("Shape guard review");
 *   resultPath / normalizedResultPath: raw Claude output capture files;
 *   schemaPath: JSON schema enforced via --json-schema;
 *   allowedTools: comma-joined --allowedTools value;
 *   buildPrompt(): primary review prompt;
 *   buildNormalizerPrompt(rawText, jsonSchema): fallback conversion prompt;
 *   validationErrors(value): field-whitelist validator from shape-skill-contract.
 * }
 */
export async function runSkillReviewPipeline(skill) {
  const jsonSchema = loadJsonSchema(skill.schemaPath);

  const primaryOutput = await runClaudeOrThrow(
    skillReviewArgs(skill.buildPrompt(), jsonSchema, skill.allowedTools),
    skill.resultPath,
    `Claude ${skill.title}`
  );
  const primary = selectResultFromClaudeOutput(primaryOutput, skill.validationErrors);
  if (primary.ok) {
    return emitSkillResult(skill.label, primary.source, primary.result);
  }

  console.error(
    `Primary Claude ${skill.label} output was not structured JSON; retrying with a no-tools JSON normalizer.`
  );
  if (primary.errors.length > 0) {
    console.error(primary.errors.join("\n"));
  }

  const normalizedOutput = await runClaudeOrThrow(
    claudeNormalizerArgs(
      skill.buildNormalizerPrompt(rawReviewTextForNormalizer(primaryOutput), jsonSchema),
      jsonSchema
    ),
    skill.normalizedResultPath,
    `Claude ${skill.title} normalizer`
  );
  const normalized = selectResultFromClaudeOutput(normalizedOutput, skill.validationErrors);
  if (!normalized.ok) {
    throw new Error(
      `Claude ${skill.label} normalizer output did not include a valid ${skill.title} object: ${normalized.errors.join("; ")}`
    );
  }

  return emitSkillResult(skill.label, normalized.source, normalized.result);
}

/**
 * Main body for skill gate scripts. Reads the structured result from
 * CLAUDE_SKILL_RESULT, validates it, appends the rendered summary to
 * GITHUB_STEP_SUMMARY, and exits 1 when failureMessage reports a blocker.
 */
export function runSkillGate({
  title,
  validationErrors,
  renderSummary,
  failureMessage,
  nonBlockingNote
}) {
  const input = process.env.CLAUDE_SKILL_RESULT;
  if (!input) {
    console.error("CLAUDE_SKILL_RESULT is required.");
    process.exit(1);
  }

  let result;
  try {
    const parsed = parseJsonText(input, "CLAUDE_SKILL_RESULT");
    if (!parsed.ok) {
      throw new Error(parsed.errors.join("; "));
    }
    result = requireValidResult(parsed.value, validationErrors, title);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderSummary(result));
  }

  const failure = failureMessage(result, process.env);
  if (failure) {
    console.error(failure);
    process.exit(1);
  }

  const note = nonBlockingNote(result);
  if (note) {
    console.log(note);
  }
}
