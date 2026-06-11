// Gate for the shape-contract-guard CI review. Guard findings are advisory by
// design; only high-severity findings (or a review error) fail the job.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonText } from "./shape-review-contract.mjs";
import { requireValidResult, shapeGuardValidationErrors } from "./shape-skill-contract.mjs";

export function parseGuardInput(input, source) {
  const parsed = parseJsonText(input, source);
  if (!parsed.ok) {
    throw new Error(parsed.errors.join("; "));
  }
  return requireValidResult(parsed.value, shapeGuardValidationErrors, source);
}

export function renderGuardSummary(result) {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const finding of result.findings) {
    bySeverity[finding.severity] += 1;
  }
  return [
    "## Shape Contract Guard",
    "",
    `Status: \`${result.status}\``,
    "",
    result.summary,
    "",
    `Findings: ${result.findings.length} (high: ${bySeverity.high}, medium: ${bySeverity.medium}, low: ${bySeverity.low})`,
    ""
  ].join("\n");
}

export function guardFailureMessage(result) {
  if (result.status === "pass" && result.findings.length > 0) {
    return "Invalid Shape guard result: pass status cannot include findings.";
  }
  if (result.status === "error") {
    return JSON.stringify(result, null, 2);
  }

  const highFindings = result.findings.filter((finding) => finding.severity === "high");
  if (highFindings.length > 0) {
    return [
      `Shape contract guard reported ${highFindings.length} high-severity finding(s):`,
      JSON.stringify(highFindings, null, 2)
    ].join("\n");
  }

  return undefined;
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  const input = process.env.CLAUDE_SHAPE_GUARD_RESULT;
  if (!input) {
    console.error("CLAUDE_SHAPE_GUARD_RESULT is required.");
    process.exit(1);
  }

  let result;
  try {
    result = parseGuardInput(input, "CLAUDE_SHAPE_GUARD_RESULT");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderGuardSummary(result));
  }

  const failureMessage = guardFailureMessage(result);
  if (failureMessage) {
    console.error(failureMessage);
    process.exit(1);
  }

  if (result.findings.length > 0) {
    console.log(`Advisory guard findings (non-blocking): ${result.findings.length}`);
  }
}
