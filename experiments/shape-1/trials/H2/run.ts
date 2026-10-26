// @ts-nocheck
// H2 drift trial driver.
//   bun experiments/shape-1/trials/H2/run.ts prep --arm A|X --work <dir>
//   bun experiments/shape-1/trials/H2/run.ts dry --work <dir>             apply every seed, check parses
//   bun experiments/shape-1/trials/H2/run.ts run --arm A|X --work <dir> [--only S01,E01] [--shard i/n]
//   bun experiments/shape-1/trials/H2/run.ts meta --work <dir>            seed metadata -> <dir>/seeds.json
// Rows are appended to <work>/rows-<arm>-<k>of<n>.jsonl (one JSON object per seed).
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { materialize } from "../../dogfood/tools/lib.ts";
import { Tree, loadBase, prepareBase, runSeed } from "./harness.ts";
import { SEEDS } from "./seeds.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const work = resolve(opt("work") ?? "h2-work");
mkdirSync(work, { recursive: true });
const arm = (opt("arm") ?? "A") as "A" | "X";

if (cmd === "prep") {
  const t0 = performance.now();
  const b = await prepareBase(arm, work);
  process.stdout.write(`base ${arm} ${b.revision}: ${b.baseRecords.length} base records, ${b.judged.length} judgments (${b.judgmentSkipped.length} laws skipped: ${b.judgmentSkipped.join(", ")}), ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
} else if (cmd === "dry") {
  const { loadTs } = await import("../../dogfood/providers/ts-ident.ts");
  const dir = materialize("HEAD", join(work, "trees", "dry-pristine"));
  const ts = await loadTs(dir);
  for (const s of SEEDS) {
    const d = materialize("HEAD", join(work, "trees", `dry-${s.id}`));
    const t = new Tree(d);
    let err = "";
    try {
      s.apply(t);
    } catch (e) {
      err = String(e);
    }
    const bad = [];
    for (const f of t.touched) {
      if (!/\.(ts|mts|mjs|js)$/.test(f)) continue;
      const sf = ts.createSourceFile(f, t.read(f), ts.ScriptTarget.Latest, true);
      if ((sf.parseDiagnostics ?? []).length > 0) bad.push(f);
    }
    process.stdout.write(`${s.id} ${err ? `APPLY-ERROR ${err}` : "ok"} touched=${[...t.touched].join(",")}${bad.length ? ` PARSE-ERRORS=${bad.join(",")}` : ""}\n`);
    rmSync(d, { recursive: true, force: true });
  }
  rmSync(dir, { recursive: true, force: true });
} else if (cmd === "run") {
  const base = loadBase(arm, work);
  const only = opt("only") ? new Set(opt("only").split(",")) : null;
  const [k, n] = (opt("shard") ?? "0/1").split("/").map(Number);
  const list = SEEDS.filter((s) => !only || only.has(s.id)).filter((_, i) => i % n === k);
  const out = join(work, `rows-${arm}-${k}of${n}.jsonl`);
  for (const s of list) {
    try {
      const row = await runSeed(arm, s, work, base);
      appendFileSync(out, `${JSON.stringify(row)}\n`);
      const intro = row.obligations.filter((o) => o.introduced);
      process.stderr.write(`${arm} ${s.id} ${row.verdict} errors=${row.errors.length} introduced=${intro.length} [${intro.map((o) => `${o.kind}:${o.claim ?? (typeof o.subject === "string" ? o.subject : "")}`).join("; ")}] ${row.seconds.total}s\n`);
    } catch (e) {
      appendFileSync(out, `${JSON.stringify({ arm, seed: s.id, crash: String(e?.stack ?? e) })}\n`);
      process.stderr.write(`${arm} ${s.id} CRASH ${String(e)}\n`);
    }
  }
} else if (cmd === "meta") {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(work, "seeds.json"), `${JSON.stringify(SEEDS.map(({ apply: _a, ...m }) => m), null, 1)}\n`);
  process.stdout.write(`${SEEDS.length} seeds\n`);
} else throw new Error("usage: run.ts prep|dry|run|meta ...");
