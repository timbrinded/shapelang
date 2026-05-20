# Shape Design System

Shape is a typed architecture conformance language for reviewable systems. The visual system should feel like an engineering workstation becoming legible: precise, fast, agentic, and calm under pressure.

## Visual Thesis

Shape turns implicit architecture into executable review claims. The design should communicate that transformation with crisp technical surfaces, directional flow, and compact evidence trails instead of decorative blockchain or generic SaaS imagery.

Use this system for the docs site, generated infographics, slide-style explainers, and any future product UI around authoring, checking, and reviewing `.shape` files.

## Brand Qualities

- **Agentic:** show humans, LLMs, and deterministic tools working in a review loop.
- **SWE-native:** prefer code, diffs, facts, graphs, diagnostics, and CI signals over abstract metaphors.
- **Exciting but credible:** use kinetic arrows, scanner-like layers, and strong accent states, while keeping the page readable for senior engineers.
- **Inspectable:** every visual claim should have a clear source, target, state, or causal path.
- **Deterministic:** avoid mystical AI motifs. Shape is explicit claims plus a checker.

## Core Message

> Humans and LLMs write typed architecture claims; Shape makes those claims reviewable and checkable in CI.

The product boundary must stay visible:

- Shape checks declared architecture models, not arbitrary application correctness.
- `.shape` files are the architectural source of truth.
- Optional analyzer hints support review, but the declared model wins.
- Unknowns and design memory are explicit review surfaces, not waivers.

## Color System

The system is light-first with dark-mode parity. Favor structured surfaces and crisp contrast over shadows.

| Role | Token | Hex | Use |
| --- | --- | --- | --- |
| Primary | Conformance Blue | `#00639a` | Primary actions, active lines, accepted paths, key arrows |
| Primary Deep | Deep Slate | `#162936` | Body text, headings in light mode |
| Primary Ink | Review Ink | `#07151f` | High-emphasis text and code-adjacent labels |
| Surface | Workstation Surface | `#f6f9fb` | Page bands and infographics background |
| Surface Raised | Claim Panel | `#ffffff` | Compact panels, callouts, syntax blocks |
| Border | Rule Line | `#c8d8df` | 1px separators, graph edges, panel borders |
| Muted | Evidence Gray | `#5d7180` | Secondary copy, captions, provenance metadata |
| Success | Pass Green | `#19a66a` | Passing checks, allowed effects, completed review |
| Warning | Unknown Amber | `#d28b00` | Explicit unknowns, pending review, incomplete analysis |
| Failure | Forbid Red | `#d13b3b` | Final forbids, rejected effects, failing diagnostics |
| Agent | Agent Violet | `#6a5cff` | LLM-authored drafts, assistant-authored deltas |
| Human | Review Cyan | `#00a7b5` | Human review, evidence inspection, stewardship |

### Color Rules

- Keep Conformance Blue as the dominant accent, not the whole palette.
- Use failure red sparingly and only for real rejection states.
- Use amber only for explicit uncertainty, never as general decoration.
- Use violet only for agent/LLM activity or speculative drafts.
- In diagrams, color encodes state: blue for model flow, green for pass, amber for unknown, red for reject, violet for agent contribution.

## Typography

Primary typeface: **Space Grotesk**.

Fallback stack:

```css
font-family: "Space Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Monospace typeface:

```css
font-family: "IBM Plex Mono", "Berkeley Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

### Type Scale

| Role | Size | Weight | Line height |
| --- | --- | --- | --- |
| Hero | `clamp(3rem, 8vw, 6.5rem)` | 700 | `0.95` |
| Page H1 | `clamp(2.4rem, 5vw, 4.25rem)` | 700 | `1.0` |
| H2 | `clamp(1.65rem, 3vw, 2.3rem)` | 650 | `1.12` |
| H3 | `1.25rem` | 650 | `1.2` |
| Body | `1rem` | 400 | `1.72` |
| Dense label | `0.84rem` | 600 | `1.2` |
| Code | `0.9rem` | 450 | `1.55` |

Typography should be compact and precise. Do not use negative letter spacing. Use short labels in diagrams and avoid paragraph text inside images.

## Grid And Layout

- Base grid: **4px**.
- Page max width: use the Starlight content width, but let hero media and image bands breathe.
- Infographic canvases: `1680x944` for 16:9 landscape explainers; `1536x864` is acceptable for slide-compatible exports.
- Panel radius: `8px` maximum.
- Panel borders: `1px solid #c8d8df` or a color-mixed equivalent.
- Shadows: avoid soft SaaS shadows. Use tonal layering, hairline borders, and subtle inset highlights.
- Arrows: use clean orthogonal or gently curved paths with visible endpoints. Only draw arrows where a real data, review, or rule flow exists.

## Surface Language

The core visual metaphor is an architecture review bench:

- Left side: source code, diff, docs, changed files.
- Middle: `.shape` claims, evidence spans, facts, graphs, obligations.
- Right side: deterministic checker, CI gate, diagnostics.
- Lower rails: CLI commands, reviewer actions, generated artifacts.

Use compact panels as instruments, not generic cards. Each panel needs one job: input, claim, review, fact, rule, diagnostic, or decision.

## Icon And Shape System

Prefer simple stroked icons and schematic shapes:

- Document: source refs, evidence, change files.
- Hexagon or tag: traits.
- Cylinder: resources.
- Shield: grants, coverage, CI gate.
- Lightning bolt: effects.
- Branch graph: relation hyperedges and hypercycle witness paths.
- Terminal prompt: CLI commands.
- Spark line or small node: agent-authored draft.

Keep icons small and subordinate to labels. Technical labels and causal paths matter more than ornament.

## Motion Direction

When motion exists, it should help the reader understand review flow:

- Subtle entrance: hero text and workflow image appear as if a check completed.
- Hover: image surfaces brighten and reveal a crisp border.
- Scroll: diagrams can feel like stages in a pipeline, but should remain readable when static.

Avoid idle animation that competes with code samples.

## Docs Site Application

The docs should feel like a working reference, not a marketing page.

- Use the home page hero as a strong first signal: Shape name, product boundary, and a serious workflow image.
- Keep concept pages dense and readable.
- Place infographics before or after the section where they reduce cognitive load.
- Use images for concepts that involve a loop, pipeline, causal chain, graph, or review obligation.
- Keep code samples first-class. Diagrams should explain relationships around code, not replace code.
- Captions should state the purpose of the image, not describe its styling.

## Infographic Style

All generated infographic prompts must use `@file:DESIGN.md` as the visual style reference.

If a generation tool cannot resolve file references, include this style summary:

- professional enterprise workstation aesthetic
- Space Grotesk typography
- Arbitrum Blue `#00639a`, deep slate text, light structured surfaces
- tight 4px-grid alignment, compact panels, crisp 1px borders
- tonal layering instead of soft shadows
- high-density but readable information hierarchy

For Shape-specific outputs, also include:

- crisp SWE-native architecture diagrams
- `.shape` files, source evidence, deterministic checker, and CI as recurring surfaces
- blue/green/amber/red state encoding for flow, pass, unknown, and reject
- no stock photography, no decorative blockchain art, no vague AI clouds

### Infographic Label Rules

- Use medium information density by default.
- Use exact project terms: `Shape`, `.shape`, `shp check`, `effects complete`, `effects unknown`, `forbid final`, `ReEvaluation`.
- Keep labels short enough to render cleanly.
- Do not put full code blocks inside generated images; use schematic snippets only.
- Do not imply Shape proves implementation correctness.
- Do not imply unknowns are safe final states.
- Do not imply design memory can waive final forbids.

## Planned Infographic Set

| Asset | Primary Page | Concept |
| --- | --- | --- |
| `shape-model-loop.png` | Home, What Shape Is | Human and agent-authored claims become CI-enforced diagnostics |
| `quickstart-loop.png` | Quickstart | Install, check, diagnose, update, and repeat in CI |
| `first-shape-file-map.png` | First Shape File | Smallest useful model: resource, component, function, effect, evidence |
| `core-vocabulary-map.png` | Resources, Traits, and Effects | Resources, traits, effects, components, grants, and evidence |
| `component-boundary-grants.png` | Components, Ownership, and Grants | Component boundary with ownership, grants, functions, and an external relation hyperedge |
| `evidence-review-path.png` | Evidence and Source Refs | Declared claim linked to source span and reviewer inspection |
| `append-only-rejection.png` | Append-Only Walkthrough | Final forbids override grants and reject destructive effects |
| `pr-change-review.png` | PR Change Files, CI Workflow | Baseline model plus PR delta plus coverage or attestation |
| `implementation-coverage-map.png` | Implementations and Coverage | Governed source path changes require documentation |
| `design-memory-reevaluation.png` | Refactor Constraints | Function shape trait, memory/rationale, guard, reevaluation |
| `unknowns-safety-states.png` | Unknowns and Safety | Unknown effects, complete effects, and design memory are different states |
| `hypercycle-witness-path.png` | Rules and Hypercycles | Hypercycles in the directed hypergraph explain failure with witness paths |
| `analyzer-advisory-scan.png` | Analyzer Hints | Source analyzer hints are advisory, while `.shape` remains source of truth |
| `diagnostics-causal-trail.png` | Diagnostics and Provenance | Diagnostics should preserve causal trail and source evidence |
| `checker-pipeline.png` | Checker Pipeline | Parse, apply changes, lower facts, run rules, emit diagnostics |
| `fact-lowering-map.png` | Fact Lowering | Declarations and changes lower into uniform facts with provenance |
| `rule-evaluation-board.png` | Rule Evaluation | Rules read facts (including hypercycle rules) and produce pass or reject outcomes |
| `shape-boundary.png` | Design Rationale | Shape does not replace tests, code review, or proof boundaries |
| `review-helpers.png` | Formatter, Editor, and Authoring Helpers | Supporting helpers keep `.shape` files reviewable |

## Accessibility And Quality

- Images need meaningful alt text in Markdown or front matter.
- Do not depend on color alone; pair state color with a label or icon.
- Keep contrast above WCAG AA for text and diagram labels.
- Avoid microtext. If a label cannot be read at docs column width, remove it or make the image less dense.
- Generated images must be inspected before being committed. Regenerate if there are typos, malformed labels, impossible arrows, or visual artifacts that weaken trust.

## Anti-Patterns

- Generic AI sparkle clouds.
- Purple-blue gradient backgrounds as the main design.
- Crypto-chain decoration unrelated to Shape behavior.
- Marketing copy inside technical diagrams.
- Dense paragraphs inside images.
- Arrows that imply unsupported behavior.
- Decorative cards nested inside larger decorative cards.
- Ambiguous labels such as "magic", "intelligence", "proof", or "guaranteed correctness".
