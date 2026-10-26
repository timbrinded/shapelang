// @ts-nocheck
// Builds the counterfactual checker "V-new" in the scratch space: a copy of the prototype's src/
// whose only change is the introduced rule for law contradictions (proto/src/laws.ts). Stock rule
// (model §7.3, A.7.3.3): a law obligation is introduced iff Req(c) meets Δcode ∪ deleted, or its
// producer changed. V-new adds: a sound law contradiction is also introduced when the cone
// (code ∪ deps) of the contradicting record meets Δcode ∪ deleted and no base-revision record
// contradicted the same claim -- the law analogue of A.7.3.1's new-fact rule for observations.
// V-new2 (mode "vnew2") also stops an edit inside Req from re-introducing a contradiction the base
// revision already had.
//   bun experiments/shape-1/trials/H3/variant-checker.ts   → prints the variant's derive.ts path
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "./lib.ts";

const SRC = join(import.meta.dir, "..", "..", "proto", "src");

export function buildVariant(mode: "vnew" | "vnew2" = "vnew"): string {
  // one copy per process and mode: concurrent runs must not delete each other's copy
  const root = join(WORK, `proto-${mode}-${process.pid}`);
  const dst = join(root, "src");
  rmSync(root, { recursive: true, force: true });
  cpSync(SRC, dst, { recursive: true });
  const p = join(dst, "laws.ts");
  const s = readFileSync(p, "utf8");
  const from = `    const introduced = ctx.hasBase && (bindingReq.some((p) => changed.has(p.id)) || reason === "producer-changed");`;
  if (!s.includes(from)) throw new Error("variant-checker: anchor not found in laws.ts (prototype changed?)");
  const to = `    const reqIn = bindingReq.some((p) => changed.has(p.id));
    let coneNew = false;
    if (soundContra?.record) {
      const sr = soundContra.record.shape;
      const coneIds = [...(sr.code ?? []), ...(sr.deps ?? [])].map((x) => x.id);
      const baseContra = ctx.baseRecords.some((b) => b.shape.claim?.fp === c.fp && b.shape.result === "contradicts");
      coneNew = coneIds.some((x) => changed.has(x)) && !baseContra;
    }
    const introduced = ctx.hasBase && (reqIn || coneNew || reason === "producer-changed");`;
  // V-new2: a sound law contradiction is introduced iff Req or the record's cone meets the delta and
  // no base-revision record contradicted the claim (an old contradiction is never re-introduced by
  // editing its code); other law obligations keep the stock rule
  const to2 = `    const reqIn = bindingReq.some((p) => changed.has(p.id));
    let contraIntro = null;
    if (soundContra?.record) {
      const sr = soundContra.record.shape;
      const coneIds = [...(sr.code ?? []), ...(sr.deps ?? [])].map((x) => x.id);
      const baseContra = ctx.baseRecords.some((b) => b.shape.claim?.fp === c.fp && b.shape.result === "contradicts");
      contraIntro = (reqIn || coneIds.some((x) => changed.has(x))) && !baseContra;
    }
    const introduced = ctx.hasBase && ((contraIntro ?? reqIn) || reason === "producer-changed");`;
  writeFileSync(p, s.replace(from, mode === "vnew2" ? to2 : to));
  // the copied derive.ts imports siblings only ("./x.ts"); check nothing reaches back into proto/
  const d = readFileSync(join(dst, "derive.ts"), "utf8");
  if (/from "\.\.\//.test(d)) throw new Error("variant-checker: derive.ts imports outside src/");
  return join(dst, "derive.ts");
}

if (import.meta.main) {
  const p = buildVariant();
  process.stdout.write(`${p} ${existsSync(p) ? "ok" : "missing"}\n`);
}
