// @ts-nocheck
// DRT shared library (one-off experiment code): the pre-pass that turns a prototype CheckInput into a
// shape.kernel.case/v1, a runner for the Lean kernel executable, and an exact comparator over the
// kernel's core-output fields.
//
// Pre-pass = kernel/test/bridge.ts's kernelCase, with three corrections that the kernel interface
// assigns to the pre-pass (A.11.2.1):
//   1. records the prototype rejected (RJ01-RJ14 validation) are dropped (as trials/H5/kernel-xcheck.ts);
//   2. elaboration uses now* = max(now, base committer time), as derive does (bridge used now);
//   3. review lines whose `change` is not one of the change ids are dropped (derive drops them for
//      every line kind; the kernel only checks the change of approve lines).
import { spawnSync } from "node:child_process";
import { derive } from "../../proto/src/derive.ts";
import { elaborate } from "../../proto/src/elaborate.ts";
import { buildGov } from "../../proto/src/governance.ts";
import { computeCells } from "../../proto/src/globs.ts";
import { mergeRecords, parseRecord } from "../../proto/src/records.ts";
import { coreOutput } from "../../proto/src/render.ts";
import { toSeconds } from "../../proto/src/util.ts";

export const KERNEL_ERROR_CODES = new Set(["E-conduct", "E-structure", "E-provider-missing", "E-exception"]);

function records(list, rejected) {
  const parsed = [];
  for (const x of list ?? []) {
    const r = parseRecord(x);
    if (!r.error) parsed.push(r);
  }
  return mergeRecords(parsed)
    .filter((r) => !rejected.has(r.id))
    .map((r) => ({ id: r.id, predicate: { shape: r.shape }, authenticated: r.signers.length > 0 }));
}

/** The kernel case for a prototype input; `tsOut` supplies the rejected record ids (validation). */
export function kernelCase(input, tsOut) {
  const rejected = new Set((tsOut?.rejected ?? []).map((r) => r.record));
  const now = toSeconds(input.now);
  const nowStar = Math.max(now, input.base?.committerTime ? toSeconds(input.base.committerTime) : now);
  const head = elaborate(input.head.source, { now: nowStar });
  const base = input.base?.source ? elaborate(input.base.source, { lenient: true, now: nowStar }) : null;
  const gov = input.mode === "audit" || !base ? head : base;
  const gv = buildGov(gov, gov.policy, input.authors ?? []);
  const ids = input.change?.ids ?? [];
  const reviews = [];
  for (const rv of input.reviews ?? []) {
    const actor = gv.byIdentity.get(rv.identity.trim());
    if (!actor) continue;
    if (rv.change && !ids.includes(rv.change)) continue;
    reviews.push({ actor, line: rv.line.trim(), change: rv.change ?? ids[0] });
  }
  const owners = [];
  if (base && input.mode !== "audit") {
    for (const c of base.components) for (const g of c.paths) owners.push({ side: "b", glob: g, owner: `${c.q}.*` });
    for (const c of head.components) for (const g of c.paths) owners.push({ side: "h", glob: g, owner: `${c.q}.*` });
  }
  const cells = owners.length ? computeCells(owners).cells.filter((c) => typeof c.b === "string" && typeof c.h === "string").map((c) => [c.b, c.h]) : [];
  return {
    contract: "shape.kernel.case/v1",
    mode: input.mode,
    now: nowStar,
    change: input.change,
    authors: [...gv.authors],
    unmappedBot: gv.unmappedBot,
    head: { revision: input.head.revision, esf: head, manifest: input.head.manifest },
    base: input.mode === "audit" || !input.base ? null : { revision: input.base.revision, esf: base ?? { shape: { q: "", owner: "" } }, manifest: input.base.manifest },
    cells,
    records: records(input.records, rejected),
    reviews,
    baseRecords: records(input.baseRecords, rejected)
  };
}

export function runKernel(exe, kcase, timeoutMs = 120000) {
  const t0 = performance.now();
  const r = spawnSync(exe, [], { input: JSON.stringify(kcase), maxBuffer: 1 << 30, timeout: timeoutMs });
  const ms = performance.now() - t0;
  if (r.error || r.signal) return { error: r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM" ? "timeout" : String(r.error ?? r.signal), ms };
  try {
    return { out: JSON.parse(r.stdout.toString()), status: r.status, ms };
  } catch {
    return { error: `unparsable (exit ${r.status}): ${r.stdout.toString().slice(0, 200)} ${r.stderr.toString().slice(0, 300)}`, ms };
  }
}

export function runTs(input) {
  const t0 = performance.now();
  try {
    const full = derive(input);
    return { full, core: coreOutput(full), ms: performance.now() - t0 };
  } catch (e) {
    return { error: `derive threw: ${String(e?.stack ?? e).slice(0, 600)}`, ms: performance.now() - t0 };
  }
}

/** The 18 obligation fields the kernel prints (kernel interface, "Output"). */
export const OB_FIELDS = ["key", "kind", "reason", "questions", "introduced", "severity", "tier", "budget", "force", "owner", "group", "claim", "subject", "witness", "exploited", "final", "binding", "exception"];

const cj = (v) => JSON.stringify(canonJ(v === undefined ? null : v));
function canonJ(v) {
  if (Array.isArray(v)) return v.map(canonJ);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonJ(v[k])]));
  return v;
}

export function projectOb(o) {
  const out = {};
  for (const f of OB_FIELDS) {
    let v = o[f] === undefined ? null : o[f];
    if (f === "claim" && v) v = { fp: v.fp, ids: [...(v.ids ?? [])].sort(), tier: v.tier ?? null };
    out[f] = v;
  }
  return out;
}

function short(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 90 ? `${s.slice(0, 87)}...` : s;
}

/**
 * Exact comparison. Returns { diffs: [{sig, detail}], stats }. `sig` is a coarse signature for
 * clustering; detail carries the values.
 */
export function compare(tsCore, lean) {
  const diffs = [];
  const add = (sig, detail) => diffs.push({ sig, detail });
  const tsErr = tsCore.errors ?? [];
  const prepass = tsErr.filter((e) => !KERNEL_ERROR_CODES.has(e.code));
  const tsK = tsErr.filter((e) => KERNEL_ERROR_CODES.has(e.code));
  const leanErr = lean.errors ?? [];
  const leanVerdict = prepass.length > 0 && lean.verdict !== "invalid" ? "blocked" : lean.verdict;
  if (tsCore.verdict !== leanVerdict) add(`verdict:${tsCore.verdict}/${leanVerdict}`, { ts: tsCore.verdict, lean: lean.verdict, prepass: prepass.length });
  // errors: codes (multiset), then (code, subject)
  const codes = (es) => es.map((e) => e.code).sort();
  const tc = codes(tsK);
  const lc = codes(leanErr);
  const cnt = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const tcm = cnt(tc);
  const lcm = cnt(lc);
  for (const c of new Set([...tc, ...lc])) {
    const a = tcm.get(c) ?? 0;
    const b = lcm.get(c) ?? 0;
    if (a > b) add(`err-only-ts:${c}`, { n: a - b, ts: tsK.filter((e) => e.code === c).map((e) => e.subject), lean: leanErr.filter((e) => e.code === c).map((e) => e.subject) });
    if (b > a) add(`err-only-lean:${c}`, { n: b - a, ts: tsK.filter((e) => e.code === c).map((e) => e.subject), lean: leanErr.filter((e) => e.code === c).map((e) => e.subject) });
  }
  const ts2 = new Set(tsK.map((e) => `${e.code}\u0000${e.subject}`));
  const le2 = new Set(leanErr.map((e) => `${e.code}\u0000${e.subject}`));
  const subjOnly = [...ts2].filter((x) => !le2.has(x)).length + [...le2].filter((x) => !ts2.has(x)).length;
  if (subjOnly > 0 && !diffs.some((d) => d.sig.startsWith("err-only"))) {
    const code = [...new Set([...ts2, ...le2].filter((x) => !(ts2.has(x) && le2.has(x))).map((x) => x.split("\u0000")[0]))].sort().join(",");
    add(`err-subject:${code}`, { ts: [...ts2].filter((x) => !le2.has(x)).map((x) => x.replace("\u0000", " ")), lean: [...le2].filter((x) => !ts2.has(x)).map((x) => x.replace("\u0000", " ")) });
  }
  // obligations
  const T = new Map((tsCore.obligations ?? []).map((o) => [o.key, projectOb(o)]));
  const L = new Map((lean.obligations ?? []).map((o) => [o.key, projectOb(o)]));
  let fieldTotal = 0;
  let fieldAgree = 0;
  const kindQ = (o) => (o.kind === "loosening" ? `loosening[${(o.questions ?? []).join("+")}]` : o.kind === "unestablished" ? `unestablished[${o.reason}]` : o.kind === "contradiction" ? `contradiction[${o.force}${o.subject === null ? ",law" : ""}]` : o.kind);
  for (const [k, o] of T) {
    const l = L.get(k);
    if (!l) {
      add(`ob-only-ts:${kindQ(o)}`, { key: k, subject: short(o.subject), claim: o.claim?.ids?.[0] ?? null, severity: o.severity, tier: o.tier });
      continue;
    }
    for (const f of OB_FIELDS) {
      fieldTotal += 1;
      if (cj(o[f]) === cj(l[f])) fieldAgree += 1;
      else {
        let hint = "";
        if (["tier", "severity", "reason", "force", "introduced", "exploited", "final", "budget", "kind", "owner", "exception"].includes(f)) hint = `:${o[f]}/${l[f]}`;
        if (f === "questions") hint = `:${(o[f] ?? []).join("+")}/${(l[f] ?? []).join("+")}`;
        if (f === "witness") hint = `:n${(o[f] ?? []).length}/n${(l[f] ?? []).length}`;
        add(`field:${kindQ(o)}:${f}${hint}`, { key: k, claim: o.claim?.ids?.[0] ?? null, subject: short(o.subject), ts: short(o[f]), lean: short(l[f]) });
      }
    }
  }
  for (const [k, o] of L) if (!T.has(k)) add(`ob-only-lean:${kindQ(o)}`, { key: k, subject: short(o.subject), claim: o.claim?.ids?.[0] ?? null, severity: o.severity, tier: o.tier });
  // order of the obligation list (both sort by severity, kind, key)
  const tOrder = (tsCore.obligations ?? []).map((o) => o.key).join(",");
  const lOrder = (lean.obligations ?? []).map((o) => o.key).join(",");
  if (T.size === L.size && [...T.keys()].every((k) => L.has(k)) && tOrder !== lOrder) add("ob-order", {});
  // answered
  const ans = (xs) => new Set((xs ?? []).map((a) => `${a.obligation} ${a.as}`));
  const ta = ans(tsCore.answered);
  const la = ans(lean.answered);
  for (const a of ta) if (!la.has(a)) add(`answered-only-ts:${a.split(" ")[1]}`, { a });
  for (const a of la) if (!ta.has(a)) add(`answered-only-lean:${a.split(" ")[1]}`, { a });
  // debt
  const debt = (xs) => new Map((xs ?? []).map((d) => [d.obligation, cj({ exception: d.exception, owner: d.owner, expiresInDays: d.expiresInDays })]));
  const td = debt(tsCore.debt);
  const ld = debt(lean.debt);
  for (const [k, v] of td) {
    if (!ld.has(k)) add("debt-only-ts", { k });
    else if (ld.get(k) !== v) add("debt-field", { k, ts: v, lean: ld.get(k) });
  }
  for (const k of ld.keys()) if (!td.has(k)) add("debt-only-lean", { k });
  const obsExact = cj((tsCore.obligations ?? []).map(projectOb)) === cj((lean.obligations ?? []).map(projectOb));
  return {
    diffs,
    stats: {
      tsObs: T.size,
      leanObs: L.size,
      shared: [...T.keys()].filter((k) => L.has(k)).length,
      fieldTotal,
      fieldAgree,
      obsExact,
      prepassErrors: prepass.map((e) => e.code),
      tsVerdict: tsCore.verdict,
      leanVerdict: lean.verdict
    }
  };
}

/** Full differential run of one prototype input. */
export function diffOne(input, exe, timeoutMs) {
  const ts = runTs(input);
  if (ts.error) return { status: "ts-error", error: ts.error, tsMs: ts.ms };
  if (ts.core.verdict === "invalid") return { status: "ts-invalid", errors: ts.core.errors.map((e) => `${e.code} ${e.subject}`), tsMs: ts.ms };
  let kcase;
  try {
    kcase = kernelCase(input, ts.full);
  } catch (e) {
    return { status: "prepass-error", error: String(e?.stack ?? e).slice(0, 400), tsMs: ts.ms };
  }
  const k = runKernel(exe, kcase, timeoutMs);
  if (k.error) return { status: k.error === "timeout" ? "kernel-timeout" : "kernel-error", error: k.error, tsMs: ts.ms, leanMs: k.ms, kcase };
  if (k.out.verdict === "invalid") return { status: "kernel-invalid", error: JSON.stringify(k.out.errors), tsMs: ts.ms, leanMs: k.ms, kcase };
  const c = compare(ts.core, k.out);
  return { status: c.diffs.length === 0 ? "agree" : "differ", ...c, tsMs: ts.ms, leanMs: k.ms, ts: ts.core, tsFull: ts.full, lean: k.out, kcase };
}
