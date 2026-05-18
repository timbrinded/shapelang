# Shape Lang Skill

This directory contains the source for the Shape language Codex skill.

The skill entrypoint is:

```text
skill/shape-lang/SKILL.md
```

The skill is for agents using Shape in downstream repositories where the released `shp` binary is already available on `PATH`.

## Validate

After changing the skill, run the skill validator skill as part of your agent setup.

If the skill change accompanies Shape implementation changes in this repository, also run the local project checks from the repository README.

`skill/README.md` is maintainer documentation. `skill/shape-lang/SKILL.md` is the skill file agents load.
