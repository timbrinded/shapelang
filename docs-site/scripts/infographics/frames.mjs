/**
 * Generate the production HTML frames used for Shape documentation images.
 *
 * Concepts contain semantic content only. The shared template owns layout,
 * typography, icons, connectors, and validation hooks.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { concepts } from "./concepts.mjs";
import { renderFrame } from "./frame-template.mjs";
import { writeIconCss } from "./generate-icons.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const framesDir = join(here, "frames");

mkdirSync(framesDir, { recursive: true });
writeIconCss();

for (const concept of concepts) {
  writeFileSync(join(framesDir, `${concept.name}.html`), renderFrame(concept), "utf8");
  console.log(`wrote ${concept.name}.html`);
}
