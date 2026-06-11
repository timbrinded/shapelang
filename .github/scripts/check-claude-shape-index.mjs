// Gate for the shape-index coverage audit. Gaps are authoring debt, not a PR
// defect, so the job stays green on gaps unless SHAPE_INDEX_STRICT=true; only
// an audit error (or strict-mode gaps) fails.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSkillGate } from "./claude-skill-pipeline.mjs";
import { shapeIndexValidationErrors } from "./shape-skill-contract.mjs";

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
  runSkillGate({
    title: "Shape index result",
    validationErrors: shapeIndexValidationErrors,
    renderSummary: renderIndexSummary,
    failureMessage: indexFailureMessage,
    nonBlockingNote: (result) =>
      result.gaps.length > 0
        ? `Advisory index coverage gaps (non-blocking): ${result.gaps.length}`
        : undefined
  });
}
