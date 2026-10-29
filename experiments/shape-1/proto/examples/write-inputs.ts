// Writes the worked examples' checker inputs (shape.check.input/v1) as JSON files into a directory:
//   bun experiments/shape-1/proto/examples/write-inputs.ts <outdir>
// then: bun experiments/shape-1/proto/src/cli.ts check --input <outdir>/ex1-B.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckInput } from "../src/io-types.ts";
import { ex1, ex2, ex3, ex3s2, ex4 } from "./fixtures.ts";

const all: Record<string, CheckInput> = {
  "ex1-audit": ex1("audit"),
  "ex1-empty-base": ex1("empty-base"),
  "ex1-A": ex1("A"),
  "ex1-B": ex1("B"),
  "ex1-B-weak-observer": ex1("B-weak"),
  "ex1-Bprime": ex1("Bprime"),
  "ex1-Bsecond": ex1("Bsecond"),
  "ex1-C": ex1("C"),
  "ex1-C-answered": ex1("C-answered"),
  ex2: ex2(),
  "ex2-approve-only": ex2({ approve: true }),
  "ex2-exception-approve": ex2({ exception: true, approve: true }),
  "ex3-step1": ex3(),
  "ex3-step1-judged": ex3({ judgeLine: true }),
  "ex3-step2": ex3s2(),
  "ex3-step2-harness-edited": ex3s2({ harnessEdited: true }),
  "ex3-step2-record-dropped": ex3s2({ harnessEdited: true, dropRecord: true }),
  "ex3-step2-seeded-clock": ex3s2({ seededClock: true }),
  "ex3-step2-refactor-sensitive-removed": ex3s2({ removeRefactorSensitive: true }),
  ex4: ex4(),
  "ex4-closing-the-set": ex4({ complete: true, headDiagnostics: true })
};

const out = process.argv[2];
if (!out) {
  process.stderr.write("usage: write-inputs.ts <outdir>\n");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
for (const [name, input] of Object.entries(all))
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(input, null, 1)}\n`);
process.stdout.write(`${Object.keys(all).length} inputs written to ${out}\n`);
