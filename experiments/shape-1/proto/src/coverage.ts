// Coverage (version 7): the coverage set, Need(x) on observable channels or final claims, meeting
// by complete absence-sound entries (base and head) or hatch-completeness, one obligation per
// component, and vocabulary coverage (A.4.5.6, A.7.4, A.15.9, A.16.19(b), A.16.30; D3).
import { channelAt, footprint, nearestEntries } from "./checker.ts";
import type { Ctx } from "./context.ts";
import { type WFact, channelCovered } from "./evidence.ts";
import type { Claim } from "./model.ts";
import { tagKind } from "./resource-code.ts";
import { type Tier, cmpStr, maxTier, sortedUniq, tierRank } from "./util.ts";
import { UNGOVERNED, liftEffect, posComp, verbDeclared } from "./world.ts";

export interface CoverageNeed {
  claim: Claim;
  channel: string;
  met: boolean;
  tier: Tier;
}

export interface CoverageOb {
  subject: string;
  component: string | null;
  uncovered: string[];
  unmet: { id: string; claim: string; channel: string; tier: Tier }[];
  tier: Tier;
  owner: string;
  /** claims with an unmet final pair */
  unmetFinalClaims: string[];
  unmetClaims: string[];
  /** (d, own) rows: changed dependencies that put an uncovered identity in the set */
  depCode: string[];
  healthOnly: boolean;
}

export interface VocabOb {
  subject: string;
  sites: string[];
  tier: Tier;
  facts: WFact[];
}

export interface CoverageResult {
  set: string[];
  obligations: CoverageOb[];
  vocab: VocabOb[];
  /** per identity: needs and whether met (for exploited) */
  needs: Map<string, CoverageNeed[]>;
  checked: number;
  coveredCount: number;
  /** "<claim fp> <channel>" pairs at coverage-set identities neither observable nor final */
  unobservable: string[];
}

const CHECKER_OPS = new Set([
  "edge.exists",
  "edge.forbid",
  "path.forbid",
  "cycle.forbid",
  "authority",
  "effect.forbid",
  "effects.upper",
  "effects.lower"
]);

/** Is a channel observable: a base provider absence-sound in the base declares a matching
 *  channel, or it is a hatch channel (A.4.5.6 [D3]). */
export function observable(ctx: Ctx, ch: string): boolean {
  if (ch.startsWith("hatch(")) return true;
  for (const p of ctx.gov.providers) {
    if (!p.absence) continue;
    if (
      ch === "call(*)"
        ? p.observes.some((o) => o.startsWith("call("))
        : channelCovered(p.observes, ch)
    )
      return true;
  }
  return false;
}

/** tier*(c, x): the head tier and the base claims c is an heir of whose base footprint holds x. */
export function tierStarAt(ctx: Ctx, c: Claim, x: string, baseFps: Map<string, Set<string>>): Tier {
  let t = c.tier;
  for (const b of ctx.heirOf.get(c.fp) ?? []) {
    const bc = ctx.baseClaims.get(b);
    if (!bc) continue;
    if (!baseFps.get(b)?.has(x)) continue;
    t = maxTier(t, ctx.finalAnswered.has(b) ? c.tier : bc.tier);
  }
  return t;
}

export function computeCoverage(ctx: Ctx): CoverageResult {
  const empty: CoverageResult = {
    set: [],
    obligations: [],
    vocab: [],
    needs: new Map(),
    checked: 0,
    coveredCount: 0,
    unobservable: []
  };
  if (!ctx.hasBase || ctx.baseUnreadable) return empty;
  const W = ctx.Wh;
  const claims = ctx.head.claims.filter((c) => CHECKER_OPS.has(c.op));
  const fps = new Map(claims.map((c) => [c.fp, footprint(W, c)]));
  const fpSets = new Map(claims.map((c) => [c.fp, new Set(fps.get(c.fp)?.code ?? [])]));
  const baseFps = new Map<string, Set<string>>();
  if (ctx.Wb)
    for (const b of ctx.base?.claims ?? [])
      if (CHECKER_OPS.has(b.op)) baseFps.set(b.fp, new Set(footprint(ctx.Wb, b).code));
  // coverage set (A.7.4.1): finest changes, identities whose records' entries (never
  // baseRecords) list changed or deleted deps, and footprint growth of unchanged upper bounds
  const set = new Set<string>(ctx.finest);
  const depCause = new Map<string, string[]>();
  for (const r of ctx.records) {
    if (r.shape.kind !== "observation") continue;
    for (const e of r.shape.scope?.entries ?? []) {
      const ch = (e.deps ?? [])
        .filter((d) => ctx.delta.has(d.id) || ctx.deleted.has(d.id))
        .map((d) => d.id);
      if (ch.length > 0 && ctx.Mh.ids.has(e.id)) {
        set.add(e.id);
        depCause.set(e.id, sortedUniq([...(depCause.get(e.id) ?? []), ...ch]));
      }
    }
  }
  if (ctx.Wb)
    for (const c of claims) {
      if (c.polarity !== "upper" || !ctx.baseClaims.has(c.fp)) continue;
      const fb = baseFps.get(c.fp) ?? new Set<string>();
      for (const x of fps.get(c.fp)?.code ?? []) if (!fb.has(x)) set.add(x);
    }
  for (const x of set) if (!ctx.Mh.ids.has(x)) set.delete(x);
  const needs = new Map<string, CoverageNeed[]>();
  const uncovered = new Map<string, { x: string; unmet: CoverageNeed[] }[]>();
  const unobservable = new Set<string>();
  let coveredCount = 0;
  for (const x of [...set].sort(cmpStr)) {
    const info = ctx.Mh.ids.get(x);
    if (!info) continue;
    const list: CoverageNeed[] = [];
    for (const c of claims) {
      if (c.polarity !== "upper") continue;
      if (!fpSets.get(c.fp)?.has(x)) continue;
      const t = tierStarAt(ctx, c, x, baseFps);
      for (const ch0 of fps.get(c.fp)?.channels ?? []) {
        const ch = channelAt(ch0, info);
        if (!ch) continue;
        if (!observable(ctx, ch0) && t !== "final") {
          unobservable.add(`${c.fp} ${ch}`);
          continue;
        }
        let met: boolean;
        if (ch.startsWith("hatch(")) met = info.hatchComplete;
        else
          met = nearestEntries(ctx, x).some((e) => {
            const g = ctx.provs.get(e.provider);
            return (
              e.entry.complete &&
              !e.producerChanged &&
              !!g &&
              g.absenceB &&
              channelCovered(g.channelsB, ch)
            );
          });
        list.push({ claim: c, channel: ch, met, tier: t });
      }
    }
    needs.set(x, list);
    const unmet = list.filter((n) => !n.met);
    if (unmet.length === 0) {
      coveredCount += 1;
      continue;
    }
    const comp = posComp(W.att(x)) ?? UNGOVERNED;
    uncovered.set(comp, [...(uncovered.get(comp) ?? []), { x, unmet }]);
  }
  const rhoInv = new Map<string, string>();
  for (const [b, h] of ctx.rho) rhoInv.set(h, b);
  const obligations: CoverageOb[] = [];
  for (const [comp, items] of [...uncovered.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const baseComp = comp === UNGOVERNED ? null : (rhoInv.get(comp) ?? null);
    const kb = baseComp ? ctx.gov.components.find((k) => k.q === baseComp) : undefined;
    const th = comp === UNGOVERNED ? "normal" : (W.compByQ.get(comp)?.tier ?? "normal");
    // tier*(K) = max(tier_b(ρ⁻¹K), tier_h(K)), ungoverned normal (A.6.2.4)
    let tier: Tier = comp === UNGOVERNED ? "normal" : maxTier(th, kb?.tier ?? "low");
    const unmet: CoverageOb["unmet"] = [];
    for (const it of items)
      for (const n of it.unmet) {
        tier = maxTier(tier, n.tier);
        unmet.push({ id: it.x, claim: n.claim.fp, channel: n.channel, tier: n.tier });
      }
    const owner =
      comp === UNGOVERNED
        ? ctx.gov.shape.owner
        : (kb?.owner ?? W.compByQ.get(comp)?.owner ?? ctx.gov.shape.owner);
    const uniq = new Map(unmet.map((u) => [`${u.id}\u0000${u.claim}\u0000${u.channel}`, u]));
    const sorted = [...uniq.values()].sort((a, b) =>
      cmpStr(
        `${a.id}\u0000${a.claim}\u0000${a.channel}`,
        `${b.id}\u0000${b.claim}\u0000${b.channel}`
      )
    );
    obligations.push({
      subject: comp === UNGOVERNED ? UNGOVERNED : `component ${comp}`,
      component: comp === UNGOVERNED ? null : comp,
      uncovered: items.map((i) => i.x).sort(cmpStr),
      unmet: sorted,
      tier,
      owner,
      unmetFinalClaims: sortedUniq(sorted.filter((u) => u.tier === "final").map((u) => u.claim)),
      unmetClaims: sortedUniq(sorted.map((u) => u.claim)),
      depCode: sortedUniq(items.flatMap((i) => depCause.get(i.x) ?? [])),
      healthOnly: tierRank(tier) < tierRank("normal")
    });
  }
  // vocabulary coverage (A.7.4.6): new facts on unmapped resource code of a bound kind, or
  // undeclared verbs, under a claim with an applicable channel
  const vocab = new Map<string, VocabOb>();
  for (const f of ctx.facts) {
    if (f.type !== "effect" || !f.at || !f.verb || !f.resource || !ctx.newFact(f)) continue;
    const info = ctx.Mh.ids.get(f.at);
    if (!info) continue;
    const lifted = liftEffect(W, f.verb, f.resource);
    let subject: string | null = null;
    if (!lifted && W.boundKinds.has(tagKind(f.resource))) subject = `resourceCode ${f.resource}`;
    else if (lifted && !verbDeclared(W, f.verb)) subject = `verb ${f.verb}`;
    if (!subject) continue;
    let tier: Tier | null = null;
    for (const c of claims) {
      if (!fpSets.get(c.fp)?.has(f.at)) continue;
      const applies = (fps.get(c.fp)?.channels ?? []).some((t) => {
        const ch = channelAt(t, info);
        if (!ch || !ch.startsWith("effect(")) return false;
        return subject?.startsWith("verb ")
          ? channelCovered([ch], `effect(${f.resource})`)
          : tagKind(ch.slice(7, -1)) === tagKind(f.resource ?? "");
      });
      if (applies) {
        const t = tierStarAt(ctx, c, f.at, baseFps);
        tier = tier ? maxTier(tier, t) : t;
      }
    }
    if (!tier) continue;
    const v = vocab.get(subject) ?? { subject, sites: [], tier, facts: [] };
    v.sites = sortedUniq([...v.sites, f.at]);
    v.tier = maxTier(v.tier, tier);
    v.facts.push(f);
    vocab.set(subject, v);
  }
  return {
    set: [...set].sort(cmpStr),
    obligations,
    vocab: [...vocab.values()].sort((a, b) => cmpStr(a.subject, b.subject)),
    needs,
    checked: set.size,
    coveredCount,
    unobservable: [...unobservable].sort(cmpStr)
  };
}
