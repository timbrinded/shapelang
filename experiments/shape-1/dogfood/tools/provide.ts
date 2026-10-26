// Runs the dogfood providers over a tree and writes their signed records.
//
//   bun experiments/shape-1/dogfood/tools/provide.ts --out <dir> [--root <dir>] [--now <rfc3339>]
//        [--only bunTest,tsClockScan,tsCalls]
//
// --root: a materialised tree (default: the repository working tree plus the dogfood files).
// Writes <out>/<provider>.jsonl (DSSE envelopes) and <out>.summary.json (outside <out>, which
// `check --records <out>` reads whole).
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { filesFromDir } from "../../proto/src/manifest-build.ts";
import { runLaws } from "../providers/bun-test.ts";
import { writeJsonl } from "../providers/common.ts";
import { callScan } from "../providers/ts-calls.ts";
import { clockScan } from "../providers/ts-clock-scan.ts";
import { DOGFOOD_REL, REPO, dogfoodFiles, manifestFor, readModel, workingTreeFiles } from "./lib.ts";

const argv = process.argv.slice(2);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const out = resolve(opt("out") ?? "dogfood-records");
const root = resolve(opt("root") ?? REPO);
const now = opt("now") ?? "2026-10-26T00:00:00Z";
const only = new Set((opt("only") ?? "bunTest,tsClockScan,tsCalls").split(","));

const files = root === REPO ? workingTreeFiles() : [...filesFromDir(root).filter((f) => !f.path.startsWith(`${DOGFOOD_REL}/`)), ...dogfoodFiles(root)];
const m = await manifestFor(files);
const source = readModel();
const summary: Record<string, unknown> = { revision: m.revision, root };
const t = (): number => performance.now();

if (only.has("tsClockScan")) {
  const t0 = t();
  const r = await clockScan({ root, manifest: m.statement, now });
  writeJsonl(join(out, "tsClockScan.jsonl"), [r.envelope]);
  summary.tsClockScan = { record: r.id, files: r.files, facts: r.facts, sites: r.sites, incompleteFiles: r.incomplete.length, incomplete: r.incomplete, seconds: Number(((t() - t0) / 1000).toFixed(1)) };
}
if (only.has("tsCalls")) {
  const t0 = t();
  const r = await callScan({ root, manifest: m.statement, now });
  writeJsonl(join(out, "tsCalls.jsonl"), [r.envelope]);
  summary.tsCalls = { record: r.id, files: r.files, facts: r.facts, external: r.external, unresolved: r.unresolved, seconds: Number(((t() - t0) / 1000).toFixed(1)) };
}
if (only.has("bunTest")) {
  const t0 = t();
  const r = await runLaws({ root, manifest: m.statement, source, now });
  writeJsonl(join(out, "bunTest.jsonl"), r.records.map((x) => x.envelope));
  summary.bunTest = {
    exitCode: r.exitCode,
    records: r.records.map((x) => ({ law: x.law, result: x.result, id: x.id })),
    verdicts: r.verdicts.length,
    missingClaims: r.missingClaims,
    unprovable: r.unprovable,
    seconds: Number(((t() - t0) / 1000).toFixed(1))
  };
}
writeFileSync(`${out}.summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
process.stdout.write(`${JSON.stringify(summary, (k, v: unknown) => (k === "sites" || k === "incomplete" || k === "records" ? (Array.isArray(v) ? v.length : v) : v), 1)}\n`);
