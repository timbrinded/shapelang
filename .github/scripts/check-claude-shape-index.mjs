// Gate for the shape-index coverage audit. Gaps are authoring debt, not a PR
// defect, so the job stays green on gaps unless SHAPE_INDEX_STRICT=true; only
// an audit error (or strict-mode gaps) fails.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonText } from "./shape-review-contract.mjs";
import { requireValidResult, shapeIndexValidationErrors } from "./shape-skill-contract.mjs";

export function parseIndexInput(input, source) {
  const parsed = parseJsonText(input, source);
  if (!parsed.ok) {
    throw new Error(parsed.errors.join("; "));
  }
  return requireValidResult(parsed.value, shapeIndexValidationErrors, source);
}

export function renderIndexSummary(result) {
  const lines = [
    "## Shape Index Coverage",
    "",
    `Status: \`${result.status}\``,
    "",
    result.summary,
    ""
  ];
  for (const gap of result.gaps) {
    lines.push(
      `- **${gap.subsystem}** (${gap.files.length} file(s)): ${gap.why_significant}`,
      `  - Suggested shapes: ${gap.suggested_shapes}`
    );
  }
  if (result.gaps.length > 0) {
    lines.push("");
  }
  return lines.join("\n");
}

export function indexFailureMessage(result, env = process.env) {
  if (result.status === "pass" && result.gaps.length > 0) {
    return "Invalid Shape index result: pass status cannot include gaps.";
  }
  if (result.status === "error") {
    return JSON.stringify(result, null, 2);
  }
  if (result.status === "gaps" && env.SHAPE_INDEX_STRICT === "true") {
    return [
      `Shape index audit found ${result.gaps.length} coverage gap(s) and SHAPE_INDEX_STRICT is enabled:`,
      JSON.stringify(result.gaps, null, 2)
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
  const input = process.env.CLAUDE_SHAPE_INDEX_RESULT;
  if (!input) {
    console.error("CLAUDE_SHAPE_INDEX_RESULT is required.");
    process.exit(1);
  }

  let result;
  try {
    result = parseIndexInput(input, "CLAUDE_SHAPE_INDEX_RESULT");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderIndexSummary(result));
  }

  const failureMessage = indexFailureMessage(result);
  if (failureMessage) {
    console.error(failureMessage);
    process.exit(1);
  }

  if (result.gaps.length > 0) {
    console.log(`Advisory index coverage gaps (non-blocking): ${result.gaps.length}`);
  }
}
