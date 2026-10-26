// teeth: model mutation for Shape 1.0 models (A.10.5, adapted from experiments/verus-probes/e10).
// Closed-form kill sets over the elaborated head and its world (W_decl plus usable observed facts):
//   W1  add an effect fact (position u, atom a) not already entailed there: killed by every effect
//       forbid with a ∈ Prot(u), by authority(K) when a ∉ A(u), and by effects.upper(v, C) when u
//       lies in v's reach and a ∉ cl(C);
//   W2  add a type-correct edge (A, k, B) not already present: killed by edge forbids matching it,
//       path forbids whose sources reach A and whose targets B reaches (interiors outside V), and
//       cycle forbids over k when B already reaches A;
//   P1  grant a destructive verb on R to K and perform it at K.*: killed iff a ∈ Prot(K.*);
//   M2  remove a grant: killed iff some fact at K's positions needs it (else the grant is unused).
// Vacuous claims kill nothing; redundant claims (and path-forbid sources) kill a subset of another;
// gaps are the surviving mutants by change class. Lower bounds are not assessed (additions only).
// Laws use bound.mutants from their test records.
import { type Claim, type ESF, TRUST, parseAtom } from "../../src/model.ts";
import type { ParsedRecord } from "../../src/records.ts";
import { cmpStr, sortedUniq } from "../../src/util.ts";
import { UNGOVERNED, type World, covers, impl, inA, liftEffect, liftHatch, nodeSet, posComp, protectingForbids } from "../../src/world.ts";

export interface TeethOptions {
  esf: ESF;
  world: World;
  /** usable observation records at head (facts join W_decl) */
  observations?: ParsedRecord[];
  /** test records carrying bound.mutants for laws */
  tests?: ParsedRecord[];
  /** P1 verbs (default: every verb ⇒ HardDelete) */
  p1Verbs?: string[];
}

export interface ClaimTeeth {
  fp: string;
  id: string;
  op: string;
  tier: string;
  kills: { W1: number; W2: number; P1: number };
  vacuous: boolean;
  /** claims whose kill set contains this one's (subset or equal) */
  redundantWith: string[];
}

export interface TeethReport {
  v: "shape.teeth.v1";
  /** what the kill sets are exact for */
  basis: string;
  operators: { op: string; mutants: number; killed: number }[];
  claims: ClaimTeeth[];
  vacuous: string[];
  redundant: string[];
  sources: { claim: string; source: string; kills: number; redundantWith: string[] }[];
  unusedGrants: string[];
  gaps: {
    W1: Record<string, number>;
    W2: { kind: string; class: string; total: number; killed: number }[];
    P1: { resources: number; uncaught: string[]; caught: string[] };
  };
  laws: { fp: string; id: string; mutants: { total: number; killed: number } | null; verdict: "vacuous" | "weak" | "teeth" | "unassessed" }[];
  notAssessed: string[];
}

type KillSets = Map<string, Set<number>>;

function addKill(m: KillSets, fp: string, i: number): void {
  let s = m.get(fp);
  if (!s) {
    s = new Set();
    m.set(fp, s);
  }
  s.add(i);
}

function isSubset(a: Set<number>, b: Set<number>): boolean {
  if (a.size > b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Declared and observed atoms per position (⇒-closure applied later), and component edges. */
export function worldFacts(o: Pick<TeethOptions, "esf" | "world" | "observations">): { atoms: Map<string, Set<string>>; edges: Set<string>; reachOf: Map<string, Set<string>> } {
  const W = o.world;
  const atoms = new Map<string, Set<string>>();
  const add = (pos: string, atom: string): void => {
    const s = atoms.get(pos) ?? new Set<string>();
    s.add(atom);
    atoms.set(pos, s);
  };
  const edges = new Set<string>();
  const callPairs: [string, string][] = [];
  for (const c of o.esf.claims) {
    if (c.op === "effects.lower") {
      const u = String(c.args.unit);
      for (const entry of c.args.atoms as string[]) {
        const m = /^(.+?)(?: via (.+))?$/.exec(entry);
        const atom = m?.[1] ?? entry;
        const via = m?.[2] ?? null;
        if (via) {
          add(via, atom);
          callPairs.push([u, via]);
        } else add(u, atom);
      }
    } else if (c.op === "edge.exists") edges.add(`${String(c.args.from)}\u0000${String(c.args.kind)}\u0000${String(c.args.to)}`);
  }
  for (const r of o.observations ?? []) {
    for (const f of r.shape.facts ?? []) {
      if (f.type === "effect") {
        const l = liftEffect(W, f.verb, f.resource);
        if (l) add(W.att(f.at), l.atom);
      } else if (f.type === "call") {
        callPairs.push([W.att(f.at), W.att(f.to)]);
      } else if (f.type === "edge") {
        const a = posComp(W.att(f.at));
        const res = W.resOfCode.get(f.to);
        const b = res ?? (W.man.ids.has(f.to) ? posComp(W.att(f.to)) : null);
        if (a && b) edges.add(`${a}\u0000${f.kind}\u0000${b}`);
      }
    }
  }
  for (const x of W.man.ids.values()) for (const [k, n] of Object.entries(x.markers)) if (n > 0) add(W.att(x.id), liftHatch(W, k));
  // position-level reach through calls (summaries' footprint), and component call edges
  const callsFrom = new Map<string, Set<string>>();
  for (const [a, b] of callPairs) {
    const s = callsFrom.get(a) ?? new Set<string>();
    s.add(b);
    callsFrom.set(a, s);
    const ca = posComp(a);
    const cb = posComp(b);
    if (ca && cb && ca !== cb) edges.add(`${ca}\u0000calls\u0000${cb}`);
  }
  const reachOf = new Map<string, Set<string>>();
  for (const u of W.positions) {
    const seen = new Set<string>([u]);
    const stack = [u];
    while (stack.length > 0) {
      const x = stack.pop() as string;
      for (const y of callsFrom.get(x) ?? []) if (!seen.has(y)) {
        seen.add(y);
        stack.push(y);
      }
    }
    reachOf.set(u, seen);
  }
  return { atoms, edges, reachOf };
}

function entailed(W: World, present: Set<string> | undefined, atom: string): boolean {
  if (!present) return false;
  const a = parseAtom(atom);
  if (!a) return false;
  for (const p of present) {
    const q = parseAtom(p);
    if (q && q.resource === a.resource && impl(W, q.verb, a.verb)) return true;
  }
  return false;
}

function inClosure(W: World, atoms: string[], atom: string): boolean {
  const a = parseAtom(atom);
  if (!a) return false;
  return atoms.some((c) => {
    const p = parseAtom(c.replace(/ via .+$/, ""));
    return !!p && p.resource === a.resource && impl(W, a.verb, p.verb);
  });
}

/** The claims a W1 mutant (fact `atom` at position `pos`) breaks: forbids protecting it,
 *  authority when ungranted, and complete summaries whose reach holds the position. */
export function w1Killers(W: World, uppers: Claim[], reachOf: Map<string, Set<string>>, pos: string, atom: string): Claim[] {
  const killers: Claim[] = [...protectingForbids(W, pos, atom)];
  if (!inA(W, pos, atom)) {
    const comp = posComp(pos);
    const auth = comp ? W.authority.get(comp) : undefined;
    if (auth) killers.push(auth);
  }
  for (const u of uppers) {
    const unit = String(u.args.unit);
    if (!reachOf.get(unit)?.has(pos)) continue;
    if (!atom.endsWith(`<${TRUST}>`) && !inClosure(W, u.args.atoms as string[], atom)) killers.push(u);
  }
  return killers;
}

function reachable(adj: Map<string, string[]>, from: string, allow: (n: string) => boolean): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const x = stack.pop() as string;
    for (const y of adj.get(x) ?? []) {
      if (seen.has(y)) continue;
      seen.add(y);
      if (allow(y)) stack.push(y);
    }
  }
  return seen;
}

export function teeth(o: TeethOptions): TeethReport {
  const W = o.world;
  const claims = o.esf.claims;
  const byFp = new Map(claims.map((c) => [c.fp, c]));
  const { atoms: present, edges, reachOf } = worldFacts(o);
  const kills: KillSets = new Map();
  const killsByOp: Record<"W1" | "W2" | "P1", KillSets> = { W1: new Map(), W2: new Map(), P1: new Map() };
  const operators: TeethReport["operators"] = [];
  const hatchVerbs = new Set(o.esf.effects.map((e) => e.verb).filter((v) => v !== "Hatch" && impl(W, v, "Hatch")));
  const verbs = o.esf.effects.map((e) => e.verb).filter((v) => v !== "Hatch" && !hatchVerbs.has(v));
  const resources = o.esf.resources.filter((r) => !r.q.startsWith("std::")).map((r) => r.q);
  const uppers = claims.filter((c) => c.op === "effects.upper");
  let mutantIndex = 0;

  // ---- W1 -------------------------------------------------------------------------------------
  const w1Gap: Record<string, number> = {};
  let w1 = 0;
  let w1k = 0;
  const atomUniverse = [...resources.flatMap((r) => verbs.map((v) => `${v}<${r}>`)), ...[...hatchVerbs, "Hatch"].map((h) => `${h}<${TRUST}>`)];
  for (const pos of W.positions) {
    for (const atom of atomUniverse) {
      if (entailed(W, present.get(pos), atom)) continue;
      const i = mutantIndex++;
      w1 += 1;
      const killers = w1Killers(W, uppers, reachOf, pos, atom);
      if (killers.length > 0) {
        w1k += 1;
        for (const k of killers) {
          addKill(kills, k.fp, i);
          addKill(killsByOp.W1, k.fp, i);
        }
        continue;
      }
      const comp = posComp(pos);
      const cls = atom.endsWith(`<${TRUST}>`)
        ? "hatch-unforbidden"
        : pos === UNGOVERNED
          ? "ungoverned"
          : !comp || W.compByQ.get(comp)?.grants === null
            ? "open-authority"
            : "granted-to-component";
      w1Gap[cls] = (w1Gap[cls] ?? 0) + 1;
    }
  }
  operators.push({ op: "W1", mutants: w1, killed: w1k });

  // ---- W2 -------------------------------------------------------------------------------------
  const kinds = o.esf.kinds;
  const comps = W.nodes.filter((n) => W.compByQ.has(n));
  const resNodes = W.nodes.filter((n) => !W.compByQ.has(n));
  const adjByKind = new Map<string, Map<string, string[]>>();
  for (const e of edges) {
    const [a, k, b] = e.split("\u0000") as [string, string, string];
    const m = adjByKind.get(k) ?? new Map<string, string[]>();
    m.set(a, [...(m.get(a) ?? []), b]);
    adjByKind.set(k, m);
  }
  const adjFor = (ks: string[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const k of ks) for (const [a, bs] of adjByKind.get(k) ?? []) m.set(a, [...(m.get(a) ?? []), ...bs]);
    return m;
  };
  const reverse = (adj: Map<string, string[]>): Map<string, string[]> => {
    const r = new Map<string, string[]>();
    for (const [a, bs] of adj) for (const b of bs) r.set(b, [...(r.get(b) ?? []), a]);
    return r;
  };
  // path forbids: per claim F (sources' forward region) and G (targets' backward region)
  interface PathInfo {
    claim: Claim;
    kinds: Set<string>;
    F: Set<string>;
    G: Set<string>;
    perSource: Map<string, Set<string>>;
  }
  const paths: PathInfo[] = [];
  for (const c of claims.filter((x) => x.op === "path.forbid")) {
    const ks = c.args.kinds as string[];
    const adj = adjFor(ks);
    const radj = reverse(adj);
    const V = nodeSet(W, c.args.exceptVia as string[]);
    const S = [...nodeSet(W, c.args.from as string[])].filter((s) => !V.has(s));
    const T = nodeSet(W, c.args.to as string[]);
    const perSource = new Map<string, Set<string>>();
    const F = new Set<string>();
    for (const s of S) {
      const f = new Set<string>([s, ...[...reachable(adj, s, (n) => !V.has(n))].filter((n) => !V.has(n))]);
      perSource.set(s, f);
      for (const n of f) F.add(n);
    }
    const G = new Set<string>(T);
    for (const t of T) for (const n of reachable(radj, t, (x) => !V.has(x))) if (!V.has(n)) G.add(n);
    paths.push({ claim: c, kinds: new Set(ks), F, G, perSource });
  }
  const cycles = claims.filter((x) => x.op === "cycle.forbid").map((c) => ({ claim: c, kinds: c.args.kinds as string[], adj: adjFor(c.args.kinds as string[]) }));
  const edgeForbids = claims.filter((x) => x.op === "edge.forbid");
  const w2Classes = new Map<string, { total: number; killed: number }>();
  const sourceKills = new Map<string, Set<number>>();
  let w2 = 0;
  let w2k = 0;
  for (const kd of kinds) {
    const targets = kd.to === "resource" ? resNodes : comps;
    const adjK = adjFor([kd.name]);
    for (const a of comps) {
      const reachA = reachable(adjK, a, () => true);
      for (const b of targets) {
        if (a === b) continue;
        if (edges.has(`${a}\u0000${kd.name}\u0000${b}`)) continue;
        const i = mutantIndex++;
        w2 += 1;
        const killers: Claim[] = [];
        for (const f of edgeForbids) {
          if (String(f.args.kind) !== kd.name) continue;
          const S = nodeSet(W, f.args.from as string[]);
          const X = nodeSet(W, f.args.exceptFrom as string[]);
          const T = nodeSet(W, f.args.to as string[]);
          const Y = nodeSet(W, f.args.exceptTo as string[]);
          if (S.has(a) && !X.has(a) && T.has(b) && !Y.has(b)) killers.push(f);
        }
        for (const p of paths) {
          if (!p.kinds.has(kd.name)) continue;
          if (p.F.has(a) && p.G.has(b)) {
            killers.push(p.claim);
            for (const [s, f] of p.perSource) if (f.has(a)) {
              const key = `${p.claim.fp}\u0000${s}`;
              const set = sourceKills.get(key) ?? new Set<number>();
              set.add(i);
              sourceKills.set(key, set);
            }
          }
        }
        for (const cy of cycles) {
          if (!cy.kinds.includes(kd.name)) continue;
          if (reachable(cy.adj, b, () => true).has(a)) killers.push(cy.claim);
        }
        const reachB = reachable(adjK, b, () => true);
        const cls = kd.to === "resource" ? "provider" : reachB.has(a) ? "back-edge" : reachA.has(b) ? "shortcut" : "new-coupling";
        const key = `${kd.name}\u0000${cls}`;
        const row = w2Classes.get(key) ?? { total: 0, killed: 0 };
        row.total += 1;
        if (killers.length > 0) {
          row.killed += 1;
          w2k += 1;
          for (const k of killers) {
            addKill(kills, k.fp, i);
            addKill(killsByOp.W2, k.fp, i);
          }
        }
        w2Classes.set(key, row);
      }
    }
  }
  operators.push({ op: "W2", mutants: w2, killed: w2k });

  // ---- P1 -------------------------------------------------------------------------------------
  const p1Verbs = o.p1Verbs ?? o.esf.effects.map((e) => e.verb).filter((v) => impl(W, v, "HardDelete"));
  let p1 = 0;
  let p1k = 0;
  const caughtRes = new Set<string>();
  const uncaughtRes = new Set<string>();
  for (const comp of [...W.compByQ.values()].filter((c) => !c.q.startsWith("std::"))) {
    if (comp.grants === null) continue;
    const pos = `${comp.q}.*`;
    for (const r of resources) {
      for (const v of p1Verbs) {
        const atom = `${v}<${r}>`;
        if (inClosure(W, comp.grants, atom)) continue;
        const i = mutantIndex++;
        p1 += 1;
        const killers = protectingForbids(W, pos, atom);
        if (killers.length > 0) {
          p1k += 1;
          caughtRes.add(r);
          for (const k of killers) {
            addKill(kills, k.fp, i);
            addKill(killsByOp.P1, k.fp, i);
          }
        } else uncaughtRes.add(r);
      }
    }
  }
  operators.push({ op: "P1", mutants: p1, killed: p1k });

  // ---- M2 (unused grants) ------------------------------------------------------------------------
  const unusedGrants: string[] = [];
  let m2 = 0;
  for (const comp of [...W.compByQ.values()].filter((c) => !c.q.startsWith("std::"))) {
    if (comp.grants === null) continue;
    const posList = W.positions.filter((p) => posComp(p) === comp.q);
    const facts = posList.flatMap((p) => [...(present.get(p) ?? [])]).filter((a) => !a.endsWith(`<${TRUST}>`));
    for (const g of comp.grants) {
      m2 += 1;
      const rest = comp.grants.filter((x) => x !== g);
      const needed = facts.some((a) => inClosure(W, [g], a) && !inClosure(W, rest, a));
      if (!needed) unusedGrants.push(`${comp.q} ${g}`);
    }
  }
  operators.push({ op: "M2", mutants: m2, killed: m2 - unusedGrants.length });

  // ---- vacuous and redundant ------------------------------------------------------------------------
  const assessed = claims.filter((c) => c.polarity === "upper");
  const notAssessed = claims.filter((c) => c.polarity === "lower").map((c) => c.ids[0] ?? c.fp).sort(cmpStr);
  const out: ClaimTeeth[] = [];
  for (const c of assessed) {
    const ks = kills.get(c.fp) ?? new Set<number>();
    const redundantWith: string[] = [];
    if (ks.size > 0) {
      for (const d of assessed) {
        if (d.fp === c.fp) continue;
        const kd = kills.get(d.fp);
        if (!kd || kd.size < ks.size) continue;
        // equal sets: only the later fp is reported redundant, so one of a tied pair survives
        if (kd.size === ks.size && cmpStr(d.fp, c.fp) > 0) continue;
        if (isSubset(ks, kd)) redundantWith.push(d.ids[0] ?? d.fp);
      }
    }
    out.push({
      fp: c.fp,
      id: c.ids[0] ?? c.fp,
      op: c.op,
      tier: c.tier,
      kills: { W1: killsByOp.W1.get(c.fp)?.size ?? 0, W2: killsByOp.W2.get(c.fp)?.size ?? 0, P1: killsByOp.P1.get(c.fp)?.size ?? 0 },
      vacuous: ks.size === 0,
      redundantWith: redundantWith.sort(cmpStr)
    });
  }
  out.sort((a, b) => cmpStr(a.id, b.id));
  const sources: TeethReport["sources"] = [];
  for (const p of paths) {
    if (p.perSource.size < 2) continue;
    const id = p.claim.ids[0] ?? p.claim.fp;
    for (const s of [...p.perSource.keys()].sort(cmpStr)) {
      const ks = sourceKills.get(`${p.claim.fp}\u0000${s}`) ?? new Set<number>();
      const red: string[] = [];
      for (const t of p.perSource.keys()) {
        if (t === s) continue;
        const kt = sourceKills.get(`${p.claim.fp}\u0000${t}`) ?? new Set<number>();
        if (kt.size < ks.size || (kt.size === ks.size && cmpStr(t, s) > 0)) continue;
        if (isSubset(ks, kt)) red.push(t);
      }
      sources.push({ claim: id, source: s, kills: ks.size, redundantWith: red.sort(cmpStr) });
    }
  }
  // ---- laws ------------------------------------------------------------------------------------------
  const laws: TeethReport["laws"] = [];
  for (const c of claims.filter((x) => x.op === "law")) {
    let best: { total: number; killed: number } | null = null;
    for (const r of o.tests ?? []) {
      if (r.shape.claim?.fp !== c.fp || r.shape.result !== "supports") continue;
      const m = (r.shape.bound as { mutants?: { total?: number; killed?: number } } | undefined)?.mutants;
      if (m && Number.isSafeInteger(m.total) && Number.isSafeInteger(m.killed)) {
        const cand = { total: m.total as number, killed: m.killed as number };
        if (!best || cand.total > best.total) best = cand;
      }
    }
    const verdict = !best || best.total === 0 ? "unassessed" : best.killed === 0 ? "vacuous" : 2 * best.killed < best.total ? "weak" : "teeth";
    laws.push({ fp: c.fp, id: c.ids[0] ?? c.fp, mutants: best, verdict });
  }
  laws.sort((a, b) => cmpStr(a.id, b.id));
  void byFp;
  void covers;
  return {
    v: "shape.teeth.v1",
    basis: "closed form over W_decl plus usable observed facts and manifest hatch facts; additions only (W1, W2, P1) and grant removal (M2); lower bounds not assessed",
    operators,
    claims: out,
    vacuous: out.filter((c) => c.vacuous).map((c) => c.id),
    redundant: out.filter((c) => c.redundantWith.length > 0).map((c) => c.id),
    sources,
    unusedGrants: unusedGrants.sort(cmpStr),
    gaps: {
      W1: Object.fromEntries(Object.entries(w1Gap).sort((a, b) => cmpStr(a[0], b[0]))),
      W2: [...w2Classes.entries()]
        .map(([k, v]) => {
          const [kind, cls] = k.split("\u0000") as [string, string];
          return { kind, class: cls, total: v.total, killed: v.killed };
        })
        .sort((a, b) => cmpStr(a.kind, b.kind) || cmpStr(a.class, b.class)),
      P1: { resources: resources.length, uncaught: sortedUniq([...uncaughtRes]), caught: sortedUniq([...caughtRes].filter((r) => !uncaughtRes.has(r))) }
    },
    laws,
    notAssessed
  };
}
