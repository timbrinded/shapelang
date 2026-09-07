import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_SKILL_STATIC_CHECKS = {
  "shape-lang": ["mode-boundaries", "draft-strict", "current-cli", "stable-refs", "drift-review"],
  "shape-contract-preflight": [
    "baseline-separation",
    "unknown-plan",
    "decision-contract",
    "current-cli"
  ],
  "shape-contract-guard": [
    "impact-support-separation",
    "semantic-normalization",
    "source-boundary",
    "structured-output"
  ],
  "shape-index": ["explicit-only", "clean-baseline", "no-invariant-quota", "ast-navigation"],
  "shape-review": [
    "code-first",
    "all-incident-relations",
    "false-positive-challenge",
    "drift-separation"
  ],
  "unix-system-visualiser": [
    "semantic-inspection",
    "ignored-output-safety",
    "deterministic-offline-artifact",
    "browser-and-evidence-boundary"
  ]
};

const RELEASE_SKILL_EVIDENCE_MARKERS = {
  "preflight-complete-route": ["SubmissionApi", "ArchiveWorker", "PublishedArchive"],
  "index-coverage-gaps": [
    ["UploadApi", "acceptImage"],
    ["ThumbnailWorker", "resizeImage"],
    "binding",
    "docs/images.md"
  ],
  "review-root-cause-grouping": [
    "RangeNormalizer.normalizeRange",
    "explain RangeNormalizer.normalizeRange",
    "end - 1"
  ],
  "visualiser-deterministic-nested-model": [
    "SystemEvent",
    "nested",
    "identical",
    "1 resource",
    "2 components",
    "2 functions",
    "2 relations",
    "1 authored journey",
    "1 inferred dependency tour",
    "authored",
    "runtime"
  ],
  "visualiser-unignored-output": ["not ignored", "before", "write"]
};

function repoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

function loadReleaseSkillCases() {
  const parsed = JSON.parse(readFileSync(join(repoRoot(), "fixtures/skills/cases.json"), "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("fixtures/skills/cases.json must be a JSON array");
  }

  const cases = {};
  for (const item of parsed) {
    if (typeof item?.skill !== "string" || typeof item?.id !== "string") {
      throw new Error("fixtures/skills/cases.json entries must declare skill and id");
    }
    if (!Array.isArray(item.required_commands)) {
      throw new Error(`${item.id} required_commands must be an array`);
    }
    cases[item.skill] ??= {};
    cases[item.skill][item.id] = {
      commands: item.required_commands,
      evidenceMarkers: RELEASE_SKILL_EVIDENCE_MARKERS[item.id]
    };
  }
  return cases;
}

export const RELEASE_SKILL_CASES = loadReleaseSkillCases();

export function releaseCaseAllowedTools() {
  const commands = Object.values(RELEASE_SKILL_CASES).flatMap((skillCases) =>
    Object.values(skillCases).flatMap((behaviorCase) => behaviorCase.commands)
  );
  return [...new Set(commands)].map((command) => `Bash(${command})`);
}
