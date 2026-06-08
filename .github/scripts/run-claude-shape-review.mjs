import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractShapeReviewFromClaudeOutput } from "./extract-claude-shape-review.mjs";
import { writeGitHubOutput } from "./shape-review-contract.mjs";

const PRIMARY_RESULT_PATH = "claude-shape-review.json";
const NORMALIZED_RESULT_PATH = "claude-shape-review-normalized.json";

const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git ls-files *)",
  "Bash(bun run shape:ci)",
  "Bash(bun shp --help)",
  "Bash(bun shp check *)",
  "Bash(bun shp obligations *)",
  "Bash(bun shp memory *)",
  "Bash(bun shp explain *)",
  "Bash(bun shp analyze *)",
  "Bash(rg *)",
  "Bash(sed -n *)",
  "Bash(ls *)",
  "Bash(pwd)"
].join(",");

const JSON_ONLY_SYSTEM_PROMPT =
  'You are producing machine input for CI. Your final response must be exactly one JSON object matching the configured JSON schema. The first character must be "{" and the last character must be "}". Do not include prose, bullets, Markdown, code fences, preamble, or postscript. If there are no verified drift findings, return status "pass" with an empty findings array.';

export function loadJsonSchema(schemaPath) {
  return JSON.stringify(JSON.parse(readFileSync(schemaPath, "utf8")));
}

export function buildReviewPrompt(env = process.env) {
  const schemaPath =
    env.SHAPE_CONTRACT_RESULT_SCHEMA ??
    ".github/shape-contract/schemas/shape-contract-result.schema.json";
  return [
    "Read AGENTS.md when it exists, then read .github/prompts/shape-contract-review.md.",
    "",
    "Analyze this repository for Shape contract drift.",
    `Scope: BASE_REF=${env.GITHUB_BASE_REF ?? ""}, HEAD_SHA=${env.GITHUB_SHA ?? ""}.`,
    "Changed files are listed in changed.txt.",
    "Shape command output is in shape-claude-context.txt.",
    "Use the prompt file's review policy and output contract.",
    `Return the final review as a single JSON object matching ${schemaPath}.`,
    "Do not include prose, Markdown, or code fences outside that object.",
    "Do not modify tracked repository files."
  ].join("\n");
}

export function buildNormalizerPrompt(rawReview, jsonSchema) {
  return `The previous Shape contract review returned text instead of the required JSON object.

Convert that review into exactly one JSON object matching this schema:

${jsonSchema}

Rules:
- Preserve verified drift or error findings if the text reports them.
- If the text reports no verified Shape contract drift, return status "pass" with an empty findings array.
- Do not invent findings that are not present in the text.
- Do not include prose, Markdown, code fences, preamble, or postscript.

Review text:

${rawReview}`;
}

export async function runClaude(args, options = {}) {
  const child = spawn("claude", args, {
    env: process.env,
    ...options,
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

  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  return { exitCode, stdout, stderr };
}

export function claudeReviewArgs(prompt, jsonSchema) {
  return [
    "-p",
    prompt,
    "--max-turns",
    "100",
    "--output-format",
    "json",
    "--append-system-prompt",
    JSON_ONLY_SYSTEM_PROMPT,
    "--allowedTools",
    ALLOWED_TOOLS,
    "--disallowedTools",
    "Write,Edit",
    "--json-schema",
    jsonSchema
  ];
}

export function claudeNormalizerArgs(prompt, jsonSchema) {
  return [
    "-p",
    prompt,
    "--max-turns",
    "20",
    "--output-format",
    "json",
    "--append-system-prompt",
    JSON_ONLY_SYSTEM_PROMPT,
    "--tools",
    "",
    "--json-schema",
    jsonSchema
  ];
}

export function rawReviewTextForNormalizer(output) {
  try {
    const result = JSON.parse(output);
    return typeof result.result === "string" ? result.result : JSON.stringify(result);
  } catch {
    return output;
  }
}

function requireSuccessfulClaudeRun(result, label) {
  if (result.exitCode === 0) {
    return;
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  throw new Error(`${label} failed with exit ${result.exitCode}${detail ? `: ${detail}` : ""}`);
}

function emitReview(source, review) {
  const structuredOutput = JSON.stringify(review);
  console.log(`Claude structured output source: ${source}`);
  console.log(`Claude structured output fields: ${Object.keys(review).join(", ")}`);
  if (!writeGitHubOutput("structured_output", structuredOutput)) {
    console.log(structuredOutput);
  }
}

export async function runClaudeShapeReview(env = process.env) {
  const schemaPath =
    env.SHAPE_CONTRACT_RESULT_SCHEMA ??
    ".github/shape-contract/schemas/shape-contract-result.schema.json";
  const jsonSchema = loadJsonSchema(schemaPath);

  const primary = await runClaude(claudeReviewArgs(buildReviewPrompt(env), jsonSchema));
  writeFileSync(PRIMARY_RESULT_PATH, primary.stdout);
  requireSuccessfulClaudeRun(primary, "Claude Shape contract review");

  const primaryReview = extractShapeReviewFromClaudeOutput(primary.stdout);
  if (primaryReview.ok) {
    emitReview(primaryReview.source, primaryReview.review);
    return primaryReview.review;
  }

  console.error(
    "Primary Claude output was not structured JSON; retrying with a no-tools JSON normalizer."
  );
  if (primaryReview.errors.length > 0) {
    console.error(primaryReview.errors.join("\n"));
  }

  const normalizerPrompt = buildNormalizerPrompt(
    rawReviewTextForNormalizer(primary.stdout),
    jsonSchema
  );
  const normalized = await runClaude(claudeNormalizerArgs(normalizerPrompt, jsonSchema));
  writeFileSync(NORMALIZED_RESULT_PATH, normalized.stdout);
  requireSuccessfulClaudeRun(normalized, "Claude Shape review normalizer");

  const normalizedReview = extractShapeReviewFromClaudeOutput(normalized.stdout);
  if (!normalizedReview.ok) {
    throw new Error(
      `Claude normalizer output did not include a valid Shape review object: ${normalizedReview.errors.join("; ")}`
    );
  }

  emitReview(normalizedReview.source, normalizedReview.review);
  return normalizedReview.review;
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  runClaudeShapeReview().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
