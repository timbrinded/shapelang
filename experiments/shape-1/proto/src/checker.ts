// Checker-decided claims (structure, authority, conduct): W_decl, lifted edges, coherence errors,
// contradictions with canonical witnesses, refutations, footprints and channels (A.4.4–A.4.5).
import type { Ctx } from "./context.ts";
import { type WFact, channelCovered, factId } from "./evidence.ts";
import { idToSourceRef } from "./elaborate.ts";
import { type IdentityInfo, ancestorsOrSelf } from "./manifest.ts";
import {
  type Cause,
  type Claim,
  type JsonValue,
  type ShapeError,
  TRUST,
  parseAtom
} from "./model.ts";
import { carriers, parseResourceCode } from "./resource-code.ts";
import { type Tier, cmpStr, cmpTuple, maxTier, sortedUniq, tierRank } from "./util.ts";
import {
  UNGOVERNED,
  type World,
  compCode,
  covers,
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
}

export interface Edge {
  from: string;
  kind: string;
  to: string;
  facts: WFact[];
}

// ---- declared world ----------------------------------------------------------------------------

/** W_decl(S_h): declared summary atoms, `via` call pairs and relation edges as declared facts. */
export function declaredFacts(ctx: Ctx): WFact[] {
  const out: WFact[] = [];
  const W = ctx.Wh;
  const mk = (raw: Record<string, unknown>, extra: Partial<WFact>): WFact => ({
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
    raw,
    ...extra
  });
  for (const c of ctx.head.claims) {
    if (c.op === "effects.lower") {
      const u = String(c.args.unit);
      for (const entry of c.args.atoms as string[]) {
        const m = /^(.+?)(?: via (.+))?$/.exec(entry);
        const atom = m?.[1] ?? entry;
        const via = m?.[2] ?? null;
        const a = parseAtom(atom);
        if (via) {
          out.push(
            mk(
              { type: "declared", claim: c.fp, atom: entry },
              {
                kind: "call",
                at: W.unitBind.get(u) ?? null,
                unit: u,
                to: W.unitBind.get(via) ?? null,
                atom,
                verb: a?.verb ?? null,
                resource: a?.resource ?? null
              }
            )
          );
          out.push(
            mk(
              { type: "declared", claim: c.fp, atom, unit: via },
              {
                at: W.unitBind.get(via) ?? null,
                unit: via,
                atom,
                verb: a?.verb ?? null,
                resource: a?.resource ?? null
              }
            )
          );
        } else {
          out.push(
            mk(
              { type: "declared", claim: c.fp, atom },
              {
                at: W.unitBind.get(u) ?? null,
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
        mk(
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

function bestFact(facts: WFact[]): WFact {
  return [...facts].sort((a, b) =>
    cmpTuple([...factCost(a), a.fid], [...factCost(b), b.fid])
  )[0] as WFact;
}

/** Lifted edges E_S of W_eval: relations, `via` pairs and observed calls/edges between components. */
export function liftedEdges(
  ctx: Ctx,
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
    e.facts.push(f);
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
  void ctx;
  const edges = [...byKey.values()].sort((x, y) =>
    cmpTuple([x.from, x.kind, x.to], [y.from, y.kind, y.to])
  );
  for (const e of edges) e.facts.sort((a, b) => cmpStr(a.fid, b.fid));
  return { edges, ungovernedCalls, droppedEdges };
}

// ---- tier* ------------------------------------------------------------------------------------

export function tierStar(ctx: Ctx, c: Claim): Tier {
  let t = c.tier;
  for (const bfp of ctx.heirOf.get(c.fp) ?? []) {
    const b = ctx.baseClaims.get(bfp);
    if (b) t = maxTier(t, b.tier);
  }
  return t;
}

function claimId(c: Claim): string {
  return c.ids[0] ?? c.fp;
}

// ---- authority and effect forbids ------------------------------------------------------------------

export function effectSites(
  ctx: Ctx,
  facts: WFact[]
): { x: string; pos: string; atom: string; f: WFact }[] {
  const W = ctx.Wh;
  const out: { x: string; pos: string; atom: string; f: WFact }[] = [];
  for (const f of facts) {
    if (f.type === "effect" && f.at && f.verb && f.resource) {
      const l = liftEffect(W, f.verb, f.resource);
      if (l) out.push({ x: f.at, pos: W.att(f.at), atom: l.atom, f });
    } else if (f.type === "hatch" && f.at && f.kind) {
      out.push({ x: f.at, pos: W.att(f.at), atom: liftHatch(W, f.kind), f });
    } else if (f.declared && f.atom && f.unit && f.kind !== "call" && !f.to) {
      out.push({ x: f.at ?? `unit:${f.unit}`, pos: f.unit, atom: f.atom, f });
    }
  }
  return out;
}

export function evalEffects(ctx: Ctx, facts: WFact[], errors: ShapeError[]): Contra[] {
  const W = ctx.Wh;
  const subjects = new Map<string, { x: string; pos: string; atom: string; facts: WFact[] }>();
  for (const s of effectSites(ctx, facts)) {
    if (permitted(W, s.pos, s.atom)) continue;
    const k = JSON.stringify([s.x, s.atom]);
    const e = subjects.get(k) ?? { x: s.x, pos: s.pos, atom: s.atom, facts: [] };
    e.facts.push(s.f);
    subjects.set(k, e);
  }
  const out: Contra[] = [];
  for (const [, s] of [...subjects.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const excl = excludingClaims(W, s.pos, s.atom).sort((a, b) =>
      cmpTuple(
        [-tierRank(tierStar(ctx, a)), a.op === "effect.forbid" ? 0 : 1, a.fp],
        [-tierRank(tierStar(ctx, b)), b.op === "effect.forbid" ? 0 : 1, b.fp]
      )
    );
    const claim = excl[0];
    if (!claim) continue;
    const subject = { code: s.x, atom: s.atom };
    const decl = s.facts.filter((f) => f.declared);
    const causes: Cause[] = [];
    const w = bestFact(s.facts);
    const where = s.x.startsWith("unit:") ? s.x.slice(5) : idToSourceRef(s.x);
    causes.push({ type: "fact", id: w.fid, text: factText(w) });
    if (w.type === "effect" && w.resource) {
      const r = parseAtom(s.atom)?.resource ?? "";
      causes.push({ type: "binding", id: `resource ${r}`, text: `${r} binds ${w.resource}` });
    }
    causes.push({ type: "code", id: s.x, text: `${where} is attributed to ${s.pos}` });
    for (const o of excl.slice(1))
      causes.push({ type: "claim", id: o.fp, text: `${claimId(o)} also excludes it` });
    if (decl.length > 0) {
      errors.push({
        code: "E-conduct",
        subject: `${claimId(claim)} ${JSON.stringify(subject)}`,
        message: `${s.pos} declares ${s.atom}, which ${claimId(claim)} excludes`,
        causes,
        dischargers: [
          { act: "edit-shape", by: "author", agentSafe: true, eligible: [], creates: null }
        ]
      });
      continue;
    }
    out.push({
      claim,
      subject,
      force: w.presenceSound ? "sound" : "heuristic",
      witness: [w],
      support: s.facts,
      supportCode: sortedUniq(s.facts.flatMap((f) => (f.at ? [f.at] : []))),
      excluding: excl,
      tierStar: maxTier(...excl.map((c) => tierStar(ctx, c))),
      causes,
      message: `${where} (in ${s.pos}) performs ${s.atom}${w.resource ? ` on ${w.resource}` : ""}. ${claimId(claim)} forbids it.`,
      refuted: false
    });
  }
  return out;
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

// ---- reach and conduct ------------------------------------------------------------------------------

export function reach(ctx: Ctx, from: string[]): Map<string, WFact[]> {
  // shortest call chains by (heuristic, observed, length) from any start identity
  const best = new Map<string, { cost: [number, number, number]; chain: WFact[] }>();
  const queue: { x: string; cost: [number, number, number]; chain: WFact[] }[] = from.map((x) => ({
    x,
    cost: [0, 0, 0],
    chain: []
  }));
  while (queue.length > 0) {
    queue.sort((a, b) => cmpTuple([...a.cost, a.x], [...b.cost, b.x]));
    const cur = queue.shift() as { x: string; cost: [number, number, number]; chain: WFact[] };
    if (best.has(cur.x)) continue;
    best.set(cur.x, { cost: cur.cost, chain: cur.chain });
    for (const c of ctx.calls.get(cur.x) ?? []) {
      if (best.has(c.to)) continue;
      const fc = factCost(c.fact);
      queue.push({
        x: c.to,
        cost: [cur.cost[0] + fc[0], cur.cost[1] + fc[1], cur.cost[2] + 1],
        chain: [...cur.chain, c.fact]
      });
    }
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.chain]));
}

export function inClosure(w: World, atoms: string[], atom: string): boolean {
  const a = parseAtom(atom);
  if (!a) return false;
  return atoms.some((c) => {
    const p = parseAtom(c);
    return !!p && p.resource === a.resource && impl(w, p.verb, a.verb);
  });
}

export function evalUpper(ctx: Ctx, facts: WFact[], errors: ShapeError[]): Contra[] {
  const W = ctx.Wh;
  const out: Contra[] = [];
  const sites = effectSites(ctx, facts).filter((s) => !(parseAtom(s.atom)?.resource === TRUST));
  const sitesAt = new Map<string, typeof sites>();
  for (const s of sites) {
    const k = s.f.declared ? (s.f.at ?? `unit:${s.f.unit}`) : s.x;
    sitesAt.set(k, [...(sitesAt.get(k) ?? []), s]);
  }
  for (const c of ctx.head.claims) {
    if (c.op !== "effects.upper") continue;
    const u = String(c.args.unit);
    const C = c.args.atoms as string[];
    const start = [...(W.codeOfPos.get(u) ?? [])];
    const r = reach(ctx, start);
    const keys = [...r.keys(), ...(W.unitBind.get(u) ? [] : [`unit:${u}`])];
    const subjects = new Map<string, { atom: string; options: { f: WFact; chain: WFact[] }[] }>();
    for (const x of keys) {
      for (const s of sitesAt.get(x) ?? []) {
        if (s.f.declared && s.f.unit === u) continue;
        if (inClosure(W, C, s.atom)) continue;
        const e = subjects.get(s.atom) ?? { atom: s.atom, options: [] };
        e.options.push({ f: s.f, chain: r.get(x) ?? [] });
        subjects.set(s.atom, e);
      }
    }
    for (const [atom, s] of [...subjects.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
      const scored = s.options
        .map((o) => {
          const all = [...o.chain, o.f];
          const h = all.filter((f) => !f.declared && !f.presenceSound).length;
          const ob = all.filter((f) => f.observed).length;
          return {
            o,
            all,
            key: [h, ob, all.length, ...all.map((f) => f.fid)] as (string | number)[]
          };
        })
        .sort((a, b) => cmpTuple(a.key, b.key));
      const w = scored[0];
      if (!w) continue;
      const subject = { unit: u, atom };
      const causes: Cause[] = w.all.map((f) => ({
        type: "fact" as const,
        id: f.fid,
        text: factText(f)
      }));
      if (w.all.every((f) => f.declared)) {
        errors.push({
          code: "E-conduct",
          subject: `${claimId(c)} ${JSON.stringify(subject)}`,
          message: `${u}'s complete summary omits ${atom}, which W_decl gives it`,
          causes,
          dischargers: [
            { act: "edit-shape", by: "author", agentSafe: true, eligible: [], creates: null }
          ]
        });
        continue;
      }
      const support = s.options.flatMap((o) => [...o.chain, o.f]);
      out.push({
        claim: c,
        subject,
        force: w.all.every((f) => f.declared || f.presenceSound) ? "sound" : "heuristic",
        witness: w.all,
        support,
        supportCode: sortedUniq(support.flatMap((f) => (f.at ? [f.at] : []))),
        excluding: [c],
        tierStar: tierStar(ctx, c),
        causes,
        message: `calling ${u} may cause ${atom}, outside its complete summary ${claimId(c)}.`,
        refuted: false
      });
    }
  }
  return out;
}

// ---- footprints and channels ---------------------------------------------------------------------

export function boundCodes(w: World): string[] {
  return sortedUniq(w.esf.resources.flatMap((r) => r.bind));
}

export function chanOfAtom(w: World, atom: string): string[] {
  const a = parseAtom(atom);
  if (!a) return [];
  if (a.resource === TRUST) {
    const langs = new Set<string>();
    for (const [h, lang] of w.hatchKinds) if (impl(w, h, a.verb)) langs.add(lang);
    return [...langs].sort(cmpStr).map((l) => `hatch(${l})`);
  }
  const r = w.esf.resources.find((x) => x.q === a.resource);
  return (r?.bind ?? []).map((t) => `effect(${t})`);
}

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

export function unitsOfSel(w: World, sels: string[]): string[] {
  return w.positions.filter((p) => sels.some((s) => inUnitSel(s, p)));
}

export function governedCode(w: World): string[] {
  const out: string[] = [];
  for (const [p, xs] of w.codeOfPos) if (p !== UNGOVERNED) out.push(...xs);
  return out.sort(cmpStr);
}

/** F(c) and T(c) for a checker-decided claim under a world (A.4.5.1-2). */
export function footprint(ctx: Ctx, w: World, c: Claim): { code: string[]; channels: string[] } {
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
    case "effects.lower": {
      const u = String(c.args.unit);
      const r = reach(ctx, [...(w.codeOfPos.get(u) ?? [])]);
      return {
        code: sortedUniq(r.keys()),
        channels: ["call(*)", ...boundCodes(w).map((t) => `effect(${t})`)]
      };
    }
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

/** Does channel t apply to identity x (A.4.5.3)? Returns the instantiated channel or null. */
export function channelAt(t: string, info: IdentityInfo): string | null {
  const registered = info.lang === "ts" || info.lang === "rust" || info.lang === "verus";
  const command = info.lang === "pkgjson" || info.lang === "gha";
  const rawExec = info.lang === "raw" && info.executable;
  const executable = registered || rawExec || (command && info.executable);
  if (t === "call(*)") return registered ? `call(${info.lang})` : null;
  const call = /^call\((\w+)\)$/.exec(t);
  if (call) return info.lang === call[1] ? t : null;
  const hatch = /^hatch\((\w+)\)$/.exec(t);
  if (hatch) return info.lang === hatch[1] ? t : null;
  const eff = /^effect\((.+)\)$/.exec(t);
  if (eff) {
    const rc = eff[1] ?? "";
    const car = carriers(rc);
    if (registered && (car.langs === "all" || car.langs.has(info.lang))) return t;
    if ((rawExec || (command && info.executable)) && car.rawCarrier) return t;
    const ext = info.path.split(".").pop() ?? "";
    if (info.lang === "raw" && car.rawExts.includes(ext)) return t;
    void parseResourceCode;
    return null;
  }
  if (t.startsWith("edge(")) return executable ? t : null;
  return null;
}

// ---- refutation of lower bounds -----------------------------------------------------------------------

function entryFor(
  ctx: Ctx,
  x: string
): { provider: string; record: string; producerChanged: boolean }[] {
  const out: { provider: string; record: string; producerChanged: boolean }[] = [];
  for (const a of ancestorsOrSelf(ctx.Mh, x)) {
    for (const e of ctx.obsEntries.get(a) ?? []) if (e.entry.complete) out.push(e);
  }
  return out;
}

/** Footprint identities each covered by a usable complete entry on an applicable channel from a
 *  provider absence-sound in the given direction. */
export function fullyObserved(
  ctx: Ctx,
  code: string[],
  channels: string[],
  dir: "a" | "b"
): { ok: boolean; covered: string[] } {
  const covered: string[] = [];
  let any = false;
  for (const x of code) {
    const info = ctx.Mh.ids.get(x);
    if (!info) continue;
    const needed = channels.map((t) => channelAt(t, info)).filter((t): t is string => t !== null);
    if (needed.length === 0) continue;
    any = true;
    const es = entryFor(ctx, x).filter((e) => {
      const g = ctx.provs.get(e.provider);
      if (!g) return false;
      if (dir === "b" && e.producerChanged) return false;
      return dir === "a" ? g.absenceA : g.absenceB;
    });
    const ok = needed.every((t) =>
      es.some((e) => {
        const g = ctx.provs.get(e.provider);
        return !!g && channelCovered(dir === "a" ? g.channelsA : g.channelsB, t);
      })
    );
    if (!ok) return { ok: false, covered };
    covered.push(x);
  }
  return { ok: any, covered };
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
      const fp = footprint(ctx, W, c);
      const obs = fullyObserved(ctx, fp.code, fp.channels, "a");
      if (!obs.ok) continue;
      const inReach = new Set(fp.code);
      for (const entry of c.args.atoms as string[]) {
        const atom = entry.split(" via ")[0] as string;
        const a = parseAtom(atom);
        if (!a) continue;
        const present = observedSites.some((s) => {
          const b = parseAtom(s.atom);
          return inReach.has(s.x) && !!b && b.resource === a.resource && impl(W, b.verb, a.verb);
        });
        if (present) continue;
        out.push({
          claim: c,
          subject: { unit: String(c.args.unit), atom },
          force: "sound",
          witness: [],
          support: [],
          supportCode: obs.covered,
          excluding: [c],
          tierStar: tierStar(ctx, c),
          causes: [
            {
              type: "claim",
              id: c.fp,
              text: `complete absence-sound entries cover ${obs.covered.length} identities and none reports ${atom}`
            }
          ],
          message: `${c.args.unit} is declared to cause ${atom}, but complete observations of its reach report none.`,
          refuted: true
        });
      }
    } else if (c.op === "edge.exists") {
      const fp = footprint(ctx, W, c);
      const obs = fullyObserved(ctx, fp.code, fp.channels, "a");
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
        tierStar: tierStar(ctx, c),
        causes: [
          {
            type: "claim",
            id: c.fp,
            text: `complete absence-sound entries cover ${obs.covered.length} identities of ${c.args.from} and report no ${c.args.kind} edge to ${c.args.to}`
          }
        ],
        message: `${claimId(c)}: no ${c.args.kind} edge ${c.args.from} -> ${c.args.to} is observed where observation is complete.`,
        refuted: true
      });
    }
  }
  return out;
}

// ---- structure ----------------------------------------------------------------------------------------

function edgeCost(e: Edge): [number, number] {
  const f = bestFact(e.facts);
  return factCost(f);
}

function pathCost(path: Edge[]): (number | string)[] {
  let h = 0;
  let o = 0;
  for (const e of path) {
    const [a, b] = edgeCost(e);
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
      if (cur.path.some((p) => p.from === e.to)) continue;
      queue.push({ n: e.to, path: [...cur.path, e] });
    }
  }
  return best;
}

function sccs(nodes: string[], edges: Edge[]): string[][] {
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
      if (comp.length > 1) out.push(comp.sort(cmpStr));
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
    support: WFact[],
    what: string
  ): void => {
    const wfacts = witness.map((e) => bestFact(e.facts));
    const causes: Cause[] = wfacts.map((f) => ({
      type: "fact" as const,
      id: f.fid,
      text: factText(f)
    }));
    if (wfacts.every((f) => f.declared)) {
      errors.push({
        code: "E-structure",
        subject: `${claimId(c)} ${JSON.stringify(subject)}`,
        message: `declared structure violates ${claimId(c)}: ${what}`,
        causes,
        dischargers: [
          { act: "edit-shape", by: "author", agentSafe: true, eligible: [], creates: null }
        ]
      });
      return;
    }
    out.push({
      claim: c,
      subject,
      force: wfacts.every((f) => f.declared || f.presenceSound) ? "sound" : "heuristic",
      witness: wfacts,
      support,
      supportCode: sortedUniq(support.flatMap((f) => (f.at ? [f.at] : []))),
      excluding: [c],
      tierStar: tierStar(ctx, c),
      causes,
      message: `${what}. ${claimId(c)} forbids it.`,
      refuted: false
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
        emit(c, { from: e.from, to: e.to }, [e], e.facts, `${e.kind} edge ${e.from} -> ${e.to}`);
      }
    } else if (c.op === "path.forbid") {
      const K = new Set(c.args.kinds as string[]);
      const S = nodeSet(W, c.args.from as string[]);
      const T = nodeSet(W, c.args.to as string[]);
      const V = nodeSet(W, c.args.exceptVia as string[]);
      const kEdges = edges.filter((e) => K.has(e.kind));
      for (const s of [...S].sort(cmpStr)) {
        if (V.has(s)) continue;
        const sp = shortestPaths(s, kEdges, (n) => !V.has(n) && !S.has(n) && !T.has(n));
        for (const t of [...T].sort(cmpStr)) {
          if (t === s) continue;
          const p = sp.get(t);
          if (!p) continue;
          // support: K-edges (a,b) with a reachable from s and t reachable from b through allowed interiors
          const fwd = new Set([
            s,
            ...[...sp.keys()].filter((n) => !V.has(n) && !S.has(n) && !T.has(n))
          ]);
          const back = new Set<string>([t]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const e of kEdges)
              if (
                back.has(e.to) &&
                !back.has(e.from) &&
                !V.has(e.from) &&
                !T.has(e.from) &&
                (e.from === s || !S.has(e.from))
              ) {
                back.add(e.from);
                grew = true;
              }
          }
          const support = kEdges
            .filter((e) => fwd.has(e.from) && back.has(e.to))
            .flatMap((e) => e.facts);
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
          inner.flatMap((e) => e.facts),
          `cycle ${[n, ...best.map((e) => e.to)].join(" -> ")}`
        );
      }
    }
  }
  return out;
}

export { covers, tierRank };
