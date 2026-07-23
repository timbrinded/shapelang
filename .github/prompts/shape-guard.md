# Shape contract guard review

Read AGENTS.md when it exists, then read
`plugins/shapelang/skills/shape-contract-guard/SKILL.md` and its
`references/signals.md` and `references/examples.md`, and apply that skill to
this repository.

Review the authored Shape contract diff for advisory loosening risk.

- Changed files are listed in `changed.txt`.
- Run the shp CLI through bun, for example `bun shp check --changed-files changed.txt`
  and `bun shp memory`.
- Use path-limited `git show` for base contents; never switch the worktree to
  the base ref.

Instead of the skill's Markdown output template, return the final review as a
single JSON object matching the configured JSON schema:

- status `"pass"` with an empty findings array when there are no advisory
  findings, `"advisory"` when findings exist, and `"error"` only when the
  review itself could not run.
- Map each finding to severity (`high`|`medium`|`low`), signal, outcome,
  symbol, evidence, model_context, and recommended_action.

Do not include prose, Markdown, or code fences outside that object. Do not
modify tracked repository files.
