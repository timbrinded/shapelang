// @ts-nocheck
// DRT7 comparator. The gate's verdict on a case is byte equality of the two core outputs (JCS,
// A.16.31), with no normalisation. When the bytes differ, diffSignatures explains where: one
// signature per differing element or field, for clustering only (it never decides residual).
import { jcs } from "../../proto/src/jcs.ts";

const SECTIONS = ["contract", "mode", "inputDigest", "verdict", "errors", "rejected", "obligations", "answered", "loosening", "order", "renames", "debt", "preexisting", "budget", "health"];

const short = (v, n = 160) => {
  const s = v === undefined ? "(absent)" : typeof v === "string" ? v : jcs(v);
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
};
const eq = (a, b) => (a === undefined ? "\u0001" : jcs(a)) === (b === undefined ? "\u0001" : jcs(b));

function kindQ(o) {
  if (o.kind === "loosening") return `loosening[${(o.questions ?? []).join("+")}]`;
  if (o.kind === "unestablished") return `unestablished[${o.reason}]`;
  if (o.kind === "contradiction") {
    const s = o.subject;
    const shape = s === null ? "law|refute" : "nodes" in s ? "nodes" : "from" in s ? "edge" : "unit" in s ? "unit" : "code";
    return `contradiction[${o.force},${shape}]`;
  }
  return o.kind;
}

const SCALAR = new Set(["kind", "reason", "introduced", "severity", "tier", "budget", "force", "owner", "assignee", "exploited", "final", "exception"]);

function keyedDiff(add, name, ts, k, keyOf, labelOf, detailOf) {
  const T = new Map((ts ?? []).map((x) => [keyOf(x), x]));
  const K = new Map((k ?? []).map((x) => [keyOf(x), x]));
  for (const [key, x] of T) {
    const y = K.get(key);
    if (!y) {
      add(`${name}-only-ts:${labelOf(x)}`, { key, ts: detailOf(x) });
      continue;
    }
    for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (eq(x[f], y[f])) continue;
      const hint = SCALAR.has(f) ? `:${short(x[f], 30)}/${short(y[f], 30)}` : "";
      add(`${name}-field:${labelOf(x)}:${f}${hint}`, { key, ts: short(x[f]), kernel: short(y[f]) });
    }
  }
  for (const [key, y] of K) if (!T.has(key)) add(`${name}-only-kernel:${labelOf(y)}`, { key, kernel: detailOf(y) });
  if (T.size === K.size && [...T.keys()].every((x) => K.has(x))) {
    const ot = [...T.keys()].join("\n");
    const ok = [...K.keys()].join("\n");
    if (ot !== ok) add(`${name}-order`, {});
  }
}

/** Signatures of the differences between two parsed core outputs. */
export function diffSignatures(ts, k) {
  const out = [];
  const add = (sig, detail) => out.push({ sig, detail });
  for (const s of new Set([...Object.keys(ts), ...Object.keys(k)]))
    if (!SECTIONS.includes(s)) add(`section-extra:${s}`, { ts: short(ts[s]), kernel: short(k[s]) });
  for (const s of SECTIONS) if (!(s in k)) add(`section-missing-kernel:${s}`, {});
  for (const s of ["contract", "mode", "inputDigest"]) if (!eq(ts[s], k[s])) add(`${s}`, { ts: short(ts[s]), kernel: short(k[s]) });
  if (!eq(ts.verdict, k.verdict)) add(`verdict:${ts.verdict}/${k.verdict}`, {});
  if (!eq(ts.order, k.order)) add(`order:${ts.order}/${k.order}`, {});
  keyedDiff(add, "error", ts.errors, k.errors, (e) => `${e.code}\u0000${e.subject}`, (e) => e.code, (e) => short(e.subject));
  keyedDiff(add, "rejected", ts.rejected, k.rejected, (r) => `${r.record}\u0000${r.code}`, (r) => r.code, (r) => r.record);
  keyedDiff(add, "ob", ts.obligations, k.obligations, (o) => o.key, kindQ, (o) => ({ subject: short(o.subject, 90), claim: o.claim?.ids?.[0] ?? null, tier: o.tier, severity: o.severity }));
  keyedDiff(add, "answered", ts.answered, k.answered, (a) => `${a.obligation}\u0000${a.as}`, (a) => a.as, (a) => a.obligation);
  keyedDiff(add, "loosening-row", ts.loosening, k.loosening, (r) => `${r.question}\u0000${r.subject}`, (r) => r.question, (r) => ({ subject: r.subject, answer: r.answer }));
  keyedDiff(add, "rename", ts.renames, k.renames, (r) => `${r.base}\u0000${r.head}`, (r) => r.rule ?? "rename", (r) => r);
  keyedDiff(add, "debt", ts.debt, k.debt, (d) => d.obligation, () => "row", (d) => d.obligation);
  if (!eq(ts.preexisting, k.preexisting)) add("preexisting", { ts: short(ts.preexisting), kernel: short(k.preexisting) });
  for (const f of new Set([...Object.keys(ts.budget ?? {}), ...Object.keys(k.budget ?? {})]))
    if (!eq(ts.budget?.[f], k.budget?.[f])) add(`budget:${f}`, { ts: short(ts.budget?.[f]), kernel: short(k.budget?.[f]) });
  if (typeof ts.health === "object" && typeof k.health === "object" && ts.health && k.health) {
    for (const f of new Set([...Object.keys(ts.health), ...Object.keys(k.health)]))
      if (!eq(ts.health[f], k.health[f])) add(`health:${f}`, { ts: short(ts.health[f]), kernel: short(k.health[f]) });
  } else if (!eq(ts.health, k.health)) add("health", {});
  if (out.length === 0) add("bytes-only", {});
  return out;
}

/** The primary signature of a case: the first differing section in cause order. */
const PRIORITY = ["section-", "contract", "mode", "inputDigest", "rejected-", "error-", "ob-only", "ob-field", "ob-order", "loosening-row", "rename", "order:", "answered", "debt", "preexisting", "budget", "health", "verdict", "bytes-only"];
export function primary(sigs) {
  for (const p of PRIORITY) {
    const hit = sigs.filter((s) => s.startsWith(p)).sort();
    if (hit.length) return hit[0];
  }
  return sigs.sort()[0];
}
