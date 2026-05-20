import { appendFileSync, readFileSync } from "node:fs";

const resultPath = process.env.COPILOT_SHAPE_REVIEW_RESULT ?? "copilot-shape-review.json";
let review;

try {
  review = JSON.parse(readFileSync(resultPath, "utf8"));
} catch (error) {
  console.error(`Could not parse ${resultPath}: ${error}`);
  process.exit(1);
}

const validStatuses = new Set(["pass", "drift", "error"]);
if (review === null || typeof review !== "object" || Array.isArray(review)) {
  console.error("Invalid Shape Copilot review: result must be a JSON object.");
  process.exit(1);
}

if (!validStatuses.has(review.status)) {
  console.error(`Invalid Shape Copilot review status: ${review?.status}`);
  process.exit(1);
}

if (typeof review.summary !== "string") {
  console.error("Invalid Shape Copilot review: summary must be a string.");
  process.exit(1);
}

if (!Array.isArray(review.findings)) {
  console.error("Invalid Shape Copilot review: findings must be an array.");
  process.exit(1);
}

const summary = review.summary;
const findings = review.findings;

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Shape Copilot Review",
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
  console.error("Invalid Shape Copilot review: pass status cannot include findings.");
  console.error(JSON.stringify(review, null, 2));
  process.exit(1);
}

if (review.status !== "pass") {
  console.error(JSON.stringify(review, null, 2));
  process.exit(1);
}
