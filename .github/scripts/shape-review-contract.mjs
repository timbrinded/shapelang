import { appendFileSync } from "node:fs";

export const SHAPE_REVIEW_STATUSES = new Set(["pass", "drift", "error"]);
export const SHAPE_REVIEW_SEVERITIES = new Set(["warning", "error"]);

export const SHAPE_REVIEW_FINDING_FIELDS = [
  "severity",
  "target",
  "shape_source",
  "issue",
  "reason",
  "source_quote",
  "shape_quote",
  "suggested_fix"
];

export const SHAPE_REVIEW_FIELDS = ["status", "summary", "findings"];

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonText(text, source) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, errors: [`Could not parse ${source}: ${error}`] };
  }
}

export function parseJsonObjectCandidate(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidates = fenced?.[1] ? [trimmed, fenced[1].trim()] : [trimmed];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next complete representation. Deliberately do not slice from
      // the first `{` to the last `}`; CI should consume structured output or a
      // whole JSON object, not implicitly scrape prose.
    }
  }

  return undefined;
}

export function shapeReviewValidationErrors(value) {
  const errors = [];
  if (!isRecord(value)) {
    return ["result must be a JSON object"];
  }

  for (const field of SHAPE_REVIEW_FIELDS) {
    if (!(field in value)) {
      errors.push(`${field} is required`);
    }
  }

  for (const field of Object.keys(value)) {
    if (!SHAPE_REVIEW_FIELDS.includes(field)) {
      errors.push(`${field} is not allowed`);
    }
  }

  if (typeof value.status !== "string" || !SHAPE_REVIEW_STATUSES.has(value.status)) {
    errors.push(`status must be one of ${[...SHAPE_REVIEW_STATUSES].join(", ")}`);
  }

  if (typeof value.summary !== "string") {
    errors.push("summary must be a string");
  }

  if (!Array.isArray(value.findings)) {
    errors.push("findings must be an array");
    return errors;
  }

  value.findings.forEach((finding, index) => {
    errors.push(...shapeReviewFindingValidationErrors(finding, `findings[${index}]`));
  });

  return errors;
}

export function shapeReviewFindingValidationErrors(value, path = "finding") {
  const errors = [];
  if (!isRecord(value)) {
    return [`${path} must be an object`];
  }

  for (const field of SHAPE_REVIEW_FINDING_FIELDS) {
    if (!(field in value)) {
      errors.push(`${path}.${field} is required`);
    }
  }

  for (const field of Object.keys(value)) {
    if (!SHAPE_REVIEW_FINDING_FIELDS.includes(field)) {
      errors.push(`${path}.${field} is not allowed`);
    }
  }

  if (typeof value.severity !== "string" || !SHAPE_REVIEW_SEVERITIES.has(value.severity)) {
    errors.push(`${path}.severity must be one of ${[...SHAPE_REVIEW_SEVERITIES].join(", ")}`);
  }

  for (const field of SHAPE_REVIEW_FINDING_FIELDS.filter((item) => item !== "severity")) {
    if (typeof value[field] !== "string") {
      errors.push(`${path}.${field} must be a string`);
    }
  }

  return errors;
}

export function requireShapeReview(value, source = "Shape review") {
  const errors = shapeReviewValidationErrors(value);
  if (errors.length > 0) {
    throw new Error(`Invalid ${source}: ${errors.join("; ")}.`);
  }
  return value;
}

export function writeGitHubOutput(
  name,
  value,
  env = process.env,
  appendFileSyncImpl = appendFileSync
) {
  const outputPath = env.GITHUB_OUTPUT;
  if (!outputPath) {
    return false;
  }

  appendFileSyncImpl(outputPath, `${name}=${value}\n`);
  return true;
}
