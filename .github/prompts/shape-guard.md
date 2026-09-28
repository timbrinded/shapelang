# Shape contract guard review

Read AGENTS.md when it exists, then read
`plugins/shapelang/skills/shape-contract-guard/SKILL.md` and its
`references/signals.md` and `references/examples.md`, and apply that skill to
this repository.

Review the authored Shape contract diff for advisory loosening risk.

- Changed files are listed in `changed.txt`.
- Run the shp CLI through bun. Always run
  `bun shp check --changed-files changed.txt`; use focused `explain` and
  `graph show` as needed, and use `memory` or `obligations` only when guarded
  context is relevant.
- Use path-limited `git show` for base contents; never switch the worktree to
  the base ref.

Return the skill's canonical result as a single JSON object matching the
configured JSON schema:

- status `"pass"` with an empty findings array when there are no advisory
  findings, `"advisory"` when findings exist, and `"error"` only when the
  review itself could not run.
- Normalize exact before/after facts and search the candidate model for
  relocation, semantic equivalence, or an equal/stronger replacement before
  retaining a finding.
- Map each finding to impact (`high`|`medium`|`low`), support
  (`none`|`generic`|`specific`), disposition
  (`suspicious`|`supported`|`tightening`|`informational`), signal, symbol,
  before, after, replacement, evidence, model_context, and recommended_action.
- Keep semantic impact independent from justification. Specific evidence may
  make a loosening supported; it does not make a high-impact boundary removal
  intrinsically low-impact.

Do not include prose, Markdown, or code fences outside that object. Do not
modify tracked repository files.
