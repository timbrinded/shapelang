// Checker-decided claims (version 7): W_decl, lifted edges, coherence errors, contradictions of
// effect forbids, summaries and authority through P(u) (raw_fact_exact), structure
// contradictions with canonical witnesses and supports, refutations of lower bounds, footprints
// and channels (A.4.4–A.4.5, A.15.4, A.15.12, A.16.5, A.16.8, A.16.25, A.16.26).
import type { Ctx } from "./context.ts";
import { idToSourceRef } from "./elaborate.ts";
import { type UsableEntry, type WFact, channelCovered, factId } from "./evidence.ts";
import { jcs } from "./jcs.ts";
import { type IdentityInfo, ancestorsOrSelf } from "./manifest.ts";
import {
  type Cause,
  type Claim,
  type JsonValue,
  type ShapeError,
  TRUST,
  parseAtom
} from "./model.ts";
import { carriers } from "./resource-code.ts";
import { type Tier, cmpStr, cmpTuple, maxTier, sortedUniq, tierRank } from "./util.ts";
import {
  UNGOVERNED,
  type World,
  bindOf,
  compCode,
  excludingClaims,
  impl,
  inUnitSel,
  liftEffect,
  liftHatch,
  nodeSet,
  permitted,
  posComp
} from "./world.ts";

export interface Contra {
  claim: Claim;
  subject: JsonValue;
  force: "sound" | "heuristic";
  witness: WFact[];
  support: WFact[];
  supportCode: string[];
  excluding: Claim[];
  tierStar: Tier;
  causes: Cause[];
  message: string;
  refuted: boolean;
  /** refutations: the refuting records' ids */
  refuting: string[];
  /** effect contradictions: the site, for tier* and the matching of exceptions */
  site: { x: string; pos: string; atom: string } | null;
  /** structure contradictions: the support's lifted edges (A.4.4.11, A.16.5) */
  supportEdges: Edge[];
}

export interface Edge {
  from: string;
  kind: string;
  to: string;
  facts: WFact[];
}

const REGISTERED = new Set(["ts", "rust", "verus"]);

// ---- declared world ----------------------------------------------------------------------------

function declFact(raw: Record<string, unknown>, extra: Partial<WFact>): WFact {
  return {
    fid: factId(raw),
    type: "declared",
    at: null,
    verb: null,
    resource: null,
    to: null,
    kind: null,
    claim: String(raw.claim),
    unit: null,
    atom: null,
    declared: true,
    observed: false,
    presenceSound: true,
    relocated: false,
    n: 1,
    sources: [],
    anchors: [],
    raw,
    ...extra
  };
}

/** W_decl(S_h): declared summary atoms, `via` call pairs and relation edges (A.4.4.4). */
export function declaredFacts(ctx: Ctx): WFact[] {
  return declaredFactsOf(ctx.head.claims, ctx.Wh);
}

/** W_decl of a shape's claims under a world. */
export function declaredFactsOf(claims: Claim[], W: World): WFact[] {
  const out: WFact[] = [];
  for (const c of claims) {
    if (c.op === "effects.lower") {
      const u = String(c.args.unit);
      for (const entry of c.args.atoms as string[]) {
        const m = /^(.+?)(?: via (.+))?$/.exec(entry);
        const atom = m?.[1] ?? entry;
        const via = m?.[2] ?? null;
        const a = parseAtom(atom);
        if (via) {
          out.push(
            declFact(
              { type: "declared", claim: c.fp, atom: entry },
              { kind: "call", at: bindOf(W, u), unit: u, to: bindOf(W, via), atom }
            )
          );
          out.push(
            declFact(
              { type: "declared", claim: c.fp, atom, unit: via },
              {
                at: bindOf(W, via),
                unit: via,
                atom,
                verb: a?.verb ?? null,
                resource: a?.resource ?? null
              }
            )
          );
        } else {
          out.push(
            declFact(
              { type: "declared", claim: c.fp, atom },
              {
                at: bindOf(W, u),
                unit: u,
                atom,
                verb: a?.verb ?? null,
                resource: a?.resource ?? null
              }
            )
          );
        }
      }
    } else if (c.op === "edge.exists") {
      out.push(
        declFact(
          { type: "declared", claim: c.fp },
          { kind: String(c.args.kind), unit: String(c.args.from), to: String(c.args.to) }
        )
      );
    }
  }
  return out;
}

/** Calls°: observed call facts within ids(M_h) plus declared `a via v` pairs (A.3.3.10). */
export function buildCalls(facts: WFact[]): Map<string, { to: string; fact: WFact }[]> {
  const calls = new Map<string, { to: string; fact: WFact }[]>();
  for (const f of facts) {
    const isCall = f.type === "call" || (f.declared && f.kind === "call");
    if (!isCall || !f.at || !f.to) continue;
    const list = calls.get(f.at) ?? [];
    list.push({ to: f.to, fact: f });
    calls.set(f.at, list);
  }
  for (const list of calls.values())
    list.sort((a, b) => cmpStr(a.to, b.to) || cmpStr(a.fact.fid, b.fact.fid));
  return calls;
}

export function factCost(f: WFact): [number, number] {
  if (f.declared) return [0, 0];
  return f.presenceSound ? [0, 1] : [1, 1];
}

/** The representative: least by (presence-sound first, declared first, fact id) (A.4.4.9). */
export function bestFact(facts: WFact[]): WFact {
  return [...facts].sort((a, b) =>
    cmpTuple([...factCost(a), a.fid], [...factCost(b), b.fid])
  )[0] as WFact;
}

/** Lifted edges E_S: relations, `via` pairs, calls between distinct components and declared-kind
 *  raw edges; edges touching ungoverned are dropped and counted (A.4.4.2). */
export function liftedEdges(
  w: World,
  facts: WFact[]
): { edges: Edge[]; ungovernedCalls: number; droppedEdges: number } {
  const byKey = new Map<string, Edge>();
  let ungovernedCalls = 0;
  let droppedEdges = 0;
  const kinds = new Map(w.esf.kinds.map((k) => [k.name, k]));
  const add = (from: string, kind: string, to: string, f: WFact): void => {
    const k = `${from}\u0000${kind}\u0000${to}`;
    const e = byKey.get(k) ?? { from, kind, to, facts: [] };
    if (!e.facts.some((x) => x.fid === f.fid)) e.facts.push(f);
    byKey.set(k, e);
  };
  const compAt = (x: string): string | null => posComp(w.att(x));
  for (const f of facts) {
    if (f.declared && f.kind && f.kind !== "call" && f.unit && f.to) add(f.unit, f.kind, f.to, f);
    else if ((f.type === "call" || (f.declared && f.kind === "call")) && f.at && f.to) {
      const a = compAt(f.at);
      const b = compAt(f.to);
      if (!a || !b) {
        ungovernedCalls += 1;
        continue;
      }
      if (a !== b) add(a, "calls", b, f);
    } else if (f.type === "edge" && f.at && f.to && f.kind) {
      const kd = kinds.get(f.kind);
      if (!kd) {
        droppedEdges += 1;
        continue;
      }
      const a = compAt(f.at);
      const b =
        kd.to === "resource"
          ? (w.resOfCode.get(f.to) ?? null)
          : w.man.ids.has(f.to)
            ? compAt(f.to)
            : null;
      if (!a || !b) {
        ungovernedCalls += 1;
        continue;
      }
      add(a, f.kind, b, f);
    }
  }
  const edges = [...byKey.values()].sort((x, y) =>
    cmpTuple([x.from, x.kind, x.to], [y.from, y.kind, y.to])
  );
  for (const e of edges) e.facts.sort((a, b) => cmpStr(a.fid, b.fid));
  return { edges, ungovernedCalls, droppedEdges };
}

function claimId(c: Claim): string {
  return c.ids[0] ?? c.fp;
}

function factText(f: WFact): string {
  if (f.type === "effect")
    return `${f.verb} at ${f.at} on ${f.resource}${f.presenceSound ? " (presence-sound)" : " (heuristic)"} from ${f.sources.map((s) => s.provider).join(", ")}`;
  if (f.type === "hatch") return `${f.n} ${f.kind} marker(s) at ${f.at} (manifest)`;
  if (f.type === "call")
    return `call ${f.at} -> ${f.to}${f.presenceSound ? "" : " (heuristic)"} from ${f.sources.map((s) => s.provider).join(", ")}`;
  if (f.type === "edge") return `${f.kind} edge ${f.at} -> ${f.to}`;
  return `declared by ${f.claim}${f.atom ? ` (${f.atom})` : ""}`;
}

/** The JCS of the key preimage a violation would have as a contradiction (A.16.25). */
function keyPreimage(c: Claim, subject: JsonValue): string {
  return jcs({ claim: c.fp, kind: "contradiction", subject, v: "shape.obligation.v1" });
}

function editShape(): {
  act: "edit-shape";
  by: "author";
  agentSafe: true;
  eligible: string[];
  creates: null;
} {
  return { act: "edit-shape", by: "author", agentSafe: true, eligible: [], creates: null };
}

// ---- authority, effect forbids and summaries ---------------------------------------------------

export interface Site {
  x: string;
  pos: string;
  atom: string;
  f: WFact;
}

/** Effect sites: lifted effect facts, manifest hatch facts and declared summary atoms. */
export function effectSites(ctx: Ctx, facts: WFact[]): Site[] {
  const W = ctx.Wh;
  const out: Site[] = [];
  for (const f of facts) {
    if (f.type === "effect" && f.at && f.verb && f.resource) {
      const l = liftEffect(W, f.verb, f.resource);
      if (l) out.push({ x: f.at, pos: W.att(f.at), atom: l.atom, f });
    } else if (f.type === "hatch" && f.at && f.kind) {
      const lang = ctx.Mh.ids.get(f.at)?.lang ?? "";
      out.push({ x: f.at, pos: W.att(f.at), atom: liftHatch(W, f.kind, lang), f });
    } else if (f.declared && f.atom && f.unit && f.kind !== "call" && !f.to) {
      out.push({ x: f.at ?? `unit:${f.unit}`, pos: f.unit, atom: f.atom, f });
    }
  }
  return out;
}

/** tier* of an effect-forbid, summary or authority obligation at its fact: the higher of the
 *  claim's head tier and Lvl_b at the fact's base position (A.6.2.3, A.16.13). */
export type LvlB = (x: string, atom: string, f: WFact) => Tier | null;

export function evalEffects(ctx: Ctx, facts: WFact[], errors: ShapeError[], lvlB: LvlB): Contra[] {
  const W = ctx.Wh;
  const subjects = new Map<string, { x: string; pos: string; atom: string; facts: WFact[] }>();
  for (const s of effectSites(ctx, facts)) {
    if (permitted(W, s.pos, s.atom)) continue;
    const k = JSON.stringify([s.x, s.atom]);
    const e = subjects.get(k) ?? { x: s.x, pos: s.pos, atom: s.atom, facts: [] };
    if (!e.facts.some((f) => f.fid === s.f.fid)) e.facts.push(s.f);
    subjects.set(k, e);
  }
  const out: Contra[] = [];
  const kindRank = (c: Claim): number =>
    c.op === "effect.forbid" ? 0 : c.op === "effects.upper" ? 1 : 2;
  for (const [, s] of [...subjects.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const L = s.x.startsWith("unit:") ? null : lvlB(s.x, s.atom, bestFact(s.facts));
    const tstar = (c: Claim): Tier => (L ? maxTier(c.tier, L) : c.tier);
    const excl = excludingClaims(W, s.pos, s.atom).sort((a, b) =>
      cmpTuple([-tierRank(tstar(a)), kindRank(a), a.fp], [-tierRank(tstar(b)), kindRank(b), b.fp])
    );
    const claim = excl[0];
    if (!claim) continue;
    const subject = { code: s.x, atom: s.atom };
    const w = bestFact(s.facts);
    if (s.facts.some((f) => f.declared)) {
      const decl = bestFact(s.facts.filter((f) => f.declared));
      errors.push({
        code: "E-conduct",
        subject: keyPreimage(claim, subject),
        message: `${s.pos} declares ${s.atom}, which ${claimId(claim)} excludes`,
        causes: [
          { type: "fact", id: decl.fid, text: factText(decl) },
          ...(s.x.startsWith("unit:") ? [] : [{ type: "code" as const, id: s.x }])
        ],
        dischargers: [editShape()]
      });
      continue;
    }
    const where = s.x.startsWith("unit:") ? s.x.slice(5) : idToSourceRef(s.x);
    const causes: Cause[] = [{ type: "fact", id: w.fid, text: factText(w) }];
    if (w.type === "effect" && w.resource) {
      const r = parseAtom(s.atom)?.resource ?? "";
      causes.push({ type: "binding", id: `resource ${r}`, text: `${r} binds ${w.resource}` });
    }
    causes.push({ type: "code", id: s.x, text: `${where} is attributed to ${s.pos}` });
    for (const o of excl.slice(1))
      causes.push({ type: "claim", id: o.fp, text: `${claimId(o)} also excludes it` });
    causes.push({ type: "claim", id: claim.fp, text: `${claimId(claim)} forbids it` });
    out.push({
      claim,
      subject,
      force: w.presenceSound ? "sound" : "heuristic",
      witness: [w],
      support: s.facts,
      supportCode: sortedUniq(s.facts.flatMap((f) => (f.at ? [f.at] : []))),
      excluding: excl,
      tierStar: tstar(claim),
      causes,
      message: `${where} (in ${s.pos}) performs ${s.atom}${w.resource ? ` on ${w.resource}` : ""}. ${claimId(claim)} forbids it.`,
      refuted: false,
      refuting: [],
      site: { x: s.x, pos: s.pos, atom: s.atom },
      supportEdges: []
    });
  }
  return out;
}

// ---- footprints and channels ---------------------------------------------------------------------

export function boundCodes(w: World): string[] {
  return sortedUniq(w.esf.resources.flatMap((r) => r.bind));
}

/** chan(v<R>): effect(t) per t bound to R; for Trust, hatch(L) per language with a declared
 *  hatch kind in ↓v (A.4.5.2). */
export function chanOfAtom(w: World, atom: string): string[] {
  const a = parseAtom(atom);
  if (!a) return [];
  if (a.resource === TRUST) {
    const langs = new Set<string>();
    for (const [h, ls] of w.hatchLangs) if (impl(w, h, a.verb)) for (const l of ls) langs.add(l);
    return [...langs].sort(cmpStr).map((l) => `hatch(${l})`);
  }
  const r = w.esf.resources.find((x) => x.q === a.resource);
  return (r?.bind ?? []).map((t) => `effect(${t})`);
}

/** prod(k, T): call(L) for calls; edge(k) to components; edge(k, t) per bound t of T. */
export function prod(w: World, kind: string, targets: Set<string>): string[] {
  if (kind === "calls") return ["call(*)"];
  const kd = w.esf.kinds.find((k) => k.name === kind);
  if (!kd) return [];
  if (kd.to === "component") return [`edge(${kind})`];
  const out: string[] = [];
  for (const t of targets)
    for (const b of w.esf.resources.find((r) => r.q === t)?.bind ?? [])
      out.push(`edge(${kind}, ${b})`);
  return out;
}

export function governedCode(w: World): string[] {
  const out: string[] = [];
  for (const [p, xs] of w.codeOfPos) if (p !== UNGOVERNED) out.push(...xs);
  return sortedUniq(out);
}

/** F(c) and T(c) of a checker-decided claim under a world (A.4.5.1-2 [D2]). */
export function footprint(w: World, c: Claim): { code: string[]; channels: string[] } {
  switch (c.op) {
    case "authority":
      return {
        code: compCode(w, String(c.args.component)),
        channels: boundCodes(w).map((t) => `effect(${t})`)
      };
    case "effect.forbid": {
      const scope = c.args.scope as string[];
      const except = c.args.except as string[];
      const pos = w.positions.filter(
        (p) => scope.some((s) => inUnitSel(s, p)) && !except.some((s) => inUnitSel(s, p))
      );
      return {
        code: sortedUniq(pos.flatMap((p) => w.codeOfPos.get(p) ?? [])),
        channels: chanOfAtom(w, String(c.args.atom))
      };
    }
    case "effects.upper":
    case "effects.lower":
      return {
        code: [...(w.codeOfPos.get(String(c.args.unit)) ?? [])].sort(cmpStr),
        channels: boundCodes(w).map((t) => `effect(${t})`)
      };
    case "edge.exists": {
      const a = String(c.args.from);
      return {
        code: compCode(w, a),
        channels: prod(w, String(c.args.kind), new Set([String(c.args.to)]))
      };
    }
    case "edge.forbid": {
      const S = nodeSet(w, c.args.from as string[]);
      for (const x of nodeSet(w, c.args.exceptFrom as string[])) S.delete(x);
      const T = nodeSet(w, c.args.to as string[]);
      for (const y of nodeSet(w, c.args.exceptTo as string[])) T.delete(y);
      return {
        code: sortedUniq([...S].flatMap((s) => compCode(w, s))),
        channels: prod(w, String(c.args.kind), T)
      };
    }
    case "path.forbid": {
      const T = nodeSet(w, c.args.to as string[]);
      return {
        code: governedCode(w),
        channels: sortedUniq((c.args.kinds as string[]).flatMap((k) => prod(w, k, T)))
      };
    }
    case "cycle.forbid": {
      const N = new Set(w.nodes);
      return {
        code: governedCode(w),
        channels: sortedUniq((c.args.kinds as string[]).flatMap((k) => prod(w, k, N)))
      };
    }
    default:
      return { code: [], channels: [] };
  }
}

export function isExecutable(info: IdentityInfo): boolean {
  return REGISTERED.has(info.lang) || info.executable;
}

/** Does channel t apply to identity x (A.4.5.3)? Returns the instantiated channel or null. */
export function channelAt(t: string, info: IdentityInfo): string | null {
  const registered = REGISTERED.has(info.lang);
  if (t === "call(*)") return registered ? `call(${info.lang})` : null;
  const call = /^call\((\w+)\)$/.exec(t);
  if (call) return info.lang === call[1] ? t : null;
  const hatch = /^hatch\((\w+)\)$/.exec(t);
  if (hatch) return info.lang === hatch[1] ? t : null;
  const eff = /^effect\((.+)\)$/.exec(t);
  if (eff) {
    const car = carriers(eff[1] ?? "");
    if (registered) return car.langs === "all" || car.langs.has(info.lang) ? t : null;
    // raw files of the kind's listed extensions carry it; otherwise a raw or command identity
    // flagged executable is a raw carrier (A.12.4, A.16.22 [D27])
    const ext = info.path.split(".").pop() ?? "";
    if (info.lang === "raw" && car.rawExts.includes(ext)) return t;
    return info.executable && car.rawCarrier ? t : null;
  }
  if (t.startsWith("edge(")) return isExecutable(info) ? t : null;
  return null;
}

// ---- refutation of lower bounds -----------------------------------------------------------------------

/** Per provider, the entry of the nearest ancestor-or-self of x that has a usable entry from it
 *  (A.15.9). */
export function nearestEntries(ctx: Ctx, x: string): UsableEntry[] {
  const out = new Map<string, UsableEntry>();
  for (const a of ancestorsOrSelf(ctx.Mh, x))
    for (const e of ctx.obsEntries.get(a) ?? []) if (!out.has(e.provider)) out.set(e.provider, e);
  return [...out.values()];
}

/** Footprint identities each covered on an applicable channel of T(c) by a usable complete entry
 *  from a provider absence-sound under (a) (A.16.8(a)). */
export function fullyObserved(
  ctx: Ctx,
  code: string[],
  channels: string[]
): { ok: boolean; covered: string[]; records: string[] } {
  const covered: string[] = [];
  const records = new Set<string>();
  if (code.length === 0) return { ok: false, covered, records: [] };
  for (const x of code) {
    const info = ctx.Mh.ids.get(x);
    if (!info) return { ok: false, covered, records: [] };
    const applicable = channels
      .map((t) => channelAt(t, info))
      .filter((t): t is string => t !== null);
    let hit: UsableEntry | null = null;
    for (const e of nearestEntries(ctx, x)) {
      const g = ctx.provs.get(e.provider);
      if (!g || !g.absenceA || !e.entry.complete) continue;
      if (applicable.some((t) => channelCovered(g.channelsA, t))) {
        hit = e;
        break;
      }
    }
    if (!hit) return { ok: false, covered, records: [] };
    covered.push(x);
    records.add(hit.record);
  }
  return { ok: true, covered, records: [...records].sort(cmpStr) };
}

export function evalLower(ctx: Ctx, facts: WFact[], edges: Edge[]): Contra[] {
  const W = ctx.Wh;
  const out: Contra[] = [];
  const observedSites = effectSites(
    ctx,
    facts.filter((f) => f.observed)
  );
  for (const c of ctx.head.claims) {
    if (c.op === "effects.lower") {
      const fp = footprint(W, c);
      const obs = fullyObserved(ctx, fp.code, fp.channels);
      if (!obs.ok) continue;
      const inCode = new Set(fp.code);
      for (const entry of c.args.atoms as string[]) {
        if (entry.includes(" via ")) continue;
        const a = parseAtom(entry);
        if (!a) continue;
        const present = observedSites.some((s) => {
          const b = parseAtom(s.atom);
          return inCode.has(s.x) && !!b && b.resource === a.resource && impl(W, b.verb, a.verb);
        });
        if (present) continue;
        out.push({
          claim: c,
          subject: { unit: String(c.args.unit), atom: entry },
          force: "sound",
          witness: [],
          support: [],
          supportCode: obs.covered,
          excluding: [c],
          tierStar: c.tier,
          causes: [
            ...obs.records.map((r) => ({ type: "record" as const, id: r })),
            { type: "claim", id: c.fp, text: `complete absence-sound entries report no ${entry}` }
          ],
          message: `${c.args.unit} is declared to cause ${entry}, but complete observations of its code report none.`,
          refuted: true,
          refuting: obs.records,
          site: null,
          supportEdges: []
        });
      }
    } else if (c.op === "edge.exists") {
      const fp = footprint(W, c);
      const obs = fullyObserved(ctx, fp.code, fp.channels);
      if (!obs.ok) continue;
      const present = edges.some(
        (e) =>
          e.from === c.args.from &&
          e.kind === c.args.kind &&
          e.to === c.args.to &&
          e.facts.some((f) => f.observed)
      );
      if (present) continue;
      out.push({
        claim: c,
        subject: null,
        force: "sound",
        witness: [],
        support: [],
        supportCode: obs.covered,
        excluding: [c],
        tierStar: c.tier,
        causes: [
          ...obs.records.map((r) => ({ type: "record" as const, id: r })),
          {
            type: "claim",
            id: c.fp,
            text: `complete absence-sound entries report no ${c.args.kind} edge ${c.args.from} -> ${c.args.to}`
          }
        ],
        message: `${claimId(c)}: no ${c.args.kind} edge ${c.args.from} -> ${c.args.to} is observed where observation is complete.`,
        refuted: true,
        refuting: obs.records,
        site: null,
        supportEdges: []
      });
    }
  }
  return out;
}

// ---- structure ----------------------------------------------------------------------------------------

function pathCost(path: Edge[]): (number | string)[] {
  let h = 0;
  let o = 0;
  for (const e of path) {
    const [a, b] = factCost(bestFact(e.facts));
    h += a;
    o += b;
  }
  return [h, o, path.length, ...path.map((e) => bestFact(e.facts).fid)];
}

function shortestPaths(
  start: string,
  edges: Edge[],
  allowInterior: (n: string) => boolean
): Map<string, Edge[]> {
  const best = new Map<string, Edge[]>();
  const out = new Map<string, Edge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const queue: { n: string; path: Edge[] }[] = [{ n: start, path: [] }];
  const settled = new Set<string>();
  while (queue.length > 0) {
    queue.sort((a, b) => cmpTuple([...pathCost(a.path), a.n], [...pathCost(b.path), b.n]));
    const cur = queue.shift() as { n: string; path: Edge[] };
    if (settled.has(cur.n) && cur.path.length > 0) continue;
    if (cur.path.length > 0) {
      settled.add(cur.n);
      best.set(cur.n, cur.path);
      if (!allowInterior(cur.n)) continue;
    }
    for (const e of out.get(cur.n) ?? []) {
      if (settled.has(e.to)) continue;
      if (e.to === start) continue;
      if (cur.path.some((p) => p.from === e.to)) continue;
      queue.push({ n: e.to, path: [...cur.path, e] });
    }
  }
  return best;
}

/** Non-trivial strongly connected components; a node with a self-loop is one (A.4.2.1). */
export function sccs(nodes: string[], edges: { from: string; to: string }[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    for (const w of [...(adj.get(v) ?? [])].sort(cmpStr)) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop() as string;
        on.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > 1 || edges.some((e) => e.from === v && e.to === v))
        out.push(comp.sort(cmpStr));
    }
  };
  for (const n of [...nodes].sort(cmpStr)) if (!idx.has(n)) strong(n);
  return out.sort((a, b) => cmpStr(a[0] as string, b[0] as string));
}

export function evalStructure(ctx: Ctx, edges: Edge[], errors: ShapeError[]): Contra[] {
  const W = ctx.Wh;
  const out: Contra[] = [];
  const emit = (
    c: Claim,
    subject: JsonValue,
    witness: Edge[],
    supportEdges: Edge[],
    what: string
  ): void => {
    const support = supportEdges.flatMap((e) => e.facts);
    const wfacts = witness.map((e) => bestFact(e.facts));
    const causes: Cause[] = wfacts.map((f) => ({
      type: "fact" as const,
      id: f.fid,
      text: factText(f)
    }));
    if (wfacts.every((f) => f.declared)) {
      errors.push({
        code: "E-structure",
        subject: keyPreimage(c, subject),
        message: `declared structure violates ${claimId(c)}: ${what}`,
        causes,
        dischargers: [editShape()]
      });
      return;
    }
    const uniq = [...new Map(support.map((f) => [f.fid, f])).values()];
    out.push({
      claim: c,
      subject,
      force: wfacts.every((f) => f.declared || f.presenceSound) ? "sound" : "heuristic",
      witness: wfacts,
      support: uniq,
      supportCode: sortedUniq(uniq.flatMap((f) => (f.at ? [f.at] : []))),
      excluding: [c],
      tierStar: c.tier,
      causes: [...causes, { type: "claim", id: c.fp, text: `${claimId(c)} forbids it` }],
      message: `${what}. ${claimId(c)} forbids it.`,
      refuted: false,
      refuting: [],
      site: null,
      supportEdges: [
        ...new Map(supportEdges.map((e) => [`${e.from}\u0000${e.kind}\u0000${e.to}`, e])).values()
      ]
    });
  };
  for (const c of ctx.head.claims) {
    if (c.op === "edge.forbid") {
      const S = nodeSet(W, c.args.from as string[]);
      for (const x of nodeSet(W, c.args.exceptFrom as string[])) S.delete(x);
      const T = nodeSet(W, c.args.to as string[]);
      for (const y of nodeSet(W, c.args.exceptTo as string[])) T.delete(y);
      for (const e of edges) {
        if (e.kind !== c.args.kind || !S.has(e.from) || !T.has(e.to)) continue;
        emit(c, { from: e.from, to: e.to }, [e], [e], `${e.kind} edge ${e.from} -> ${e.to}`);
      }
    } else if (c.op === "path.forbid") {
      const K = new Set(c.args.kinds as string[]);
      const S = nodeSet(W, c.args.from as string[]);
      const T = nodeSet(W, c.args.to as string[]);
      const V = nodeSet(W, c.args.exceptVia as string[]);
      const kEdges = edges.filter((e) => K.has(e.kind));
      const interior = (n: string): boolean => !V.has(n) && !S.has(n) && !T.has(n);
      for (const s of [...S].sort(cmpStr)) {
        if (V.has(s)) continue;
        const sp = shortestPaths(s, kEdges, interior);
        for (const t of [...T].sort(cmpStr)) {
          if (t === s) continue;
          const p = sp.get(t);
          if (!p) continue;
          // support: K-edges (a,b) with a reachable from s and t reachable from b through
          // interiors outside V ∪ S ∪ T (A.4.4.11)
          const fwd = new Set<string>([s]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const e of kEdges)
              if (fwd.has(e.from) && !fwd.has(e.to) && interior(e.to)) {
                fwd.add(e.to);
                grew = true;
              }
          }
          const back = new Set<string>([t]);
          grew = true;
          while (grew) {
            grew = false;
            for (const e of kEdges)
              if (back.has(e.to) && !back.has(e.from) && (e.from === s || interior(e.from))) {
                back.add(e.from);
                grew = true;
              }
          }
          const support = kEdges.filter((e) => fwd.has(e.from) && back.has(e.to));
          emit(
            c,
            { from: s, to: t },
            p,
            support,
            `path ${[s, ...p.map((e) => e.to)].join(" -> ")}`
          );
        }
      }
    } else if (c.op === "cycle.forbid") {
      const K = new Set(c.args.kinds as string[]);
      const kEdges = edges.filter((e) => K.has(e.kind));
      const nodes = sortedUniq(kEdges.flatMap((e) => [e.from, e.to]));
      for (const comp of sccs(nodes, kEdges)) {
        const set = new Set(comp);
        const inner = kEdges.filter((e) => set.has(e.from) && set.has(e.to));
        const n = comp[0] as string;
        // canonical-least cycle through the least node: best path n ⇝ m plus edge m → n
        const sp = shortestPaths(n, inner, () => true);
        let best: Edge[] | null = null;
        for (const e of inner) {
          if (e.to !== n) continue;
          const prefix = e.from === n ? [] : sp.get(e.from);
          if (prefix === undefined) continue;
          const cyc = [...prefix, e];
          if (!best || cmpTuple(pathCost(cyc), pathCost(best)) < 0) best = cyc;
        }
        if (!best) continue;
        emit(
          c,
          { nodes: comp },
          best,
          inner,
          `cycle ${[n, ...best.map((e) => e.to)].join(" -> ")}`
        );
      }
    }
  }
  return out;
}

export function ungovernedIds(w: World): string[] {
  return [...(w.codeOfPos.get(UNGOVERNED) ?? [])];
}
