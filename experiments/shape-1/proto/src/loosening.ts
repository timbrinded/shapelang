// The loosening decider (version 7, A.8): L0, L1 over identities and cells (levels, authority+,
// authority level [D11, D17]), L3 structure (heirs, G_A, the W_eval first pass, then the budgeted
// search; DRT T18), L4 laws (T16), L6 jurisdiction tuples (A.16.29(a)), L7 governance orders
// (A.8.2.3, A.16.29(b), inherited fields once [D18]); subject tiers and answerers (A.8.2.2; DRT
// T3, T6). One pass is parameterised by its two shapes, so the reverse pass of the order class
// (A.8.1.3 [D17], A.16.11) runs the same code with base and head exchanged.
import { type Edge, chanOfAtom, footprint, prod } from "./checker.ts";
import { lawDecidedBy } from "./elaborate.ts";
import type { WFact } from "./evidence.ts";
import { type CellSide, type GlobOwner, cellId, computeCells } from "./globs.ts";
import { jcs } from "./jcs.ts";
import type { ManifestIndex } from "./manifest.ts";
import {
  type Claim,
  type ESF,
  type JsonValue,
  type Requirement,
  TRUST,
  type TemplateItem,
  parseAtom
} from "./model.ts";
import { opOrderGeq, renameArgs, renamedFp } from "./strength.ts";
import { type Tier, cmpStr, cmpTuple, levelRank, maxTier, sortedUniq, tierRank } from "./util.ts";
import {
  UNGOVERNED,
  type World,
  compCode,
  covers,
  impl,
  liftHatch,
  nodeSet,
  posComp
} from "./world.ts";

export type Question = "L0" | "L1" | "L3" | "L4" | "L6" | "L7";
export const QUESTION_ORDER: Question[] = ["L0", "L1", "L3", "L4", "L6", "L7"];

export interface LoosePart {
  question: Question;
  subject: string;
  answer: "loosened" | "undecided";
  affected: string[];
  delta: string[];
  counterexample: JsonValue;
  /** the question's channels (A.8.3.2); [] when it has none */
  channels: string[];
  /** realising facts (fact ids): a fact or W_eval path that realises a failure (A.8.3.1) */
  realisedBy: string[];
  /** the counterexample is realised in W_eval(head) */
  realised: boolean;
  /** undecided only because base items are unmapped by ρ rules 0–2 (A.8.1.6): add-was */
  unmapped: boolean;
  /** set by derive (A.8.3.1, A.16.10) */
  exploited: boolean;
}

export const L3_BUDGET = 1_000_000;

export interface PassEnv {
  /** the pass's base and head shapes (exchanged in the reverse pass) */
  base: ESF;
  head: ESF;
  /** both shapes resolved over one manifest (A.8.1.5) */
  Wb: World;
  Wh: World;
  M: ManifestIndex;
  /** base Q → head Q by ρ rules 0–2; rule-3 hints; base items rules 0–2 leave unmapped */
  rho: Map<string, string>;
  hints: Map<string, string>;
  unmapped: Set<string>;
  /** base fp → head heir fps (ρ only) */
  heirs: Map<string, string[]>;
  templates: Map<string, TemplateItem>;
  claimImplies: Map<string, Set<string>>;
  closureEqual: (ref: string) => boolean;
  /** an empty base: owners, policy and manifest identity are not compared (A.16.17) */
  emptyBase: boolean;
  /** W_eval(head) facts and lifted edges, and W_decl(head)'s lifted edges */
  facts: WFact[];
  evalEdges: Edge[];
  declEdges: Edge[];
  /** Req identities of a (renamed) base law over the pass's head (L4 affected, T16) */
  reqIds: (c: Claim) => string[];
}

export interface PassResult {
  parts: LoosePart[];
  cells: { id: string; b: CellSide; h: CellSide; example: string }[];
  /** base structural claims implied through H_A: base fp → head claims rejecting candidates */
  hA: Map<string, string[]>;
  cellsUndecided: boolean;
}

function newPart(question: Question, subject: string): LoosePart {
  return {
    question,
    subject,
    answer: "loosened",
    affected: [],
    delta: [],
    counterexample: null,
    channels: [],
    realisedBy: [],
    realised: false,
    unmapped: false,
    exploited: false
  };
}

function pushU(xs: string[], x: string): void {
  if (!xs.includes(x)) xs.push(x);
}

function rankOrNone(t: Tier | null): number {
  return t === null ? -1 : tierRank(t);
}

// ---- the pass ---------------------------------------------------------------------------------

export function runPass(env: PassEnv): PassResult {
  const parts: LoosePart[] = [];
  // cells (A.8.1.4): base and head globs with their except globs
  const owners: GlobOwner[] = [
    ...env.Wb.globOwners.map((o) => ({
      side: "b" as const,
      glob: o.glob,
      owner: o.owner,
      except: o.except
    })),
    ...env.Wh.globOwners.map((o) => ({
      side: "h" as const,
      glob: o.glob,
      owner: o.owner,
      except: o.except
    }))
  ].sort((a, b) => cmpStr(`${a.side}:${a.glob}`, `${b.side}:${b.glob}`));
  const cr = computeCells(owners);
  const cells = cr.cells.map((c) => ({ id: cellId(c.b, c.h), b: c.b, h: c.h, example: c.example }));
  parts.push(...l1(env, cells));
  const hA = new Map<string, string[]>();
  for (const cb of env.base.claims) {
    if ((env.heirs.get(cb.fp) ?? []).length > 0) continue;
    if (cb.op === "edge.forbid" || cb.op === "path.forbid" || cb.op === "cycle.forbid") {
      const p = l3(env, cb, hA);
      if (p) parts.push(p);
    } else if (cb.op === "law") parts.push(l4(env, cb));
  }
  parts.push(...l6(env, cells));
  parts.push(...l7(env, hA));
  for (const p of parts) {
    p.affected = sortedUniq(p.affected);
    p.delta = sortedUniq(p.delta);
    p.channels = sortedUniq(p.channels);
    p.realisedBy = sortedUniq(p.realisedBy);
  }
  return {
    parts: parts.sort((a, b) => cmpTuple([a.subject, a.question], [b.subject, b.question])),
    cells,
    hA,
    cellsUndecided: cr.undecided
  };
}

/** The answer of a pass: loosened if any part is, else undecided if any is, else implied. */
export function passAnswer(parts: LoosePart[]): "loosened" | "undecided" | "implied" {
  if (parts.some((p) => p.answer === "loosened")) return "loosened";
  if (parts.length > 0) return "undecided";
  return "implied";
}

/** The order class from the forward and reverse passes (A.8.1.3, A.16.11(a)). */
export function orderClass(
  forward: LoosePart[],
  reverse: LoosePart[]
): "looser" | "tighter" | "equivalent" | "incomparable" | "undecided" {
  const f = passAnswer(forward);
  const r = passAnswer(reverse) === "loosened";
  if (f === "undecided") return "undecided";
  if (f === "loosened") return r ? "incomparable" : "looser";
  return r ? "tighter" : "equivalent";
}

// ---- L1 NoNewEffect -----------------------------------------------------------------------------

interface Token {
  /** canonical resource code, "res:Q" or "trust" */
  key: string;
  resB: string | null;
  resH: string | null;
  trust: boolean;
  /** res:Q of a base resource unmapped by ρ rules 0–2, with its rule-3 hint (or null) */
  unmappedHint?: string | null;
}

interface L1Entry {
  x: string;
  verb: string;
  token: string;
  atomH: string;
  admitted: boolean;
}

function verbUniverse(Wb: World, Wh: World, trust: boolean): string[] {
  const all = new Set<string>([...Wb.upOf.keys(), ...Wh.upOf.keys()]);
  const hatchy = (v: string): boolean => impl(Wb, v, "Hatch") || impl(Wh, v, "Hatch");
  return [...all].filter((v) => (trust ? hatchy(v) : !hatchy(v))).sort(cmpStr);
}

function l1(env: PassEnv, cells: { id: string; b: CellSide; h: CellSide }[]): LoosePart[] {
  const { Wb, Wh } = env;
  const rhoInv = new Map<string, string>();
  for (const [b, h] of env.rho) rhoInv.set(h, b);
  const userRes = (e: ESF): ESF["resources"] => e.resources.filter((r) => r.q !== TRUST);
  const codes = sortedUniq([
    ...userRes(env.base).flatMap((r) => r.bind),
    ...userRes(env.head).flatMap((r) => r.bind)
  ]);
  const tokens: Token[] = codes.map((t) => ({
    key: t,
    resB: Wb.resOfCode.get(t) ?? null,
    resH: Wh.resOfCode.get(t) ?? null,
    trust: false
  }));
  const headRes = new Set(env.head.resources.map((r) => r.q));
  const unboundB = userRes(env.base).filter((r) => r.bind.length === 0);
  const seenRes = new Set<string>();
  for (const r of unboundB) {
    const h = env.rho.get(r.q) ?? null;
    seenRes.add(`res:${r.q}`);
    tokens.push({
      key: `res:${r.q}`,
      resB: r.q,
      resH: h && headRes.has(h) ? h : null,
      trust: false,
      unmappedHint: env.unmapped.has(r.q)
        ? env.hints.get(r.q) && headRes.has(env.hints.get(r.q) as string)
          ? (env.hints.get(r.q) as string)
          : null
        : undefined
    });
  }
  for (const r of userRes(env.head).filter((x) => x.bind.length === 0)) {
    const b = rhoInv.get(r.q) ?? r.q;
    if (seenRes.has(`res:${b}`)) continue;
    seenRes.add(`res:${b}`);
    const baseHas = env.base.resources.some((x) => x.q === b);
    tokens.push({ key: `res:${b}`, resB: baseHas ? b : null, resH: r.q, trust: false });
  }
  tokens.push({ key: "trust", resB: TRUST, resH: TRUST, trust: true });
  const verbsOrd = verbUniverse(Wb, Wh, false);
  const verbsTrust = verbUniverse(Wb, Wh, true);

  // positions grouped by (base positions, head position)
  interface Group {
    pbs: string[];
    ph: string;
    xs: string[];
  }
  const groups = new Map<string, Group>();
  const addPos = (x: string, pbs: string[], ph: string): void => {
    const k = `${pbs.join("|")}\u0000${ph}`;
    const g = groups.get(k) ?? { pbs, ph, xs: [] };
    g.xs.push(x);
    groups.set(k, g);
  };
  for (const x of [...env.M.ids.keys()].sort(cmpStr)) addPos(x, Wb.attAll(x), Wh.att(x));
  for (const c of cells)
    addPos(
      c.id,
      Array.isArray(c.b) ? c.b : [c.b],
      Array.isArray(c.h) ? (c.h[0] as string) : (c.h as string)
    );

  // per (world, position) profiles of A, S and Prot (A.4.4.7), so each atom is O(1); the same
  // semantics as world.ts (inA, inS, excludingClaims, permitted)
  interface Profile {
    open: boolean;
    grants: Map<string, Set<string>>;
    auth: Claim | undefined;
    summary: Claim | undefined;
    sum: Map<string, Set<string>>;
    forbids: { c: Claim; res: string; verbs: Set<string> }[];
  }
  const upOf = (w: World, v: string): Set<string> => w.upOf.get(v) ?? new Set([v]);
  const downOf = (w: World, v: string): Set<string> => w.downOf.get(v) ?? new Set([v]);
  const closure = (w: World, atoms: string[]): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const a0 of atoms) {
      const a = parseAtom(a0.replace(/ via .+$/, ""));
      if (!a) continue;
      const set = m.get(a.resource) ?? new Set<string>();
      for (const v of upOf(w, a.verb)) set.add(v);
      m.set(a.resource, set);
    }
    return m;
  };
  const profiles = new Map<string, Profile>();
  const profile = (w: World, side: string, pos: string): Profile => {
    const k = `${side}\u0000${pos}`;
    let pr = profiles.get(k);
    if (pr) return pr;
    const comp = posComp(pos);
    const c = comp ? w.compByQ.get(comp) : undefined;
    const summary = w.summary.get(pos);
    pr = {
      open: !c || c.grants === null,
      grants: closure(w, c?.grants ?? []),
      auth: comp ? w.authority.get(comp) : undefined,
      summary,
      sum: closure(w, summary ? (summary.args.atoms as string[]) : []),
      forbids: w.forbids
        .filter((f) => covers(f, pos))
        .flatMap((f) => {
          const a = parseAtom(String(f.args.atom));
          return a ? [{ c: f, res: a.resource, verbs: downOf(w, a.verb) }] : [];
        })
    };
    profiles.set(k, pr);
    return pr;
  };
  const NONE = { perm: true, inA: true, excl: [] as Claim[], lvl: null as Tier | null };
  const view = (w: World, side: string, pos: string, verb: string, res: string | null) => {
    if (res === null) return NONE;
    const pr = profile(w, side, pos);
    const trust = res === TRUST;
    const a = pr.open || trust || !!pr.grants.get(res)?.has(verb);
    const sIn = !pr.summary || trust || !!pr.sum.get(res)?.has(verb);
    const excl: Claim[] = [];
    for (const f of pr.forbids) if (f.res === res && f.verbs.has(verb)) excl.push(f.c);
    const blocked = excl.length > 0;
    if (!sIn && pr.summary) excl.push(pr.summary);
    if (!a && pr.auth) excl.push(pr.auth);
    return {
      perm: a && sIn && !blocked,
      inA: a,
      excl,
      lvl: excl.length === 0 ? null : maxTier(...excl.map((c) => c.tier))
    };
  };

  const main = new Map<string, LoosePart>();
  const plain = new Map<string, LoosePart>();
  // per part: affected and delta sets, and the (group, atom) entries for counterexamples
  interface Acc {
    affected: Set<string>;
    delta: Set<string>;
    channels: Set<string>;
    entries: { xs: string[]; e: Omit<L1Entry, "x"> }[];
  }
  const acc = new Map<LoosePart, Acc>();
  const add = (
    sink: Map<string, LoosePart>,
    subject: string,
    xs: string[],
    delta: string,
    e: Omit<L1Entry, "x">,
    chans: string[]
  ): void => {
    let p = sink.get(subject);
    if (!p) {
      p = newPart("L1", subject);
      sink.set(subject, p);
      acc.set(p, { affected: new Set(), delta: new Set(), channels: new Set(), entries: [] });
    }
    const a = acc.get(p) as Acc;
    for (const x of xs) a.affected.add(x);
    a.delta.add(delta);
    for (const c of chans) a.channels.add(c);
    const last = a.entries[a.entries.length - 1];
    if (!(last && last.xs === xs && last.e.verb === e.verb && last.e.token === e.token))
      a.entries.push({ xs, e });
  };
  const shown = (t: Token, v: string): string => (t.resB ? `${v}<${t.resB}>` : `${v}<${t.key}>`);

  const evalToken = (
    g: Group,
    t: Token,
    resH: string | null,
    sink: Map<string, LoosePart>
  ): void => {
    const verbs = t.trust ? verbsTrust : verbsOrd;
    for (const v of verbs) {
      const aH = resH ? `${v}<${resH}>` : null;
      const hv = view(Wh, "h", g.ph, v, resH);
      const atomShown = shown(t, v);
      let entry: Omit<L1Entry, "x"> | null = null;
      let chans: string[] = [];
      const mk = (): Omit<L1Entry, "x"> => {
        if (!entry) {
          entry = { verb: v, token: t.key, atomH: aH ?? atomShown, admitted: hv.perm };
          chans = t.trust
            ? aH
              ? chanOfAtom(Wh, aH)
              : []
            : t.key.startsWith("res:")
              ? []
              : [`effect(${t.key})`];
        }
        return entry;
      };
      for (const pb of g.pbs) {
        const bv = view(Wb, "b", pb, v, t.resB);
        if (bv.perm) continue;
        for (const e of bv.excl) {
          if (e.op === "authority") continue;
          if (rankOrNone(hv.lvl) < tierRank(e.tier))
            add(
              sink,
              e.fp,
              g.xs,
              `L1 level ${atomShown} ${e.tier}>${hv.lvl ?? "none"}`,
              mk(),
              chans
            );
        }
        const K = posComp(pb);
        const auth = K ? Wb.authority.get(K) : undefined;
        if (!K || !auth || !t.resB || bv.inA) continue;
        // authority+: the atom is newly in both A and P at the position, wherever the code now
        // lives (another component, open authority, ungoverned); an atom gained in A that a
        // forbid still blocks is no part [D17]
        if (hv.inA && hv.perm)
          add(sink, `component ${K}`, g.xs, `L1 authority+ ${atomShown}`, mk(), chans);
        // authority tier fall, an independent condition (A.16.39): tier_h is the head authority
        // tier of the atom, that of the head authority excluding it, none for open authority,
        // ungoverned code or an unmapped resource; an atom a head grant admits has no entry
        let authH: Tier | null | undefined;
        if (!resH) authH = null;
        else if (!hv.inA) authH = profile(Wh, "h", g.ph).auth?.tier ?? null;
        else if (profile(Wh, "h", g.ph).open) authH = null;
        else authH = undefined;
        if (
          authH !== undefined &&
          rankOrNone(hv.lvl) < tierRank(auth.tier) &&
          rankOrNone(authH) < tierRank(auth.tier)
        )
          add(
            sink,
            `component ${K}`,
            g.xs,
            `L1 authority ${auth.tier}>${authH ?? "none"}`,
            mk(),
            chans
          );
      }
    }
  };
  const sorted = [...groups.values()].sort((a, b) =>
    cmpStr(`${a.pbs.join("|")}\u0000${a.ph}`, `${b.pbs.join("|")}\u0000${b.ph}`)
  );
  for (const g of sorted)
    for (const t of tokens) {
      if (t.unmappedHint) {
        // A.8.1.6: the rules 0–2 reading goes to the plain sink; the hint reading decides
        evalToken(g, t, t.resH, plain);
        evalToken(g, t, t.unmappedHint, main);
      } else {
        // an unmapped resource without a rule-3 hint stays unmapped under the hint reading, so
        // its failure is loosened, not undecided (A.16.45(a)); likewise every mapped token
        evalToken(g, t, t.resH, main);
      }
    }
  for (const [subject, p] of plain) {
    if (main.has(subject)) continue;
    p.answer = "undecided";
    p.unmapped = true;
    main.set(subject, p);
  }
  // realising facts and counterexamples (A.8.3.2, A.16.10(b))
  const factsAt = new Map<string, { atomH: string; f: WFact }[]>();
  for (const f of env.facts) {
    let atom: string | null = null;
    if (f.type === "effect" && f.at && f.verb && f.resource) {
      const r = Wh.resOfCode.get(f.resource);
      if (r) atom = `${f.verb}<${r}>`;
    } else if (f.type === "hatch" && f.at && f.kind) {
      atom = liftHatch(Wh, f.kind, env.M.ids.get(f.at)?.lang ?? "");
    } else if (f.declared && f.atom && f.unit && f.kind !== "call" && !f.to) atom = f.atom;
    if (!atom || !f.at) continue;
    const list = factsAt.get(f.at) ?? [];
    list.push({ atomH: atom, f });
    factsAt.set(f.at, list);
  }
  const out: LoosePart[] = [];
  for (const p of main.values()) {
    const a = acc.get(p) as Acc;
    p.affected = [...a.affected];
    p.delta = [...a.delta];
    p.channels = [...a.channels];
    const realising: { f: WFact; e: Omit<L1Entry, "x"> }[] = [];
    let adm: L1Entry | null = null;
    const realisedBy = new Set<string>();
    for (const { xs, e } of a.entries)
      for (const x of xs) {
        for (const r of factsAt.get(x) ?? [])
          if (r.atomH === e.atomH && (r.f.type !== "effect" || e.token === r.f.resource)) {
            realising.push({ f: r.f, e });
            realisedBy.add(r.f.fid);
          }
        if (e.admitted) {
          const cand: L1Entry = { ...e, x };
          if (!adm || cmpTuple([x, e.verb, e.token], [adm.x, adm.verb, adm.token]) < 0) adm = cand;
        }
      }
    p.realisedBy = [...realisedBy];
    const admittedFact = realising
      .filter((r) => r.e.admitted)
      .sort((x, y) => cmpStr(x.f.fid, y.f.fid))[0];
    if (admittedFact) {
      p.counterexample = {
        at: admittedFact.f.at as string,
        verb:
          (admittedFact.f.type === "hatch" ? admittedFact.f.kind : admittedFact.f.verb) ??
          admittedFact.e.verb,
        resource: admittedFact.e.token
      };
      p.realised = true;
    } else {
      const best = adm as L1Entry | null;
      p.counterexample = best ? { at: best.x, verb: best.verb, resource: best.token } : null;
    }
    out.push(p);
  }
  return out;
}

// ---- L3 NoWeakerClaim for structural claims ----------------------------------------------------------

interface SEdge {
  from: string;
  kind: string;
  to: string;
}

const ekey = (e: SEdge): string => `${e.from}\u0000${e.kind}\u0000${e.to}`;

function kindsOf(c: { op: string; args: Record<string, JsonValue> }): string[] {
  return c.op === "edge.forbid" ? [String(c.args.kind)] : ((c.args.kinds as string[]) ?? []);
}

/** A structural upper bound with its node sets resolved once (the search checks it often). */
interface Compiled {
  op: string;
  kind: string;
  K: Set<string>;
  S: Set<string>;
  T: Set<string>;
  V: Set<string>;
}

const compiledCache = new WeakMap<object, Map<World, Compiled>>();

function compile(c: { op: string; args: Record<string, JsonValue> }, w: World): Compiled {
  let byW = compiledCache.get(c);
  if (!byW) {
    byW = new Map();
    compiledCache.set(c, byW);
  }
  const hit = byW.get(w);
  if (hit) return hit;
  const ns = (x: JsonValue | undefined): Set<string> => nodeSet(w, (x as string[]) ?? []);
  const S = ns(c.args.from);
  const T = ns(c.args.to);
  if (c.op === "edge.forbid") {
    for (const x of ns(c.args.exceptFrom)) S.delete(x);
    for (const y of ns(c.args.exceptTo)) T.delete(y);
  }
  const out: Compiled = {
    op: c.op,
    kind: String(c.args.kind ?? ""),
    K: new Set(kindsOf(c)),
    S,
    T,
    V: ns(c.args.exceptVia)
  };
  byW.set(w, out);
  return out;
}

/** Does an edge set violate a structural upper bound under a world's node sets (A.4.2.1)? */
export function violates(
  c0: { op: string; args: Record<string, JsonValue> },
  w: World,
  edges: SEdge[]
): boolean {
  const c = compile(c0, w);
  if (c.op === "edge.forbid")
    return edges.some((e) => e.kind === c.kind && c.S.has(e.from) && c.T.has(e.to));
  const K = c.K;
  const adj = new Map<string, string[]>();
  for (const e of edges) if (K.has(e.kind)) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  if (c.op === "cycle.forbid") {
    const state = new Map<string, number>();
    const dfs = (v: string): boolean => {
      state.set(v, 1);
      for (const u of adj.get(v) ?? []) {
        const s = state.get(u);
        if (s === 1) return true;
        if (s === undefined && dfs(u)) return true;
      }
      state.set(v, 2);
      return false;
    };
    for (const v of [...adj.keys()].sort(cmpStr)) if (!state.has(v) && dfs(v)) return true;
    return false;
  }
  if (c.op === "path.forbid") {
    const { S, T, V } = c;
    for (const s of S) {
      if (V.has(s)) continue;
      const seen = new Set<string>([s]);
      const stack = [s];
      while (stack.length > 0) {
        const v = stack.pop() as string;
        for (const t of adj.get(v) ?? []) {
          if (T.has(t) && t !== s) return true;
          if (seen.has(t) || V.has(t) || S.has(t) || T.has(t)) continue;
          seen.add(t);
          stack.push(t);
        }
      }
    }
  }
  return false;
}

/** With W_decl ∪ P already satisfying c, does adding edge e to P violate it (A.8.4.2 prune)?
 *  A new violation must use e: a K-path from some s ∈ S∖V through e to some t ∈ T with interiors
 *  outside V ∪ S ∪ T, or a K-cycle through e. `fwd`/`rev` are W_decl's K-adjacency; `extra` P. */
function violatesVia(
  c: Compiled,
  fwd: Map<string, string[]>,
  rev: Map<string, string[]>,
  extra: SEdge[],
  e: SEdge
): boolean {
  if (c.op === "edge.forbid") return e.kind === c.kind && c.S.has(e.from) && c.T.has(e.to);
  if (!c.K.has(e.kind)) return false;
  const xf = new Map<string, string[]>();
  const xr = new Map<string, string[]>();
  for (const x of extra) {
    if (!c.K.has(x.kind)) continue;
    xf.set(x.from, [...(xf.get(x.from) ?? []), x.to]);
    xr.set(x.to, [...(xr.get(x.to) ?? []), x.from]);
  }
  const next = (m: Map<string, string[]>, x: Map<string, string[]>, v: string): string[] => [
    ...(m.get(v) ?? []),
    ...(x.get(v) ?? [])
  ];
  if (c.op === "cycle.forbid") {
    // a cycle through e: e.to reaches e.from
    if (e.to === e.from) return true;
    const seen = new Set<string>([e.to]);
    const stack = [e.to];
    while (stack.length > 0) {
      const v = stack.pop() as string;
      for (const u of next(fwd, xf, v)) {
        if (u === e.from) return true;
        if (!seen.has(u)) {
          seen.add(u);
          stack.push(u);
        }
      }
    }
    return false;
  }
  // path.forbid: sources reaching e.from backwards, targets reachable from e.to
  const { S, T, V } = c;
  const interior = (n: string): boolean => !V.has(n) && !S.has(n) && !T.has(n);
  const sources = new Set<string>();
  if (S.has(e.from) && !V.has(e.from)) sources.add(e.from);
  if (interior(e.from)) {
    const seen = new Set<string>([e.from]);
    const stack = [e.from];
    while (stack.length > 0) {
      const v = stack.pop() as string;
      for (const u of next(rev, xr, v)) {
        if (seen.has(u)) continue;
        seen.add(u);
        if (S.has(u) && !V.has(u)) sources.add(u);
        if (interior(u)) stack.push(u);
      }
    }
  }
  if (sources.size === 0) return false;
  const targets = new Set<string>();
  if (T.has(e.to)) targets.add(e.to);
  if (interior(e.to)) {
    const seen = new Set<string>([e.to]);
    const stack = [e.to];
    while (stack.length > 0) {
      const v = stack.pop() as string;
      for (const u of next(fwd, xf, v)) {
        if (seen.has(u)) continue;
        seen.add(u);
        if (T.has(u)) targets.add(u);
        if (interior(u)) stack.push(u);
      }
    }
  }
  for (const t of targets) for (const s0 of sources) if (s0 !== t) return true;
  return false;
}

function selectorsOf(c: Claim): string[] {
  const a = c.args;
  const keys = ["from", "to", "exceptFrom", "exceptTo", "exceptVia"];
  return keys.flatMap((k) => (Array.isArray(a[k]) ? (a[k] as string[]) : []));
}

/** Base items a claim names that ρ rules 0–2 leave unmapped (A.8.1.6, A.16.11(b)). */
function unmappedNamed(env: PassEnv, c: Claim): string[] {
  const out: string[] = [];
  const names = [
    ...selectorsOf(c),
    ...(((c.args.on as string[]) ?? []) as string[]),
    ...(c.args.scope ? (c.args.scope as string[]) : [])
  ];
  for (const s of names) {
    const m = /^(?:component|resource|unit) (.+)$/.exec(s);
    const q = m ? (m[1] as string) : null;
    if (q && env.unmapped.has(q)) out.push(q);
  }
  const st = c.args.statement as { schema?: string; args?: JsonValue } | undefined;
  if (st?.args)
    for (const v of JSON.stringify(st.args).match(/"[^"]+"/g) ?? []) {
      const q = v.slice(1, -1).replace(/^(?:component|resource|unit) /, "");
      if (env.unmapped.has(q)) out.push(q);
    }
  return sortedUniq(out);
}

function hasHeirUnder(env: PassEnv, cb: Claim, rho: Map<string, string>): boolean {
  const rfp = renamedFp(cb, rho);
  const ren = { op: cb.op, args: renameArgs(cb.args, rho) as Claim["args"] };
  const hosted = cb.op === "law" ? (cb.args.statement as { ref?: string }).ref : undefined;
  for (const ch of env.head.claims) {
    if (ch.op !== cb.op) continue;
    if (ch.fp === rfp || ch.fp === cb.fp) {
      if (hosted === undefined || env.closureEqual(hosted)) return true;
      continue;
    }
    if (cb.op !== "effect.forbid" && cb.op !== "authority" && hosted === undefined)
      if (opOrderGeq(ch, ren, env.Wh, env.templates)) return true;
    if (env.claimImplies.get(ch.fp)?.has(cb.fp) || env.claimImplies.get(ch.fp)?.has(rfp))
      return true;
  }
  return false;
}

function l3(env: PassEnv, cb: Claim, hA: Map<string, string[]>): LoosePart | null {
  const um = unmappedNamed(env, cb);
  if (um.length > 0) {
    const hinted = new Map([...env.rho, ...env.hints]);
    // a node unmapped under the hint too fails under the hint (A.16.11(b))
    const allHinted = um.every((q) => env.hints.has(q));
    let loosened = !allHinted;
    let base: LoosePart | null = null;
    if (allHinted && !hasHeirUnder(env, cb, hinted)) {
      base = l3Search(env, cb, hinted, new Map());
      loosened = !!base && base.answer === "loosened";
    }
    const p = base ?? l3Shell(env, cb, hinted);
    if (!loosened) {
      p.answer = "undecided";
      p.unmapped = true;
      p.counterexample = null;
      p.realised = false;
      p.realisedBy = [];
      p.delta = p.delta.filter((d) => !d.startsWith("L3 budget"));
    }
    return p;
  }
  return l3Search(env, cb, env.rho, hA);
}

function l3Shell(env: PassEnv, cb: Claim, rho: Map<string, string>): LoosePart {
  const ren = { op: cb.op, args: renameArgs(cb.args, rho) as Record<string, JsonValue> };
  const p = newPart("L3", cb.fp);
  const Wh = env.Wh;
  const kinds = kindsOf(ren);
  const headStruct = env.head.claims.filter(
    (c) => c.op === "edge.forbid" || c.op === "path.forbid" || c.op === "cycle.forbid"
  );
  p.delta = headStruct
    .filter((c) => kindsOf(c).some((k) => kinds.includes(k)))
    .map((c) => `L3 head ${c.fp}`);
  // affected: the code of every source node of ρc_b (A.15.10); cycles: every node
  let S: Set<string>;
  if (ren.op === "cycle.forbid") S = new Set(Wh.nodes);
  else {
    S = nodeSet(Wh, (ren.args.from as string[]) ?? []);
    if (ren.op === "edge.forbid")
      for (const x of nodeSet(Wh, (ren.args.exceptFrom as string[]) ?? [])) S.delete(x);
  }
  p.affected = sortedUniq([...S].flatMap((s) => compCode(Wh, s)));
  const T =
    ren.op === "cycle.forbid" ? new Set(Wh.nodes) : nodeSet(Wh, (ren.args.to as string[]) ?? []);
  p.channels = sortedUniq(kinds.flatMap((k) => prod(Wh, k, T)));
  return p;
}

/** Support edges of a structural claim within an edge set (A.4.4.11): edge forbids exactly;
 *  path forbids the K-edges (a,b) with a reachable from S∖V and T reachable from b through
 *  interiors outside V ∪ S ∪ T; cycle forbids the K-edges on a cycle. */
function supportOf(c: Compiled, edges: SEdge[], nodes: string[]): SEdge[] {
  if (c.op === "edge.forbid")
    return edges.filter((e) => e.kind === c.kind && c.S.has(e.from) && c.T.has(e.to));
  const kE = edges.filter((e) => c.K.has(e.kind));
  const fwdM = new Map<string, string[]>();
  const revM = new Map<string, string[]>();
  for (const e of kE) {
    fwdM.set(e.from, [...(fwdM.get(e.from) ?? []), e.to]);
    revM.set(e.to, [...(revM.get(e.to) ?? []), e.from]);
  }
  // the seeds, then every node reached from a seed that passes ok
  const reach = (
    seeds: string[],
    next: Map<string, string[]>,
    ok: (n: string) => boolean
  ): Set<string> => {
    const out = new Set(seeds);
    const stack = [...seeds];
    while (stack.length > 0) {
      const a = stack.pop() as string;
      if (!ok(a)) continue;
      for (const b of next.get(a) ?? [])
        if (!out.has(b)) {
          out.add(b);
          stack.push(b);
        }
    }
    return out;
  };
  if (c.op === "path.forbid") {
    const blocked = (n: string): boolean => c.V.has(n) || c.S.has(n) || c.T.has(n);
    const starts = nodes.filter((n) => c.S.has(n) && !c.V.has(n));
    const fwd = reach(
      starts.flatMap((n) => fwdM.get(n) ?? []),
      fwdM,
      (n) => !blocked(n)
    );
    const fwdI = new Set([...starts, ...[...fwd].filter((n) => !blocked(n))]);
    const targets = nodes.filter((n) => c.T.has(n));
    const bwd = new Set([
      ...targets,
      ...reach(
        targets.flatMap((n) => revM.get(n) ?? []),
        revM,
        (n) => !blocked(n)
      )
    ]);
    return kE.filter(
      (e) => fwdI.has(e.from) && (c.T.has(e.to) || (bwd.has(e.to) && !blocked(e.to)))
    );
  }
  if (c.op === "cycle.forbid")
    return kE.filter((e) => reach(fwdM.get(e.to) ?? [], fwdM, () => true).has(e.from));
  return [];
}

function l3Search(
  env: PassEnv,
  cb: Claim,
  rho: Map<string, string>,
  hA: Map<string, string[]>
): LoosePart | null {
  const Wh = env.Wh;
  const ren = { op: cb.op, args: renameArgs(cb.args, rho) as Record<string, JsonValue> };
  const headStruct = env.head.claims.filter(
    (c) => c.op === "edge.forbid" || c.op === "path.forbid" || c.op === "cycle.forbid"
  );
  const decl: SEdge[] = env.declEdges.map((e) => ({ from: e.from, kind: e.kind, to: e.to }));
  const declKey = new Set(decl.map(ekey));
  const evalKey = new Set([...declKey, ...env.evalEdges.map(ekey)]);
  const kinds = kindsOf(ren);
  const kindDecl = new Map(env.head.kinds.map((k) => [k.name, k]));
  const comps = Wh.nodes.filter((n) => Wh.compByQ.has(n));
  const ress = Wh.nodes.filter((n) => !Wh.compByQ.has(n));
  // head structural bounds violated by W_decl(head) ∪ extra: those W_decl alone violates, plus
  // those sharing a kind with an extra edge that the union violates (others are unaffected)
  const declViolators = headStruct.filter((c) => violates(c, Wh, decl));
  const kindsOfHead = new Map(headStruct.map((c) => [c, new Set(kindsOf(c))]));
  const rejecting = (extra: SEdge[]): Claim[] => {
    const out = [...declViolators];
    const ks = new Set(extra.map((e) => e.kind));
    for (const c of headStruct) {
      if (declViolators.includes(c)) continue;
      const ck = kindsOfHead.get(c) as Set<string>;
      if (![...ks].some((k) => ck.has(k))) continue;
      if (violates(c, Wh, [...decl, ...extra])) out.push(c);
    }
    return out;
  };
  // (1) G_A: W_decl(head) plus each new type-correct edge that alone keeps every head bound
  const GA: SEdge[] = [...decl];
  const cands: SEdge[] = [];
  const rejectedBy = new Map<string, Claim[]>();
  for (const k of [...kinds].sort(cmpStr)) {
    const kd = kindDecl.get(k);
    if (!kd) continue;
    const froms = kd.from === "component" ? comps : ress;
    const tos = kd.to === "component" ? comps : ress;
    for (const s of froms)
      for (const t of tos) {
        // E_S has calls only between distinct components (A.4.4.2), so a calls self-loop is not
        // a type-correct edge; self-loops of declared kinds are (A.8.4.2)
        if (k === "calls" && s === t) continue;
        const e = { from: s, kind: k, to: t };
        if (declKey.has(ekey(e))) continue;
        cands.push(e);
        const rej = rejecting([e]);
        if (rej.length === 0) GA.push(e);
        else rejectedBy.set(ekey(e), rej);
      }
  }
  const p = l3Shell(env, cb, rho);
  // H_A: the head structural upper bounds rejecting some candidate edge on ρc_b's support
  // (A.6.2.2), the support taken over W_decl(head) and every new type-correct edge (A.4.4.11)
  const recordHA = (): void => {
    const names = new Set<string>();
    for (const e of supportOf(compile(ren, Wh), [...decl, ...cands], Wh.nodes))
      for (const c of rejectedBy.get(ekey(e)) ?? []) names.add(c.fp);
    if (names.size > 0) hA.set(cb.fp, [...names].sort(cmpStr));
  };
  if (!violates(ren, Wh, GA)) {
    recordHA();
    return null;
  }
  const finish = (cx: SEdge[] | null, units: number, exhausted: boolean): LoosePart | null => {
    if (exhausted) {
      p.answer = "undecided";
      p.delta.push(`L3 budget ${units}`);
      return p;
    }
    if (!cx) {
      recordHA();
      return null;
    }
    p.counterexample = cx.map((e) => ({ from: e.from, kind: e.kind, to: e.to }));
    p.realised = cx.every((e) => evalKey.has(ekey(e)));
    if (p.realised)
      for (const e of cx)
        for (const ee of env.evalEdges)
          if (ekey(ee) === ekey(e)) for (const f of ee.facts) pushU(p.realisedBy, f.fid);
    return p;
  };
  const ns = (x: JsonValue | undefined): Set<string> => nodeSet(Wh, (x as string[]) ?? []);
  if (ren.op === "edge.forbid") {
    const S = ns(ren.args.from);
    for (const x of ns(ren.args.exceptFrom)) S.delete(x);
    const T = ns(ren.args.to);
    for (const y of ns(ren.args.exceptTo)) T.delete(y);
    const cands = GA.filter((e) => e.kind === ren.args.kind && S.has(e.from) && T.has(e.to)).sort(
      (a, b) => cmpTuple([a.from, a.kind, a.to], [b.from, b.kind, b.to])
    );
    const cx = cands.find((e) => evalKey.has(ekey(e))) ?? cands[0];
    return finish(cx ? [cx] : null, 0, false);
  }
  // (2) the normative search (A.8.4.2), first over W_eval(head) edges (DRT T18)
  const K = new Set(kinds);
  let units = 0;
  let exhausted = false;
  const search = (edgesAll: SEdge[]): SEdge[] | null => {
    const gaK = edgesAll
      .filter((e) => K.has(e.kind))
      .sort((a, b) => cmpTuple([a.from, a.kind, a.to], [b.from, b.kind, b.to]));
    const out = new Map<string, SEdge[]>();
    for (const e of gaK) out.set(e.from, [...(out.get(e.from) ?? []), e]);
    const isDecl = (e: SEdge): boolean => declKey.has(ekey(e));
    // the search extends prefixes that already passed, so only the new edge can break a head
    // bound: W_decl's violations reject everything, else check the claims sharing its kind
    const adjs = new Map<Claim, { fwd: Map<string, string[]>; rev: Map<string, string[]> }>();
    for (const c of headStruct) {
      const cc = compile(c, Wh);
      const f = new Map<string, string[]>();
      const r = new Map<string, string[]>();
      for (const d of decl)
        if (cc.K.has(d.kind) || (cc.op === "edge.forbid" && d.kind === cc.kind)) {
          f.set(d.from, [...(f.get(d.from) ?? []), d.to]);
          r.set(d.to, [...(r.get(d.to) ?? []), d.from]);
        }
      adjs.set(c, { fwd: f, rev: r });
    }
    const headOk = (P: SEdge[]): boolean => {
      if (declViolators.length > 0) return false;
      const e = P[P.length - 1] as SEdge;
      if (isDecl(e)) return true;
      const extra = P.filter((x) => !isDecl(x));
      for (const c of headStruct) {
        const a = adjs.get(c) as { fwd: Map<string, string[]>; rev: Map<string, string[]> };
        if (violatesVia(compile(c, Wh), a.fwd, a.rev, extra, e)) return false;
      }
      return true;
    };
    let found: SEdge[] | null = null;
    if (ren.op === "path.forbid") {
      const S = ns(ren.args.from);
      const T = ns(ren.args.to);
      const V = ns(ren.args.exceptVia);
      const dfs = (v: string, path: SEdge[], visited: Set<string>, start: string): boolean => {
        for (const e of out.get(v) ?? []) {
          units += 1;
          if (units > L3_BUDGET) {
            exhausted = true;
            return true;
          }
          if (visited.has(e.to)) continue;
          const P = [...path, e];
          if (!headOk(P)) continue;
          if (T.has(e.to) && e.to !== start) {
            found = P;
            return true;
          }
          if (V.has(e.to) || S.has(e.to) || T.has(e.to)) continue;
          visited.add(e.to);
          if (dfs(e.to, P, visited, start)) return true;
          visited.delete(e.to);
        }
        return false;
      };
      for (const s of [...S].sort(cmpStr)) {
        if (V.has(s)) continue;
        if (dfs(s, [], new Set([s]), s)) break;
      }
    } else {
      const nodes = sortedUniq(gaK.flatMap((e) => [e.from, e.to]));
      const dfs = (n: string, v: string, path: SEdge[], visited: Set<string>): boolean => {
        for (const e of out.get(v) ?? []) {
          units += 1;
          if (units > L3_BUDGET) {
            exhausted = true;
            return true;
          }
          if (cmpStr(e.to, n) < 0) continue;
          const P = [...path, e];
          if (!headOk(P)) continue;
          if (e.to === n) {
            found = P;
            return true;
          }
          if (visited.has(e.to)) continue;
          visited.add(e.to);
          if (dfs(n, e.to, P, visited)) return true;
          visited.delete(e.to);
        }
        return false;
      };
      for (const n of nodes) if (dfs(n, n, [], new Set([n]))) break;
    }
    return found;
  };
  let found = search(GA.filter((e) => evalKey.has(ekey(e))));
  if (!found && !exhausted) found = search(GA);
  return finish(found, units, exhausted);
}

// ---- L4 NoWeakerClaim for laws -----------------------------------------------------------------------

function l4(env: PassEnv, cb: Claim): LoosePart {
  const um = unmappedNamed(env, cb);
  const related = (rho: Map<string, string>): string[] => {
    const sameName = env.head.claims.filter(
      (c) => c.op === "law" && c.ids.some((id) => cb.ids.includes(id))
    );
    const pool =
      sameName.length > 0
        ? sameName
        : env.head.claims.filter(
            (c) =>
              c.op === "law" &&
              jcs(c.args.on) === jcs(renameArgs((cb.args.on as JsonValue) ?? [], rho)) &&
              c.statementForm === cb.statementForm
          );
    return sortedUniq(pool.map((c) => c.fp));
  };
  const p = newPart("L4", cb.fp);
  const rel = related(env.rho);
  const ren: Claim = { ...cb, args: renameArgs(cb.args, env.rho) as Claim["args"] };
  p.affected = sortedUniq(env.reqIds(ren));
  if (um.length > 0) {
    const hinted = new Map([...env.rho, ...env.hints]);
    const relH = related(hinted);
    const loosened = !hasHeirUnder(env, cb, hinted) && relH.length === 0;
    p.answer = loosened ? "loosened" : "undecided";
    p.unmapped = !loosened;
    p.delta = loosened ? ["L4 removed"] : relH.map((f) => `L4 head ${f}`);
    if (!loosened && p.delta.length === 0) p.delta = rel.map((f) => `L4 head ${f}`);
    return p;
  }
  if (rel.length === 0) p.delta = ["L4 removed"];
  else {
    p.answer = "undecided";
    p.delta = rel.map((f) => `L4 head ${f}`);
  }
  return p;
}

// ---- L6 NoShrunkJurisdiction ----------------------------------------------------------------------

interface Tuple {
  type: string;
  value: Record<string, JsonValue>;
  claim: Claim;
}

const STRUCT_OR_LAW = new Set(["path.forbid", "edge.forbid", "cycle.forbid", "law"]);

function lawCode(w: World, c: { args: Record<string, JsonValue> }, x: string): boolean {
  for (const t of (c.args.on as string[]) ?? []) {
    if (t.startsWith("unit ") && (w.codeOfPos.get(t.slice(5)) ?? []).includes(x)) return true;
    if (t.startsWith("component ") && posComp(w.att(x)) === t.slice(10)) return true;
    if (t.startsWith("code ")) {
      const id = t.slice(5);
      if (x === id || x.startsWith(`${id}.`) || x.startsWith(`${id}::`) || x.startsWith(`${id}#`))
        return true;
    }
  }
  return false;
}

/** Con_S(x) (A.8.2.3 L6, A.16.29(a)): node sets over the pass's head nodes. */
function conTuples(
  env: PassEnv,
  w: World,
  node: string | null,
  x: string | null,
  claims: { claim: Claim; args: Record<string, JsonValue> }[]
): Tuple[] {
  const out: Tuple[] = [];
  const ns = (v: JsonValue | undefined): string[] =>
    [...nodeSet(env.Wh, (v as string[]) ?? [])].sort(cmpStr);
  for (const { claim, args } of claims) {
    if (args.kinds === undefined && args.kind === undefined && claim.op !== "law") continue;
    if (claim.op === "path.forbid" && node) {
      const S = ns(args.from);
      const T = ns(args.to);
      const V = ns(args.exceptVia);
      const K = [...(args.kinds as string[])].sort(cmpStr);
      if (S.includes(node) && !V.includes(node))
        out.push({ type: "path-source", value: { T, K, V }, claim });
      if (T.includes(node)) out.push({ type: "path-target", value: { S, K, V }, claim });
      if (V.includes(node)) out.push({ type: "via", value: { S, T, K }, claim });
    } else if (claim.op === "edge.forbid" && node) {
      const X = ns(args.exceptFrom);
      const Y = ns(args.exceptTo);
      const S = ns(args.from).filter((n) => !X.includes(n));
      const T = ns(args.to).filter((n) => !Y.includes(n));
      const k = String(args.kind);
      if (S.includes(node)) out.push({ type: "edge-source", value: { k, T }, claim });
      if (T.includes(node)) out.push({ type: "edge-target", value: { S, k }, claim });
    } else if (claim.op === "cycle.forbid" && node) {
      out.push({
        type: "cycle-member",
        value: { K: [...(args.kinds as string[])].sort(cmpStr) },
        claim
      });
    } else if (
      claim.op === "law" &&
      // a law's on selects positions by attribution: identities through lawCode, and a cell
      // (x null) when it is attributed to K.* or a unit of K under on component K (A.16.41)
      (x
        ? lawCode(w, { args }, x)
        : node !== null && ((args.on as string[]) ?? []).includes(`component ${node}`))
    ) {
      out.push({ type: "law-member", value: { statement: args.statement ?? null }, claim });
    }
  }
  return out;
}

function sup(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const xs = (a as string[]) ?? [];
  return ((b as string[]) ?? []).every((y) => xs.includes(y));
}

function reqGeq(h: Requirement | null, b: Requirement | null): boolean {
  if (!b) return true;
  if (!h) return false;
  return (
    levelRank(h.level) >= levelRank(b.level) &&
    (!h.judged || b.judged) &&
    b.pins.every((p) => h.pins.includes(p)) &&
    (h.projection === b.projection || h.projection === "unit")
  );
}

function dominates(h: Tuple, b: Tuple): boolean {
  if (h.type !== b.type) return false;
  if (tierRank(h.claim.tier) < tierRank(b.claim.tier)) return false;
  if (!reqGeq(h.claim.requirement, b.claim.requirement)) return false;
  const hv = h.value;
  const bv = b.value;
  switch (h.type) {
    case "path-source":
      return sup(hv.T, bv.T) && sup(hv.K, bv.K) && sup(bv.V, hv.V);
    case "path-target":
      return sup(hv.S, bv.S) && sup(hv.K, bv.K) && sup(bv.V, hv.V);
    case "edge-source":
      return hv.k === bv.k && sup(hv.T, bv.T);
    case "edge-target":
      return hv.k === bv.k && sup(hv.S, bv.S);
    case "cycle-member":
      return sup(hv.K, bv.K);
    default:
      return jcs(hv) === jcs(bv);
  }
}

function l6(env: PassEnv, cells: { id: string; b: CellSide; h: CellSide }[]): LoosePart[] {
  const { Wb, Wh } = env;
  const parts = new Map<string, LoosePart>();
  const run = (rho: Map<string, string>, sink: Map<string, LoosePart>): void => {
    const baseC = env.base.claims
      .filter((c) => STRUCT_OR_LAW.has(c.op))
      .map((c) => ({ claim: c, args: renameArgs(c.args, rho) as Record<string, JsonValue> }));
    const headC = env.head.claims
      .filter((c) => STRUCT_OR_LAW.has(c.op))
      .map((c) => ({ claim: c, args: c.args as Record<string, JsonValue> }));
    const mapPos = (p: string): string => {
      if (p === UNGOVERNED) return p;
      if (p.endsWith(".*")) {
        const k = p.slice(0, -2);
        return `${rho.get(k) ?? k}.*`;
      }
      return rho.get(p) ?? p;
    };
    const part = (subject: string): LoosePart => {
      let p = sink.get(subject);
      if (!p) {
        p = newPart("L6", subject);
        sink.set(subject, p);
      }
      return p;
    };
    const compare = (x: string, isId: boolean, pbs: string[], ph: string): void => {
      if (pbs.every((pb) => mapPos(pb) === ph)) return;
      const nodeH = posComp(ph);
      const th = conTuples(env, Wh, nodeH, isId ? x : null, headC);
      const tb: Tuple[] = [];
      for (const pb of pbs) {
        const k = posComp(pb);
        const nodeB = k ? (rho.get(k) ?? k) : null;
        tb.push(
          ...conTuples(
            env,
            Wb,
            nodeB,
            isId ? x : null,
            baseC.map((c) => ({ ...c }))
          )
        );
      }
      for (const b of tb) {
        if (b.type === "via") continue;
        if (th.some((h) => dominates(h, b))) continue;
        const p = part(b.claim.fp);
        pushU(p.affected, x);
        pushU(p.delta, `L6 drop ${x} ${jcs({ type: b.type, ...b.value })}`);
      }
      for (const h of th) {
        if (h.type !== "via") continue;
        if (tb.some((b) => b.type === "via" && jcs(b.value) === jcs(h.value))) continue;
        const subject = baseOfHead(env, h.claim.fp);
        if (!subject) continue;
        const p = part(subject);
        pushU(p.affected, x);
        pushU(p.delta, `L6 via ${x} ${jcs(h.value)}`);
      }
    };
    for (const x of [...env.M.ids.keys()].sort(cmpStr)) compare(x, true, Wb.attAll(x), Wh.att(x));
    for (const c of cells)
      compare(
        c.id,
        false,
        Array.isArray(c.b) ? c.b : [c.b],
        Array.isArray(c.h) ? (c.h[0] as string) : (c.h as string)
      );
  };
  run(env.rho, parts);
  if (env.unmapped.size > 0 && parts.size > 0) {
    const hinted = new Map<string, LoosePart>();
    run(new Map([...env.rho, ...env.hints]), hinted);
    for (const [s, p] of parts)
      if (!hinted.has(s)) {
        p.answer = "undecided";
        p.unmapped = true;
      }
  }
  return [...parts.values()];
}

function baseOfHead(env: PassEnv, headFp: string): string | null {
  for (const [b, hs] of env.heirs) if (hs.includes(headFp)) return b;
  return null;
}

// ---- L7 NoWeakerGovernance ------------------------------------------------------------------------

function l7(env: PassEnv, hA: Map<string, string[]>): LoosePart[] {
  const parts = new Map<string, LoosePart>();
  const { base, head } = env;
  const add = (
    subject: string,
    answer: "loosened" | "undecided",
    field: string,
    b: JsonValue,
    h: JsonValue
  ): void => {
    let p = parts.get(subject);
    if (!p) {
      p = newPart("L7", subject);
      p.answer = answer;
      parts.set(subject, p);
    }
    if (answer === "loosened") p.answer = "loosened";
    pushU(p.delta, `L7 ${field} ${jcs(b)} ${jcs(h)}`);
  };
  const user = <T extends { q: string }>(xs: T[]): T[] =>
    xs.filter((x) => !x.q.startsWith("std::"));
  const headClaims = new Map(head.claims.map((c) => [c.fp, c]));
  const rhoOf = (q: string): string => env.rho.get(q) ?? q;
  // is the base claim's field inherited from an item that the heir inherits from too?
  const inheritedTogether = (bFrom: string | null, hFrom: string | null): boolean => {
    if (!bFrom || !hFrom) return false;
    if (bFrom === "shape" || bFrom === "default") return bFrom === hFrom;
    const m = /^(\w+) (.+)$/.exec(bFrom);
    if (!m) return false;
    return hFrom === `${m[1]} ${rhoOf(m[2] as string)}`;
  };
  // claims with heirs, and structural claims implied through H_A
  for (const cb of base.claims) {
    const hs = (env.heirs.get(cb.fp) ?? [])
      .map((f) => headClaims.get(f))
      .filter((c): c is Claim => !!c);
    if (hs.length > 0) {
      const ok = hs.some(
        (h) => tierRank(h.tier) >= tierRank(cb.tier) && reqGeq(h.requirement, cb.requirement)
      );
      if (!ok) {
        const best = [...hs].sort((a, b) => cmpStr(a.fp, b.fp))[0] as Claim;
        const tierFell = !hs.some((h) => tierRank(h.tier) >= tierRank(cb.tier));
        if (tierFell) {
          if (!hs.every((h) => inheritedTogether(cb.tierFrom, h.tierFrom)))
            add(cb.fp, "loosened", "tier", cb.tier, best.tier);
        } else
          add(
            cb.fp,
            "loosened",
            "requirement",
            cb.requirement as unknown as JsonValue,
            best.requirement as unknown as JsonValue
          );
      }
      if (!env.emptyBase)
        for (const h of hs)
          if (h.owner !== cb.owner && !inheritedTogether(cb.ownerFrom, h.ownerFrom))
            add(cb.fp, "undecided", "owner", cb.owner, h.owner);
      continue;
    }
    const ha = (hA.get(cb.fp) ?? []).map((f) => headClaims.get(f)).filter((c): c is Claim => !!c);
    const low = ha
      .filter((h) => tierRank(h.tier) < tierRank(cb.tier))
      .sort((a, b) => cmpStr(a.fp, b.fp));
    if (low.length > 0) add(cb.fp, "loosened", "tier", cb.tier, (low[0] as Claim).tier);
  }
  // policy entries and the shape (A.16.17: nothing the missing declaration would hold)
  if (!env.emptyBase) {
    for (const t of ["low", "normal", "critical"] as const) {
      const b = base.policy.tiers[t];
      const h = head.policy.tiers[t];
      const s = `policy ${t}`;
      if (!b.blocks.every((x) => h.blocks.includes(x)))
        add(s, "loosened", "blocks", [...b.blocks].sort(cmpStr), [...h.blocks].sort(cmpStr));
      if (h.maxAge > b.maxAge) add(s, "loosened", "max_age", b.maxAge, h.maxAge);
      if (levelRank(h.floor) < levelRank(b.floor)) add(s, "loosened", "floor", b.floor, h.floor);
      if (!h.judges.every((j) => b.judges.includes(j)))
        add(s, "loosened", "judges", [...b.judges].sort(cmpStr), [...h.judges].sort(cmpStr));
    }
    const bb = base.policy.budget;
    const hb = head.policy.budget;
    if (bb !== null && (hb === null || hb > bb)) add("shape", "loosened", "budget", bb, hb);
    if (base.shape.owner !== head.shape.owner)
      add("shape", "undecided", "owner", base.shape.owner, head.shape.owner);
    const mb = base.shape.manifest;
    const mh = head.shape.manifest;
    if (mb !== mh)
      add("shape", mb !== null && mh === null ? "loosened" : "undecided", "manifest", mb, mh);
  }
  // vocabulary items (ρ-matched)
  for (const kb of user(base.components)) {
    const kh = head.components.find((k) => k.q === env.rho.get(kb.q));
    if (!kh) continue;
    const s = `component ${kb.q}`;
    if (tierRank(kh.tier) < tierRank(kb.tier)) add(s, "loosened", "tier", kb.tier, kh.tier);
    if (kh.allows.some((a) => !kb.allows.includes(a)))
      add(s, "loosened", "allows", [...kb.allows].sort(cmpStr), [...kh.allows].sort(cmpStr));
    if (kh.assumes.some((a) => !kb.assumes.some((x) => x.id === a.id)))
      add(
        s,
        "loosened",
        "assumes",
        kb.assumes.map((a) => a.id).sort(cmpStr),
        kh.assumes.map((a) => a.id).sort(cmpStr)
      );
    if (
      !env.emptyBase &&
      kh.owner !== kb.owner &&
      !(kb.ownerFrom === "shape" && kh.ownerFrom === "shape")
    )
      add(s, "undecided", "owner", kb.owner, kh.owner);
  }
  for (const rb of user(base.resources)) {
    if (rb.q === TRUST) continue;
    const rh = head.resources.find((r) => r.q === env.rho.get(rb.q));
    if (!rh) continue;
    const s = `resource ${rb.q}`;
    if (tierRank(rh.tier) < tierRank(rb.tier)) add(s, "loosened", "tier", rb.tier, rh.tier);
    if (
      !env.emptyBase &&
      rh.owner !== rb.owner &&
      !(rb.ownerFrom === "shape" && rh.ownerFrom === "shape")
    )
      add(s, "undecided", "owner", rb.owner, rh.owner);
  }
  for (const ub of user(base.units)) {
    const uh = head.units.find((u) => u.q === env.rho.get(ub.q));
    if (!uh) continue;
    const s = `unit ${ub.q}`;
    if (tierRank(uh.tier) < tierRank(ub.tier) && !inheritedTogether(ub.tierFrom, uh.tierFrom))
      add(s, "loosened", "tier", ub.tier, uh.tier);
    if (!env.emptyBase && uh.owner !== ub.owner && !inheritedTogether(ub.ownerFrom, uh.ownerFrom))
      add(s, "undecided", "owner", ub.owner, uh.owner);
  }
  // providers (A.16.29(b) encodings)
  for (const pb of user(base.providers)) {
    const ph = head.providers.find((p) => p.q === pb.q);
    const s = `provider ${pb.q}`;
    if (!ph) {
      add(s, "loosened", "removed", pb.q, null);
      continue;
    }
    const trusts = (p: typeof pb): JsonValue =>
      [...p.trusts].map((t) => [t[0], t[1]]).sort((a, b) => cmpStr(jcs(a), jcs(b)));
    if (ph.trusts.some((t) => !pb.trusts.some((x) => x[0] === t[0] && x[1] === t[1])))
      add(s, "loosened", "trusts", trusts(pb), trusts(ph));
    const enc = (p: typeof pb, f: string): JsonValue => {
      switch (f) {
        case "produces":
          return [...p.produces].sort(cmpStr);
        case "observes":
          return [...p.observes].sort(cmpStr);
        case "decides":
          return [...p.decides].sort(cmpStr);
        case "presence":
          return p.presence;
        case "absence":
          return p.absence;
        case "persist":
          return p.persist;
        case "depsComplete":
          return p.depsComplete;
        case "identity":
          return p.identity;
        default:
          return p.implementation
            ? {
                paths: [...p.implementation.paths].sort(cmpStr),
                ids: [...p.implementation.ids].sort(cmpStr),
                digest: p.implementation.digest
              }
            : null;
      }
    };
    for (const f of [
      "produces",
      "observes",
      "decides",
      "presence",
      "absence",
      "persist",
      "depsComplete",
      "identity",
      "implementation"
    ]) {
      const a = enc(pb, f);
      const b = enc(ph, f);
      if (jcs(a) !== jcs(b)) add(s, "undecided", f, a, b);
    }
  }
  // actors (ρ for actors by name and was, A.6.1.4 [D18])
  for (const ab of user(base.actors)) {
    const ah =
      head.actors.find((a) => a.q === ab.q) ??
      head.actors.find((a) => a.was !== null && (a.was === ab.q || ab.q.endsWith(`::${a.was}`)));
    if (!ah) continue;
    const s = `actor ${ab.q}`;
    if (ah.identities.some((i) => !ab.identities.includes(i)))
      add(
        s,
        "undecided",
        "identity",
        [...ab.identities].sort(cmpStr),
        [...ah.identities].sort(cmpStr)
      );
    if (ah.members.some((m) => !ab.members.includes(m)))
      add(s, "undecided", "member", [...ab.members].sort(cmpStr), [...ah.members].sort(cmpStr));
    if (ah.operator !== ab.operator && ah.operator !== null)
      add(s, "undecided", "operator", ab.operator, ah.operator);
  }
  return [...parts.values()];
}

// ---- subjects (A.8.2.2) ------------------------------------------------------------------------------

const CHECKER = new Set([
  "edge.exists",
  "edge.forbid",
  "path.forbid",
  "cycle.forbid",
  "authority",
  "effect.forbid",
  "effects.upper",
  "effects.lower"
]);

function observesMeet(observes: string[], ch: string): boolean {
  if (ch === "call(*)") return observes.some((o) => o.startsWith("call("));
  for (const o of observes) {
    if (o === ch) return true;
    const om = /^effect\((.+)\)$/.exec(o);
    const cm = /^effect\((.+)\)$/.exec(ch);
    if (om && cm) {
      const d = /^(\w+)\.(\w+)\("(.*)"\)$/.exec(om[1] as string);
      const n = /^(\w+)\.(\w+)\("(.*)"\)$/.exec(cm[1] as string);
      if (d && n && d[1] === n[1] && d[2] === n[2] && (d[3] === "*" || d[3] === n[3])) return true;
    }
    const oe = /^edge\((\w+)(?:, (.+))?\)$/.exec(o);
    const ce = /^edge\((\w+)(?:, (.+))?\)$/.exec(ch);
    if (oe && ce && oe[1] === ce[1] && (!oe[2] || oe[2] === ce[2])) return true;
    const oc = /^call\((\w+)\)$/.exec(o);
    if (oc && ch === o) return true;
  }
  return false;
}

/** A loosening subject's base tier (A.8.2.2, A.16.29(c); DRT T3, T6). */
export function subjectTier(base: ESF, Wb: World | null, subject: string): Tier {
  if (subject === "shape") return "critical";
  if (subject.startsWith("policy ")) {
    const t = subject.slice(7);
    return t === "low" || t === "normal" || t === "critical" ? t : "critical";
  }
  if (subject.startsWith("component "))
    return base.components.find((k) => k.q === subject.slice(10))?.tier ?? "normal";
  if (subject.startsWith("resource "))
    return base.resources.find((k) => k.q === subject.slice(9))?.tier ?? "normal";
  if (subject.startsWith("unit "))
    return base.units.find((k) => k.q === subject.slice(5))?.tier ?? "normal";
  if (subject.startsWith("provider ")) {
    const p = base.providers.find((x) => x.q === subject.slice(9));
    let t: Tier = "low";
    if (!p) return t;
    for (const c of base.claims) {
      let hit = false;
      if (c.op === "law") hit = lawDecidedBy(c, p);
      else if (CHECKER.has(c.op) && Wb)
        hit = footprint(Wb, c).channels.some((ch) => observesMeet(p.observes, ch));
      if (hit) t = maxTier(t, c.tier);
    }
    return t;
  }
  if (subject.startsWith("actor ")) {
    const q = subject.slice(6);
    let t: Tier = "low";
    for (const x of [...base.components, ...base.resources, ...base.units, ...base.claims])
      if (x.owner === q) t = maxTier(t, x.tier);
    for (const tt of ["low", "normal", "critical"] as const)
      if (base.policy.tiers[tt].judges.includes(q)) t = maxTier(t, tt);
    return t;
  }
  return base.claims.find((c) => c.fp === subject)?.tier ?? "normal";
}

/** The base owner who answers for a loosening subject (A.8.2.2). */
export function subjectOwner(base: ESF, subject: string): string {
  if (
    subject === "shape" ||
    subject.startsWith("policy ") ||
    subject.startsWith("provider ") ||
    subject.startsWith("actor ")
  )
    return base.shape.owner;
  if (subject.startsWith("component "))
    return base.components.find((k) => k.q === subject.slice(10))?.owner ?? base.shape.owner;
  if (subject.startsWith("resource "))
    return base.resources.find((k) => k.q === subject.slice(9))?.owner ?? base.shape.owner;
  if (subject.startsWith("unit "))
    return base.units.find((k) => k.q === subject.slice(5))?.owner ?? base.shape.owner;
  return base.claims.find((c) => c.fp === subject)?.owner ?? base.shape.owner;
}

export function parseAtomVerb(atom: string): string | null {
  return parseAtom(atom)?.verb ?? null;
}
