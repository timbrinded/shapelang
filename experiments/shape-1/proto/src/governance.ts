// Governance G* (version 7): policy*, base actors, authors*, eligibility with the self fallback
// read from the base judges, and the two-person rule for final items (A.6.2, A.6.3, A.15.6,
// A.16.12, A.16.15, A.16.16).
import { personsOf } from "./elaborate.ts";
import type { Author } from "./io-types.ts";
import type { Actor, ESF, Policy, TierPolicy } from "./model.ts";
import { type Level, type Tier, cmpStr, levelRank, sortedUniq } from "./util.ts";

export interface Gov {
  actors: Map<string, Actor>;
  byIdentity: Map<string, string>;
  /** authors*: base actors behind the authors, closed under agent → operator (A.6.3.2) */
  authors: Set<string>;
  unmappedBot: boolean;
  /** policy* (A.6.2.6) */
  policy: Policy;
  /** the base policy: the self fallback reads the base judges alone [D12] */
  basePolicy: Policy;
  shapeOwner: string;
  /** no self fallback at all (an unreadable base, A.16.16) */
  noFallback: boolean;
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

export function buildGov(
  govBase: ESF,
  policy: Policy,
  basePolicy: Policy,
  authors: Author[],
  noFallback = false
): Gov {
  const actors = new Map(govBase.actors.map((a) => [a.q, a]));
  const byIdentity = new Map<string, string>();
  for (const a of [...govBase.actors].sort((x, y) => cmpStr(x.q, y.q)))
    for (const i of a.identities) if (!byIdentity.has(i)) byIdentity.set(i, a.q);
  const set = new Set<string>();
  let unmappedBot = false;
  for (const au of authors ?? []) {
    const q = byIdentity.get(String(au.identity ?? "").trim());
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
  return {
    actors,
    byIdentity,
    authors: set,
    unmappedBot,
    policy,
    basePolicy,
    shapeOwner: govBase.shape.owner,
    noFallback
  };
}

export interface EligibilityQuery {
  tier: Tier;
  /** the item's owner, resolved to persons for the `owner` judge (owner*, base owner, ...) */
  owner: string;
  /** loosenings, exception answers, producer-changed answers, acts on final claims: no agent */
  noAgent: boolean;
  /** an act on a final item: persons of the owner and of the base shape owner, no fallback */
  final: boolean;
  /** an act of this change: authorship bars it (A.6.3.3, A.16.4(b)); default true */
  thisChange?: boolean;
}

export function persons(gov: Gov, q: string): string[] {
  return [...personsOf(q, gov.actors)].sort(cmpStr);
}

/** Actors eligible by role under a policy's judges, ignoring authorship (A.6.3.3, A.15.6). */
export function eligibleByRole(
  gov: Gov,
  q: EligibilityQuery,
  policy: Policy = gov.policy
): string[] {
  const out = new Set<string>();
  if (q.final) {
    // A.16.12(a): the persons of the item's base owner and of the base shape owner
    for (const p of persons(gov, q.owner)) out.add(p);
    for (const p of persons(gov, gov.shapeOwner)) out.add(p);
  } else {
    const judges = tierPolicy(policy, q.tier).judges;
    const agentsListed = judges.includes("agents");
    for (const j of judges) {
      if (j === "owner") for (const p of persons(gov, q.owner)) out.add(p);
      else if (j === "agents") {
        for (const a of gov.actors.values()) if (a.kind === "agent") out.add(a.q);
      } else {
        const a = gov.actors.get(j);
        if (!a) continue;
        if (a.kind === "team") {
          for (const p of persons(gov, j)) out.add(p);
          if (agentsListed)
            for (const m of a.members) if (gov.actors.get(m)?.kind === "agent") out.add(m);
        } else out.add(j);
      }
    }
  }
  return [...out]
    .filter((a) => gov.actors.has(a))
    .filter((a) => !((q.noAgent || q.final) && gov.actors.get(a)?.kind === "agent"))
    .sort(cmpStr);
}

export function isEligible(
  gov: Gov,
  j: string,
  q: EligibilityQuery
): { ok: boolean; self: boolean } {
  const role = eligibleByRole(gov, q);
  if (!role.includes(j)) return { ok: false, self: false };
  if (q.thisChange === false || !gov.authors.has(j)) return { ok: true, self: false };
  // self fallback (A.6.3.3): a person, no final item, the only base person eligible by role
  // under the base judges ignoring authorship, no author an unmapped bot [D12]
  if (gov.noFallback || q.final || gov.unmappedBot) return { ok: false, self: false };
  const a = gov.actors.get(j);
  if (a?.kind !== "person") return { ok: false, self: false };
  const basePersons = eligibleByRole(gov, q, gov.basePolicy).filter(
    (x) => gov.actors.get(x)?.kind === "person"
  );
  if (basePersons.length === 1 && basePersons[0] === j) return { ok: true, self: true };
  return { ok: false, self: false };
}

export function eligibleNow(gov: Gov, q: EligibilityQuery): string[] {
  return eligibleByRole(gov, q).filter((j) => isEligible(gov, j, q).ok);
}

export function isPerson(gov: Gov, q: string): boolean {
  return gov.actors.get(q)?.kind === "person";
}

/** Two distinct eligible persons, one of the owner and one of the base shape owner (two of that
 *  actor when they coincide), among the actors that acted (A.6.3.4, A.16.12). */
export function finalPair(gov: Gov, owner: string, tier: Tier, acted: string[]): string[] | null {
  const q: EligibilityQuery = { tier, owner, noAgent: true, final: true };
  const ok = sortedUniq(acted).filter((j) => isPerson(gov, j) && isEligible(gov, j, q).ok);
  const A = new Set(persons(gov, owner));
  const B = new Set(persons(gov, gov.shapeOwner));
  for (const x of ok)
    for (const y of ok) if (x !== y && A.has(x) && B.has(y)) return [x, y].sort(cmpStr);
  return null;
}
