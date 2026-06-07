# Shape contract review

You are running in GitHub Actions through Claude Code. Review the pull request
diff for Shape contract drift and populate the configured structured-output
fields. Do not print a prose explanation.

## Required method

1. Read `AGENTS.md` when it exists.
2. Read `changed.txt`; this is the current changed-file set.
3. Treat every `.shape` file under `shape/` and nested subdirectories as the
   durable Shape model. There is no `shape/system` split.
4. Read changed source files and relevant Shape files.
5. Run or inspect the Shape checks:
   - `bun shp check --changed-files changed.txt`
   - `bun shp obligations`
   - `bun shp memory`
   - `bun shp explain <symbol>` when a symbol needs local context
   - `bun shp analyze` only as advisory evidence, never as the finding itself
6. Decide whether changed behavior is faithfully represented by current
   `shape/**/*.shape` changes or by a narrow current attestation.

## Report drift

Report a finding when a changed source file materially changes architecture
contract behavior and the committed Shape model does not faithfully represent
it. Contract behavior includes component responsibility, resources, effects,
dependencies, implementation mappings, permissions, trust boundaries,
guards/rationales, and runtime architecture defaults.

Also report Shape changes that claim behavior unsupported by the changed source
diff. Do not count unchanged Shape files as a current Shape update.

Do not report formatting-only changes, comments, local renames, docs-only
changes, tests-only changes, or behavior already faithfully represented by a
current Shape update or current attestation.

## Output

The GitHub Action passes a JSON schema through `--json-schema`. Populate these
structured-output fields; do not write a file or print a standalone Markdown
response:

```json
{
  "status": "pass | drift | error",
  "summary": "one sentence, max 280 chars",
  "findings": [
    {
      "severity": "warning | error",
      "target": "path/to/changed/source-or-shape-file",
      "shape_source": "shape/file.shape | missing-durable-shape",
      "issue": "short label",
      "reason": "1-2 short sentences explaining the mismatch",
      "source_quote": "verbatim source or diff snippet, max 200 chars",
      "shape_quote": "verbatim Shape snippet, max 200 chars, or empty",
      "suggested_fix": "minimal durable Shape change or source change"
    }
  ]
}
```

Use `status: "pass"` only with an empty `findings` array. Use
`status: "drift"` for verified faithfulness findings. Use `status: "error"` for
ambiguous scope, contradictory repo instructions, invalid Shape output, or an
inability to inspect the relevant files.
