// Runs the shape-index coverage audit in CI: flags changed source files that
// fall in subsystems with no authored (Layer-2) Shape coverage. Deterministic
// fast path: changed source files already referenced by an authored source/
// evidence ref or implementation/paths glob need no LLM judgment, so Claude is
// only invoked for the uncovered remainder.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emitSkillResult, runSkillReviewPipeline } from "./claude-skill-pipeline.mjs";
import { shapeIndexValidationErrors } from "./shape-skill-contract.mjs";

const INDEX_SKILL_PATH = "plugins/shapelang/skills/shape-index/SKILL.md";

const INDEX_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Bash(git log *)",
  "Bash(git ls-files *)",
  "Bash(bun shp check *)",
  "Bash(bun shp explain *)",
  "Bash(bun shp graph *)",
  "Bash(bun shp memory *)",
  "Bash(rg *)",
  "Bash(sed -n *)",
  "Bash(ls *)",
  "Bash(pwd)"
].join(",");

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

export function buildIndexPrompt(uncovered, env = process.env) {
  const schemaPath =
    env.SHAPE_INDEX_RESULT_SCHEMA ??
    ".github/shape-contract/schemas/shape-index-result.schema.json";
  return [
    `Read AGENTS.md when it exists, then read ${INDEX_SKILL_PATH} for what counts as an architecture-significant subsystem and authored (Layer-2) Shape coverage.`,
    "",
    "This is a coverage AUDIT of the authored Shape model, not an authoring run. Do not write files.",
    "A deterministic prefilter found changed source files that no authored shape/*.shape source/evidence ref or implementation paths glob covers:",
    "",
    ...uncovered.map((file) => `- ${file}`),
    "",
    "Group these files into subsystems. For each subsystem, decide whether it is architecture-significant per the skill (components/responsibilities, boundaries, owned resources, invariants).",
    "Inspect the authored model under shape/ (not shape/generated/) and the repository layout; `bun shp graph stats` and `bun shp explain SYMBOL` are available.",
    `Return the final audit as a single JSON object matching ${schemaPath}:`,
    'status "pass" with an empty gaps array when none of the uncovered files belong to an architecture-significant subsystem lacking coverage, "gaps" when they do, and "error" only when the audit itself could not run.',
    "For each gap report subsystem, files, why_significant, and suggested_shapes (which Layer-2 component, boundary, or invariant shapes to author).",
    "Do not include prose, Markdown, or code fences outside that object.",
    "Do not modify tracked repository files."
  ].join("\n");
}

export function buildIndexNormalizerPrompt(rawText, jsonSchema) {
  return `The previous Shape index coverage audit returned text instead of the required JSON object.

Convert that audit into exactly one JSON object matching this schema:

${jsonSchema}

Rules:
- Preserve coverage gaps if the text reports them.
- If the text reports no architecture-significant coverage gaps, return status "pass" with an empty gaps array.
- Do not invent gaps that are not present in the text.
- Do not include prose, Markdown, code fences, preamble, or postscript.

Audit text:

${rawText}`;
}

export async function runClaudeShapeIndex(env = process.env) {
  const changedFiles = readFileSync(env.SHAPE_CHANGED_FILES ?? "changed.txt", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const uncovered = uncoveredChangedFiles(changedFiles, collectAuthoredCoverage());
  if (uncovered.length === 0) {
    return emitSkillResult("index", "prefilter", {
      status: "pass",
      summary:
        "Every changed source file is referenced by an authored Shape source/evidence ref or implementation glob.",
      gaps: []
    });
  }

  console.log(`Uncovered changed source files (${uncovered.length}):`);
  for (const file of uncovered) {
    console.log(`- ${file}`);
  }

  return runSkillReviewPipeline({
    label: "index",
    title: "Shape index audit",
    resultPath: "claude-shape-index.json",
    normalizedResultPath: "claude-shape-index-normalized.json",
    schemaPath:
      env.SHAPE_INDEX_RESULT_SCHEMA ??
      ".github/shape-contract/schemas/shape-index-result.schema.json",
    allowedTools: INDEX_ALLOWED_TOOLS,
    buildPrompt: () => buildIndexPrompt(uncovered, env),
    buildNormalizerPrompt: buildIndexNormalizerPrompt,
    validationErrors: shapeIndexValidationErrors
  });
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  runClaudeShapeIndex().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
