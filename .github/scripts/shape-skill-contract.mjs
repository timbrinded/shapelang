// Result contracts for the skill-driven CI reviews (shape-contract-guard and
// shape-index). Mirrors shape-review-contract.mjs: strict field whitelists so
// model output can never smuggle extra structure into GITHUB_OUTPUT.
import { isRecord, parseJsonObjectCandidate } from "./shape-review-contract.mjs";

export const SHAPE_GUARD_STATUSES = new Set(["pass", "advisory", "error"]);
export const SHAPE_GUARD_SEVERITIES = new Set(["high", "medium", "low"]);
export const SHAPE_GUARD_FIELDS = ["status", "summary", "findings"];
export const SHAPE_GUARD_FINDING_FIELDS = [
  "severity",
  "signal",
  "outcome",
  "symbol",
  "evidence",
  "model_context",
  "recommended_action"
];

export const SHAPE_INDEX_STATUSES = new Set(["pass", "gaps", "error"]);
export const SHAPE_INDEX_FIELDS = ["status", "summary", "gaps"];
export const SHAPE_INDEX_GAP_FIELDS = ["subsystem", "files", "why_significant", "suggested_shapes"];

function recordValidationErrors(value, path, fields) {
  const errors = [];
  if (!isRecord(value)) {
    return [`${path} must be a JSON object`];
  }
  for (const field of fields) {
    if (!(field in value)) {
      errors.push(`${path}.${field} is required`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      errors.push(`${path}.${field} is not allowed`);
    }
  }
  return errors;
}

export function shapeGuardValidationErrors(value) {
  const errors = recordValidationErrors(value, "result", SHAPE_GUARD_FIELDS);
  if (!isRecord(value)) {
    return errors;
  }

  if (typeof value.status !== "string" || !SHAPE_GUARD_STATUSES.has(value.status)) {
    errors.push(`result.status must be one of ${[...SHAPE_GUARD_STATUSES].join(", ")}`);
  }
  if (typeof value.summary !== "string") {
    errors.push("result.summary must be a string");
  }
  if (!Array.isArray(value.findings)) {
    errors.push("result.findings must be an array");
    return errors;
  }

  value.findings.forEach((finding, index) => {
    const path = `result.findings[${index}]`;
    errors.push(...recordValidationErrors(finding, path, SHAPE_GUARD_FINDING_FIELDS));
    if (!isRecord(finding)) {
      return;
    }
    if (typeof finding.severity !== "string" || !SHAPE_GUARD_SEVERITIES.has(finding.severity)) {
      errors.push(`${path}.severity must be one of ${[...SHAPE_GUARD_SEVERITIES].join(", ")}`);
    }
    for (const field of SHAPE_GUARD_FINDING_FIELDS.filter((item) => item !== "severity")) {
      if (typeof finding[field] !== "string") {
        errors.push(`${path}.${field} must be a string`);
      }
    }
  });

  return errors;
}

export function shapeIndexValidationErrors(value) {
  const errors = recordValidationErrors(value, "result", SHAPE_INDEX_FIELDS);
  if (!isRecord(value)) {
    return errors;
  }

  if (typeof value.status !== "string" || !SHAPE_INDEX_STATUSES.has(value.status)) {
    errors.push(`result.status must be one of ${[...SHAPE_INDEX_STATUSES].join(", ")}`);
  }
  if (typeof value.summary !== "string") {
    errors.push("result.summary must be a string");
  }
  if (!Array.isArray(value.gaps)) {
    errors.push("result.gaps must be an array");
    return errors;
  }

  value.gaps.forEach((gap, index) => {
    const path = `result.gaps[${index}]`;
    errors.push(...recordValidationErrors(gap, path, SHAPE_INDEX_GAP_FIELDS));
    if (!isRecord(gap)) {
      return;
    }
    if (!Array.isArray(gap.files) || gap.files.some((file) => typeof file !== "string")) {
      errors.push(`${path}.files must be an array of strings`);
    }
    for (const field of ["subsystem", "why_significant", "suggested_shapes"]) {
      if (typeof gap[field] !== "string") {
        errors.push(`${path}.${field} must be a string`);
      }
    }
  });

  return errors;
}

export function requireValidResult(value, validationErrors, source) {
  const errors = validationErrors(value);
  if (errors.length > 0) {
    throw new Error(`Invalid ${source}: ${errors.join("; ")}.`);
  }
  return value;
}

// Same candidate order as extract-claude-shape-review.mjs: structured output,
// then the result text, then the parsed value itself.
export function selectResultFromClaudeOutput(text, validationErrors, source) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Could not parse Claude JSON output: ${error}`] };
  }

  const candidates = [
    ["structured_output", isRecord(parsed) ? parsed.structured_output : undefined],
    ["result", isRecord(parsed) ? parseJsonObjectCandidate(parsed.result) : undefined],
    ["direct", parsed]
  ];

  const errors = [];
  for (const [candidateSource, value] of candidates) {
    const candidateErrors = validationErrors(value);
    if (candidateErrors.length === 0) {
      return {
        ok: true,
        source: candidateSource,
        result: requireValidResult(value, validationErrors, source)
      };
    }
    if (value !== undefined) {
      errors.push(`${candidateSource}: ${candidateErrors.join("; ")}`);
    }
  }

  return { ok: false, errors };
}
