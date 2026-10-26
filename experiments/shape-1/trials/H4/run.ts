// @ts-nocheck
// Runs every H4 case (built by build.ts) through:
//   proto   shape1 check (the 1.0 prototype's decider), runs fwd, fwdu, rev, and `orig`
//           (the unmodified fixture dirs with --synthesize, fixtures/loosening only)
//   kernel  the Lean kernel's shapek on each prototype input, converted as kernel/test/bridge.ts does
//   zerox   0.x `shp check --base-model <base> --check-loosening [--changed-files]`
//   sem     the syntactic inspect diff of experiments/bend-probes/E/e2-semantic-diff.ts
// Usage: bun run.ts <casesDir> <outDir> [shapek]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify, contextEntries, diff, inspect } from "../../../bend-probes/E/e2-semantic-diff.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { toSeconds } from "../../proto/src/util.ts";
import { CASES, REPO } from "./cases.ts";

const [casesDir, outDir, shapekArg] = process.argv.slice(2);
if (!casesDir || !outDir) throw new Error("usage: bun run.ts <casesDir> <outDir> [shapek]");
const SHAPEK = shapekArg ?? join(REPO, "experiments/shape-1/kernel/.lake/build/bin/shapek");
const CLI = join(REPO, "experiments/shape-1/proto/src/cli.ts");
const SHP = join(REPO, "packages/shp-cli/src/index.ts");
const NOW = "2026-10-25T12:00:00Z";
mkdirSync(outDir, { recursive: true });

// ---- kernel case conversion: copied from experiments/shape-1/kernel/test/bridge.ts (kernelCase) ----
function records(list) {
  const parsed = [];
  for (const x of list ?? []) {
    const r = parseRecord(x);
    if (!r.error) parsed.push(r);
  }
  return mergeRecords(parsed).map((r) => ({ id: r.id, predicate: { shape: r.shape }, authenticated: r.signers.length > 0 }));
}
function kernelCase(input) {
  const now = toSeconds(input.now);
  const head = elaborate(input.head.source, { now });
  const base = input.base?.source ? elaborate(input.base.source, { lenient: true, now }) : null;
  const gov = input.mode === "audit" || !base ? head : base;
  const gv = buildGov(gov, gov.policy, input.authors ?? []);
  const reviews = [];
  for (const rv of input.reviews ?? []) {
    const actor = gv.byIdentity.get(rv.identity.trim());
    if (actor) reviews.push({ actor, line: rv.line, change: rv.change ?? input.change.ids[0] });
  }
  const owners = [];
  if (base && input.mode !== "audit") {
    for (const c of base.components) for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
    for (const c of head.components) for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  }
  // bridge.ts passes [] when no component has paths; the prototype always computes cells, which
  // then holds the (ungoverned, ungoverned) cell, so do the same here
  const cells =
    base && input.mode !== "audit"
      ? computeCells(owners).cells.filter((c) => typeof c.b === "string" && typeof c.h === "string").map((c) => [c.b, c.h])
      : [];
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now: Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now),
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base: input.mode === "audit" || !input.base ? null : { revision: input.base.revision, esf: base ?? { shape: { q: "", owner: "" } }, manifest: input.base.manifest },
    cells,
    records: records(input.records),
    reviews,
    baseRecords: records(input.baseRecords)
  };
}

function proto(id, run, modelDir, baseDir) {
  const inp = join(outDir, `${id}.${run}.input.json`);
  const t0 = performance.now();
  const r = spawnSync(
    "bun",
    [CLI, "check", "--model", modelDir, "--base", baseDir, "--synthesize", "--maintainer", "alice", "--maintainer", "bob", "--now", NOW, "--json", "--write-input", inp],
    { cwd: REPO, maxBuffer: 1 << 28 }
  );
  const ms = Math.round(performance.now() - t0);
  let out = null;
  try {
    out = JSON.parse(r.stdout.toString());
  } catch {
    out = { verdict: "crash", stderr: r.stderr.toString().slice(0, 2000) };
  }
  writeFileSync(join(outDir, `${id}.${run}.proto.json`), JSON.stringify(out, null, 1));
  // kernel on the same input
  let kout = null;
  let kms = null;
  if (existsSync(inp)) {
    const kc = kernelCase(JSON.parse(readFileSync(inp, "utf8")));
    writeFileSync(join(outDir, `${id}.${run}.kcase.json`), JSON.stringify(kc));
    const k0 = performance.now();
    const kr = spawnSync(SHAPEK, [join(outDir, `${id}.${run}.kcase.json`)], { maxBuffer: 1 << 28 });
    kms = Math.round(performance.now() - k0);
    try {
      kout = JSON.parse(kr.stdout.toString());
    } catch {
      kout = { verdict: "crash", stdout: kr.stdout.toString().slice(0, 2000), stderr: kr.stderr.toString().slice(0, 2000) };
    }
    writeFileSync(join(outDir, `${id}.${run}.kernel.json`), JSON.stringify(kout, null, 1));
  }
  return { exit: r.status, ms, kms, stderr: r.stderr.toString().trim().split("\n").slice(-3) };
}

function zerox(headDir, baseDir, changed, extra = []) {
  const args = [SHP, "check", "--base-model", baseDir, "--check-loosening", ...extra];
  if (changed) args.push("--changed-files", changed);
  const r = spawnSync("bun", args, { cwd: headDir, maxBuffer: 1 << 26 });
  const text = `${r.stdout}${r.stderr}`;
  return { exit: r.status, ruleLoosening: /error: rule loosening/.test(text), firstError: (text.match(/^error: .*$/m) ?? [null])[0], edits: [...text.matchAll(/^This change (.*)$/gm)].map((m) => m[1]), text };
}

const summary = [];
for (const c of CASES) {
  const d = join(casesDir, c.id);
  const row = { id: c.id, family: c.family, runs: {} };
  for (const run of ["fwd", "fwdu", "rev"]) row.runs[run] = proto(c.id, run, join(d, run, "head"), join(d, run, "base"));
  if (c.family === "loosening") row.runs.orig = proto(c.id, "orig", c.head, c.base);
  // 0.x: uniform form on the built dirs, plus the repository's parity-test form on the fixture dirs
  const changed = join(d, "changed-files.txt");
  row.zerox = { uniform: zerox(join(d, "fwd/head"), join(d, "fwd/base"), changed) };
  row.zerox.uniformAllowUnknown = zerox(join(d, "fwd/head"), join(d, "fwd/base"), changed, ["--allow-unknown-effects"]);
  if (c.family === "loosening") {
    const fxc = join(c.base, "..", "changed-files.txt");
    row.zerox.parity = zerox(c.head, "../base", existsSync(fxc) ? "../changed-files.txt" : null);
  }
  // syntactic inspect diff
  const B = inspect(join(d, "fwd/base"));
  const Hh = inspect(join(d, "fwd/head"));
  const sem = classify(B, Hh, { base: contextEntries(join(d, "fwd/base")), cand: contextEntries(join(d, "fwd/head")) });
  row.sem = { rawChanges: diff(B, Hh).map((x) => `${x.kind} ${x.coll} ${x.id}`), ...sem };
  for (const k of Object.keys(row.zerox)) {
    writeFileSync(join(outDir, `${c.id}.zerox-${k}.txt`), row.zerox[k].text);
    delete row.zerox[k].text;
  }
  summary.push(row);
  process.stderr.write(`${c.id}: fwd ${row.runs.fwd.exit} rev ${row.runs.rev.exit} 0.x ${row.zerox.uniform.exit} sem ${sem.findings.length}\n`);
}
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
