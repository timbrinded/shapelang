// @ts-nocheck
// H6: identities the dogfood model attributes to `ungoverned`, by directory and language.
//   bun experiments/shape-1/trials/H6/ungoverned-ids.ts <work>   (needs <work>/manifest.json)
import { readModel } from "../../dogfood/tools/lib.ts";
import { elaborateAt, manifestFor } from "../../proto/providers/common.ts";
import { UNGOVERNED, buildWorld } from "../../proto/src/world.ts";

const work = process.argv[2] ?? "h6-work";
const man = await manifestFor({ manifest: `${work}/manifest.json` });
const W = buildWorld(elaborateAt(readModel(), "2026-10-26T00:00:00Z"), man.index, { side: "h" });
const byTop = {};
const byLang = {};
let files = 0;
for (const [id, info] of W.man.ids) {
  if (W.att(id) !== UNGOVERNED) continue;
  const parts = info.path.split("/");
  const top = info.path.startsWith("packages/")
    ? parts.slice(0, 4).join("/")
    : parts.slice(0, info.path.startsWith("experiments/") ? 2 : 1).join("/");
  byTop[top] = (byTop[top] ?? 0) + 1;
  byLang[info.lang] = (byLang[info.lang] ?? 0) + 1;
  if (info.kind === "file") files += 1;
}
const total = Object.values(byTop).reduce((a, b) => a + b, 0);
process.stdout.write(
  `${JSON.stringify({ total, identities: W.man.ids.size, files, byLang, byTop: Object.fromEntries(Object.entries(byTop).sort((a, b) => b[1] - a[1])) }, null, 1)}\n`
);
