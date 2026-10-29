// @ts-nocheck
// DRT: runs a (patched) prototype copy on every case and writes its projected output.
//   DRT_FIX=T1,T2 bun run-ts.ts <derive.ts of the copy> <list.tsv> <outDir> [--shard i/n]
// The copy reads DRT_FIX at load time; each fix is a root-cause patch (see patch_proto.py).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { projectOut } from "./project.ts";

const argv = process.argv.slice(2);
const [deriveModule, listFile, outDir] = argv;
let shard = [0, 1];
for (let i = 3; i < argv.length; i += 1)
  if (argv[i] === "--shard") shard = argv[++i].split("/").map(Number);
const { derive } = await import(deriveModule);
mkdirSync(outDir, { recursive: true });
const lines = readFileSync(listFile, "utf8").split("\n").filter(Boolean);
lines.forEach((line, j) => {
  if (j % shard[1] !== shard[0]) return;
  const [id, path] = line.split("\t");
  const out = `${outDir}/${id}.json`;
  if (existsSync(out)) return;
  let input;
  try {
    input = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    writeFileSync(out, JSON.stringify({ status: "unreadable", error: String(e).slice(0, 200) }));
    return;
  }
  const t0 = performance.now();
  try {
    const full = derive(input);
    writeFileSync(
      out,
      JSON.stringify({ status: "ok", ms: Math.round(performance.now() - t0), ...projectOut(full) })
    );
  } catch (e) {
    writeFileSync(
      out,
      JSON.stringify({ status: "ts-error", error: String(e?.stack ?? e).slice(0, 600) })
    );
  }
});
