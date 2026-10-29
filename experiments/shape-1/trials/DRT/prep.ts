// @ts-nocheck
// DRT pre-pass: for each case (id<TAB>path lines), runs the unpatched prototype once, keeps its
// projected output (baseline TS), and writes the kernel case (pre-pass as in drtlib.kernelCase).
//   bun prep.ts <list.tsv> <kcaseDir> <tsOutDir> [--shard i/n]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { kernelCase, runTs } from "./drtlib.ts";
import { projectOut } from "./project.ts";

const argv = process.argv.slice(2);
const [listFile, kDir, tsDir] = argv;
let shard = [0, 1];
for (let i = 3; i < argv.length; i += 1)
  if (argv[i] === "--shard") shard = argv[++i].split("/").map(Number);
mkdirSync(kDir, { recursive: true });
mkdirSync(tsDir, { recursive: true });
const lines = readFileSync(listFile, "utf8").split("\n").filter(Boolean);
lines.forEach((line, j) => {
  if (j % shard[1] !== shard[0]) return;
  const [id, path] = line.split("\t");
  if (existsSync(`${kDir}/${id}.kcase.json`) && existsSync(`${tsDir}/${id}.json`)) return;
  let input;
  try {
    input = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    writeFileSync(
      `${tsDir}/${id}.json`,
      JSON.stringify({ status: "unreadable", error: String(e).slice(0, 200) })
    );
    return;
  }
  const ts = runTs(input);
  if (ts.error) {
    writeFileSync(
      `${tsDir}/${id}.json`,
      JSON.stringify({ status: "ts-error", error: ts.error, ms: Math.round(ts.ms) })
    );
    return;
  }
  writeFileSync(
    `${tsDir}/${id}.json`,
    JSON.stringify({ status: "ok", ms: Math.round(ts.ms), ...projectOut(ts.full) })
  );
  if (ts.full.verdict === "invalid") return;
  try {
    writeFileSync(`${kDir}/${id}.kcase.json`, JSON.stringify(kernelCase(input, ts.full)));
  } catch (e) {
    writeFileSync(`${kDir}/${id}.prepass-error.txt`, String(e?.stack ?? e));
  }
});
