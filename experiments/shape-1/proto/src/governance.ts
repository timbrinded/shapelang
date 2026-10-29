// Governance G*: policy*, base actors, authors*, owner* and eligibility (A.6.2, A.6.3).
import { membersOf, personsOf } from "./elaborate.ts";
import type { Author } from "./io-types.ts";
import type { Actor, ESF, Policy, TierPolicy } from "./model.ts";
import { type Level, type Tier, cmpStr, levelRank, sortedUniq } from "./util.ts";

export interface Gov {
  actors: Map<string, Actor>;
  byIdentity: Map<string, string>;
  authors: Set<string>;
  unmappedBot: boolean;
  policy: Policy;
  shapeOwner: string;
}

/** policy*: blocks united, least max_age, highest floor, judges intersected, least budget. */
export function policyStar(base: Policy, head: Policy): Policy {
  const tier = (t: "low" | "normal" | "critical"): TierPolicy => {
    const b = base.tiers[t];
    const h = head.tiers[t];
    return {
      floor: (levelRank(b.floor) >= levelRank(h.floor) ? b.floor : h.floor) as Exclude<
        Level,
        "none"
      >,
      blocks: sortedUniq([...b.blocks, ...h.blocks]) as TierPolicy["blocks"],
      maxAge: Math.min(b.maxAge, h.maxAge),
      judges: b.judges.filter((j) => h.judges.includes(j)).sort(cmpStr)
    };
  };
  const budget =
    base.budget === null
      ? head.budget
      : head.budget === null
        ? base.budget
        : Math.min(base.budget, head.budget);
  return {
    tiers: { low: tier("low"), normal: tier("normal"), critical: tier("critical") },
    budget
  };
}

export function tierPolicy(p: Policy, t: Tier): TierPolicy {
  return t === "final" ? p.tiers.critical : p.tiers[t];
}

export function buildGov(govBase: ESF, policy: Policy, authors: Author[]): Gov {
  const actors = new Map(govBase.actors.map((a) => [a.q, a]));
  const byIdentity = new Map<string, string>();
  for (const a of govBase.actors)
    for (const i of a.identities) if (!byIdentity.has(i)) byIdentity.set(i, a.q);
  const set = new Set<string>();
  let unmappedBot = false;
  for (const au of authors) {
    const q = byIdentity.get(au.identity.trim());
    if (q) set.add(q);
    else if (au.bot) unmappedBot = true;
  }
  // closure: agent → operator; team operator → persons; person → operated agents
  let grew = true;
  while (grew) {
    grew = false;
    for (const q of Array.from(set)) {
      const a = actors.get(q);
      if (!a) continue;
      const add: string[] = [];
      if (a.kind === "agent" && a.operator) {
        const op = actors.get(a.operator);
        if (op?.kind === "team") add.push(...personsOf(op.q, actors));
        else add.push(a.operator);
      }
      if (a.kind === "person")
        for (const b of actors.values()) if (b.kind === "agent" && b.operator === q) add.push(b.q);
      for (const x of add)
        if (!set.has(x)) {
          set.add(x);
          grew = true;
        }
    }
  }
  return { actors, byIdentity, authors: set, unmappedBot, policy, shapeOwner: govBase.shape.owner };
}

export interface EligibilityQuery {
  tier: Tier;
  /** the base owner of the item answered for */
  owner: string;
  /** loosenings, exception answers and producer-changed answers: never an agent */
  noAgent: boolean;
  /** the obligation involves a final item: no self fallback */
  final: boolean;
}

/** Actors eligible by role, ignoring authorship. */
export function eligibleByRole(gov: Gov, q: EligibilityQuery): string[] {
  const judges = tierPolicy(gov.policy, q.tier).judges;
  const out = new Set<string>();
  const owners = membersOf(q.owner, gov.actors);
  for (const j of judges) {
    if (j === "owner") for (const m of owners) out.add(m);
    else if (j === "agents")
      for (const a of gov.actors.values())
        if (a.kind === "agent") out.add(a.q);
        else for (const m of membersOf(j, gov.actors)) out.add(m);
  }
  return [...out]
    .filter((a) => gov.actors.has(a))
    .filter((a) => !(q.noAgent && gov.actors.get(a)?.kind === "agent"))
    .sort(cmpStr);
}

export function isEligible(
  gov: Gov,
  j: string,
  q: EligibilityQuery
): { ok: boolean; self: boolean } {
  const role = eligibleByRole(gov, q);
  if (!role.includes(j)) return { ok: false, self: false };
  if (!gov.authors.has(j)) return { ok: true, self: false };
  // self fallback (A.6.3.3)
  const a = gov.actors.get(j);
  const persons = role.filter((x) => gov.actors.get(x)?.kind === "person");
  if (
    a?.kind === "person" &&
    !q.final &&
    persons.length === 1 &&
    persons[0] === j &&
    !gov.unmappedBot
  )
    return { ok: true, self: true };
  return { ok: false, self: false };
}

export function eligibleNow(gov: Gov, q: EligibilityQuery): string[] {
  return eligibleByRole(gov, q).filter((j) => isEligible(gov, j, q).ok);
}

export function isPerson(gov: Gov, q: string): boolean {
  return gov.actors.get(q)?.kind === "person";
}
