// usage: bun host.mjs <tag.mjs> <marker-file>
import { writeFileSync } from "node:fs";
const [mod, marker] = process.argv.slice(2);
const Tag = (await import(mod)).default;
const out = Tag.tag((s) => {
  writeFileSync(marker, "written by a closure inside a pure def");
  console.log("EFFECT:host-callback");
  return s;
}, "x");
console.log("result=" + out);
