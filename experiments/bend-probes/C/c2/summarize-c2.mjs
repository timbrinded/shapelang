// Summarises $CWORK/c2/results.json into kill rates relative to the law-false
// set. Mutants that no technique kills were analysed by hand; the verdicts and
// reasons are recorded in LAW_TRUE below (all were argued law-true).
// Usage: bun summarize-c2.mjs  (prints markdown, writes c2/mutants.csv)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CDIR, WORK } from "../lib/work.mjs";

export const LAW_TRUE = {
  R01: ["equivalent", "swapping equal endpoints yields the same range"],
  R05: ["behaviour change", "normalize returns its argument instead of a copy; merge still copies before mutating, no law observes aliasing"],
  R08: ["equivalent", "ranges with equal starts always merge (start <= last.end + 1), so the end tie-break is irrelevant"],
  R17: ["equivalent", "the pushed object is normalize's fresh copy, so mutating it never touches the input"],
  L04: ["behaviour change", "fee schedule 30 -> 31 bps; laws fix only fee > 0 and headroom (fee <= amount + 1)"],
  L05: ["behaviour change", "fee divisor 10,000 -> 1,000; fee stays in 1..amount+1"],
  L06: ["behaviour change", "floor -> ceil in fee; fee stays in 1..amount+1"],
  L10: ["behaviour change", "rejects a transfer that empties the account exactly; the liveness law only requires success at >= 2*amount+1 > amount+fee"],
  L23: ["behaviour change", "rejects a receiver balance of exactly U32_MAX; the liveness law's headroom keeps the receiver strictly below it"],
  L31: ["behaviour change", "zero-amount transfers pay MIN_FEE; no law covers amount 0 fees"],
  G03: ["equivalent", "segment size 8 -> 4 is used consistently by append, find and redact"],
  G04: ["equivalent", "nextId == count is invariant, so the id is unchanged"],
  G29: ["equivalent", "entry ids equal positions (invariant), so id < cutoff == position < cutoff"],
  G32: ["equivalent", "entry ids equal positions (invariant)"]
};

const results = JSON.parse(readFileSync(join(WORK, "c2/results.json"), "utf8"));
const killedBy = (r, t) => r.techniques[t]?.killed === true;
const rows = results.map((r) => {
  const any = ["pbt", "small", "large", "bigpbt"].some((t) => killedBy(r, t));
  if (!any && !LAW_TRUE[r.id]) throw new Error(`${r.id} survived every technique but has no manual verdict`);
  if (any && LAW_TRUE[r.id]) throw new Error(`${r.id} was killed but is listed as law-true`);
  return { ...r, lawFalse: any, tsReject: r.typeErrors.length > 0 };
});

const pct = (a, b) => (b === 0 ? "-" : `${((100 * a) / b).toFixed(1)}%`);
const lawFalse = rows.filter((r) => r.lawFalse);
const line = (cells) => `| ${cells.join(" | ")} |`;
console.log(line(["set", "mutants", "law-true", "law-false", "tsc rejects", "pbt kills", "small kills", "pbt or small", "large/bigpbt kills"]));
console.log(line(Array(9).fill("---")));
const groups = [
  ["ranges", (r) => r.kind === "ranges"],
  ["ledger", (r) => r.kind === "ledger"],
  ["log", (r) => r.kind === "log"],
  ["standard operators (untagged)", (r) => !r.large],
  ["large-input (tagged)", (r) => r.large],
  ["all", () => true]
];
for (const [name, pred] of groups) {
  const all = rows.filter(pred);
  const lf = all.filter((r) => r.lawFalse);
  const n = (f) => lf.filter(f).length;
  console.log(
    line([
      name, all.length, all.length - lf.length, lf.length,
      `${n((r) => r.tsReject)} (${pct(n((r) => r.tsReject), lf.length)})`,
      `${n((r) => killedBy(r, "pbt"))} (${pct(n((r) => killedBy(r, "pbt")), lf.length)})`,
      `${n((r) => killedBy(r, "small"))} (${pct(n((r) => killedBy(r, "small")), lf.length)})`,
      `${n((r) => killedBy(r, "pbt") || killedBy(r, "small"))} (${pct(n((r) => killedBy(r, "pbt") || killedBy(r, "small")), lf.length)})`,
      `${n((r) => killedBy(r, "large") || killedBy(r, "bigpbt"))}/${n((r) => !(killedBy(r, "pbt") && killedBy(r, "small")))}`
    ])
  );
}
console.log("\nResidue (law-false, not killed by small scope):");
for (const r of lawFalse.filter((r) => !killedBy(r, "small"))) {
  const k = ["large", "bigpbt"].map((t) => (killedBy(r, t) ? t : null)).filter(Boolean).join("+");
  console.log(`- ${r.id} ${r.op}${r.large ? " (tagged large)" : ""}: pbt ${killedBy(r, "pbt") ? "kills" : "misses"}; killed by ${k}; ${r.techniques.large?.law ?? r.techniques.bigpbt?.law}`);
}
console.log("\nLaw-false mutants pbt misses:");
for (const r of lawFalse.filter((r) => !killedBy(r, "pbt"))) console.log(`- ${r.id} ${r.op}${r.large ? " (tagged large)" : ""}`);

const csv = ["id,module,operator,tagged_large,tsc_rejects,pbt,small,large,bigpbt,law_false,first_law,manual_verdict"];
for (const r of rows) {
  const c = (t) => (r.techniques[t] === undefined ? "" : r.techniques[t].killed ? "K" : "S");
  const law = ["pbt", "small", "large", "bigpbt"].map((t) => r.techniques[t]).find((x) => x?.killed)?.law ?? "";
  csv.push([r.id, r.kind, r.op, r.large, r.tsReject, c("pbt"), c("small"), c("large"), c("bigpbt"), r.lawFalse, JSON.stringify(law), JSON.stringify(LAW_TRUE[r.id]?.join(": ") ?? "")].join(","));
}
writeFileSync(join(CDIR, "c2/mutants.csv"), `${csv.join("\n")}\n`);
