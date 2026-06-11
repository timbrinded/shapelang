// Runs the shape-contract-guard skill review in CI: advisory loosening review
// of authored .shape diffs. Deterministic fast path: when the PR changes no
// authored .shape file, emit a pass result without invoking Claude.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emitSkillResult, runSkillReviewPipeline } from "./claude-skill-pipeline.mjs";
import { shapeGuardValidationErrors } from "./shape-skill-contract.mjs";

const GUARD_SKILL_PATH = "plugins/shapelang/skills/shape-contract-guard/SKILL.md";

const GUARD_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git ls-files *)",
  "Bash(git merge-base *)",
  "Bash(bun shp check *)",
  "Bash(bun shp obligations *)",
  "Bash(bun shp memory *)",
  "Bash(bun shp explain *)",
  "Bash(bun shp graph *)",
  "Bash(rg *)",
  "Bash(sed -n *)",
  "Bash(ls *)",
  "Bash(pwd)"
].join(",");

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

export function buildGuardPrompt(env = process.env) {
  const schemaPath =
    env.SHAPE_GUARD_RESULT_SCHEMA ??
    ".github/shape-contract/schemas/shape-guard-result.schema.json";
  return [
    `Read AGENTS.md when it exists, then read ${GUARD_SKILL_PATH} and its references/signals.md and references/examples.md, and apply that skill to this repository.`,
    "",
    "Review the authored Shape contract diff for advisory loosening risk.",
    `Scope: BASE_REF=${env.GITHUB_BASE_REF ?? ""}, HEAD_SHA=${env.GITHUB_SHA ?? ""}. Compare ${guardBaseRef(env)}...HEAD.`,
    "Changed files are listed in changed.txt.",
    "Run the shp CLI through bun, for example `bun shp check --changed-files changed.txt` and `bun shp memory`.",
    "Use path-limited `git show` for base contents; never switch the worktree to the base ref.",
    `Instead of the skill's Markdown output template, return the final review as a single JSON object matching ${schemaPath}:`,
    'status "pass" with an empty findings array when there are no advisory findings, "advisory" when findings exist, and "error" only when the review itself could not run.',
    "Map each finding to severity (high|medium|low), signal, outcome, symbol, evidence, model_context, and recommended_action.",
    "Do not include prose, Markdown, or code fences outside that object.",
    "Do not modify tracked repository files."
  ].join("\n");
}

export function buildGuardNormalizerPrompt(rawText, jsonSchema) {
  return `The previous Shape contract guard review returned text instead of the required JSON object.

Convert that review into exactly one JSON object matching this schema:

${jsonSchema}

Rules:
- Preserve guard findings if the text reports them, mapping severities to high, medium, or low.
- If the text reports no guard findings, return status "pass" with an empty findings array.
- Do not invent findings that are not present in the text.
- Do not include prose, Markdown, code fences, preamble, or postscript.

Review text:

${rawText}`;
}

export async function runClaudeShapeGuard(env = process.env) {
  const baseRef = guardBaseRef(env);
  if (changedAuthoredShapeFiles(baseRef).length === 0) {
    return emitSkillResult("guard", "prefilter", {
      status: "pass",
      summary: `No authored .shape files changed against ${baseRef}; guard review not needed.`,
      findings: []
    });
  }

  return runSkillReviewPipeline({
    label: "guard",
    title: "Shape guard review",
    resultPath: "claude-shape-guard.json",
    normalizedResultPath: "claude-shape-guard-normalized.json",
    schemaPath:
      env.SHAPE_GUARD_RESULT_SCHEMA ??
      ".github/shape-contract/schemas/shape-guard-result.schema.json",
    allowedTools: GUARD_ALLOWED_TOOLS,
    buildPrompt: () => buildGuardPrompt(env),
    buildNormalizerPrompt: buildGuardNormalizerPrompt,
    validationErrors: shapeGuardValidationErrors
  });
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  runClaudeShapeGuard().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
