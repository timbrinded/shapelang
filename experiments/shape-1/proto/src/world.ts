// A shape resolved over the head manifest (version 7): unit bindings, attribution att_S with except
// globs, resource mapping, lifting, and the permitted set P(u) = (A(u) ∩ S(u)) ∖ Prot(u) with
// protection levels Lvl(u) (A.3.3, A.4.4.7, A.6.4.3-4, A.16.21, A.16.34).
import { globMatches, specificity } from "./globs.ts";
import { type IdentityInfo, type ManifestIndex, ancestorsOrSelf } from "./manifest.ts";
import {
  type Claim,
  type ComponentItem,
  type ESF,
  type ShapeError,
  TRUST,
  type UnitItem,
  parseAtom
} from "./model.ts";
import { canonResourceCode, tagKind } from "./resource-code.ts";
import { type Tier, cmpStr, maxTier, sortedUniq, tierRank } from "./util.ts";

export const UNGOVERNED = "ungoverned";
export const UNDECLARED = `Undeclared<${TRUST}>`;

export interface World {
  side: "b" | "h";
  esf: ESF;
  man: ManifestIndex;
  upOf: Map<string, Set<string>>;
  downOf: Map<string, Set<string>>;
  /** hatch kind → languages it is declared for */
  hatchLangs: Map<string, Set<string>>;
  /** unit → bound identities (head: at most one; base: rename in place may give several) */
  unitBinds: Map<string, string[]>;
  /** identity → units binding it (head: one, else E-overlap) */
  identityUnits: Map<string, string[]>;
  compByQ: Map<string, ComponentItem>;
  unitByQ: Map<string, UnitItem>;
  resOfCode: Map<string, string>;
  boundKinds: Set<string>;
  positions: string[];
  /** the position of x (base ties: the codepoint-least of the tied positions) */
  att: (x: string) => string;
  /** every position x is attributed to (base ties and overlaps: all of them, A.6.4.4) */
  attAll: (x: string) => string[];
  codeOfPos: Map<string, string[]>;
  forbids: Claim[];
  authority: Map<string, Claim>;
  summary: Map<string, Claim>;
  nodes: string[];
  globOwners: { glob: string; owner: string; except: string[] }[];
  errors: ShapeError[];
}

export function posComp(pos: string): string | null {
  if (pos === UNGOVERNED || pos.startsWith("cell:")) return null;
  if (pos.endsWith(".*")) return pos.slice(0, -2);
  const i = pos.lastIndexOf(".");
  return i > 0 ? pos.slice(0, i) : null;
}

function closureMaps(esf: ESF): { up: Map<string, Set<string>>; down: Map<string, Set<string>> } {
  const implies = new Map<string, string[]>();
  for (const e of esf.effects) implies.set(e.verb, e.implies);
  const up = new Map<string, Set<string>>();
  for (const v of implies.keys()) {
    const seen = new Set<string>();
    const stack = [v];
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const i of implies.get(x) ?? []) stack.push(i);
    }
    up.set(v, seen);
  }
  const down = new Map<string, Set<string>>();
  for (const v of implies.keys()) down.set(v, new Set());
  for (const [v, s] of up) for (const w of s) down.get(w)?.add(v);
  return { up, down };
}

export function lastSegment(info: IdentityInfo): string | null {
  if (!info.symbol) return null;
  const sep = info.lang === "rust" || info.lang === "verus" ? "::" : ".";
  const seg = info.symbol.split(sep).pop() ?? "";
  return seg.replace(/%2E/g, ".").replace(/%23/g, "#").replace(/%25/g, "%");
}

/** ⟦paths(K)⟧: K's globs minus its except globs (A.3.3.3 [D25]). */
export function inRegion(c: ComponentItem, path: string): boolean {
  return (
    c.paths.some((g) => globMatches(g, path)) && !c.exceptPaths.some((g) => globMatches(g, path))
  );
}

export interface WorldOptions {
  side: "b" | "h";
  /** base manifest, used to resolve base bindings over the head manifest (A.6.4.3) */
  baseMan?: ManifestIndex | null;
}

export function buildWorld(esf: ESF, man: ManifestIndex, opts: WorldOptions): World {
  const errors: ShapeError[] = [];
  const err = (code: string, subject: string, message: string): void => {
    if (opts.side === "h") errors.push({ code, subject, message, causes: [], dischargers: [] });
  };
  const { up, down } = closureMaps(esf);
  const hatchLangs = new Map<string, Set<string>>();
  for (const h of esf.hatches) {
    const s = hatchLangs.get(h.kind) ?? new Set<string>();
    s.add(h.lang);
    hatchLangs.set(h.kind, s);
  }
  const compByQ = new Map(esf.components.map((c) => [c.q, c]));
  const unitByQ = new Map(esf.units.map((u) => [u.q, u]));
  const ids = [...man.ids.keys()].sort(cmpStr);

  const inPaths = (c: ComponentItem, info: IdentityInfo): boolean =>
    c.paths.length === 0 || inRegion(c, info.path);
  const byName = (u: UnitItem, m: ManifestIndex): string[] => {
    const c = compByQ.get(u.component);
    if (!c) return [];
    const out: string[] = [];
    for (const info of m.ids.values())
      if (lastSegment(info) === u.name && inPaths(c, info)) out.push(info.id);
    return out.sort(cmpStr);
  };

  // ---- unit bindings over M_h ---------------------------------------------------------------
  const unitBinds = new Map<string, string[]>();
  for (const u of esf.units) {
    let bound: string[] = [];
    if (opts.side === "h") {
      if (u.bind) {
        if (man.ids.has(u.bind)) bound = [u.bind];
        else err("E-unbound", `unit ${u.q}`, `${u.bind} is not in the head manifest`);
      } else {
        const cands = byName(u, man);
        if (cands.length === 1) bound = [cands[0] as string];
        else if (cands.length === 0)
          err(
            "E-unbound",
            `unit ${u.q}`,
            `no identity named ${u.name} within ${u.component}'s paths`
          );
        else
          err(
            "E-ambiguous",
            `unit ${u.q}`,
            `${cands.length} identities named ${u.name}: ${cands.join(", ")}`
          );
      }
    } else {
      // base (A.6.4.3, A.16.21): default names take the unique M_h match; else x_b if present;
      // else every new identity in x_b's file (rename in place); else ∅; relocation not followed
      let xb: string | null = u.bind;
      if (!u.bind) {
        const cands = byName(u, man);
        if (cands.length === 1) bound = [cands[0] as string];
        else if (opts.baseMan) {
          const bc = byName(u, opts.baseMan);
          xb = bc.length === 1 ? (bc[0] as string) : null;
        } else xb = null;
      }
      if (bound.length === 0 && xb) {
        if (man.ids.has(xb)) bound = [xb];
        else if (opts.baseMan) {
          const file = xb.split("#")[0] as string;
          bound = ids.filter((x) => x.startsWith(`${file}#`) && !opts.baseMan?.ids.has(x));
        }
      }
    }
    unitBinds.set(u.q, bound);
  }
  const identityUnits = new Map<string, string[]>();
  for (const [u, xs] of [...unitBinds.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    for (const x of xs) {
      const prev = identityUnits.get(x) ?? [];
      if (prev.length > 0 && opts.side === "h") {
        err(
          "E-overlap",
          [`unit ${prev[0]}`, `unit ${u}`].sort(cmpStr).join(" "),
          `${x} is bound by ${prev[0]} and ${u}`
        );
        continue;
      }
      identityUnits.set(x, [...prev, u].sort(cmpStr));
    }
  }

  // ---- attribution ---------------------------------------------------------------------------
  const globOwners: { glob: string; owner: string; except: string[] }[] = [];
  for (const c of esf.components)
    for (const g of c.paths) globOwners.push({ glob: g, owner: `${c.q}.*`, except: c.exceptPaths });
  const attCache = new Map<string, string[]>();
  const overlapSeen = new Set<string>();
  const attAll = (x: string): string[] => {
    const hit = attCache.get(x);
    if (hit) return hit;
    let res: string[] = [UNGOVERNED];
    const anc = man.ids.has(x) ? ancestorsOrSelf(man, x) : [x];
    const bound = anc.find((a) => identityUnits.has(a));
    if (bound) res = identityUnits.get(bound) as string[];
    else {
      const path = man.ids.get(x)?.path ?? x.replace(/^[^:]*:/, "").split("#")[0] ?? "";
      let best = -1;
      let who: string[] = [];
      for (const o of globOwners) {
        if (!globMatches(o.glob, path) || o.except.some((g) => globMatches(g, path))) continue;
        const s = specificity(o.glob);
        if (s > best) {
          best = s;
          who = [o.owner];
        } else if (s === best && !who.includes(o.owner)) who.push(o.owner);
      }
      who.sort(cmpStr);
      if (who.length > 1 && opts.side === "h") {
        const k = who.join("|");
        if (!overlapSeen.has(k)) {
          overlapSeen.add(k);
          err(
            "E-overlap",
            who.map((w) => `component ${posComp(w)}`).join(" "),
            `equally specific globs of ${who.map((w) => posComp(w)).join(" and ")} match ${path}`
          );
        }
        who = [who[0] as string];
      }
      if (who.length > 0) res = who;
    }
    attCache.set(x, res);
    return res;
  };
  const att = (x: string): string => attAll(x)[0] as string;
  const positions = sortedUniq([
    ...esf.units.map((u) => u.q),
    ...esf.components.map((c) => `${c.q}.*`),
    UNGOVERNED
  ]);
  const codeOfPos = new Map<string, string[]>();
  for (const p of positions) codeOfPos.set(p, []);
  for (const x of ids) {
    for (const p of attAll(x)) {
      const list = codeOfPos.get(p);
      if (list) list.push(x);
      else codeOfPos.set(p, [x]);
    }
  }

  // ---- resources ----------------------------------------------------------------------------------
  const resOfCode = new Map<string, string>();
  const boundKinds = new Set<string>();
  for (const r of esf.resources) {
    for (const b of r.bind) {
      resOfCode.set(b, r.q);
      boundKinds.add(tagKind(b));
    }
  }

  const forbids = esf.claims.filter((c) => c.op === "effect.forbid");
  const authority = new Map<string, Claim>();
  for (const c of esf.claims) if (c.op === "authority") authority.set(String(c.args.component), c);
  const summary = new Map<string, Claim>();
  for (const c of esf.claims) if (c.op === "effects.upper") summary.set(String(c.args.unit), c);
  const nodes = sortedUniq([
    ...esf.components.filter((c) => !c.q.startsWith("std::")).map((c) => c.q),
    ...esf.resources.filter((r) => !r.q.startsWith("std::")).map((r) => r.q)
  ]);
  return {
    side: opts.side,
    esf,
    man,
    upOf: up,
    downOf: down,
    hatchLangs,
    unitBinds,
    identityUnits,
    compByQ,
    unitByQ,
    resOfCode,
    boundKinds,
    positions,
    att,
    attAll,
    codeOfPos,
    forbids,
    authority,
    summary,
    nodes,
    globOwners,
    errors
  };
}

/** The unit's single bound identity (head), or null. */
export function bindOf(w: World, u: string): string | null {
  return w.unitBinds.get(u)?.[0] ?? null;
}

// ---- lifting and permitted sets ---------------------------------------------------------------

export function liftEffect(
  w: World,
  verb: string,
  resource: string
): { atom: string; resource: string } | null {
  const rc = canonResourceCode(resource) ?? resource;
  const r = w.resOfCode.get(rc);
  if (!r) return null;
  return { atom: `${verb}<${r}>`, resource: r };
}

/** A manifest marker of kind h at an identity of language L lifts to h<Trust> when the shape
 *  declares h for L, else to Undeclared<Trust> (A.3.4.5, A.16.9(a)). */
export function liftHatch(w: World, kind: string, lang: string): string {
  return w.hatchLangs.get(kind)?.has(lang) ? `${kind}<${TRUST}>` : UNDECLARED;
}

export function verbDeclared(w: World, verb: string): boolean {
  return w.upOf.has(verb);
}

/** a ⇒* b, reflexive; undeclared verbs are isolated (A.3.4.5) */
export function impl(w: World, a: string, b: string): boolean {
  if (a === b) return true;
  return w.upOf.get(a)?.has(b) ?? false;
}

export function inUnitSel(sel: string, pos: string): boolean {
  if (sel === "*") return true;
  if (sel === UNGOVERNED) return pos === UNGOVERNED;
  if (sel.startsWith("component ")) return posComp(pos) === sel.slice(10);
  if (sel.startsWith("unit ")) return pos === sel.slice(5);
  return false;
}

export function covers(f: Claim, pos: string): boolean {
  const scope = f.args.scope as string[];
  const except = f.args.except as string[];
  return scope.some((s) => inUnitSel(s, pos)) && !except.some((s) => inUnitSel(s, pos));
}

/** atom ∈ cl(C): implied by some atom of C on the same resource */
export function inClosure(w: World, atoms: string[], atom: string): boolean {
  const a = parseAtom(atom);
  if (!a) return false;
  return atoms.some((c) => {
    const p = parseAtom(c);
    return !!p && p.resource === a.resource && impl(w, p.verb, a.verb);
  });
}

/** b ∈ A(u): cl(G(comp(u))) ∪ TrustAtoms under declared grants, else every atom. */
export function inA(w: World, pos: string, atom: string): boolean {
  const comp = posComp(pos);
  if (!comp) return true;
  const c = w.compByQ.get(comp);
  if (!c || c.grants === null) return true;
  const a = parseAtom(atom);
  if (!a) return false;
  if (a.resource === TRUST) return true;
  return inClosure(w, c.grants, atom);
}

/** b ∈ S(u): cl(C) ∪ TrustAtoms under a complete summary, else every atom (A.16.34). */
export function inS(w: World, pos: string, atom: string): boolean {
  const s = w.summary.get(pos);
  if (!s) return true;
  const a = parseAtom(atom);
  if (!a) return false;
  if (a.resource === TRUST) return true;
  return inClosure(w, s.args.atoms as string[], atom);
}

export function protectingForbids(w: World, pos: string, atom: string): Claim[] {
  const a = parseAtom(atom);
  if (!a) return [];
  return w.forbids.filter((f) => {
    const fa = parseAtom(String(f.args.atom));
    return !!fa && fa.resource === a.resource && impl(w, a.verb, fa.verb) && covers(f, pos);
  });
}

/** Excluding claims of b ∉ P(u), in A.4.4.7's kinds: forbids, the summary, authority. */
export function excludingClaims(w: World, pos: string, atom: string): Claim[] {
  const out = [...protectingForbids(w, pos, atom)];
  if (!inS(w, pos, atom)) {
    const s = w.summary.get(pos);
    if (s) out.push(s);
  }
  if (!inA(w, pos, atom)) {
    const comp = posComp(pos);
    const auth = comp ? w.authority.get(comp) : undefined;
    if (auth) out.push(auth);
  }
  return out;
}

export function permitted(w: World, pos: string, atom: string): boolean {
  return inA(w, pos, atom) && inS(w, pos, atom) && protectingForbids(w, pos, atom).length === 0;
}

/** Lvl(u)(a): the highest tier among the claims excluding a at u, ⊥ (null) if none. */
export function lvl(
  w: World,
  pos: string,
  atom: string,
  tierOf: (c: Claim) => Tier = (c) => c.tier
): Tier | null {
  const cs = excludingClaims(w, pos, atom);
  if (cs.length === 0) return null;
  return maxTier(...cs.map(tierOf));
}

export function compCode(w: World, comp: string): string[] {
  const out: string[] = [];
  for (const [p, xs] of w.codeOfPos) if (posComp(p) === comp) out.push(...xs);
  return sortedUniq(out);
}

export function unitCode(w: World, unit: string): string[] {
  return [...(w.codeOfPos.get(unit) ?? [])];
}

export function nodeSet(w: World, sels: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of sels) {
    if (s === "*") for (const n of w.nodes) out.add(n);
    else if (s.startsWith("component ")) out.add(s.slice(10));
    else if (s.startsWith("resource ")) out.add(s.slice(9));
  }
  return out;
}

export function tierOfPos(w: World, pos: string): Tier {
  const comp = posComp(pos);
  if (!comp) return "normal";
  const u = w.unitByQ.get(pos);
  if (u) return u.tier;
  return w.compByQ.get(comp)?.tier ?? "normal";
}

export function higherTier(a: Tier, b: Tier): boolean {
  return tierRank(a) > tierRank(b);
}
