// @ts-nocheck
// DRT: runs a kernel executable on every prepared kernel case, optionally with a list of root-cause
// patches (the scratch copy reads "drtFix" from the case; the original kernel ignores it).
//   bun run-k.ts <shapek> <list.tsv> <kcaseDir> <outDir> <fix,fix|-> <timeoutMs> [--shard i/n]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const [exe, listFile, kDir, outDir, fixes, timeoutStr] = argv;
let shard = [0, 1];
for (let i = 6; i < argv.length; i += 1) if (argv[i] === "--shard") shard = argv[++i].split("/").map(Number);
const fixList = fixes === "-" ? null : fixes.split(",").filter(Boolean);
mkdirSync(outDir, { recursive: true });
const lines = readFileSync(listFile, "utf8").split("\n").filter(Boolean);
lines.forEach((line, j) => {
  if (j % shard[1] !== shard[0]) return;
  const [id] = line.split("\t");
  const out = `${outDir}/${id}.json`;
  if (existsSync(out)) return;
  const kfile = `${kDir}/${id}.kcase.json`;
  if (!existsSync(kfile)) return;
  let text = readFileSync(kfile, "utf8");
  if (fixList) {
    const k = JSON.parse(text);
    k.drtFix = fixList;
    text = JSON.stringify(k);
  }
  const t0 = performance.now();
  const r = spawnSync(exe, [], { input: text, maxBuffer: 1 << 30, timeout: Number(timeoutStr) });
  const ms = Math.round(performance.now() - t0);
  if (r.error || r.signal) {
    writeFileSync(out, JSON.stringify({ status: r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM" ? "timeout" : "error", error: String(r.error ?? r.signal), ms }));
    return;
  }
  try {
    writeFileSync(out, JSON.stringify({ status: "ok", ms, ...JSON.parse(r.stdout.toString()) }));
  } catch {
    writeFileSync(out, JSON.stringify({ status: "unparsable", ms, stdout: r.stdout.toString().slice(0, 300), stderr: r.stderr.toString().slice(0, 300) }));
  }
});
