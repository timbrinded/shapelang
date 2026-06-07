# Shape Skills

This directory contains the source for Shape-related Codex skills.

Skill entrypoints:

```text
skills/shape-lang/SKILL.md
skills/shape-contract-guard/SKILL.md
skills/shape-contract-preflight/SKILL.md
```

- `shape-lang`: general Shape authoring, review, formatting, debugging, and CLI workflows.
- `shape-contract-guard`: advisory review of authored `.shape` contract diffs for suspicious loosenings that may pass `shp check`.
- `shape-contract-preflight`: pre-implementation planning against an existing Shape model, with optional temporary `change` block checks.

## Validate

After changing a skill, run the skill validator as part of your agent setup.

If the skill change accompanies Shape implementation changes in this repository, also run the local project checks from the repository README.

`skills/README.md` is maintainer documentation. Each `SKILL.md` is the file agents load.
