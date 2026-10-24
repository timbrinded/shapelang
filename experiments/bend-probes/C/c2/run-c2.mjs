// C2 driver: generates mutants, type-checks them, and runs the kill techniques.
// Phase 1 runs pbt (fast-check, 1,000 runs, seed 42) and small (bounded
// exhaustive) on every mutant; phase 2 runs large (bigger exhaustive scope plus
// boundary values) and bigpbt (100,000 runs, seed 7, boundary-biased) on every
// mutant that phase 1 did not kill with both techniques.
// Usage: bun run-c2.mjs   (writes $CWORK/c2/results.json)
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { REPO, CDIR, WORK } from "../lib/work.mjs";
import { MUTANTS } from "./mutants.mjs";

const OUT = join(WORK, "c2");
const MDIR = join(OUT, "mutants");
rmSync(MDIR, { recursive: true, force: true });
const jobs = [];
for (const [kind, list] of Object.entries(MUTANTS)) {
  const source = readFileSync(join(CDIR, "c2/modules", `${kind}.ts`), "utf8");
  mkdirSync(join(MDIR, kind), { recursive: true });
  writeFileSync(join(MDIR, kind, "ORIGINAL.ts"), source);
  for (const [id, op, find, replace, tag] of list) {
    const first = source.indexOf(find);
    if (first < 0 || source.indexOf(find, first + 1) >= 0) throw new Error(`${id}: find text must occur exactly once`);
    const mutated = source.slice(0, first) + replace + source.slice(first + find.length);
    const file = join(MDIR, kind, `${id}.ts`);
    writeFileSync(file, mutated);
    jobs.push({ kind, id, op, large: tag === "large", file, find, replace });
  }
}

// Type-check every mutant with the repository's strictness flags.
writeFileSync(
  join(MDIR, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler",
      strict: true, noUncheckedIndexedAccess: true, noEmit: true, types: []
    },
    include: ["**/*.ts"]
  })
);
const tsc = spawnSync(join(REPO, "node_modules/.bin/tsgo"), ["-p", join(MDIR, "tsconfig.json")], { encoding: "utf8" });
const typeErrors = {};
for (const line of (tsc.stdout + tsc.stderr).split("\n")) {
  const m = line.match(/([A-Za-z]+)\/([A-Z]\d+|ORIGINAL)\.ts\(\d+,\d+\): error (TS\d+): (.*)/);
  if (m) (typeErrors[`${m[1]}/${m[2]}`] ??= []).push(`${m[3]} ${m[4]}`);
}
if (Object.keys(typeErrors).some((k) => k.endsWith("ORIGINAL"))) throw new Error("original modules do not type-check");

function run(job, technique, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("bun", [join(CDIR, "c2/eval.mjs"), job.kind, job.file, technique], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return resolve({ killed: true, law: "timeout (non-termination)", timeout: true });
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop()));
      } catch {
        resolve({ killed: true, law: `crash: ${stderr.trim().split("\n").slice(-3).join(" | ")}`, crash: true, code });
      }
    });
  });
}

async function pool(tasks, width) {
  let next = 0;
  const workers = Array.from({ length: width }, async () => {
    while (next < tasks.length) await tasks[next++]();
  });
  await Promise.all(workers);
}

const results = jobs.map((job) => ({
  kind: job.kind, id: job.id, op: job.op, large: job.large, find: job.find, replace: job.replace,
  typeErrors: typeErrors[`${job.kind}/${job.id}`] ?? [], techniques: {}
}));
const byId = new Map(results.map((r) => [r.id, r]));
const phase = async (filter, techniques, timeoutMs) => {
  const tasks = [];
  for (const job of jobs) {
    if (!filter(byId.get(job.id))) continue;
    for (const technique of techniques) {
      tasks.push(async () => {
        byId.get(job.id).techniques[technique] = await run(job, technique, timeoutMs);
        process.stderr.write(".");
      });
    }
  }
  await pool(tasks, 4);
  process.stderr.write("\n");
};
await phase(() => true, ["pbt", "small"], 120_000);
await phase((r) => !(r.techniques.pbt.killed && r.techniques.small.killed), ["large", "bigpbt"], 900_000);

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
for (const r of results) {
  const t = r.techniques;
  const cell = (x) => (x === undefined ? "-" : x.killed ? "K" : ".");
  console.log(
    [r.id, r.op, r.large ? "large" : "", r.typeErrors.length ? "TS-ERR" : "ts-ok", cell(t.pbt), cell(t.small), cell(t.large), cell(t.bigpbt),
      [t.pbt, t.small, t.large, t.bigpbt].find((x) => x?.killed)?.law ?? ""].join("\t")
  );
}
