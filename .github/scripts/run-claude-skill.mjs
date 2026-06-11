// One runner for every Claude-driven Shape CI job (review, guard, index).
// Invoke as `node run-claude-skill.mjs <skill>`. Each skill contributes named
// functions (prompt, prefilter, gate policy, summary) via the SKILLS table;
// this file owns the shared flow: prefilter -> claude -> extract -> validate
// against the skill's JSON schema -> step summary -> gate exit code.
//
// Test/operations seam: when CLAUDE_SKILL_RESULT is set, the model call is
// skipped and the provided result is validated and gated directly.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const JSON_ONLY_SYSTEM_PROMPT =
  'You are producing machine input for CI. Your final response must be exactly one JSON object matching the configured JSON schema. The first character must be "{" and the last character must be "}". Do not include prose, bullets, Markdown, code fences, preamble, or postscript. If there are no verified drift findings, return status "pass" with an empty findings array.';

// ---------------------------------------------------------------------------
// Shared: schema validation and Claude output extraction
// ---------------------------------------------------------------------------

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Validates a value against the restricted JSON-schema subset our result
// schemas use. Fails closed: any schema keyword outside that subset is an
// error, so a future schema cannot be silently under-enforced.
export function schemaValidationErrors(value, schema, path = "result") {
  const errors = [];
  const supported = new Set([
    "$schema",
    "additionalProperties",
    "description",
    "enum",
    "items",
    "properties",
    "required",
    "type"
  ]);
  for (const keyword of Object.keys(schema)) {
    if (!supported.has(keyword)) {
      errors.push(`${path}: unsupported schema keyword ${keyword}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    }
    return errors;
  }

  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) {
        return [`${path} must be a JSON object`];
      }
      for (const field of schema.required ?? []) {
        if (!(field in value)) {
          errors.push(`${path}.${field} is required`);
        }
      }
      const properties = schema.properties ?? {};
      for (const [key, item] of Object.entries(value)) {
        if (!(key in properties)) {
          if (schema.additionalProperties === false) {
            errors.push(`${path}.${key} is not allowed`);
          }
          continue;
        }
        errors.push(...schemaValidationErrors(item, properties[key], `${path}.${key}`));
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) {
        return [`${path} must be an array`];
      }
      value.forEach((item, index) => {
        errors.push(...schemaValidationErrors(item, schema.items ?? {}, `${path}[${index}]`));
      });
      return errors;
    }
    case "string": {
      if (typeof value !== "string") {
        errors.push(`${path} must be a string`);
      }
      return errors;
    }
    default: {
      return [`${path}: unsupported schema type ${schema.type}`];
    }
  }
}

function parseJsonObjectCandidate(value) {
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

// Candidate order matches observed CLI behavior: the validated structured
// output field, then a whole-JSON result text, then a bare result object.
export function extractValidResult(text, schema) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`Could not parse Claude JSON output: ${error}`] };
  }

  const candidates = [
    ["structured_output", isRecord(envelope) ? envelope.structured_output : undefined],
    ["result", isRecord(envelope) ? parseJsonObjectCandidate(envelope.result) : undefined],
    ["direct", envelope]
  ];

  const errors = [];
  for (const [source, value] of candidates) {
    if (value === undefined) {
      continue;
    }
    const candidateErrors = schemaValidationErrors(value, schema);
    if (candidateErrors.length === 0) {
      return { ok: true, source, result: value };
    }
    errors.push(`${source}: ${candidateErrors.join("; ")}`);
  }

  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Shared: Claude invocation
// ---------------------------------------------------------------------------

async function runClaude(args) {
  const child = spawn("claude", args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  const exitCode = await new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  });

  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8")
  };
}

async function runSkillThroughClaude(name, skill, schema, promptContext) {
  const run = await runClaude([
    "-p",
    skill.buildPrompt(process.env, promptContext),
    "--max-turns",
    "100",
    "--output-format",
    "json",
    "--append-system-prompt",
    JSON_ONLY_SYSTEM_PROMPT,
    "--allowedTools",
    skill.allowedTools,
    "--disallowedTools",
    "Write,Edit",
    "--json-schema",
    JSON.stringify(schema)
  ]);
  writeFileSync(skill.resultPath, run.stdout);
  if (run.exitCode !== 0) {
    const detail = run.stderr.trim() || run.stdout.trim();
    throw new Error(
      `Claude ${name} run failed with exit ${run.exitCode}${detail ? `: ${detail}` : ""}`
    );
  }

  const extracted = extractValidResult(run.stdout, schema);
  if (!extracted.ok) {
    throw new Error(
      `Claude ${name} output did not include a valid ${skill.title} (raw output captured in ${skill.resultPath}):\n${extracted.errors.join("\n")}`
    );
  }
  return extracted;
}

// ---------------------------------------------------------------------------
// Review skill: source -> model drift review (policy in shape-contract-review.md)
// ---------------------------------------------------------------------------

export function buildReviewPrompt(env = process.env) {
  return [
    "Read AGENTS.md when it exists, then read .github/prompts/shape-contract-review.md.",
    "",
    "Analyze this repository for Shape contract drift.",
    `Scope: BASE_REF=${env.GITHUB_BASE_REF ?? ""}, HEAD_SHA=${env.GITHUB_SHA ?? ""}.`,
    "Changed files are listed in changed.txt.",
    "Shape command output is in shape-claude-context.txt.",
    "Use the prompt file's review policy and output contract.",
    "Return the final review as a single JSON object matching the configured JSON schema.",
    "Do not include prose, Markdown, or code fences outside that object.",
    "Do not modify tracked repository files."
  ].join("\n");
}

export function renderReviewSummary(result) {
  return [
    "## Shape Claude Review",
    "",
    `Status: \`${result.status}\``,
    "",
    result.summary,
    "",
    `Findings: ${result.findings.length}`,
    ""
  ].join("\n");
}

export function reviewFailureMessage(result) {
  if (result.status === "pass" && result.findings.length > 0) {
    return "Invalid Shape Claude review: pass status cannot include findings.";
  }
  if (result.status !== "pass") {
    return JSON.stringify(result, null, 2);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Guard skill: advisory loosening review of authored .shape diffs
// ---------------------------------------------------------------------------

export function guardBaseRef(env = process.env) {
  return env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : "origin/master";
}

export function changedAuthoredShapeFiles(baseRef, runGitDiff = defaultRunGitDiff) {
  return runGitDiff(baseRef)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".shape") && !line.startsWith("shape/generated/"));
}

function defaultRunGitDiff(baseRef) {
  const result = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      `${baseRef}...HEAD`,
      "--",
      "*.shape",
      ":(exclude)shape/generated/ast/**"
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`git diff against ${baseRef} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function guardPrefilter(env = process.env) {
  const baseRef = guardBaseRef(env);
  if (changedAuthoredShapeFiles(baseRef).length > 0) {
    return {};
  }
  return {
    result: {
      status: "pass",
      summary: `No authored .shape files changed against ${baseRef}; guard review not needed.`,
      findings: []
    }
  };
}

export function buildGuardPrompt(env = process.env) {
  return [
    readFileSync(".github/prompts/shape-guard.md", "utf8").trim(),
    "",
    `Scope: BASE_REF=${env.GITHUB_BASE_REF ?? ""}, HEAD_SHA=${env.GITHUB_SHA ?? ""}. Compare ${guardBaseRef(env)}...HEAD.`
  ].join("\n");
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

// ---------------------------------------------------------------------------
// Index skill: Layer-2 coverage audit over changed source files
// ---------------------------------------------------------------------------

// Changed files whose architecture coverage matters: implementation and CI
// sources. Tests, generated artifacts, docs, and config are out of scope.
export function isAuditableSourceFile(path) {
  if (!/^(packages|scripts|\.github\/scripts)\/.*\.(ts|tsx|js|mjs)$/.test(path)) {
    return false;
  }
  if (/\.test\.(ts|tsx|js|mjs)$/.test(path)) {
    return false;
  }
  if (path.startsWith("packages/shp-checker/src/language/generated/")) {
    return false;
  }
  return true;
}

export function globToRegExp(glob) {
  const pattern = glob
    .split("**")
    .map((part) =>
      part
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
    )
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

// Coverage signals in an authored .shape file: source/evidence refs such as
// ts("path#fn") or mjs("path"), and quoted globs inside `paths { ... }` blocks.
export function authoredCoverageFromShapeSource(text) {
  const refs = new Set();
  const globs = [];

  for (const match of text.matchAll(/\b[a-z]+\("([^"]+)"\)/g)) {
    const path = match[1].split("#")[0].split(":")[0];
    if (path) {
      refs.add(path);
    }
  }

  for (const block of text.matchAll(/\bpaths\s*\{([^}]*)\}/g)) {
    for (const quoted of block[1].matchAll(/"([^"]+)"/g)) {
      globs.push(quoted[1]);
    }
  }

  return { refs, globs };
}

export function collectAuthoredCoverage() {
  const refs = new Set();
  const globs = [];
  const shapeFiles = readdirSync("shape")
    .filter((name) => name.endsWith(".shape"))
    .map((name) => join("shape", name));
  for (const file of shapeFiles) {
    const fromFile = authoredCoverageFromShapeSource(readFileSync(file, "utf8"));
    for (const ref of fromFile.refs) {
      refs.add(ref);
    }
    globs.push(...fromFile.globs);
  }
  return { refs, globMatchers: globs.map(globToRegExp) };
}

export function uncoveredChangedFiles(changedFiles, coverage) {
  return changedFiles
    .filter(isAuditableSourceFile)
    .filter(
      (file) =>
        !coverage.refs.has(file) && !coverage.globMatchers.some((matcher) => matcher.test(file))
    );
}

export function indexPrefilter(env = process.env) {
  const changedFiles = readFileSync(env.SHAPE_CHANGED_FILES ?? "changed.txt", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const uncovered = uncoveredChangedFiles(changedFiles, collectAuthoredCoverage());
  if (uncovered.length === 0) {
    return {
      result: {
        status: "pass",
        summary:
          "Every changed source file is referenced by an authored Shape source/evidence ref or implementation glob.",
        gaps: []
      }
    };
  }

  console.log(`Uncovered changed source files (${uncovered.length}):`);
  for (const file of uncovered) {
    console.log(`- ${file}`);
  }
  return { promptContext: uncovered };
}

export function buildIndexPrompt(env = process.env, uncovered = []) {
  return [
    readFileSync(".github/prompts/shape-index.md", "utf8").trim(),
    "",
    "Uncovered changed source files:",
    ...uncovered.map((file) => `- ${file}`)
  ].join("\n");
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

// ---------------------------------------------------------------------------
// Skill table and gate flow
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git ls-files *)",
  "Bash(bun shp check *)",
  "Bash(bun shp obligations *)",
  "Bash(bun shp memory *)",
  "Bash(bun shp explain *)",
  "Bash(rg *)",
  "Bash(sed -n *)",
  "Bash(ls *)",
  "Bash(pwd)"
];

const SKILLS = {
  review: {
    title: "Shape Claude review",
    schemaPath: (env) =>
      env.SHAPE_CONTRACT_RESULT_SCHEMA ??
      ".github/shape-contract/schemas/shape-contract-result.schema.json",
    resultPath: "claude-shape-review.json",
    allowedTools: [
      ...READ_ONLY_TOOLS,
      "Bash(bun run shape:ci)",
      "Bash(bun shp --help)",
      "Bash(bun shp analyze *)"
    ].join(","),
    buildPrompt: buildReviewPrompt,
    renderSummary: renderReviewSummary,
    failureMessage: reviewFailureMessage
  },
  guard: {
    title: "Shape guard result",
    schemaPath: (env) =>
      env.SHAPE_GUARD_RESULT_SCHEMA ??
      ".github/shape-contract/schemas/shape-guard-result.schema.json",
    resultPath: "claude-shape-guard.json",
    allowedTools: [...READ_ONLY_TOOLS, "Bash(git merge-base *)", "Bash(bun shp graph *)"].join(","),
    prefilter: guardPrefilter,
    buildPrompt: buildGuardPrompt,
    renderSummary: renderGuardSummary,
    failureMessage: guardFailureMessage,
    nonBlockingNote: (result) =>
      result.findings.length > 0
        ? `Advisory guard findings (non-blocking): ${result.findings.length}`
        : undefined
  },
  index: {
    title: "Shape index result",
    schemaPath: (env) =>
      env.SHAPE_INDEX_RESULT_SCHEMA ??
      ".github/shape-contract/schemas/shape-index-result.schema.json",
    resultPath: "claude-shape-index.json",
    allowedTools: [...READ_ONLY_TOOLS, "Bash(bun shp graph *)"].join(","),
    prefilter: indexPrefilter,
    buildPrompt: buildIndexPrompt,
    renderSummary: renderIndexSummary,
    failureMessage: indexFailureMessage,
    nonBlockingNote: (result) =>
      result.gaps.length > 0
        ? `Advisory index coverage gaps (non-blocking): ${result.gaps.length}`
        : undefined
  }
};

async function main() {
  const name = process.argv[2] ?? "";
  const skill = SKILLS[name];
  if (!skill) {
    throw new Error(`unknown skill "${name}"; expected one of ${Object.keys(SKILLS).join(", ")}`);
  }
  const schema = JSON.parse(readFileSync(skill.schemaPath(process.env), "utf8"));

  let result;
  let source;
  if (process.env.CLAUDE_SKILL_RESULT !== undefined) {
    let provided;
    try {
      provided = JSON.parse(process.env.CLAUDE_SKILL_RESULT);
    } catch (error) {
      throw new Error(`Could not parse CLAUDE_SKILL_RESULT: ${error}`);
    }
    const errors = schemaValidationErrors(provided, schema);
    if (errors.length > 0) {
      throw new Error(`Invalid ${skill.title}: ${errors.join("; ")}.`);
    }
    result = provided;
    source = "provided";
  } else {
    const pre = skill.prefilter ? skill.prefilter(process.env) : {};
    if (pre.result) {
      result = pre.result;
      source = "prefilter";
    } else {
      ({ result, source } = await runSkillThroughClaude(name, skill, schema, pre.promptContext));
    }
  }

  console.log(`Claude ${name} output source: ${source}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, skill.renderSummary(result));
  }

  const failure = skill.failureMessage(result, process.env);
  if (failure) {
    console.error(failure);
    process.exit(1);
  }

  const note = skill.nonBlockingNote ? skill.nonBlockingNote(result) : undefined;
  if (note) {
    console.log(note);
  }
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
