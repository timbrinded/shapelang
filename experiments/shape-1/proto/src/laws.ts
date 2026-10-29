// Laws: requirement R*, Req(c, kind), applicability, usability, Sat, the total law reason, law
// contradictions, and E-provider-missing (A.5.2.13, A.5.3, A.5.4, A.5.5).
import type { Ctx } from "./context.ts";
import { lawDecidedBy } from "./elaborate.ts";
import { globMatches } from "./globs.ts";
import { type Gov, isEligible, tierPolicy } from "./governance.ts";
import { descendantsOrSelf } from "./manifest.ts";
import type { Claim, Requirement, ShapeError } from "./model.ts";
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
import { compCode, posComp } from "./world.ts";

export interface Pair {
  id: string;
  projection: string;
}

export type UseReason = "stale" | "expired" | "producer-changed" | "assumption" | "weak";

export interface RecEval {
  record: ParsedRecord | null;
  /** synthetic review judgments (no relay) have no record */
  review: string | null;
  judge: string | null;
  direction: "supports" | "contradicts" | "inconclusive";
  applicable: boolean;
  reason: UseReason | null;
  force: "sound" | "heuristic" | null;
  self: boolean;
}

export interface LawEval {
  claim: Claim;
  tierStar: Tier;
  req: Requirement;
  reqTest: Pair[];
  reqJudg: Pair[];
  bindingReq: Pair[];
  sat: boolean;
  soundContra: RecEval | null;
  heurContras: RecEval[];
  reason: string | null;
  evals: RecEval[];
  producerChanged: boolean;
  introduced: boolean;
  producerFinest: string[];
}

export interface ClaimJudgmentReview {
  actor: string;
  claimSel: string;
  reject: boolean;
  text: string;
  line: string;
}

export function strictest(a: Requirement, b: Requirement): Requirement {
  return {
    level: levelRank(a.level) >= levelRank(b.level) ? a.level : b.level,
    judged: a.judged && b.judged,
    pins: sortedUniq([...a.pins, ...b.pins]),
    projection: a.projection === b.projection ? a.projection : "unit"
  };
}

export function lawTierStar(ctx: Ctx, c: Claim): Tier {
  let t = c.tier;
  for (const b of ctx.heirOf.get(c.fp) ?? []) {
    const bc = ctx.baseClaims.get(b);
    if (bc) t = maxTier(t, bc.tier);
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
  for (const b of ctx.heirOf.get(c.fp) ?? []) {
    const bc = ctx.baseClaims.get(b);
    if (bc?.requirement) r = strictest(r, bc.requirement);
  }
  const floor = tierPolicy(ctx.policy, tier).floor;
  return { ...r, level: levelRank(r.level) >= levelRank(floor) ? r.level : floor };
}

/** Req(c, kind) from c and M_h (A.5.3.4). */
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
  const marked = (id: string): boolean =>
    Object.values(M.ids.get(id)?.markers ?? {}).some((n) => n > 0);
  for (const t of (c.args.on as string[]) ?? []) {
    if (t.startsWith("unit ")) {
      const x = W.unitBind.get(t.slice(5)) ?? null;
      if (!x) {
        out.push({ id: `unbound:${t.slice(5)}`, projection: "unit" });
        continue;
      }
      if (projection === "trust") {
        if (descendantsOrSelf(M, x).some(marked)) out.push({ id: x, projection: "unit" });
      } else if (kind === "test") out.push({ id: x, projection: "unit" });
      else out.push({ id: x, projection });
    } else if (t.startsWith("component ")) {
      const code = compCode(W, t.slice(10));
      const codeSet = new Set(code);
      if (projection === "trust") {
        for (const x of code) {
          if (!marked(x)) continue;
          const isFile = !M.ids.get(x)?.symbol;
          out.push({ id: x, projection: isFile ? "own" : "unit" });
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
      if (pi === "unit")
        for (const x of code) if (!M.ids.get(x)?.symbol) out.push({ id: x, projection: "own" });
    } else if (t.startsWith("code ")) {
      const x = t.slice(5);
      out.push({ id: x, projection: has(x, "unit") ? "unit" : "file" });
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

function cites(r: ShapeRecord): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of [...(r.code ?? []), ...(r.deps ?? [])])
    m.set(`${c.id}@${c.projection}`, c.digest);
  return m;
}

export function producerChanged(ctx: Ctx, r: ParsedRecord): boolean {
  const pq = r.shape.provider?.id;
  if (!pq || r.shape.kind === "judgment") return false;
  const g = ctx.provs.get(pq);
  if (!g) return false;
  const changed = [...ctx.delta, ...ctx.deleted];
  if (g.implementationDigests.length > 1) return true;
  for (const x of changed) {
    const path = ctx.Mh.ids.get(x)?.path ?? ctx.Mb?.ids.get(x)?.path ?? "";
    if (g.implementationPaths.some((p) => globMatches(p, path))) return true;
  }
  for (const h of r.shape.harness ?? []) {
    if (ctx.delta.has(h.id) || ctx.deleted.has(h.id)) return true;
    const d = ctx.Mh.ids.get(h.id)?.digests.get(h.projection);
    if (d === undefined || !ctx.equiv(d, h.digest)) return true;
  }
  return false;
}

export function producerFinest(ctx: Ctx, r: ParsedRecord): string[] {
  const pq = r.shape.provider?.id;
  const g = pq ? ctx.provs.get(pq) : undefined;
  const out = new Set<string>();
  for (const x of ctx.finest) {
    const path = ctx.Mh.ids.get(x)?.path ?? "";
    if (g?.implementationPaths.some((p) => globMatches(p, path))) out.add(x);
  }
  for (const h of r.shape.harness ?? []) if (ctx.finest.has(h.id)) out.add(h.id);
  return [...out].sort(cmpStr);
}

function cone(ctx: Ctx, r: ShapeRecord): Set<string> {
  const start = [...(r.code ?? []), ...(r.deps ?? [])]
    .map((c) => c.id)
    .filter((x) => ctx.Mh.ids.has(x));
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const x = stack.pop() as string;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const d of descendantsOrSelf(ctx.Mh, x)) if (!seen.has(d)) stack.push(d);
    for (const c of ctx.calls.get(x) ?? []) stack.push(c.to);
  }
  return seen;
}

function assumptionUndeclared(
  ctx: Ctx,
  r: ParsedRecord,
  c: Claim,
  tier: Tier,
  req: Pair[]
): boolean {
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
  const boundaryAllows = (w: Ctx["Wh"] | null, x: string, kind: string): boolean => {
    if (!w) return false;
    const comp = posComp(w.att(x));
    const k = comp ? w.compByQ.get(comp) : undefined;
    return !!k && k.boundary && k.allows.includes(kind);
  };
  for (const h of hatch) {
    if (tier === "final" && h.kind === "assume") return true;
    const base = ctx.Wb ?? (ctx.mode === "audit" ? ctx.Wh : null);
    if (!(boundaryAllows(ctx.Wh, h.x, h.kind) && boundaryAllows(base, h.x, h.kind))) return true;
  }
  if (named.length > 0) {
    const base = ctx.Wb ?? (ctx.mode === "audit" ? ctx.Wh : null);
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
  void c;
  return false;
}

function levelOfKind(kind: string): Level {
  return kind === "proof" ? "proven" : kind === "test" ? "tested" : "declared";
}

export function evaluateLaws(
  ctx: Ctx,
  gov: Gov,
  geq: (a: { fp: string; nf?: string }, c: Claim) => boolean,
  leq: (a: { fp: string; nf?: string }, c: Claim) => boolean,
  reviews: ClaimJudgmentReview[]
): LawEval[] {
  const out: LawEval[] = [];
  for (const c of ctx.head.claims) {
    if (c.op !== "law") continue;
    const tier = lawTierStar(ctx, c);
    const req = requirementStar(ctx, c, tier);
    const reqTest = reqOf(ctx, c, "test", req.projection === "trust" ? "trust" : "unit");
    const reqJudg = reqOf(ctx, c, "judgment", req.projection);
    const tp = tierPolicy(ctx.policy, tier);
    const evals: RecEval[] = [];
    let anyProducerChanged = false;
    const pfinest = new Set<string>();
    for (const r of ctx.records) {
      const s = r.shape;
      if (!(s.kind === "test" || s.kind === "proof" || (s.kind === "judgment" && s.claim)))
        continue;
      if (!s.claim) continue;
      const direction =
        s.result === "supports"
          ? "supports"
          : s.result === "contradicts"
            ? "contradicts"
            : "inconclusive";
      const related = direction === "contradicts" ? leq(s.claim, c) : geq(s.claim, c);
      if (!related) continue;
      const isJ = s.kind === "judgment";
      const req0 = isJ ? reqJudg : reqTest;
      const cited = cites(s);
      const partial = req0.some((p) => !cited.has(`${p.id}@${p.projection}`));
      // stale
      let reason: UseReason | null = null;
      for (const [k, d] of cited) {
        const at = k.lastIndexOf("@");
        const id = k.slice(0, at);
        const proj = k.slice(at + 1);
        const h = ctx.Mh.ids.get(id)?.digests.get(proj);
        if (h === undefined || !ctx.equiv(h, d)) reason = "stale";
      }
      const g = s.provider ? ctx.provs.get(s.provider.id) : undefined;
      if (!isJ && s.revision !== ctx.Mh.revision && !g?.depsCompleteB) reason = reason ?? "stale";
      if (partial) reason = reason ?? "stale";
      // judge eligibility (judgments)
      let judgeOk = true;
      let self = false;
      if (isJ) {
        const j = s.judge ?? "";
        const e = isEligible(gov, j, {
          tier,
          owner: ownerStar(ctx, c),
          noAgent: false,
          final: tier === "final"
        });
        judgeOk = e.ok;
        self = e.self;
        const t = toSeconds(s.time) ?? 0;
        if (!reason && ctx.now - t > tp.maxAge * 86400) reason = "expired";
      }
      if (!reason && producerChanged(ctx, r)) {
        reason = "producer-changed";
      }
      if (!isJ && !reason && assumptionUndeclared(ctx, r, c, tier, req0)) reason = "assumption";
      if (!reason) {
        if (isJ) {
          if (!req.judged || (req.pins.length > 0 && !req.pins.includes(s.judge ?? "")))
            reason = "weak";
        } else {
          const lvl = g?.establishes ? levelOfKind(s.kind) : "declared";
          const pinned = req.pins.length > 0 && !req.pins.includes(s.provider?.id ?? "");
          if (levelRank(lvl) < levelRank(req.level) || pinned) reason = "weak";
        }
      }
      if (producerChanged(ctx, r)) {
        anyProducerChanged = anyProducerChanged || reason === "producer-changed";
        for (const x of producerFinest(ctx, r)) pfinest.add(x);
      }
      let force: RecEval["force"] = null;
      if (
        direction === "contradicts" &&
        !partial &&
        judgeOk &&
        reason !== "stale" &&
        reason !== "expired"
      ) {
        if (isJ) force = "sound";
        else if (s.counterexample !== undefined && s.counterexample !== null)
          force = g?.presenceA ? "sound" : "heuristic";
      }
      evals.push({
        record: r,
        review: null,
        judge: s.judge ?? null,
        direction,
        applicable: !partial && judgeOk,
        reason,
        force,
        self
      });
    }
    // claim judgments from review lines without a relay: this run only, head Req
    for (const rv of reviews) {
      if (!claimMatches(rv.claimSel, c)) continue;
      const e = isEligible(gov, rv.actor, {
        tier,
        owner: ownerStar(ctx, c),
        noAgent: false,
        final: tier === "final"
      });
      let reason: UseReason | null = null;
      if (!req.judged || (req.pins.length > 0 && !req.pins.includes(rv.actor))) reason = "weak";
      evals.push({
        record: null,
        review: rv.line,
        judge: rv.actor,
        direction: rv.reject ? "contradicts" : "supports",
        applicable: e.ok,
        reason,
        force: rv.reject && e.ok ? "sound" : null,
        self: e.self
      });
    }
    evals.sort((a, b) => cmpStr(a.record?.id ?? a.review ?? "", b.record?.id ?? b.review ?? ""));
    const soundContra = evals.find((e) => e.force === "sound") ?? null;
    const heurContras = evals.filter((e) => e.force === "heuristic");
    let sat = false;
    if (!soundContra) {
      if (req.level === "declared") sat = true;
      else
        sat = evals.some((e) => {
          if (e.direction !== "supports" || !e.applicable || e.reason) return false;
          const isJ = e.record ? e.record.shape.kind === "judgment" : true;
          return isJ ? req.judged : true;
        });
    }
    let reason: string | null = null;
    if (!sat && !soundContra) {
      const order: UseReason[] = ["producer-changed", "assumption", "weak", "expired", "stale"];
      reason = "missing";
      for (const o of order) {
        if (evals.some((e) => e.reason === o)) {
          reason = o;
          break;
        }
      }
    }
    const bindingReq =
      levelRank(req.level) >= 1 && req.level !== "none" ? reqTest : req.judged ? reqJudg : reqTest;
    const changed = new Set([...ctx.delta, ...ctx.deleted]);
    const introduced =
      ctx.hasBase && (bindingReq.some((p) => changed.has(p.id)) || reason === "producer-changed");
    out.push({
      claim: c,
      tierStar: tier,
      req,
      reqTest,
      reqJudg,
      bindingReq,
      sat,
      soundContra,
      heurContras,
      reason,
      evals,
      producerChanged: anyProducerChanged,
      introduced,
      producerFinest: [...pfinest].sort(cmpStr)
    });
  }
  return out;
}

export function claimMatches(sel: string, c: Claim): boolean {
  const s = sel.trim();
  if (s.startsWith("c:")) return s.length >= 18 && c.fp.slice(7).startsWith(s.slice(2));
  return c.ids.includes(s);
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

/** E-provider-missing (A.5.2.13). */
export function providerMissing(ctx: Ctx, laws: LawEval[]): ShapeError[] {
  const errors: ShapeError[] = [];
  if (!ctx.hasBase) return errors;
  for (const g of [...ctx.provs.values()].sort((a, b) => cmpStr(a.q, b.q))) {
    if (!g.authenticated || !g.base) continue;
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
        if (!g.base || !lawDecidedBy(l.claim, g.base)) continue;
        const ok = l.evals.some(
          (e) =>
            e.record &&
            e.record.shape.provider?.id === g.q &&
            e.record.signers.includes(g.identity ?? "") &&
            e.applicable &&
            (e.reason !== "stale" || false)
        );
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
