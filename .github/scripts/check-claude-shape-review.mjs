import { appendFileSync, readFileSync } from "node:fs";

const resultPath = process.env.CLAUDE_SHAPE_REVIEW_RESULT_PATH ?? "claude-shape-review.json";
const resultJson = process.env.CLAUDE_SHAPE_REVIEW_RESULT;
let review;

try {
  review = JSON.parse(resultJson ?? readFileSync(resultPath, "utf8"));
} catch (error) {
  const source = resultJson === undefined ? resultPath : "CLAUDE_SHAPE_REVIEW_RESULT";
  console.error(`Could not parse ${source}: ${error}`);
  process.exit(1);
}

const validStatuses = new Set(["pass", "drift", "error"]);
if (review === null || typeof review !== "object" || Array.isArray(review)) {
  console.error("Invalid Shape Claude review: result must be a JSON object.");
  process.exit(1);
}

if (!validStatuses.has(review.status)) {
  console.error(`Invalid Shape Claude review status: ${review?.status}`);
  process.exit(1);
}

if (typeof review.summary !== "string") {
  console.error("Invalid Shape Claude review: summary must be a string.");
  process.exit(1);
}

if (!Array.isArray(review.findings)) {
  console.error("Invalid Shape Claude review: findings must be an array.");
  process.exit(1);
}

const summary = review.summary;
const findings = review.findings;

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Shape Claude Review",
      "",
      `Status: \`${review.status}\``,
      "",
      summary,
      "",
      findings.length > 0 ? `Findings: ${findings.length}` : "Findings: 0",
      ""
    ].join("\n")
  );
}

if (review.status === "pass" && findings.length > 0) {
  console.error("Invalid Shape Claude review: pass status cannot include findings.");
  console.error(JSON.stringify(review, null, 2));
  process.exit(1);
}

if (review.status !== "pass") {
  console.error(JSON.stringify(review, null, 2));
  process.exit(1);
}
