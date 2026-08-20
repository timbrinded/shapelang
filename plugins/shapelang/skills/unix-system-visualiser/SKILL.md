---
name: unix-system-visualiser
description: >-
  This skill should be used to generate and browser-validate a deterministic,
  self-contained Jurassic Park Unix-system-style visual atlas and guided
  architecture journeys from a repository's authored Shape model. Use it for
  repositories that contain authored `.shape` files. Do not use it to infer
  runtime behavior, replace Shape validation, or visualize repositories that do
  not use Shape.
---

# Unix System Visualiser

## Boundary

Generate one local HTML atlas from the deterministic model returned by `shp inspect --json`. The map and its guided journeys show authored Shape claims and dependency topology. They are not proof that the implementation or runtime behaves as modeled.

Do not:

- parse `.shape` files with regular expressions or a second parser;
- use generated AST Shape as authored architecture evidence;
- fetch fonts, scripts, images, or other network assets;
- edit authored Shape or application source as part of visualization;
- commit the generated HTML unless the user explicitly requests it.

The generator requires inspection schema version `1`. Fail clearly when the installed Shape CLI does not support that schema. Do not add a parser fallback.

The generator excludes declarations classified as `generated_ast`. They remain available from `shp inspect --json` as navigation evidence, but this atlas presents only authored declarations as architecture claims.

The atlas creates two clearly labeled journey tiers:

- `Authored journey`: the exact ordered endpoints of an authored `coordinated_call` relation.
- `Inferred dependency tour`: a deterministic, cycle-safe path through authored binary `calls` and `callbacks` relations. It is a navigation aid, not execution order.

Use only relation identity, endpoint order and roles, graph indegree, and declaration descriptions returned by inspection. Do not inspect application source or use declaration-name guesses to manufacture a runtime scenario.

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
   - when journeys exist, the preset selector, written narration, progress, seek, previous, play/pause, next, restart, and speed controls agree with `journeySnapshot()`;
   - authored journeys and inferred dependency tours are visibly distinct, manual map interaction pauses playback, and playback stops at the final step;
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
Journeys: <authored journey and inferred dependency-tour counts>
Determinism: <matching hashes or failure>
Browser validation: <desktop, narrow viewport, zoom, journey controls, interaction, accessibility, and console results>
Evidence boundary: Authored Shape claims, not verified runtime behaviour.
```

Do not report `complete` from static HTML inspection alone.

## Resources

- `scripts/generate.mjs`: validates Shape and the output location, invokes `shp inspect --json`, assembles the bundled assets, and writes the self-contained artifact.
- `lib/atlas-model.mjs`: converts inspection schema version `1` into the authored atlas model using exact qualified identities.
- `lib/journey-model.mjs`: extracts ordered authored journeys and deterministic inferred dependency tours without runtime claims.
- `assets/index.template.html` and `assets/styles.css`: the offline document shell and presentation.
- `assets/renderer/*.mjs`: ordered Canvas, detail, journey player, interaction, accessibility, and browser-validation sources that the generator inlines into the artifact.
