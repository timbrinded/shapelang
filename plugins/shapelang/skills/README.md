# Shape Plugin Skills

This directory contains the source for Shape-related skills exposed by the
repository's dual-compatible Codex and Claude Code plugin manifests:

```text
plugins/shapelang/.codex-plugin/plugin.json
plugins/shapelang/.claude-plugin/plugin.json
plugins/shapelang/skills/
```

The repository root also contains marketplace indexes for local installation:

```text
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
```

Both plugin systems discover skills from `plugins/shapelang/skills/<skill-name>/SKILL.md`, so new Shape skills should be added as sibling directories here.

Skill entrypoints:

```text
plugins/shapelang/skills/shape-lang/SKILL.md
plugins/shapelang/skills/shape-contract-guard/SKILL.md
plugins/shapelang/skills/shape-contract-preflight/SKILL.md
plugins/shapelang/skills/shape-index/SKILL.md
plugins/shapelang/skills/shape-review/SKILL.md
```

- `shape-lang`: general Shape authoring, review, formatting, debugging, and CLI workflows.
- `shape-contract-guard`: advisory review of authored `.shape` contract diffs for suspicious loosenings that may pass `shp check`.
- `shape-contract-preflight`: pre-implementation planning against an existing Shape model, with optional temporary `change` block checks.
- `shape-index`: build a whole-codebase authored contract, using generated AST as navigation evidence and reviewing source before promoting architecture, boundaries, invariants, and domain-pack policy.
- `shape-review`: review a code change for concrete local and cross-object bugs, verifying Shape-derived leads against real source before emitting findings.

## Validate

After changing a skill or plugin manifest, run:

```bash
bun run skills:check
```

This validates the shipped skill set, entrypoint frontmatter, interface metadata,
skill invocation prompts, and current CLI spelling. The release-candidate
workflow also runs a blocking behavioral evaluation across all five skills,
then pauses for manual approval in the `skills-release-approval` environment.

If the skill change accompanies Shape implementation changes in this repository, also run the local project checks from the repository README.

`plugins/shapelang/skills/README.md` is maintainer documentation. Each `SKILL.md` is the file agents load.
