import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonText, requireShapeReview } from "./shape-review-contract.mjs";

const resultPath = process.env.CLAUDE_SHAPE_REVIEW_RESULT_PATH ?? "claude-shape-review.json";
const resultJson = process.env.CLAUDE_SHAPE_REVIEW_RESULT;

export function renderReviewSummary(review) {
  return [
    "## Shape Claude Review",
    "",
    `Status: \`${review.status}\``,
    "",
    review.summary,
    "",
    review.findings.length > 0 ? `Findings: ${review.findings.length}` : "Findings: 0",
    ""
  ].join("\n");
}

export function parseReviewInput(input, source) {
  const parsed = parseJsonText(input, source);
  if (!parsed.ok) {
    throw new Error(parsed.errors.join("; "));
  }
  return requireShapeReview(parsed.value, "Shape Claude review");
}

export function readReviewFromEnvironment(env = process.env) {
  if (env.CLAUDE_SHAPE_REVIEW_RESULT !== undefined) {
    return parseReviewInput(env.CLAUDE_SHAPE_REVIEW_RESULT, "CLAUDE_SHAPE_REVIEW_RESULT");
  }

  const path = env.CLAUDE_SHAPE_REVIEW_RESULT_PATH ?? "claude-shape-review.json";
  return parseReviewInput(readFileSync(path, "utf8"), path);
}

export function reviewFailureMessage(review) {
  if (review.status === "pass" && review.findings.length > 0) {
    return "Invalid Shape Claude review: pass status cannot include findings.";
  }

  if (review.status !== "pass") {
    return JSON.stringify(review, null, 2);
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
  let review;
  try {
    review =
      resultJson === undefined
        ? readReviewFromEnvironment()
        : parseReviewInput(resultJson, "CLAUDE_SHAPE_REVIEW_RESULT");
  } catch (error) {
    const source = resultJson === undefined ? resultPath : "CLAUDE_SHAPE_REVIEW_RESULT";
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      message.startsWith("Could not parse") || message.startsWith("Invalid")
        ? message
        : `Could not parse ${source}: ${message}`
    );
    process.exit(1);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderReviewSummary(review));
  }

  const failureMessage = reviewFailureMessage(review);
  if (failureMessage) {
    console.error(failureMessage);
    process.exit(1);
  }
}
