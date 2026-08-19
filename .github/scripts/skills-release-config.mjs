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

export const RELEASE_SKILL_CASES = {
  "shape-lang": {
    "lang-draft-strict": {
      commands: [
        "bun shp check --allow-unknown-effects fixtures/fail/unknown_effects/audit.shape",
        "bun shp check fixtures/fail/unknown_effects/audit.shape"
      ]
    },
    "lang-final-forbid": {
      commands: [
        "bun shp check fixtures/fail/memory_guard_does_not_override_final_forbid/audit.shape"
      ]
    }
  },
  "shape-contract-preflight": {
    "preflight-guarded-unknown": {
      commands: [
        "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/guarded-unknown/shape --json fixtures/skills/preflight/guarded-unknown/proposal.shape"
      ]
    },
    "preflight-invalid-baseline": {
      commands: [
        "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/invalid-baseline/shape --json fixtures/skills/preflight/invalid-baseline/proposal.shape"
      ]
    },
    "preflight-complete-route": {
      evidenceMarkers: ["SubmissionApi", "ArchiveWorker", "PublishedArchive"],
      commands: [
        "plugins/shapelang/skills/shape-contract-preflight/scripts/precheck.sh --shape-root fixtures/skills/preflight/complete-route/shape --json fixtures/skills/preflight/complete-route/proposal.shape"
      ]
    }
  },
  "shape-contract-guard": {
    "guard-policy-removal": {
      commands: ["bun shp check fixtures/skills/guard/policy-removal/candidate/contract.shape"]
    },
    "guard-equivalent-relocation": {
      commands: [
        "bun shp check fixtures/skills/guard/equivalent-relocation/candidate/retention.shape"
      ]
    }
  },
  "shape-index": {
    "index-missing-ast": {
      commands: ["bun shp check fixtures/skills/index/missing-ast/shape/system.shape"]
    },
    "index-no-invariant": {
      commands: []
    },
    "index-coverage-gaps": {
      evidenceMarkers: ["UploadApi", "ThumbnailWorker", "binding", "docs/images.md"],
      commands: ["bun shp check fixtures/skills/index/coverage-gaps/shape/system.shape"]
    }
  },
  "shape-review": {
    "review-cross-object": {
      commands: ["bun shp check fixtures/skills/review/cross-object/shape/model.shape"]
    },
    "review-stale-model": {
      commands: ["bun shp check fixtures/skills/review/stale-model/shape/model.shape"]
    },
    "review-root-cause-grouping": {
      evidenceMarkers: [
        "RangeNormalizer.normalizeRange",
        "shp explain RangeNormalizer.normalizeRange",
        "end - 1"
      ],
      commands: [
        "bun shp check fixtures/skills/review/root-cause-grouping/shape/model.shape",
        "bun shp explain RangeNormalizer.normalizeRange fixtures/skills/review/root-cause-grouping/shape/model.shape",
        "bun shp graph show RangeNormalizer fixtures/skills/review/root-cause-grouping/shape/model.shape"
      ]
    }
  },
  "unix-system-visualiser": {
    "visualiser-deterministic-nested-model": {
      evidenceMarkers: [
        "SystemEvent",
        "nested",
        "identical",
        "1 resource",
        "2 components",
        "2 functions",
        "1 relation",
        "authored",
        "runtime"
      ],
      commands: [
        "bun shp check fixtures/skills/unix-system-visualiser/connected/shape/nested/system.shape",
        'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/connected --output .research/atlas-a.html --shape-command "bun ../../../../packages/shp-cli/src/index.ts"',
        'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/connected --output .research/atlas-b.html --shape-command "bun ../../../../packages/shp-cli/src/index.ts"',
        "cmp fixtures/skills/unix-system-visualiser/connected/.research/atlas-a.html fixtures/skills/unix-system-visualiser/connected/.research/atlas-b.html"
      ]
    },
    "visualiser-unignored-output": {
      evidenceMarkers: ["not ignored", "before", "write"],
      commands: [
        'bun plugins/shapelang/skills/unix-system-visualiser/scripts/generate.mjs --repo fixtures/skills/unix-system-visualiser/unignored-output --shape-command "bun ../../../../packages/shp-cli/src/index.ts"'
      ]
    }
  }
};

export function releaseCaseAllowedTools() {
  const commands = Object.values(RELEASE_SKILL_CASES).flatMap((cases) =>
    Object.values(cases).flatMap((behaviorCase) => behaviorCase.commands)
  );
  return [...new Set(commands)].map((command) => `Bash(${command})`);
}
