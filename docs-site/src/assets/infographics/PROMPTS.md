# Shape Infographic Prompts

These prompts were written with the `$infographic` skill conventions and use `@file:DESIGN.md` as the style reference. Density is `medium`, orientation is `landscape`, and the intended audience is technical readers of the Shape docs.

## Inspection Notes

- `shape-model-loop.png` was regenerated once to remove invented sample code, filenames, and non-Shape domain details.
- `core-vocabulary-map.png` was regenerated once after the first pass misspelled `Ownership`.
- `design-memory-reevaluation.png` was regenerated after the first pass rendered `guards on_change` with an extra underscore.
- `hypercycle-witness-path.png` was regenerated for the hypergraph redesign to teach the witness-path concept using `calls`/`callbacks` relations and a `forbid hypercycle` rule. The asset uses generic `Component A`/`Component B` names because earlier image-generation passes misspelled real project component names; using generic names keeps the diagram pedagogical without inviting a bad project term into the rendered text.
- `quickstart-loop.png` was regenerated once to remove platform logos from the install panel.
- The saved assets were visually inspected for label spelling, layout coherence, and unsupported Shape behavior before embedding.

## Page-Local Pass

These additional prompts were intentionally lower-density than the first set. Each prompt used the same `@file:DESIGN.md` style reference, landscape 16:9 canvas, high-quality generation, exact visible-label constraints, and a ban on fake code, filenames, decorative clutter, and unsupported Shape behavior.

| Asset | Page | Required visible labels |
| --- | --- | --- |
| `quickstart-loop.png` | `learn/quickstart.md` | `Quickstart Loop`, `install shp`, `shape files`, `shp check`, `diagnostics`, `update model`, `CI` |
| `first-shape-file-map.png` | `learn/first-shape-file.md` | `First Shape File`, `Resource`, `Component`, `Function summary`, `Effect`, `Evidence`, `checker reads claims` |
| `component-boundary-grants.png` | `concepts/components-ownership-grants.md` | `Component Boundary`, `Component`, `owns`, `grants`, `functions`, `relation (external)`, `not runtime allocation` |
| `evidence-review-path.png` | `concepts/evidence-source-refs.md` | `Evidence Path`, `Claim`, `Effect`, `Evidence`, `Source span`, `Reviewer checks`, `checker keeps provenance` |
| `implementation-coverage-map.png` | `concepts/implementations-coverage.md` | `Implementation Coverage`, `source paths`, `implementation`, `component`, `changed file`, `shape delta`, `attestation`, `coverage gate` |
| `unknowns-safety-states.png` | `concepts/unknowns-safety.md` | `Unknowns Stay Visible`, `effects unknown`, `review blocker`, `effects complete`, `known effects`, `memory`, `known constraint` |
| `hypercycle-witness-path.png` | `concepts/rules-hypercycles.md` | `Hypercycle Witness Path`, `Component A`, `Component B`, `calls`, `callbacks`, `forbid hypercycle`, `witness path`, `rejected` |
| `analyzer-advisory-scan.png` | `concepts/analyzer-hints.md` | `Analyzer Hints`, `source scan`, `DELETE`, `TRUNCATE`, `DROP`, `.shape model`, `warning`, `source of truth` |
| `diagnostics-causal-trail.png` | `concepts/diagnostics-provenance.md` | `Diagnostic Causal Trail`, `function claim`, `effect`, `resource`, `trait`, `constraint`, `provenance`, `source evidence` |
| `fact-lowering-map.png` | `inside-shape/fact-lowering.md` | `Fact Lowering`, `declarations`, `apply changes`, `effective model`, `facts`, `rules`, `diagnostics`, `provenance` |
| `rule-evaluation-board.png` | `inside-shape/rule-evaluation.md` | `Rule Evaluation`, `facts`, `final forbid`, `missing grant`, `coverage`, `design memory`, `hypercycle rule`, `pass`, `reject` |
| `review-helpers.png` | `inside-shape/formatter-editor-authoring.md` | `Review Helpers`, `formatter`, `editor APIs`, `authoring`, `stable diff`, `diagnostics`, `effects unknown`, `human fills evidence` |
| `shape-boundary.png` | `inside-shape/design-rationale.md` | `Shape Boundary`, `agent drafts claims`, `human reviews claims`, `checker rejects incoherence`, `tests remain`, `code review remains`, `not a proof system` |

## shape-model-loop.png

Parameters: context=`docs-site/src/content/docs/index.md`, `docs-site/src/content/docs/learn/what-is-shape.md`; orientation=landscape; level=medium; format=markdown; model=gpt-image-2; quality=high; size=1680x944.

```text
Use case: infographic-diagram
Asset type: docs-site hero and concept explainer

Create a landscape 16:9 infographic for senior software engineers learning Shape.
Use @file:DESIGN.md as the visual style reference.

Design system:
professional enterprise workstation aesthetic; Space Grotesk typography; Arbitrum Blue #00639a, deep slate text, light structured surfaces; tight 4px-grid alignment, compact panels, crisp 1px borders; tonal layering instead of soft shadows; high-density but readable information hierarchy.
Also use Shape-specific SWE-native architecture surfaces: code diff, .shape claims, source evidence, deterministic checker, CI gate, and diagnostics.

Main message:
Shape turns human and agent-authored architecture claims into reviewable, deterministic CI feedback.

Required visible text:
- "Shape Review Loop"
- "Code diff"
- "Agent draft"
- ".shape claims"
- "Human review"
- "Source evidence"
- "Unknowns"
- "shp check"
- "CI gate"
- "Diagnostics"

Required layout:
- Left-to-right workflow with a subtle return loop from "Diagnostics" back to "Human review".
- Left cluster: "Code diff" and "Agent draft".
- Center cluster: ".shape claims", "Human review", "Source evidence", and "Unknowns".
- Right cluster: "shp check", "CI gate", and "Diagnostics".
- Use blue arrows for model flow, violet accent only for "Agent draft", amber only for "Unknowns", red only for failed "Diagnostics", and green for passing CI cues.

Text rendering rules:
- Render every quoted label verbatim, exactly once, with no extra characters, no duplicate labels, and no spelling changes.
- Do not render any visible text other than the quoted labels.
- Use large readable Space Grotesk text with strong contrast.

Content constraints:
- Do not imply Shape proves implementation correctness.
- Do not imply analyzer hints replace .shape files.
- No stock photography, decorative blockchain art, glowing AI clouds, ornamental orbs, illegible microtext, or invented logos.
```

## core-vocabulary-map.png

Parameters: context=`docs-site/src/content/docs/concepts/resources-traits-effects.md`, `docs-site/src/content/docs/concepts/components-ownership-grants.md`, `docs-site/src/content/docs/learn/first-shape-file.md`; orientation=landscape; level=medium; format=markdown; model=gpt-image-2; quality=high; size=1680x944.

```text
Use case: infographic-diagram
Asset type: docs concept explainer

Create a landscape 16:9 infographic for senior software engineers learning Shape vocabulary.
Use @file:DESIGN.md as the visual style reference.

Design system:
professional enterprise workstation aesthetic; Space Grotesk typography; Arbitrum Blue #00639a, deep slate text, light structured surfaces; tight 4px-grid alignment, compact panels, crisp 1px borders; tonal layering instead of soft shadows; high-density but readable information hierarchy.

Main message:
Shape models architecture as resources, traits, effects, components, grants, and evidence-backed function summaries.

Required visible text:
- "Core Vocabulary"
- "Resource"
- "Trait"
- "Effect"
- "Component"
- "Ownership"
- "Grant"
- "Evidence"
- "AuditEvent"
- "AppendOnly"
- "Append<AuditEvent>"

Required layout:
- Hub-and-spoke concept map with "Component" as the central working surface.
- Place "Resource" and "AuditEvent" on the left as the governed target.
- Place "Trait" and "AppendOnly" above the resource, connected as a constraint source.
- Place "Effect" and "Append<AuditEvent>" to the right as the function behavior.
- Place "Ownership", "Grant", and "Evidence" as compact callouts around the component.
- Use blue for normal model relationships, green for allowed effects, and thin slate edges for structural links.

Text rendering rules:
- Render every quoted label verbatim, exactly once, with no extra characters, no duplicate labels, and no spelling changes.
- Do not render any visible text other than the quoted labels.
- Use large readable Space Grotesk text with strong contrast.

Content constraints:
- Do not add runtime implementation claims.
- Do not show a full code block; use schematic panels only.
- No decorative clutter, stock images, invented logos, or illegible microtext.
```

## append-only-rejection.png

Parameters: context=`docs-site/src/content/docs/learn/append-only-walkthrough.md`, `docs-site/src/content/docs/concepts/components-ownership-grants.md`, `docs-site/src/content/docs/concepts/diagnostics-provenance.md`; orientation=landscape; level=medium; format=markdown; model=gpt-image-2; quality=high; size=1680x944.

```text
Use case: infographic-diagram
Asset type: docs concept explainer

Create a landscape 16:9 infographic for senior software engineers learning Shape's append-only failure path.
Use @file:DESIGN.md as the visual style reference.

Design system:
professional enterprise workstation aesthetic; Space Grotesk typography; Arbitrum Blue #00639a, deep slate text, light structured surfaces; tight 4px-grid alignment, compact panels, crisp 1px borders; tonal layering instead of soft shadows; high-density but readable information hierarchy.

Main message:
A final forbid derived from `AppendOnly` rejects `HardDelete<AuditEvent>` even when a component grants the effect.

Required visible text:
- "Final Forbid Wins"
- "AuditEvent"
- "AppendOnly"
- "forbid final"
- "Grant"
- "HardDelete<AuditEvent>"
- "witness path"
- "rejected"

Required layout:
- Three horizontal stages: resource policy, function claim, diagnostic result.
- Stage 1 shows "AuditEvent" carrying "AppendOnly" and "forbid final".
- Stage 2 shows "Grant" and "HardDelete<AuditEvent>" in tension.
- Stage 3 shows a red diagnostic rail with "witness path" leading to "rejected".
- Use a red stop marker only at the final diagnostic; keep the rest technical and restrained.

Text rendering rules:
- Render every quoted label verbatim, exactly once, with no extra characters, no duplicate labels, and no spelling changes.
- Do not render any visible text other than the quoted labels.
- Use large readable Space Grotesk text with strong contrast.

Content constraints:
- Do not imply grants override final forbids.
- Do not imply design memory or review can waive this failure.
- No decorative clutter, stock images, invented logos, or illegible microtext.
```

## pr-change-review.png

Parameters: context=`docs-site/src/content/docs/learn/pr-change-files.md`, `docs-site/src/content/docs/concepts/change-files-attestations.md`, `docs-site/src/content/docs/concepts/implementations-coverage.md`, `docs-site/src/content/docs/learn/ci-workflow.md`; orientation=landscape; level=medium; format=markdown; model=gpt-image-2; quality=high; size=1680x944.

```text
Use case: infographic-diagram
Asset type: docs workflow explainer

Create a landscape 16:9 infographic for senior software engineers learning Shape PR workflows.
Use @file:DESIGN.md as the visual style reference.

Design system:
professional enterprise workstation aesthetic; Space Grotesk typography; Arbitrum Blue #00639a, deep slate text, light structured surfaces; tight 4px-grid alignment, compact panels, crisp 1px borders; tonal layering instead of soft shadows; high-density but readable information hierarchy.

Main message:
PRs apply a change file on top of the baseline model, while coverage verifies governed source paths were documented.

Required visible text:
- "PR Change Review"
- "shape/system"
- "shape/changes"
- "changed files"
- "shape delta"
- "attestation"
- "effects unknown"
- "coverage"
- "shp check"
- "CI result"

Required layout:
- Two-layer workflow: top layer shows model application from "shape/system" plus "shape/changes" into "shp check"; bottom layer shows "changed files" into "coverage".
- Show "shape delta" and "attestation" as alternate documentation paths for governed changes.
- Show "effects unknown" as an amber review blocker, not as a pass state.
- Right side merges "coverage" and "shp check" into "CI result".

Text rendering rules:
- Render every quoted label verbatim, exactly once, with no extra characters, no duplicate labels, and no spelling changes.
- Do not render any visible text other than the quoted labels.
- Use large readable Space Grotesk text with strong contrast.

Content constraints:
- Do not imply attestations replace reevaluations for guarded function changes.
- Do not imply unknown effects are a safe final state.
- No decorative clutter, stock images, invented logos, or illegible microtext.
```

## design-memory-reevaluation.png

Parameters: context=`docs-site/src/content/docs/concepts/refactor-constraints.md`, `docs-site/src/content/docs/concepts/change-files-attestations.md`, `docs-site/src/content/docs/concepts/unknowns-safety.md`; orientation=landscape; level=medium; format=markdown; model=gpt-image-2; quality=high; size=1680x944.

```text
Use case: infographic-diagram
Asset type: docs concept explainer

Create a landscape 16:9 infographic for senior software engineers learning Shape design-memory constraints.
Use @file:DESIGN.md as the visual style reference.

Design system:
professional enterprise workstation aesthetic; Space Grotesk typography; Arbitrum Blue #00639a, deep slate text, light structured surfaces; tight 4px-grid alignment, compact panels, crisp 1px borders; tonal layering instead of soft shadows; high-density but readable information hierarchy.

Main message:
Function shape traits create typed review obligations; guarded changes require `ReEvaluation`, but design memory never waives final forbids.

Required visible text:
- "Design Memory"
- "Function shape trait"
- "memory"
- "rationale"
- "guards on_change"
- "modify fn"
- "ReEvaluation"
- "review obligation"
- "not a waiver"
- "final forbids still apply"

Required layout:
- Left panel: function summary with "Function shape trait".
- Middle panel: "memory" and "rationale" feeding into "review obligation".
- Upper connector: "guards on_change" protecting the function.
- Right panel: "modify fn" requires "ReEvaluation".
- Bottom red/amber rule strip: "not a waiver" and "final forbids still apply".
- Use violet only for design memory surfaces, amber for obligations, red for the non-waiver rule strip.

Text rendering rules:
- Render every quoted label verbatim, exactly once, with no extra characters, no duplicate labels, and no spelling changes.
- Do not render any visible text other than the quoted labels.
- Use large readable Space Grotesk text with strong contrast.

Content constraints:
- Do not imply memory can make forbidden effects pass.
- Do not imply a source-path attestation satisfies a guarded function reevaluation.
- No decorative clutter, stock images, invented logos, or illegible microtext.
```

## checker-pipeline.png

Parameters: context=`docs-site/src/content/docs/inside-shape/checker-pipeline.md`, `docs-site/src/content/docs/inside-shape/fact-lowering.md`, `docs-site/src/content/docs/inside-shape/rule-evaluation.md`; orientation=landscape; level=medium; format=markdown; model=gpt-image-2; quality=high; size=1680x944.

```text
Use case: infographic-diagram
Asset type: docs internals explainer

Create a landscape 16:9 infographic for senior software engineers learning Shape checker internals.
Use @file:DESIGN.md as the visual style reference.

Design system:
professional enterprise workstation aesthetic; Space Grotesk typography; Arbitrum Blue #00639a, deep slate text, light structured surfaces; tight 4px-grid alignment, compact panels, crisp 1px borders; tonal layering instead of soft shadows; high-density but readable information hierarchy.

Main message:
Shape deterministically transforms modules into facts, runs semantic rules, and emits diagnostics with provenance.

Required visible text:
- "Checker Pipeline"
- "Parse"
- "Apply changes"
- "Lower facts"
- "Run rules"
- "Emit diagnostics"
- "facts"
- "rules"
- "provenance"
- "forbidden effect"
- "missing grant"

Required layout:
- Five-stage left-to-right pipeline: "Parse", "Apply changes", "Lower facts", "Run rules", "Emit diagnostics".
- Under "Lower facts", show a compact "facts" tray.
- Under "Run rules", show a compact "rules" tray with "forbidden effect" and "missing grant".
- Under "Emit diagnostics", show "provenance" as the causal trail.
- Use clean blue pipeline arrows, slate fact trays, red only for failing rule examples.

Text rendering rules:
- Render every quoted label verbatim, exactly once, with no extra characters, no duplicate labels, and no spelling changes.
- Do not render any visible text other than the quoted labels.
- Use large readable Space Grotesk text with strong contrast.

Content constraints:
- Do not invent extra checker stages.
- Do not imply source analysis is required for parser or rule evaluation.
- No decorative clutter, stock images, invented logos, or illegible microtext.
```
