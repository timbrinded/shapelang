// One runner for every Claude-driven Shape CI job (review, guard, index).
// The claude-skill-review composite action invokes it twice per job:
//
//   node run-claude-skill.mjs <skill> --prefilter
//     Deterministic prefilter. Emits GitHub step outputs: either a finished
//     result (skip=true) or the prompt and claude_args that
//     anthropics/claude-code-action uses to run the model call with
//     structured output.
//
//   node run-claude-skill.mjs <skill>
//     Gate. Validates CLAUDE_SKILL_RESULT (the action's structured_output or
//     the prefilter result) against the skill's JSON schema, renders the step
//     summary, and exits per the skill's gate policy.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const JSON_ONLY_SYSTEM_PROMPT =
  'You are producing machine input for CI. Your final response must be exactly one JSON object matching the configured JSON schema. The first character must be "{" and the last character must be "}". Do not include prose, bullets, Markdown, code fences, preamble, or postscript. If there are no verified drift findings, return status "pass" with an empty findings array.';

const DEFAULT_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Shared: schema validation
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

// ---------------------------------------------------------------------------
// Shared: claude-code-action inputs
// ---------------------------------------------------------------------------

// claude_args values are re-parsed shell-style by the Claude Code action. Its
// docs show single-quoted values without defining escape rules, so fail closed
// on embedded single quotes instead of guessing how they would be interpreted.
export function shellSingleQuote(value) {
  if (value.includes("'")) {
    throw new Error(`Cannot single-quote a claude_args value containing a single quote: ${value}`);
  }
  return `'${value}'`;
}

export function claudeModel(env = process.env) {
  const model = env.CLAUDE_SKILL_MODEL || DEFAULT_MODEL;
  if (!/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error(`CLAUDE_SKILL_MODEL must be a bare model id, got "${model}"`);
  }
  return model;
}

export function buildClaudeArgs(skill, schema, env = process.env) {
  return [
    `--model ${claudeModel(env)}`,
    "--max-turns 100",
    `--allowedTools ${shellSingleQuote(skill.allowedTools)}`,
    "--disallowedTools Write,Edit",
    `--append-system-prompt ${shellSingleQuote(JSON_ONLY_SYSTEM_PROMPT)}`,
    `--json-schema ${shellSingleQuote(JSON.stringify(schema))}`
  ].join("\n");
}

// GitHub Actions multiline output format. The delimiter is fixed so the
// serialization stays deterministic; reject values that would terminate the
// heredoc early rather than emit corrupted outputs.
const OUTPUT_DELIMITER = "CLAUDE_SKILL_OUTPUT";

export function serializeGitHubOutputs(outputs) {
  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    if (value.split(/\r?\n/).includes(OUTPUT_DELIMITER)) {
      throw new Error(`Output ${key} contains the reserved delimiter line ${OUTPUT_DELIMITER}`);
    }
    lines.push(`${key}<<${OUTPUT_DELIMITER}`, value, OUTPUT_DELIMITER);
  }
  return `${lines.join("\n")}\n`;
}

export function prefilterOutputs(name, env = process.env) {
  const skill = requireSkill(name);
  const pre = skill.prefilter ? skill.prefilter(env) : {};
  if (pre.result) {
    return { skip: "true", result: JSON.stringify(pre.result) };
  }
  const schema = JSON.parse(readFileSync(skill.schemaPath(env), "utf8"));
  return {
    skip: "false",
    prompt: skill.buildPrompt(env, pre.promptContext),
    claude_args: buildClaudeArgs(skill, schema, env)
  };
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

function requireSkill(name) {
  const skill = SKILLS[name];
  if (!skill) {
    throw new Error(`unknown skill "${name}"; expected one of ${Object.keys(SKILLS).join(", ")}`);
  }
  return skill;
}

function runPrefilter(name) {
  const outputs = prefilterOutputs(name);
  const serialized = serializeGitHubOutputs(outputs);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, serialized);
  } else {
    process.stdout.write(serialized);
  }
  if (outputs.skip === "true") {
    console.log(`Prefilter satisfied the ${name} skill without a model call.`);
  }
}

function runGate(name) {
  const skill = requireSkill(name);
  const schema = JSON.parse(readFileSync(skill.schemaPath(process.env), "utf8"));

  const raw = process.env.CLAUDE_SKILL_RESULT;
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "CLAUDE_SKILL_RESULT is empty; the Claude Code action returned no schema-valid structured output and there was no prefilter result."
    );
  }
  let result;
  try {
    result = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse CLAUDE_SKILL_RESULT: ${error}`);
  }
  const errors = schemaValidationErrors(result, schema);
  if (errors.length > 0) {
    throw new Error(`Invalid ${skill.title}: ${errors.join("; ")}.`);
  }

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

function main() {
  const name = process.argv[2] ?? "";
  const mode = process.argv[3] ?? "--gate";
  if (mode === "--prefilter") {
    runPrefilter(name);
    return;
  }
  if (mode !== "--gate") {
    throw new Error(`unknown mode "${mode}"; expected --prefilter or --gate`);
  }
  runGate(name);
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
