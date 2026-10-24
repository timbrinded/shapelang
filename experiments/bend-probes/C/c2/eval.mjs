// Evaluates one module file (original or mutant) with one technique and prints
// one JSON line. Usage: bun eval.mjs <ranges|ledger|log> <module.ts> <pbt|small|large|bigpbt>
import { req } from "../lib/work.mjs";

const [kind, file, technique] = process.argv.slice(2);
const laws = await import(`./laws/${kind}.mjs`);
const mod = await import(file);
const fc = req("fast-check");

function verdict(input) {
  try {
    return laws.check(mod, input);
  } catch (error) {
    return `throws: ${error?.message ?? String(error)}`;
  }
}

const t0 = performance.now();
let out;
if (technique === "pbt" || technique === "bigpbt") {
  const arb = technique === "pbt" ? laws.arbitrary(fc) : laws.bigArbitrary(fc);
  const options = technique === "pbt" ? { seed: 42, numRuns: 1000 } : { seed: 7, numRuns: 100_000 };
  const r = fc.check(fc.property(arb, (input) => verdict(input) === null), options);
  out = r.failed
    ? { killed: true, law: verdict(r.counterexample[0]), input: r.counterexample[0], cases: r.numRuns }
    : { killed: false, cases: r.numRuns };
} else {
  const gen = technique === "small" ? laws.smallScope() : laws.largeScope();
  let cases = 0;
  out = { killed: false };
  for (const input of gen) {
    cases++;
    const v = verdict(input);
    if (v !== null) {
      out = { killed: true, law: v, input };
      break;
    }
  }
  out.cases = cases;
}
out.ms = Math.round(performance.now() - t0);
let text = JSON.stringify(out.input ?? null);
if (text.length > 400) text = `${text.slice(0, 400)}...`;
console.log(JSON.stringify({ ...out, input: text }));
