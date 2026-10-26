// @ts-nocheck
// DRT fixture runner: differential run of prototype CheckInput files against the Lean kernel.
//   bun run-files.ts <shapek> <out.jsonl> <saveDir> <timeoutMs> (--list <file> | <input.json>...) [--shard i/n]
// One JSON row per input: {file, status, diffs, stats, tsMs, leanMs}. Inputs whose comparison differs
// are saved to <saveDir>/<name>.{kcase,ts,lean}.json for triage.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { diffOne } from "./drtlib.ts";

const argv = process.argv.slice(2);
const [exe, outFile, saveDir, timeoutStr] = argv;
let files = [];
let shard = null;
for (let i = 4; i < argv.length; i += 1) {
  if (argv[i] === "--list") files.push(...readFileSync(argv[++i], "utf8").split("\n").filter(Boolean));
  else if (argv[i] === "--shard") shard = argv[++i].split("/").map(Number);
  else files.push(argv[i]);
}
if (shard) files = files.filter((_, j) => j % shard[1] === shard[0]);
mkdirSync(saveDir, { recursive: true });
for (const f of files) {
  let input;
  try {
    input = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    appendFileSync(outFile, `${JSON.stringify({ file: f, status: "unreadable", error: String(e).slice(0, 200) })}\n`);
    continue;
  }
  const r = diffOne(input, exe, Number(timeoutStr));
  const name = `${basename(f, ".json")}__${f.split("/").slice(-3, -1).join("_")}`;
  if (r.status === "differ" || r.status === "kernel-error" || r.status === "kernel-invalid") {
    writeFileSync(`${saveDir}/${name}.kcase.json`, JSON.stringify(r.kcase));
    if (r.tsFull) writeFileSync(`${saveDir}/${name}.ts.json`, JSON.stringify(r.tsFull));
    if (r.lean) writeFileSync(`${saveDir}/${name}.lean.json`, JSON.stringify(r.lean));
  }
  const row = { file: f, status: r.status, diffs: r.diffs ?? [], stats: r.stats ?? null, error: r.error ?? null, errors: r.errors ?? null, tsMs: Math.round(r.tsMs ?? 0), leanMs: Math.round(r.leanMs ?? 0) };
  appendFileSync(outFile, `${JSON.stringify(row)}\n`);
  process.stderr.write(`${r.status} ${basename(f)} ${(r.diffs ?? []).length} diffs ts ${Math.round(r.tsMs ?? 0)}ms lean ${Math.round(r.leanMs ?? 0)}ms\n`);
}
