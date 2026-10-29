// @ts-nocheck
// DRT7 case lists: writes the tab-separated "<id>\t<set>\t<source>" lists gate7.ts runs.
//   bun lists7.ts corpus <corpusDir> <set> <out.tsv>          every <id>.input.json of a corpus dir
//   bun lists7.ts files <dir> <set> <prefix> <out.tsv>       every *.json input under a fixture dir
//   bun lists7.ts vectors <m0 vectors dir> <out.tsv>        every M0 vector case (set vectors52 or
//                                                           vectors-full for A.16.1(g)'s four)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode, ...a] = process.argv.slice(2);
const FULL = new Set([
  "full-profile-blob-ids",
  "full-profile-pack-pins",
  "full-profile-parse-failure",
  "full-profile-manifest-identity"
]);
const lines = [];
if (mode === "corpus") {
  const [dir, set, out] = a;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".input.json"))
    .sort((x, y) => Number(x.slice(1).split(".")[0]) - Number(y.slice(1).split(".")[0])))
    lines.push(`${f.replace(".input.json", "")}\t${set}\t${join(dir, f)}`);
  writeFileSync(out, `${lines.join("\n")}\n`);
} else if (mode === "files") {
  const [dir, set, prefix, out] = a;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".json"))
    .sort())
    lines.push(`${prefix}${f.replace(/(\.input)?\.json$/, "")}\t${set}\t${join(dir, f)}`);
  writeFileSync(out, `${lines.join("\n")}\n`);
} else if (mode === "vectors") {
  const [root, out] = a;
  for (const v of readdirSync(root).sort()) {
    const ef = join(root, v, "expected.json");
    if (!existsSync(ef)) continue;
    for (const c of JSON.parse(readFileSync(ef, "utf8")).cases)
      lines.push(
        `V-${v}--${c.case}\t${FULL.has(v) ? "vectors-full" : "vectors52"}\tvector:${join(root, v)}#${c.case}`
      );
  }
  writeFileSync(out, `${lines.join("\n")}\n`);
} else {
  process.stderr.write("usage: bun lists7.ts corpus|files|vectors ...\n");
  process.exit(2);
}
