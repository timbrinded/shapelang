// @ts-nocheck
// Re-derives dumped H3 check inputs under the stock prototype, V-new and V-new2 (and, with
// --kernel, the Lean kernel shapek), so the introduced-rule variants can be compared on exactly the
// inputs the main runs used, without re-running providers.
//   bun experiments/shape-1/trials/H3/replay-dumps.ts --out <rows.jsonl> [--kernel <shapek>] <input.json>...
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { toSeconds } from "../../proto/src/util.ts";
import { compact } from "./lib.ts";
import { buildVariant } from "./variant-checker.ts";

const argv = process.argv.slice(2);
const take = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const OUT = take("out") ?? "/dev/stdout";
const KERNEL = take("kernel");
if (OUT !== "/dev/stdout") rmSync(OUT, { force: true });
const checkers = { stock: derive, vnew: (await import(buildVariant("vnew"))).derive, vnew2: (await import(buildVariant("vnew2"))).derive };

function krecords(list) {
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
  const base = elaborate(input.base.source, { lenient: true, now });
  const gv = buildGov(base, base.policy, input.authors ?? []);
  const owners = [];
  for (const c of base.components) for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
  for (const c of head.components) for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  const cells = computeCells(owners).cells.filter((c) => typeof c.b === "string" && typeof c.h === "string").map((c) => [c.b, c.h]);
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now: Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now),
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base: { revision: input.base.revision, esf: base, manifest: input.base.manifest },
    cells,
    records: krecords(input.records),
    reviews: [],
    baseRecords: krecords(input.baseRecords)
  };
}

for (const f of argv) {
  const input = JSON.parse(readFileSync(f, "utf8"));
  for (const [name, d] of Object.entries(checkers)) {
    const t0 = performance.now();
    const out = d(input);
    appendFileSync(
      OUT,
      `${JSON.stringify({ input: basename(f), checker: name, verdict: out.verdict, errors: out.errors.map((e) => ({ code: e.code, subject: e.subject })), obligations: out.obligations.filter((o) => o.introduced || o.kind === "contradiction" || o.kind === "unestablished").map(compact), ms: Math.round(performance.now() - t0) })}\n`
    );
  }
  if (KERNEL) {
    const t0 = performance.now();
    const r = spawnSync(KERNEL, [], { input: JSON.stringify(kernelCase(input)), maxBuffer: 1 << 30 });
    let row;
    try {
      const out = JSON.parse(r.stdout.toString());
      row = { input: basename(f), checker: "kernel", verdict: out.verdict, errors: (out.errors ?? []).map((e) => ({ code: e.code, subject: e.subject })), obligations: (out.obligations ?? []).filter((o) => o.introduced || o.kind === "contradiction" || o.kind === "unestablished").map(compact) };
    } catch {
      row = { input: basename(f), checker: "kernel", crash: `exit ${r.status} ${r.stderr.toString().slice(0, 300)}` };
    }
    row.ms = Math.round(performance.now() - t0);
    appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  }
  process.stderr.write(`${basename(f)}\n`);
}
