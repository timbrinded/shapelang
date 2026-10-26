// Composes Shape's 1.0 model: shape/*.shape (0.x) → shp migrate → shape1.yaml overlay →
// experiments/shape-1/dogfood/model.source.json. Prints what the overlay merged, added and
// dropped, and the elaboration errors of the result.
//
//   bun experiments/shape-1/dogfood/tools/compose.ts [--check]
//
// --check: fail (exit 1) if model.source.json is not what composition produces.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MODEL_PATH, claimIndex, composeModel, manifestFor, workingTreeFiles } from "./lib.ts";

const check = process.argv.includes("--check");
const m = await manifestFor(workingTreeFiles());
const comp = composeModel(m.statement);
const text = `${JSON.stringify(comp.source, null, 1)}\n`;
const { claims, errors } = claimIndex(comp.source, Math.floor(Date.parse("2026-10-26T00:00:00Z") / 1000));

const counts = new Map<string, number>();
for (const mod of comp.source.modules) for (const d of mod.decls) counts.set(d.decl, (counts.get(d.decl) ?? 0) + 1);
const ops = new Map<string, number>();
for (const c of claims) ops.set(c.op, (ops.get(c.op) ?? 0) + 1);

process.stderr.write(`manifest ${m.revision} (${m.backend})\n`);
process.stderr.write(`migrate notes: ${comp.migrateNotes.length}; unit sources rewritten: ${comp.rewrites.length}\n`);
process.stderr.write(`overlay: merged ${comp.merged.length}, added ${comp.added.length}, dropped ${comp.droppedDecls.length}\n`);
process.stderr.write(`declarations: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}\n`);
process.stderr.write(`claims: ${claims.length} (${[...ops.entries()].map(([k, v]) => `${k} ${v}`).join(", ")})\n`);
process.stderr.write(`elaboration errors: ${errors.length}\n`);
for (const e of errors) process.stderr.write(`  ${e.code} ${e.subject}: ${e.message}\n`);

if (check) {
  const cur = existsSync(MODEL_PATH) ? readFileSync(MODEL_PATH, "utf8") : "";
  if (cur !== text) {
    process.stderr.write("model.source.json is stale: run tools/compose.ts\n");
    process.exit(1);
  }
} else writeFileSync(MODEL_PATH, text);
process.exit(errors.length > 0 ? 1 : 0);
