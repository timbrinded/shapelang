# Shape index coverage audit

Read AGENTS.md when it exists, then read
`plugins/shapelang/skills/shape-index/SKILL.md` for what counts as an
architecture-significant subsystem and authored (Layer-2) Shape coverage.

This is a coverage AUDIT of the authored Shape model, not an authoring run. Do
not write files.

A deterministic prefilter found changed source files that no authored
`shape/*.shape` source/evidence ref or implementation paths glob covers; they
are listed at the end of this prompt.

- Group those files into subsystems. For each subsystem, decide whether it is
  architecture-significant per the skill (components/responsibilities,
  boundaries, owned resources, invariants).
- Inspect the authored model under `shape/` (not `shape/generated/`) and the
  repository layout; `bun shp graph stats` and `bun shp explain SYMBOL` are
  available.

Return the final audit as a single JSON object matching the configured JSON
schema:

- status `"pass"` with an empty gaps array when none of the uncovered files
  belong to an architecture-significant subsystem lacking coverage, `"gaps"`
  when they do, and `"error"` only when the audit itself could not run.
- For each gap report subsystem, files, why_significant, and suggested_shapes
  (which Layer-2 component, boundary, or invariant shapes to author).

Do not include prose, Markdown, or code fences outside that object. Do not
modify tracked repository files.
