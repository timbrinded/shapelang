// Coverage: the coverage set, Need(x), meeting by complete absence-sound entries or hatch-
// completeness, one obligation per component and vocabulary coverage (A.7.4).
import { type Edge, channelAt, footprint, tierStar } from "./checker.ts";
import type { Ctx } from "./context.ts";
import { type WFact, channelCovered } from "./evidence.ts";
import { ancestorsOrSelf } from "./manifest.ts";
import type { Claim } from "./model.ts";
import { tagKind } from "./resource-code.ts";
import { type Tier, cmpStr, maxTier, sortedUniq, tierRank } from "./util.ts";
import { UNGOVERNED, liftEffect, posComp, verbDeclared } from "./world.ts";

export interface CoverageNeed {
  claim: Claim;
  channel: string;
  met: boolean;
}

export interface CoverageOb {
  subject: string;
  component: string | null;
  uncovered: string[];
  unmet: { id: string; claim: string; channel: string; tier: Tier }[];
  tier: Tier;
  owner: string;
  unmetFinalOwners: string[];
  unmetClaims: string[];
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
}

const CHECKER_OPS = new Set(["edge.exists", "edge.forbid", "path.forbid", "cycle.forbid", "authority", "effect.forbid", "effects.upper", "effects.lower"]);

export function computeCoverage(ctx: Ctx, edges: Edge[]): CoverageResult {
  void edges;
  const empty: CoverageResult = { set: [], obligations: [], vocab: [], needs: new Map(), checked: 0, coveredCount: 0 };
  if (!ctx.hasBase || ctx.baseUnreadable) return empty;
  const W = ctx.Wh;
  const claims = ctx.head.claims.filter((c) => CHECKER_OPS.has(c.op));
  const fps = new Map(claims.map((c) => [c.fp, footprint(ctx, W, c)]));
  // coverage set
  const set = new Set<string>(ctx.finest);
  const depCause = new Map<string, string[]>();
  const changed = new Set([...ctx.delta, ...ctx.deleted]);
  for (const r of ctx.records) {
    for (const e of r.shape.scope?.entries ?? []) {
      const ch = (e.deps ?? []).filter((d) => changed.has(d.id)).map((d) => d.id);
      if (ch.length > 0 && ctx.Mh.ids.has(e.id)) {
        set.add(e.id);
        depCause.set(e.id, sortedUniq([...(depCause.get(e.id) ?? []), ...ch]));
      }
    }
  }
  if (ctx.Wb) {
    for (const c of claims) {
      if (c.polarity !== "upper" || !ctx.baseClaims.has(c.fp)) continue;
      const fb = new Set(footprint(ctx, ctx.Wb, ctx.baseClaims.get(c.fp) as Claim).code);
      for (const x of fps.get(c.fp)?.code ?? []) if (!fb.has(x)) set.add(x);
    }
  }
  const needs = new Map<string, CoverageNeed[]>();
  const uncovered = new Map<string, { x: string; unmet: CoverageNeed[] }[]>();
  let coveredCount = 0;
  const entriesAt = (x: string): { provider: string; complete: boolean; producerChanged: boolean }[] =>
    ancestorsOrSelf(ctx.Mh, x).flatMap((a) =>
      (ctx.obsEntries.get(a) ?? []).map((e) => ({ provider: e.provider, complete: e.entry.complete, producerChanged: e.producerChanged }))
    );
  for (const x of [...set].sort(cmpStr)) {
    const info = ctx.Mh.ids.get(x);
    if (!info) continue;
    const list: CoverageNeed[] = [];
    for (const c of claims) {
      const fp = fps.get(c.fp);
      if (!fp || !fp.code.includes(x)) continue;
      for (const t of fp.channels) {
        const ch = channelAt(t, info);
        if (!ch) continue;
        let met: boolean;
        if (ch.startsWith("hatch(")) met = info.hatchComplete;
        else
          met = entriesAt(x).some((e) => {
            const g = ctx.provs.get(e.provider);
            return e.complete && !e.producerChanged && !!g && g.absenceB && channelCovered(g.channelsB, ch);
          });
        list.push({ claim: c, channel: ch, met });
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
  const obligations: CoverageOb[] = [];
  for (const [comp, items] of [...uncovered.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const baseComp = comp === UNGOVERNED ? null : [...ctx.rho.entries()].find(([, h]) => h === comp)?.[0] ?? comp;
    const tb = baseComp ? ctx.gov.components.find((k) => k.q === baseComp)?.tier : undefined;
    const th = comp === UNGOVERNED ? "normal" : (W.compByQ.get(comp)?.tier ?? "normal");
    let tier: Tier = comp === UNGOVERNED ? "normal" : maxTier(th, tb ?? "low");
    const unmet: CoverageOb["unmet"] = [];
    for (const it of items) for (const n of it.unmet) {
      const t = tierStar(ctx, n.claim);
      tier = maxTier(tier, t);
      unmet.push({ id: it.x, claim: n.claim.fp, channel: n.channel, tier: t });
    }
    const owner = comp === UNGOVERNED ? ctx.gov.shape.owner : (ctx.gov.components.find((k) => k.q === baseComp)?.owner ?? W.compByQ.get(comp)?.owner ?? ctx.gov.shape.owner);
    const finalClaims = sortedUniq(unmet.filter((u) => u.tier === "final").map((u) => u.claim));
    obligations.push({
      subject: comp === UNGOVERNED ? UNGOVERNED : `component ${comp}`,
      component: comp === UNGOVERNED ? null : comp,
      uncovered: items.map((i) => i.x).sort(cmpStr),
      unmet: unmet.sort((a, b) => cmpStr(`${a.id}|${a.claim}|${a.channel}`, `${b.id}|${b.claim}|${b.channel}`)),
      tier,
      owner,
      unmetFinalOwners: finalClaims,
      unmetClaims: sortedUniq(unmet.map((u) => u.claim)),
      depCode: sortedUniq(items.flatMap((i) => depCause.get(i.x) ?? [])),
      healthOnly: tierRank(tier) < tierRank("normal")
    });
  }
  // vocabulary coverage: new facts on unmapped resource code of a bound kind, or undeclared verbs
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
      const fp = fps.get(c.fp);
      if (!fp || !fp.code.includes(f.at)) continue;
      const applies = fp.channels.some((t) => {
        const ch = channelAt(t, info);
        if (!ch || !ch.startsWith("effect(")) return false;
        return subject?.startsWith("verb ") ? channelCovered([ch], `effect(${f.resource})`) : tagKind(ch.slice(7, -1)) === tagKind(f.resource ?? "");
      });
      if (applies) tier = tier ? maxTier(tier, tierStar(ctx, c)) : tierStar(ctx, c);
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
    coveredCount
  };
}
