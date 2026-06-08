import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isRecord,
  parseJsonObjectCandidate,
  requireShapeReview,
  shapeReviewValidationErrors,
  writeGitHubOutput
} from "./shape-review-contract.mjs";

const resultPath = process.env.CLAUDE_SHAPE_REVIEW_RESULT_PATH ?? "claude-shape-review.json";

export function selectShapeReviewFromClaudeResult(result) {
  const candidates = [
    ["structured_output", isRecord(result) ? result.structured_output : undefined],
    ["result", isRecord(result) ? parseJsonObjectCandidate(result.result) : undefined],
    ["direct", result]
  ];

  const errors = [];
  for (const [source, value] of candidates) {
    const validationErrors = shapeReviewValidationErrors(value);
    if (validationErrors.length === 0) {
      return { ok: true, source, review: requireShapeReview(value, "Shape Claude review") };
    }
    if (value !== undefined) {
      errors.push(`${source}: ${validationErrors.join("; ")}`);
    }
  }

  return { ok: false, errors };
}

export function extractShapeReviewFromClaudeOutput(text) {
  let result;
  try {
    result = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Could not parse Claude JSON output: ${error}`] };
  }

  return selectShapeReviewFromClaudeResult(result);
}

export function debugClaudeOutput(result) {
  return {
    type: isRecord(result) ? result.type : undefined,
    subtype: isRecord(result) ? result.subtype : undefined,
    session_id: isRecord(result) ? result.session_id : undefined,
    keys: isRecord(result) ? Object.keys(result) : [],
    result_preview:
      isRecord(result) && typeof result.result === "string"
        ? result.result.slice(0, 4000)
        : undefined
  };
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  const rawOutput = readFileSync(resultPath, "utf8");
  let result;
  try {
    result = JSON.parse(rawOutput);
  } catch (error) {
    console.error(`Could not parse ${resultPath}: ${error}`);
    process.exit(1);
  }

  const selected = selectShapeReviewFromClaudeResult(result);
  if (!selected.ok) {
    console.error("Claude output did not include a valid Shape review object.");
    if (selected.errors.length > 0) {
      console.error(selected.errors.join("\n"));
    }
    console.error(JSON.stringify(debugClaudeOutput(result), null, 2));
    process.exit(1);
  }

  const structuredOutput = JSON.stringify(selected.review);
  console.log(`Claude structured output source: ${selected.source}`);
  console.log(`Claude structured output fields: ${Object.keys(selected.review).join(", ")}`);

  if (!writeGitHubOutput("structured_output", structuredOutput)) {
    console.log(structuredOutput);
  }
}
