# Source-To-Model Drift Review

Use this reference for `shape-lang` mode `drift-review`. Review changed source behavior against the current authored Shape model. Do not review the code for general bugs and do not score checker-valid contract loosening.

## Evidence Contract

1. Read the exact changed-file set and changed source diff.
2. Inspect authored `.shape` files recursively under the repository's Shape root.
3. Run the current combined check when changed files are available:

   ```bash
   <SHAPE_CMD> check --changed-files changed.txt
   ```

4. Run `obligations`, `memory`, focused `explain`, or `analyze` only when the evidence requires them.
5. Confirm material source behavior and compare it with current authored components, resources, effects, relations, implementations, bindings, permissions, trust boundaries, guards, and runtime architecture defaults.
6. Report changed Shape that claims behavior unsupported by the changed source.
7. Treat unchanged Shape files as context, not as a current update.

Do not report formatting, comments, local renames, docs-only changes, tests-only changes, or behavior faithfully represented by a current authored update or narrow current attestation.

## Result

Return:

```json
{
  "status": "pass | drift | error",
  "summary": "One concise sentence.",
  "findings": [
    {
      "severity": "warning | error",
      "target": "path/to/changed/source-or-shape-file",
      "shape_source": "shape/file.shape | missing-durable-shape",
      "issue": "Short mismatch label.",
      "reason": "Verified source-to-model mismatch.",
      "source_quote": "Short source or diff evidence.",
      "shape_quote": "Short Shape evidence or empty string.",
      "suggested_fix": "Smallest durable source or Shape correction."
    }
  ]
}
```

Use `pass` only with an empty findings array. Use `error` only when the review cannot obtain enough evidence to decide.
