# Shape Lang Skill

This directory contains the repo-local Codex skill for the Shape language monorepo.

The actual skill entrypoint is:

```text
skill/shape-lang/SKILL.md
```

## Install For Local Codex Discovery

From the repository root, symlink the skill into your Codex skills directory:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -s "$PWD/skill/shape-lang" "${CODEX_HOME:-$HOME/.codex}/skills/shape-lang"
```

If a skill already exists at that destination, remove or update that link intentionally first.

## Validate

Run the skill validator:

```bash
/home/timbo/.claude/skills/.system/skill-creator/scripts/quick_validate.py skill/shape-lang
```

After changing the skill together with Shape language behavior, also run:

```bash
bun test
bun run typecheck
bun shp fmt --check $(find shape fixtures -name '*.shape' | sort)
```

`skill/README.md` is installation documentation. `skill/shape-lang/SKILL.md` is the skill file Codex loads.
