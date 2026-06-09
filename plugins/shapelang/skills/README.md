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
- `shape-index`: build a whole-codebase Shape model — author broad architecture/boundary/invariant shapes on top of the generated AST layer (extends `shape-lang` from incremental to whole-project authoring).
- `shape-review`: review a code change (PR/diff) for real bugs, using the Shape model to add cross-object findings the diff can't show, with a recall-first pass and a human-salience emission gate.

## Validate

After changing a skill or plugin manifest, run the plugin validator as part of
your agent setup and confirm each `SKILL.md` still has valid frontmatter.

If the skill change accompanies Shape implementation changes in this repository, also run the local project checks from the repository README.

`plugins/shapelang/skills/README.md` is maintainer documentation. Each `SKILL.md` is the file agents load.
