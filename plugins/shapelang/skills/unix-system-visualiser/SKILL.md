---
name: unix-system-visualiser
description: >-
  This skill should be used to generate and browser-validate a deterministic,
  self-contained Jurassic Park Unix-system-style visual atlas of a repository's
  authored Shape model. Use it for repositories that contain authored `.shape`
  files. Do not use it to infer runtime behavior, replace Shape validation, or
  visualize repositories that do not use Shape.
---

# Unix System Visualiser

## Boundary

Generate one local HTML atlas from the deterministic model returned by `shp inspect --json`. The map shows authored Shape claims. It is not proof that the implementation or runtime behaves as modeled.

Do not:

- parse `.shape` files with regular expressions or a second parser;
- use generated AST Shape as authored architecture evidence;
- fetch fonts, scripts, images, or other network assets;
- edit authored Shape or application source as part of visualization;
- commit the generated HTML unless the user explicitly requests it.

The generator requires inspection schema version `1`. Fail clearly when the installed Shape CLI does not support that schema. Do not add a parser fallback.

The generator excludes declarations classified as `generated_ast`. They remain available from `shp inspect --json` as navigation evidence, but this atlas presents only authored declarations as architecture claims.

## Workflow

1. Resolve the repository root and its canonical Shape command. Read its dependency manifest or wrapper before choosing `shp`, `bun shp`, or another existing command. Run the resolved command with `--version` and reuse it.
2. Confirm that the repository contains authored Shape and that the canonical check succeeds. If the check fails, stop with `blocked_invalid_model`; do not generate a misleading partial map.
3. Resolve the directory that contains this `SKILL.md` as `<SKILL_DIR>`. Generate the atlas:

   ```bash
   node <SKILL_DIR>/scripts/generate.mjs \
     --repo <REPOSITORY_ROOT> \
     --shape-command "<SHAPE_COMMAND>"
   ```

   The default output is `.research/unix-system-visualiser/index.html`. The generator requires the output to be inside the repository and ignored by Git. Use `--output <IGNORED_PATH>` when the repository uses another ignored research directory.
4. Hash the output, run the same generator command again, and hash it again. The hashes must match. Treat a mismatch as `blocked_invalid_model` and report it as a generator determinism defect.
5. Serve the output only on a local loopback address or open it as a local file. Use the available browser-control tool to validate the generated artifact at desktop and narrow viewport sizes.
6. In the browser, confirm all of the following:
   - the page title is `Unix System Visualiser`;
   - there are no page or console errors;
   - `window.__unixSystemVisualiser.ready` becomes `true`;
   - `ids()` is non-empty and `snapshot()` counts agree with the visible overview;
   - `focusById(ids()[0])` selects a tile and `settle()` completes;
   - the locate field, overview control, motion control, keyboard focus, and reduced-motion mode work;
   - the layout remains usable at a narrow viewport and at 200 percent zoom;
   - the page makes the authored-claims versus runtime-proof boundary visible.
7. Stop the local server, if used. Keep only the ignored HTML artifact.

## Output Contract

Return exactly one status:

- `complete`: Shape validation, generation, determinism, and browser checks passed.
- `blocked_invalid_model`: authored Shape is invalid, inspection data is incomplete, generation fails, or deterministic output cannot be reproduced.
- `blocked_unignored_output`: no safe ignored output path exists. Do not bypass this guard without explicit user approval.
- `tooling_unavailable`: the canonical Shape CLI, inspection schema version `1`, Node.js, or browser-control capability is unavailable.

Report:

```text
Status: complete | blocked_invalid_model | blocked_unignored_output | tooling_unavailable
Output: <repository-relative path or none>
Shape command: <resolved command and version>
Model counts: <documents, components, resources, functions, relations, and total tiles>
Determinism: <matching hashes or failure>
Browser validation: <desktop, narrow viewport, zoom, interaction, accessibility, and console results>
Evidence boundary: Authored Shape claims, not verified runtime behaviour.
```

Do not report `complete` from static HTML inspection alone.

## Resources

- `scripts/generate.mjs`: validates Shape and the output location, invokes `shp inspect --json`, assembles the bundled assets, and writes the self-contained artifact.
- `lib/atlas-model.mjs`: converts inspection schema version `1` into the authored atlas model using exact qualified identities.
- `assets/index.template.html` and `assets/styles.css`: the offline document shell and presentation.
- `assets/renderer/*.mjs`: ordered Canvas, detail, interaction, accessibility, and browser-validation sources that the generator inlines into the artifact.
