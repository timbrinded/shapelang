# Shape Design System

This document governs the visual language of the docs site and its diagrams. The site's colours and fonts live in `docs-site/src/styles/tokens.css` and `docs-site/src/styles/custom.css`. This file describes how to use them. It does not duplicate their values.

## Content rules

Every picture must be as accurate as the prose beside it.

- A diagram earns its place only when it shows relationships, order, or state more clearly than prose or a table. Otherwise, write the prose or the table.
- Every label is a real Shape term, command, diagnostic title, or file path, or a plain statement that the surrounding page supports. Use exact spellings such as `shp check`, `effects unknown`, `forbid final`, and `reevaluation`.
- A `.shape` snippet inside a diagram must be a syntactically valid fragment and must match the page's own example. Application code appears only as muted bars, never as invented code.
- A diagram must not imply any of these:
  - Shape proves implementation correctness.
  - `effects unknown` is a safe final state.
  - A grant, rationale, memory, reevaluation, or attestation overrides a final forbid.
  - Structural links live inside a component.
  - Advisory output (drafts, analyzer hints, critic advisories) decides whether a model passes.
  - An attestation satisfies a guard or replaces a `reevaluation`.
  - `shp check` reads or runs application source.
  - `owns` is runtime allocation.
- The Markdown alt text states the diagram's assertion in one sentence. The SVG's `<title>` names the figure, and its `<desc>` restates the assertion.

## Site

- **Fonts.** Geist Variable and Geist Mono Variable, loaded through `@fontsource-variable/geist*` in `custom.css`.
- **Colours.** The tokens in `tokens.css` define the palette; most have a dark-theme override, while `--shape-pass`, `--shape-warn`, and `--shape-fail` keep one value in both themes. Blue (`--shape-blue`) marks model flow and links. Green, amber, and red (`--shape-pass`, `--shape-warn`, `--shape-fail`) are state colours: pass, unknown or pending review, and rejection. `--shape-agent` (violet, defined in `custom.css`) is used only for the home hero kicker.
- **Layout.** The home page uses a text-only hero (`docs-site/src/components/Hero.astro`). Content pages rely on Starlight defaults, plus the rules in `custom.css`.

## Diagrams

Diagrams are hand-authored SVG files in `docs-site/src/assets/diagrams/`. Each file is its own source; nothing generates them. Pages embed a diagram with Markdown image syntax. The README may embed the same file by repository path.

An SVG loaded through `<img>` cannot read the site's CSS variables, does not reliably follow the theme toggle, and cannot load web fonts. Each diagram therefore carries its own palette and background. The palette switches through `@media (prefers-color-scheme: dark)`, which follows the colour scheme the browser reports to the image, usually the reader's system preference. The light theme renders as a drafting sheet and the dark theme as a blueprint. Because the plate paints its own background, it stays legible when the site theme and the system theme differ.

### File contract

- `viewBox="0 0 960 H"`, where H is a multiple of 16, usually 400 to 560. Omit `width` and `height`, so the figure scales to the content column.
- Include `role="img"` and `aria-labelledby` pointing at `<title>` and `<desc>`.
- No scripts, external references, embedded raster images, or web fonts. Keep each file under 16 KB.
- Text and labels meet WCAG AA contrast against the plate in both themes.
- The file must pass `xmllint --noout`.

### Plate anatomy

- **Background.** A paper rectangle, a 16 px minor grid, and an 80 px major grid, all as patterns.
- **Border.** A double rule: the outer rule is `x=10.5 y=10.5`, 1 px ink; the inner rule is `x=14.5 y=14.5`, 0.6 px in the rule colour.
- **Title block.** Bottom right, 236 × 35. The left cell holds the Shape mark and the right cell holds the figure's short name in lower-case mono at 11 px.
- **Headings.** At most two per plate: a mono kicker (11 px, uppercase, letter-spacing 1.6) above a sans heading (19 px, weight 650).
- **Text.** Everything else is mono. Body labels and annotations are 11.5 to 12.5 px; node names may use 13 to 14 px at weight 700; secondary annotations may use 11 px. Nothing is smaller than 11 px.

### Palette

The diagram palette is independent of the site tokens. Its values are tuned for the paper and blueprint plates, so a change to `tokens.css` does not require changing the diagrams. The colour meanings are the same in both.

Copy this `<style>` block verbatim into every diagram. Use only these classes; never write a raw colour on an element.

```css
.paper{fill:#f6f4ee}.grid{stroke:#e6e1d4}.gridM{stroke:#dbd4c4}
.ink{fill:#1d2b34}.inkS{stroke:#1d2b34}.mute{fill:#5d6c74}.muteS{stroke:#8a959a}
.rule{stroke:#b8b09f}.card{fill:#fffdf8;stroke:#1d2b34}.band{fill:#0b6e99;fill-opacity:.1}
.blue{fill:#0b6e99}.blueS{stroke:#0b6e99}.pass{fill:#16734b}.passS{stroke:#16734b}
.warn{fill:#8f5a0c}.warnS{stroke:#b7791f}.fail{fill:#c23b32}.failS{stroke:#c23b32}.hatch{stroke:#c9c1ae}
.markBg{fill:#101820}.markA{fill:#45c4b0}.markB{fill:#f4b942}
.mono{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
.sans{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){
  .paper{fill:#0c1a23}.grid{stroke:#13252f}.gridM{stroke:#1a303c}
  .ink{fill:#dbe7ec}.inkS{stroke:#dbe7ec}.mute{fill:#8fa4ae}.muteS{stroke:#6f8792}
  .rule{stroke:#35505e}.card{fill:#10222d;stroke:#dbe7ec}.band{fill:#5bb8e6;fill-opacity:.12}
  .blue{fill:#5bb8e6}.blueS{stroke:#5bb8e6}.pass{fill:#46c28b}.passS{stroke:#46c28b}
  .warn{fill:#e0a33a}.warnS{stroke:#e0a33a}.fail{fill:#ec6a5f}.failS{stroke:#ec6a5f}.hatch{stroke:#233946}
  .markBg{fill:#dbe7ec}
}
```

`docs-site/src/assets/diagrams/product-boundary.svg` is the reference implementation. Copy its `<defs>` (grids, hatch, arrow and dot markers) and its title block rather than redrawing them.

### Encoding

Colour always travels with a label or a glyph, so no meaning depends on colour alone.

| Meaning | Encoding |
| --- | --- |
| Structure, declarations | Ink strokes on `card` panels |
| Model flow, emphasis | Blue stroke with an arrow marker |
| Pass | Green stroke and a ✓ glyph |
| Unknown, obligation pending | Amber dashed outline |
| Rejection, final forbid | Red stroke, a ✕ glyph, and the diagnostic title |
| Outside the checker, or a forbidden zone | Diagonal `hatch` fill |
| Feedback or return path | Dashed line (`5 4`) |
| Reference to source (`source`, `evidence`) | Dotted leader (`2 3`) ending in a dot |
| Checker boundary | Heavy dashed rule (`7 5`) |
| Input file such as `changed.txt` | Card with a fine dashed outline (`3 2`) |

Strokes are 1 to 1.6 px; the muted bars that stand in for application code are 3 px with round caps. Connectors run orthogonally or as gentle cubic curves, and every arrow is a real flow, dependency, or causal step.

### Review before committing

1. Render the light theme: `rsvg-convert -w 1440 NAME.svg -o /tmp/NAME.png`.
2. Render the dark theme: `chromium --headless=new --force-dark-mode --window-size=960,H --screenshot=/tmp/NAME-dark.png file://$PWD/NAME.svg`.
3. Inspect both renders for overlaps, clipped text, and spelling.
4. Check every label against the page that embeds the diagram.
