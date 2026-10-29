// Laws (version 7): requirement R*, Req(c, kind), cones, applicability, usability reasons, Sat,
// the total law reason, law contradictions, introducedness through Req and record cones, and
// E-provider-missing (A.5.2.13, A.5.3, A.5.4, A.5.5, A.7.3.3, A.16.4, A.16.6, A.16.7, A.16.12,
// A.16.14, A.16.20, A.16.35; DRT T2, T11, T13, T17).
import type { Ctx } from "./context.ts";
import { lawDecidedBy } from "./elaborate.ts";
import { globMatches } from "./globs.ts";
import { finalPair, isEligible, tierPolicy } from "./governance.ts";
import { descendantsOrSelf } from "./manifest.ts";
import type { Claim, JsonValue, Requirement, ShapeError } from "./model.ts";
import type { ParsedRecord, ShapeRecord } from "./records.ts";
import {
  type Level,
  type Tier,
  cmpStr,
  levelRank,
  maxTier,
  sortedUniq,
  toSeconds
} from "./util.ts";
import { bindOf, compCode, posComp } from "./world.ts";

export interface Pair {
  id: string;
  projection: string;
}

export type UseReason = "stale" | "expired" | "producer-changed" | "assumption" | "weak";

export interface RecEval {
  record: ParsedRecord;
  judge: string | null;
  direction: "supports" | "contradicts" | "inconclusive";
  /** related by ⊒ in its direction, cites Req, judge eligible */
  applicable: boolean;
  /** the first usability reason, or null when usable */
  reason: UseReason | null;
  /** whether the record holds its reason for the law reason (A.5.4.3) */
  holds: boolean;
  force: "sound" | "heuristic" | null;
  self: boolean;
  producerChanged: boolean;
  /** contradicting records' counterexamples */
  counterexample: JsonValue;
}

export interface LawEval {
  claim: Claim;
  tierStar: Tier;
  req: Requirement;
  reqTest: Pair[];
  reqJudg: Pair[];
  bindingReq: Pair[];
  vacuous: boolean;
  sat: boolean;
  soundContra: RecEval | null;
  heurContras: RecEval[];
  reason: string | null;
  /** the records holding the reported reason */
  reasonRecords: RecEval[];
  evals: RecEval[];
  /** the contradiction obligation is introduced */
  contraIntroduced: boolean;
  /** the unestablished obligation is introduced */
  unestIntroduced: boolean;
  /** implementation and harness finest changes of producer-changed records for c */
  producerFinest: string[];
  /** usable base-revision records contradicting the law with a counterexample (health) */
  baseContradictions: JsonValue[];
}

export function strictest(a: Requirement, b: Requirement): Requirement {
  return {
    level: levelRank(a.level) >= levelRank(b.level) ? a.level : b.level,
    judged: a.judged && b.judged,
    pins: sortedUniq([...a.pins, ...b.pins]),
    projection: a.projection === b.projection ? a.projection : "unit"
  };
}

/** tier*(o) for every obligation but effect-forbid, summary and authority contradictions: the
 *  strictest of the head claim and the base claims it is an heir of; a base claim whose final
 *  loosening two persons answered contributes its heir's head tier (A.6.2.3, A.16.13). */
export function tierStar(ctx: Ctx, c: Claim): Tier {
  let t = c.tier;
  for (const b of [...(ctx.heirOf.get(c.fp) ?? []), ...(ctx.hAOf.get(c.fp) ?? [])]) {
    const bc = ctx.baseClaims.get(b);
    if (!bc) continue;
    t = maxTier(t, ctx.finalAnswered.has(b) ? c.tier : bc.tier);
  }
  return t;
}

export function requirementStar(ctx: Ctx, c: Claim, tier: Tier): Requirement {
  let r = c.requirement ?? {
    level: "declared" as Level,
    judged: false,
    pins: [],
    projection: "unit" as const
  };
  for (const b of [...(ctx.heirOf.get(c.fp) ?? []), ...(ctx.hAOf.get(c.fp) ?? [])]) {
    const bc = ctx.baseClaims.get(b);
    if (bc?.requirement) r = strictest(r, bc.requirement);
  }
  const floor = tierPolicy(ctx.policy, tier).floor;
  return { ...r, level: levelRank(r.level) >= levelRank(floor) ? r.level : floor };
}

/** owner*(c_h): the base owners of what it inherits, else its head owner (A.6.2.5). */
export function ownerStar(ctx: Ctx, c: Claim): string {
  const bases = (ctx.heirOf.get(c.fp) ?? [])
    .map((b) => ctx.baseClaims.get(b))
    .filter((x): x is Claim => !!x);
  if (bases.length > 0) {
    const best = [...bases].sort((a, b) => cmpStr(a.fp, b.fp))[0] as Claim;
    return best.owner;
  }
  return c.owner;
}

/** Refs° reachability within a code set, from an identity (A.5.3.4 [D4]). */
function refsClosure(ctx: Ctx, from: string, within: Set<string>): string[] {
  const out = new Set<string>();
  const stack = [...(ctx.refs.get(from) ?? [])];
  while (stack.length > 0) {
    const y = stack.pop() as string;
    if (out.has(y) || y === from || !within.has(y)) continue;
    out.add(y);
    for (const z of ctx.refs.get(y) ?? []) stack.push(z);
  }
  return [...out].sort(cmpStr);
}

const FUNCTION_KINDS = new Set(["function", "method", "class", "namespace", "object"]);

/** Req(c, kind) from c and M_h (A.5.3.4, A.15.15, A.16.20(b)). */
export function reqOf(
  ctx: Ctx,
  c: Claim,
  kind: "test" | "judgment",
  projection: Requirement["projection"]
): Pair[] {
  const W = ctx.Wh;
  const M = ctx.Mh;
  const out: Pair[] = [];
  const has = (id: string, p: string): boolean => !!M.ids.get(id)?.digests.has(p);
  const at = (id: string, p: string): Pair => ({ id, projection: has(id, p) ? p : "file" });
  const marked = (id: string): boolean =>
    Object.values(M.ids.get(id)?.markers ?? {}).some((n) => n > 0);
  const isFile = (id: string): boolean => !M.ids.get(id)?.symbol;
  for (const t of (c.args.on as string[]) ?? []) {
    if (t.startsWith("unit ")) {
      const u = t.slice(5);
      const x = bindOf(W, u);
      if (!x) continue; // an unbound unit adds nothing (A.15.15); E-unbound reports it
      if (projection === "trust") {
        if (descendantsOrSelf(M, x).some(marked)) out.push(at(x, "unit"));
      } else if (kind === "test") out.push(at(x, "unit"));
      else {
        out.push(at(x, projection));
        const comp = W.unitByQ.get(u)?.component;
        const code = new Set(comp ? compCode(W, comp) : []);
        for (const y of refsClosure(ctx, x, code)) {
          if (!FUNCTION_KINDS.has(M.ids.get(y)?.kind ?? "")) continue;
          out.push(at(y, projection));
        }
      }
    } else if (t.startsWith("component ")) {
      const code = compCode(W, t.slice(10));
      const codeSet = new Set(code);
      if (projection === "trust") {
        for (const x of code) {
          if (!marked(x)) continue;
          out.push(isFile(x) ? at(x, "own") : at(x, "unit"));
        }
        continue;
      }
      const pi = kind === "test" ? "unit" : projection;
      for (const x of code) {
        const info = M.ids.get(x);
        if (!info?.symbol || !has(x, pi)) continue;
        const parent = info.parent;
        const parentFile = !parent || !M.ids.get(parent)?.symbol;
        if (parentFile || !has(parent, pi) || !codeSet.has(parent))
          out.push({ id: x, projection: pi });
      }
      if (pi === "unit") for (const x of code) if (isFile(x)) out.push(at(x, "own"));
    } else if (t.startsWith("code ")) {
      const x = t.slice(5);
      out.push(has(x, "unit") ? { id: x, projection: "unit" } : { id: x, projection: "file" });
    }
  }
  const st = c.args.statement as { ref?: string };
  if (st?.ref) out.push({ id: st.ref, projection: "closure" });
  const seen = new Set<string>();
  return out
    .filter((p) => {
      const k = `${p.id}@${p.projection}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmpStr(a.id, b.id) || cmpStr(a.projection, b.projection));
}

function cites(r: ShapeRecord, judgment: boolean): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of [...(r.code ?? []), ...(judgment ? [] : (r.deps ?? []))])
    m.set(`${c.id}@${c.projection}`, c.digest);
  return m;
}

/** Identities of a provider's implementation (paths, identities) that are new, moved or
 *  deleted (A.5.2.6 [D9]). */
function implementationChanges(ctx: Ctx, q: string): string[] {
  const g = ctx.provs.get(q);
  if (!g) return [];
  const out = new Set<string>();
  for (const x of [...ctx.delta, ...ctx.deleted]) {
    const path = ctx.Mh.ids.get(x)?.path ?? ctx.Mb?.ids.get(x)?.path ?? "";
    if (g.implementationPaths.some((p) => globMatches(p, path))) out.add(x);
    if (
      g.implementationIds.some((id) => x === id || x.startsWith(`${id}.`) || x.startsWith(`${id}#`))
    )
      out.add(x);
  }
  return [...out].sort(cmpStr);
}

/** Producer change: the implementation (base ∪ head) or the harness meets Δcode ∪ deleted. */
export function producerChanged(ctx: Ctx, r: ParsedRecord): boolean {
  const pq = r.shape.provider?.id;
  if (!pq || r.shape.kind === "judgment") return false;
  const g = ctx.provs.get(pq);
  if (!g) return false;
  if (g.implementationDigests.length > 1) return true;
  if (implementationChanges(ctx, pq).length > 0) return true;
  for (const h of r.shape.harness ?? [])
    if (ctx.delta.has(h.id) || ctx.deleted.has(h.id)) return true;
  return false;
}

/** The implementation and harness identities behind a producer change that are finest changes. */
export function producerFinest(ctx: Ctx, r: ParsedRecord): string[] {
  const pq = r.shape.provider?.id;
  if (!pq) return [];
  const out = new Set<string>();
  for (const x of implementationChanges(ctx, pq)) if (ctx.finest.has(x)) out.add(x);
  for (const h of r.shape.harness ?? []) if (ctx.finest.has(h.id)) out.add(h.id);
  return [...out].sort(cmpStr);
}

/** The identities behind a producer change (for groups, A.7.2.3 [D10]). */
export function producerCauses(ctx: Ctx, r: ParsedRecord): string[] {
  const pq = r.shape.provider?.id;
  if (!pq) return [];
  const out = new Set(implementationChanges(ctx, pq));
  for (const h of r.shape.harness ?? [])
    if (ctx.delta.has(h.id) || ctx.deleted.has(h.id)) out.add(h.id);
  return [...out].sort(cmpStr);
}

/** cone(r): cited code and deps closed under Calls°, Refs° and descendants (A.5.4.4). */
export function cone(ctx: Ctx, r: ShapeRecord, man = ctx.Mh): Set<string> {
  const start = [...(r.code ?? []), ...(r.deps ?? [])].map((c) => c.id);
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const x = stack.pop() as string;
    if (seen.has(x)) continue;
    seen.add(x);
    if (man.ids.has(x)) for (const d of descendantsOrSelf(man, x)) if (!seen.has(d)) stack.push(d);
    for (const c of ctx.calls.get(x) ?? []) stack.push(c.to);
    for (const y of ctx.refs.get(x) ?? []) stack.push(y);
  }
  // same-provider, same-revision proof records extend the cone (two-level admit)
  return seen;
}

/** Does a set of identities meet Δcode ∪ deleted at any projection (A.16.7)? */
function meetsDelta(ctx: Ctx, ids: Iterable<string>): boolean {
  for (const x of ids) if (ctx.delta.has(x) || ctx.deleted.has(x)) return true;
  return false;
}

/** Does Req meet Δcode ∪ deleted by a shared (identity, projection) pair (A.6.1.5)? */
export function reqMeetsDelta(ctx: Ctx, req: Pair[]): boolean {
  return req.some(
    (p) => ctx.deltaPairs.has(`${p.id}\u0000${p.projection}`) || ctx.deleted.has(p.id)
  );
}

function assumptionUndeclared(ctx: Ctx, r: ParsedRecord, tier: Tier, req: Pair[]): boolean {
  const s = r.shape;
  const coneSet = cone(ctx, s);
  const hatch: { x: string; kind: string }[] = [];
  for (const x of coneSet)
    for (const [k, n] of Object.entries(ctx.Mh.ids.get(x)?.markers ?? {}))
      if (n > 0) hatch.push({ x, kind: k });
  const named: string[] = [];
  const tools: string[] = [];
  for (const a of s.assumptions ?? []) {
    if (a.kind === "hatch") {
      const i = a.id.lastIndexOf("/");
      if (i > 0) hatch.push({ x: a.id.slice(0, i), kind: a.id.slice(i + 1) });
    } else if (a.kind === "named") named.push(a.id);
    else tools.push(a.id);
  }
  // a final law is never satisfied through any hatch fact or named assumption (A.16.14 [D11])
  if (tier === "final" && (hatch.length > 0 || named.length > 0)) return true;
  const boundaryAllows = (w: Ctx["Wh"] | null, x: string, kind: string): boolean => {
    if (!w) return false;
    return w.attAll(x).every((pos) => {
      const comp = posComp(pos);
      const k = comp ? w.compByQ.get(comp) : undefined;
      return !!k && k.boundary && k.allows.includes(kind);
    });
  };
  const base = ctx.mode === "audit" ? ctx.Wh : ctx.Wb;
  for (const h of hatch)
    if (!(boundaryAllows(ctx.Wh, h.x, h.kind) && boundaryAllows(base, h.x, h.kind))) return true;
  if (named.length > 0) {
    const meets = new Set([...coneSet, ...req.map((p) => p.id)]);
    const allowed = new Set<string>();
    for (const k of base?.esf.components ?? []) {
      if (!k.boundary || !base) continue;
      if (compCode(base, k.q).some((x) => meets.has(x)))
        for (const a of k.assumes) allowed.add(a.id);
    }
    if (named.some((n) => !allowed.has(n))) return true;
  }
  if (tools.length > 0) {
    const g = s.provider ? ctx.provs.get(s.provider.id) : undefined;
    const trusted = new Set((g?.trusts ?? []).map(([n, v]) => `${n}@${v}`));
    if (tools.some((t) => !trusted.has(t.replace(/\s+/, "@")))) return true;
  }
  return false;
}

function levelOfKind(kind: string): Level {
  return kind === "proof" ? "proven" : kind === "test" ? "tested" : "declared";
}

/** A test or proof counterexample with {seed, inputs, assertion}; else inconclusive (A.16.35). */
export function conformingCounterexample(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return "seed" in o && "inputs" in o && "assertion" in o;
}

function sameCounterexample(a: JsonValue, b: JsonValue): boolean {
  const ao = (a ?? {}) as Record<string, JsonValue>;
  const bo = (b ?? {}) as Record<string, JsonValue>;
  return (
    JSON.stringify(canon(ao.assertion)) === JSON.stringify(canon(bo.assertion)) &&
    JSON.stringify(canon(ao.inputs)) === JSON.stringify(canon(bo.inputs))
  );
}

function canon(v: JsonValue | undefined): JsonValue {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => canon(x));
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canon((v as Record<string, JsonValue>)[k])])
    );
  return v;
}

/** A cited, deps or harness digest that is not ≡ M_h, or an identity gone (stale, A.5.4.1). */
function digestsMoved(ctx: Ctx, s: ShapeRecord): boolean {
  for (const [k, d] of cites(s, false)) {
    const i = k.lastIndexOf("@");
    const h = ctx.Mh.ids.get(k.slice(0, i))?.digests.get(k.slice(i + 1));
    if (h === undefined || !ctx.equiv(h, d)) return true;
  }
  for (const h of s.harness ?? []) {
    const d = ctx.Mh.ids.get(h.id)?.digests.get(h.projection);
    if (d === undefined || !ctx.equiv(d, h.digest)) return true;
  }
  return false;
}

export interface LawDeps {
  geq: (a: { fp: string; nf?: string }, c: Claim) => boolean;
  leq: (a: { fp: string; nf?: string }, c: Claim) => boolean;
  /** claim judgments of an earlier change (exempt from the authorship bar, A.16.4(b)) */
  earlier: Set<string>;
}

export function evaluateLaws(ctx: Ctx, deps: LawDeps): LawEval[] {
  const out: LawEval[] = [];
  const gov = ctx.gv;
  for (const c of ctx.head.claims) {
    if (c.op !== "law") continue;
    const tier = tierStar(ctx, c);
    const req = requirementStar(ctx, c, tier);
    const reqTest = reqOf(ctx, c, "test", req.projection === "trust" ? "trust" : "unit");
    const reqJudg = reqOf(ctx, c, "judgment", req.projection);
    const tp = tierPolicy(ctx.policy, tier);
    const owner = ownerStar(ctx, c);
    const evals: RecEval[] = [];
    const pfinest = new Set<string>();
    for (const r of ctx.records) {
      const s = r.shape;
      const isJ = s.kind === "judgment";
      if (!(s.kind === "test" || s.kind === "proof" || (isJ && s.claim && s.result !== "approves")))
        continue;
      if (!s.claim) continue;
      const direction =
        s.result === "supports"
          ? "supports"
          : s.result === "contradicts"
            ? "contradicts"
            : "inconclusive";
      const related = direction === "contradicts" ? deps.leq(s.claim, c) : deps.geq(s.claim, c);
      if (!related) continue;
      const g = s.provider ? ctx.provs.get(s.provider.id) : undefined;
      const req0 = isJ ? reqJudg : reqTest;
      const cited = cites(s, isJ);
      const partial = req0.some((p) => !cited.has(`${p.id}@${p.projection}`));
      // judge eligibility (judgments): an act of this change unless persisted earlier
      let judgeOk = true;
      let self = false;
      if (isJ) {
        const e = isEligible(gov, s.judge ?? "", {
          tier,
          owner,
          noAgent: tier === "final",
          final: tier === "final",
          thisChange: !deps.earlier.has(r.id)
        });
        judgeOk = e.ok;
        self = e.self;
      }
      // a contradicting test or proof without a conforming counterexample is inconclusive
      const dir: RecEval["direction"] =
        !isJ && direction === "contradicts" && !conformingCounterexample(s.counterexample)
          ? "inconclusive"
          : direction;
      // stale (A.5.4.1)
      let reason: UseReason | null = digestsMoved(ctx, s) ? "stale" : null;
      if (!isJ && s.revision !== ctx.Mh.revision && !(g?.depsCompleteB && Array.isArray(s.deps)))
        reason = reason ?? "stale";
      if (partial) reason = reason ?? "stale";
      // expired (judgments, max_age of tier*(c))
      if (!reason && isJ) {
        const t = toSeconds(s.time) ?? 0;
        if (ctx.now - t > tp.maxAge * 86400) reason = "expired";
      }
      // assumption (tests, proofs)
      if (!reason && !isJ && assumptionUndeclared(ctx, r, tier, req0)) reason = "assumption";
      // weak: below level*, or pinned out
      if (!reason) {
        if (isJ) {
          const actorPins = req.pins.filter((p) => gov.actors.has(p));
          if (!req.judged || (actorPins.length > 0 && !actorPins.includes(s.judge ?? "")))
            reason = "weak";
        } else {
          const decides =
            !!g?.base && !!g.head && g.decidesB.length > 0
              ? lawDecidedBy(c, { decides: g.decidesB })
              : false;
          const lvl = g?.establishes && decides ? levelOfKind(s.kind) : "declared";
          const providerPins = req.pins.filter((p) => ctx.provs.has(p));
          const pinned = providerPins.length > 0 && !providerPins.includes(s.provider?.id ?? "");
          if (req.level === "none" || levelRank(lvl) < levelRank(req.level) || pinned)
            reason = "weak";
        }
      }
      // force (A.5.5.1): stale and expired records have none
      let force: RecEval["force"] = null;
      const applicable = !partial && judgeOk;
      if (dir === "contradicts" && applicable && reason !== "stale" && reason !== "expired") {
        if (isJ) force = "sound";
        else force = g?.presenceA ? "sound" : "heuristic";
      }
      // producer-changed: only for an otherwise usable record with force (supports, or
      // contradicts with force); never inconclusive [D9]
      const pc = !isJ && producerChanged(ctx, r);
      if (!reason && pc && (dir === "supports" || force !== null)) reason = "producer-changed";
      if (pc && dir !== "inconclusive" && applicable)
        for (const x of producerFinest(ctx, r)) pfinest.add(x);
      // the record holds its reason iff it applies (or only omits part of Req), its judge is
      // eligible, it is not inconclusive, and its provider is base-declared [D9, DRT T2]
      const baseDeclared = isJ ? true : !!g?.base;
      const holds = judgeOk && dir !== "inconclusive" && baseDeclared && reason !== null;
      evals.push({
        record: r,
        judge: s.judge ?? null,
        direction: dir,
        applicable,
        reason,
        holds,
        force,
        self,
        producerChanged: pc,
        counterexample: (s.counterexample ?? null) as JsonValue
      });
    }
    evals.sort((a, b) => cmpStr(a.record.id, b.record.id));
    // a final law: contradicting claim judgments, like establishing ones, need two distinct
    // eligible persons, one of owner* and one of the base shape owner (A.6.3.4, A.16.12)
    const contraJudges = evals
      .filter((e) => e.force === "sound" && e.record.shape.kind === "judgment")
      .map((e) => e.judge ?? "");
    const contraJOk = tier !== "final" || finalPair(gov, owner, tier, contraJudges) !== null;
    const soundContra =
      evals.find((e) => e.force === "sound" && (e.record.shape.kind !== "judgment" || contraJOk)) ??
      null;
    const heurContras = evals.filter((e) => e.force === "heuristic");
    const bindingReq =
      req.level !== "none" && levelRank(req.level) >= 1 ? reqTest : req.judged ? reqJudg : reqTest;
    const vacuous = bindingReq.length === 0;
    let sat = false;
    if (vacuous) sat = true;
    else if (!soundContra) {
      if (req.level === "declared") sat = true;
      else {
        const usable = evals.filter(
          (e) => e.direction === "supports" && e.applicable && e.reason === null
        );
        if (usable.some((e) => e.record.shape.kind !== "judgment")) sat = true;
        else if (req.judged) {
          const judges = usable.filter((e) => e.record.shape.kind === "judgment");
          if (tier === "final")
            sat =
              finalPair(
                gov,
                owner,
                tier,
                judges.map((e) => e.judge ?? "")
              ) !== null;
          else sat = judges.length > 0;
        }
      }
    }
    let reason: string | null = null;
    let reasonRecords: RecEval[] = [];
    if (!sat && !soundContra) {
      const order: UseReason[] = ["assumption", "weak", "producer-changed", "expired", "stale"];
      reason = "missing";
      for (const o of order) {
        const hs = evals.filter((e) => e.holds && e.reason === o);
        if (hs.length > 0) {
          reason = o;
          reasonRecords = hs;
          break;
        }
      }
    }
    // introducedness (A.7.3.3 [D4], A.16.7; DRT T13)
    const reqMeets = ctx.hasBase && reqMeetsDelta(ctx, bindingReq);
    const contraRecords = soundContra ? [soundContra] : heurContras;
    let contraIntroduced =
      ctx.hasBase &&
      (reqMeets ||
        evals.some((e) => e.force !== null && meetsDelta(ctx, cone(ctx, e.record.shape))));
    const baseContradictions: JsonValue[] = [];
    for (const br of ctx.baseRecords) {
      const s = br.shape;
      if (!s.claim || s.result !== "contradicts") continue;
      if (!(s.kind === "test" || s.kind === "proof" || s.kind === "judgment")) continue;
      if (!deps.leq(s.claim, c)) continue;
      if (!ctx.usableAtBase(br)) continue;
      if (s.kind !== "judgment" && conformingCounterexample(s.counterexample))
        baseContradictions.push(s.counterexample as JsonValue);
      // the counterexample clause: the same base-declared provider already made it
      if (contraIntroduced && contraRecords.length > 0) {
        const cr = contraRecords[0] as RecEval;
        const same =
          s.kind === "judgment"
            ? br.id === cr.record.id
            : !!s.provider &&
              s.provider.id === cr.record.shape.provider?.id &&
              !!ctx.provs.get(s.provider.id)?.base &&
              sameCounterexample(s.counterexample as JsonValue, cr.counterexample);
        if (same) contraIntroduced = false;
      }
    }
    const unestIntroduced =
      ctx.hasBase &&
      (reqMeets ||
        reason === "producer-changed" ||
        reasonRecords.some((e) => meetsDelta(ctx, cone(ctx, e.record.shape))));
    out.push({
      claim: c,
      tierStar: tier,
      req,
      reqTest,
      reqJudg,
      bindingReq,
      vacuous,
      sat,
      soundContra,
      heurContras,
      reason,
      reasonRecords,
      evals,
      contraIntroduced,
      unestIntroduced,
      producerFinest: [...pfinest].sort(cmpStr),
      baseContradictions
    });
  }
  return out;
}

export function claimMatches(sel: string, c: Claim): boolean {
  const s = sel.trim();
  if (s.startsWith("c:")) return s.length >= 18 && c.fp.slice(7).startsWith(s.slice(2));
  return c.ids.includes(s);
}

/** E-provider-missing (A.5.2.13, A.16.25): authenticated base providers that supplied nothing. */
export function providerMissing(ctx: Ctx, laws: LawEval[], deps: LawDeps): ShapeError[] {
  const errors: ShapeError[] = [];
  if (!ctx.hasBase) return errors;
  for (const g of [...ctx.provs.values()].sort((a, b) => cmpStr(a.q, b.q))) {
    if (!g.authenticated || !g.base || !g.identity) continue;
    const fromIt = ctx.records.filter(
      (r) => r.shape.provider?.id === g.q && r.signers.includes(g.identity ?? "")
    );
    if (g.base.produces.includes("observation") && g.channelsB.length > 0) {
      const ok = fromIt.some(
        (r) =>
          r.shape.kind === "observation" &&
          (r.shape.revision === ctx.Mh.revision || g.depsCompleteB)
      );
      if (!ok)
        errors.push({
          code: "E-provider-missing",
          subject: `provider ${g.q}`,
          message: `authenticated observer ${g.q} supplied no authenticated head record`,
          causes: [{ type: "provider", id: g.q }],
          dischargers: [{ act: "rerun", by: "ci", agentSafe: true, eligible: [], creates: null }]
        });
    }
    if (g.base.produces.some((k) => k === "test" || k === "proof")) {
      for (const l of laws) {
        if (!lawDecidedBy(l.claim, g.base)) continue;
        const ok = fromIt.some((r) => {
          const s = r.shape;
          if (!(s.kind === "test" || s.kind === "proof") || !s.claim) return false;
          if (!(deps.geq(s.claim, l.claim) || deps.leq(s.claim, l.claim))) return false;
          const cited = cites(s, false);
          if (l.reqTest.some((p) => !cited.has(`${p.id}@${p.projection}`))) return false;
          // a stale record is neither applicable at head nor reusable (A.5.2.13, A.5.4.1-2)
          if (digestsMoved(ctx, s)) return false;
          return s.revision === ctx.Mh.revision || (g.depsCompleteB && Array.isArray(s.deps));
        });
        if (!ok)
          errors.push({
            code: "E-provider-missing",
            subject: `provider ${g.q} claim ${l.claim.ids[0] ?? l.claim.fp}`,
            message: `authenticated ${g.q} supplied no applicable record for ${l.claim.ids[0] ?? l.claim.fp} at head`,
            causes: [
              { type: "provider", id: g.q },
              { type: "claim", id: l.claim.fp }
            ],
            dischargers: [{ act: "rerun", by: "ci", agentSafe: true, eligible: [], creates: null }]
          });
      }
    }
  }
  return errors;
}
