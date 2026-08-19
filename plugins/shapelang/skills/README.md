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
plugins/shapelang/skills/unix-system-visualiser/SKILL.md
```

- `shape-lang`: incremental language authoring, diagnostics, teaching, operation, and source-to-model drift review.
- `shape-contract-guard`: authored-contract diff review for checker-valid semantic loosening; it does not inspect application source.
- `shape-contract-preflight`: current-model orientation and optional model-only contract simulation before implementation.
- `shape-index`: explicit-only whole-repository modeling from a fixed clean baseline, without invariant quotas.
- `shape-review`: concrete code-bug review with focused Shape evidence and separate stale-model warnings.
- `unix-system-visualiser`: deterministic generation and browser validation of a self-contained interactive atlas from authored Shape inspection data.

## Validate

After changing a skill or plugin manifest, run:

```bash
bun run skills:check
```

This validates the shipped skill set, entrypoint frontmatter, referenced
resources, interface metadata, invocation policy, routing cases, output
contracts, bundled JavaScript and HTML resources, and current CLI spelling. The
release-candidate workflow also runs a static conformance review and focused
behavioral cases across all six skills, then pauses for manual approval in the
`skills-release-approval` environment.

If the skill change accompanies Shape implementation changes in this repository, also run the local project checks from the repository README.

`plugins/shapelang/skills/README.md` is maintainer documentation. Each `SKILL.md` is the file agents load.
