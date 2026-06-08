import { appendFileSync, readFileSync } from "node:fs";

const resultPath = process.env.CLAUDE_SHAPE_REVIEW_RESULT_PATH ?? "claude-shape-review.json";

const parseJsonValue = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidates.push(value.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }

  return undefined;
};

const isShapeReview = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof value.status === "string" &&
  typeof value.summary === "string" &&
  Array.isArray(value.findings);

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const candidates = [
  ["structured_output", result.structured_output],
  ["result", parseJsonValue(result.result)],
  ["direct", result]
];

const selected = candidates.find(([, value]) => isShapeReview(value));
if (!selected) {
  console.error("Claude output did not include a valid Shape review object.");
  console.error(
    JSON.stringify(
      {
        type: result.type,
        subtype: result.subtype,
        session_id: result.session_id,
        keys: Object.keys(result),
        result_preview: typeof result.result === "string" ? result.result.slice(0, 4000) : undefined
      },
      null,
      2
    )
  );
  process.exit(1);
}

const [source, review] = selected;
const structuredOutput = JSON.stringify(review);
console.log(`Claude structured output source: ${source}`);
console.log(`Claude structured output fields: ${Object.keys(review).join(", ")}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `structured_output=${structuredOutput}\n`);
} else {
  console.log(structuredOutput);
}
