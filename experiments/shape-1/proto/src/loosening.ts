// The loosening decider: L0–L7 with counterexamples (A.8). L1 over identities and cells, L2
// summaries, L3 structure (heirs, the G_A single-edge test, then a budgeted DFS), L4 laws, L6
// jurisdiction tuples, L7 governance orders.
import { type Edge, inClosure, reach } from "./checker.ts";
import type { Ctx } from "./context.ts";
import { type CellSide, cellId, computeCells } from "./globs.ts";
import { jcs } from "./jcs.ts";
import { type Claim, type JsonValue, TRUST, parseAtom } from "./model.ts";
import { renameArgs } from "./strength.ts";
import { type Tier, cmpStr, cmpTuple, levelRank, maxTier, sortedUniq, tierRank } from "./util.ts";
import {
  UNGOVERNED,
  type World,
  compCode,
  impl,
  inA,
  nodeSet,
  posComp,
  protectingForbids
} from "./world.ts";

export interface LoosePart {
  question: "L0" | "L1" | "L2" | "L3" | "L4" | "L6" | "L7";
  subject: string;
  answer: "loosened" | "undecided";
  affected: string[];
  delta: string[];
  counterexample: JsonValue;
  exploited: boolean;
  /** channels for the coverage route of `exploited` */
  channels: string[];
  realisedBy: string[];
}

export const L3_BUDGET = 1_000_000;

const CELL_PREFIX = "cell:";

function sideStr(v: CellSide): string {
  return typeof v === "string" ? v : v.join("|");
}

/** atom universe per resource code: ordinary verbs for codes, hatch verbs for Trust */
function verbsFor(Wb: World, Wh: World, trust: boolean): string[] {
  const all = new Set<string>([...Wb.upOf.keys(), ...Wh.upOf.keys()]);
  const isHatch = (v: string): boolean => impl(Wb, v, "Hatch") || impl(Wh, v, "Hatch");
  return [...all].filter((v) => (trust ? isHatch(v) : !isHatch(v))).sort(cmpStr);
}

export interface LooseningInput {
  ctx: Ctx;
  edgesHead: Edge[];
  declaredEdges: Edge[];
  coverageUncovered: (x: string, channels: string[]) => boolean;
  blocksCoverage: (tier: Tier) => boolean;
}

export function decideLoosening(inp: LooseningInput): { parts: LoosePart[]; cells: { id: string; example: string }[]; l3Units: number } {
  const { ctx } = inp;
  const parts: LoosePart[] = [];
  if (!ctx.hasBase) return { parts, cells: [], l3Units: 0 };
  if (ctx.baseUnreadable || !ctx.base || !ctx.Wb) {
    parts.push({ question: "L0", subject: "shape", answer: "undecided", affected: [], delta: ["L0 unreadable"], counterexample: null, exploited: false, channels: [], realisedBy: [] });
    return { parts, cells: [], l3Units: 0 };
  }
  const Wb = ctx.Wb;
  const Wh = ctx.Wh;
  const rhoInv = new Map<string, string>();
  for (const [b, h] of ctx.rho) rhoInv.set(h, b);

  // ---- cells ------------------------------------------------------------------------------------
  const owners = [
    ...Wb.globOwners.map((o) => ({ side: "b" as const, glob: o.glob, owner: o.owner })),
    ...Wh.globOwners.map((o) => ({ side: "h" as const, glob: o.glob, owner: o.owner }))
  ];
  const cellRes = computeCells(owners);
  const cells = cellRes.cells.map((c) => ({ id: cellId(c.b, c.h), b: c.b, h: c.h, example: c.example }));
  const cellExample = new Map(cells.map((c) => [c.id, c.example]));
  for (const c of cells) if (Array.isArray(c.h)) ctx.errors.push({ code: "E-overlap", subject: `cell ${c.id}`, message: `equally specific head globs of ${c.h.join(", ")} intersect (e.g. ${c.example})`, causes: [], dischargers: [] });

  // ---- facts for exploitation -------------------------------------------------------------------------
  const factsAt = new Map<string, { atom: string; fid: string }[]>();
  for (const f of ctx.facts) {
    let at: string | null = null;
    let atom: string | null = null;
    if (f.type === "effect" && f.at && f.verb && f.resource) {
      const r = Wh.resOfCode.get(f.resource);
      if (r) {
        at = f.at;
        atom = `${f.verb}<${r}>`;
      }
    } else if (f.type === "hatch" && f.at && f.kind) {
      at = f.at;
      atom = `${Wh.hatchKinds.has(f.kind) ? f.kind : "Hatch"}<${TRUST}>`;
    } else if (f.declared && f.atom && f.unit && !f.to && f.kind !== "call") {
      at = f.at ?? `unit:${f.unit}`;
      atom = f.atom;
    }
    if (at && atom) factsAt.set(at, [...(factsAt.get(at) ?? []), { atom, fid: f.fid }]);
  }
  const realising = (x: string, atomH: string): string[] => {
    const a = parseAtom(atomH);
    if (!a) return [];
    return (factsAt.get(x) ?? [])
      .filter((f) => {
        const b = parseAtom(f.atom);
        return !!b && b.resource === a.resource && impl(Wh, b.verb, a.verb);
      })
      .map((f) => f.fid)
      .sort(cmpStr);
  };

  // ---- L1 NoNewEffect --------------------------------------------------------------------------------
  const codes = sortedUniq([...Wb.esf.resources.flatMap((r) => r.bind), ...Wh.esf.resources.flatMap((r) => r.bind)]);
  const unboundRes = sortedUniq([
    ...Wb.esf.resources.filter((r) => r.bind.length === 0 && !r.q.startsWith("std::")).map((r) => r.q),
    ...Wh.esf.resources.filter((r) => r.bind.length === 0 && !r.q.startsWith("std::")).map((r) => rhoInv.get(r.q) ?? r.q)
  ]);
  type T = { key: string; resB: string | null; resH: string | null; trust: boolean; hintH?: string | null; unmapped?: boolean };
  const Ts: T[] = [
    ...codes.map((t) => ({ key: t, resB: Wb.resOfCode.get(t) ?? null, resH: Wh.resOfCode.get(t) ?? null, trust: false })),
    ...unboundRes.map((q) => {
      const hq = ctx.rho.get(q) ?? q;
      const resB = Wb.esf.resources.some((r) => r.q === q) ? q : null;
      const hint = ctx.hints.get(q) ?? null;
      return {
        key: `res:${q}`,
        resB,
        resH: Wh.esf.resources.some((r) => r.q === hq) ? hq : null,
        trust: false,
        unmapped: resB !== null && ctx.unmapped.has(q),
        hintH: hint && Wh.esf.resources.some((r) => r.q === hint) ? hint : null
      };
    }),
    { key: "trust", resB: TRUST, resH: TRUST, trust: true }
  ];
  const verbsOrd = verbsFor(Wb, Wh, false);
  const verbsTrust = verbsFor(Wb, Wh, true);
  const positions: { x: string; pb: string; ph: string; isCell: boolean }[] = [
    ...[...ctx.Mh.ids.keys()].sort(cmpStr).map((x) => ({ x, pb: Wb.att(x), ph: Wh.att(x), isCell: false })),
    ...cells.map((c) => ({ x: c.id, pb: sideStr(c.b), ph: sideStr(c.h), isCell: true }))
  ];
  const l1 = new Map<string, LoosePart>();
  let sink = l1;
  const addL1 = (subject: string, x: string, delta: string, atomH: string, chan: string[]): void => {
    const p =
      sink.get(subject) ??
      ({ question: "L1", subject, answer: "loosened", affected: [], delta: [], counterexample: null, exploited: false, channels: [], realisedBy: [] } as LoosePart);
    if (!p.affected.includes(x)) p.affected.push(x);
    if (!p.delta.includes(delta)) p.delta.push(delta);
    for (const c of chan) if (!p.channels.includes(c)) p.channels.push(c);
    const rs = x.startsWith(CELL_PREFIX) ? [] : realising(x, atomH);
    for (const r of rs) if (!p.realisedBy.includes(r)) p.realisedBy.push(r);
    if (rs.length === 0 && p.counterexample === null) {
      const cell = x.startsWith(CELL_PREFIX) ? cellExample.get(x) : undefined;
      p.counterexample = cell !== undefined ? { position: x, path: cell, atom: atomH } : { position: x, atom: atomH };
    }
    sink.set(subject, p);
  };
  // Perm and Lvl depend only on (position, resource) and on whether the shape mentions the
  // resource in a forbid or grant; profiles are memoised and unmentioned resources are O(1).
  interface Profile {
    constant: "all" | "none" | null;
    perm: Set<string>;
    inA: Set<string>;
    lvl: Map<string, { tier: Tier; forbids: Claim[] }>;
  }
  const mentioned = (w: World): Set<string> => {
    const out = new Set<string>([TRUST]);
    for (const f of w.forbids) {
      const a = parseAtom(String(f.args.atom));
      if (a) out.add(a.resource);
    }
    for (const c of w.esf.components) for (const g of c.grants ?? []) {
      const a = parseAtom(g);
      if (a) out.add(a.resource);
    }
    return out;
  };
  const mentionedB = mentioned(Wb);
  const mentionedH = mentioned(Wh);
  const memo = new Map<string, Profile>();
  const profile = (w: World, side: "b" | "h", pos: string, res: string | null, verbs: string[]): Profile => {
    if (res === null) return { constant: "all", perm: new Set(verbs), inA: new Set(verbs), lvl: new Map() };
    const m = side === "b" ? mentionedB : mentionedH;
    if (!m.has(res)) {
      const open = inA(w, pos, `Read<${res}>`) || inA(w, pos, `__probe__<${res}>`);
      return open ? { constant: "all", perm: new Set(verbs), inA: new Set(verbs), lvl: new Map() } : { constant: "none", perm: new Set(), inA: new Set(), lvl: new Map() };
    }
    const key = `${side}\u0000${pos}\u0000${res}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const perm = new Set<string>();
    const inASet = new Set<string>();
    const lv = new Map<string, { tier: Tier; forbids: Claim[] }>();
    for (const v of verbs) {
      const atom = `${v}<${res}>`;
      const a = inA(w, pos, atom);
      const fs = protectingForbids(w, pos, atom);
      if (a) inASet.add(v);
      if (a && fs.length === 0) perm.add(v);
      if (fs.length > 0) lv.set(v, { tier: maxTier(...fs.map((f) => f.tier)), forbids: fs });
    }
    const pr: Profile = { constant: null, perm, inA: inASet, lvl: lv };
    memo.set(key, pr);
    return pr;
  };
  const groups = new Map<string, { pb: string; ph: string; xs: string[] }>();
  for (const pos of positions) {
    const k = `${pos.pb}\u0000${pos.ph}`;
    const g = groups.get(k) ?? { pb: pos.pb, ph: pos.ph, xs: [] };
    g.xs.push(pos.x);
    groups.set(k, g);
  }
  const evalT = (g: { pb: string; ph: string; xs: string[] }, t: T): void => {
    const pbs = g.pb.split("|");
    {
      const verbs = t.trust ? verbsTrust : verbsOrd;
      const pB = pbs.map((p) => profile(Wb, "b", p, t.resB, verbs));
      const pH = profile(Wh, "h", g.ph, t.resH, verbs);
      // no base protection (all base profiles constant) and nothing to gain: skip
      if (pB.every((p) => p.constant !== null) && (pH.constant === "none" || pB.every((p) => p.constant === "all"))) return;
      const chan = t.trust ? [] : [`effect(${t.key})`];
      for (const v of verbs) {
        const shownAtom = t.resB ? `${v}<${t.resB}>` : `${v}<${t.key}>`;
        const atomH = t.resH ? `${v}<${t.resH}>` : shownAtom;
        const permB = pB.every((p) => p.perm.has(v));
        const permH = pH.perm.has(v);
        const lvlB = maxNullable(pB.map((p) => p.lvl.get(v)?.tier ?? null));
        const lvlH = pH.lvl.get(v)?.tier ?? null;
        if (t.resB && lvlB && (lvlH === null || tierRank(lvlH) < tierRank(lvlB))) {
          for (const p of pB) {
            for (const f of p.lvl.get(v)?.forbids ?? []) {
              if (lvlH !== null && tierRank(lvlH) >= tierRank(f.tier)) continue;
              for (const x of g.xs) addL1(f.fp, x, `L1 level ${shownAtom} ${f.tier}>${lvlH ?? "none"}`, atomH, chan);
            }
          }
        }
        if (permH && !permB) {
          const aB = pB.every((p) => p.inA.has(v));
          const aH = pH.inA.has(v);
          if (aH && !aB) {
            pbs.forEach((p, i) => {
              const k = posComp(p);
              if (k && t.resB && !pB[i]?.inA.has(v)) for (const x of g.xs) addL1(`component ${k}`, x, `L1 authority+ ${shownAtom}`, atomH, chan);
            });
          }
        }
      }
    }
  };
  // A.8.1.6: failures involving base items unmapped by ρ rules 0–2 are undecided unless they
  // also fail under the rule-3 hint (loosened); the hint never implies.
  const plainUnmapped = new Map<string, LoosePart>();
  const sortedGroups = [...groups.values()].sort((a, b) => cmpStr(`${a.pb}|${a.ph}`, `${b.pb}|${b.ph}`));
  for (const g of sortedGroups) {
    for (const t of Ts) {
      if (t.unmapped) {
        sink = plainUnmapped;
        evalT(g, t);
        sink = l1;
        if (t.hintH) evalT(g, { ...t, resH: t.hintH });
      } else evalT(g, t);
    }
  }
  for (const [subject, p] of plainUnmapped) {
    if (l1.has(subject)) continue;
    l1.set(subject, { ...p, answer: "undecided", delta: [...p.delta, ...[...ctx.unmapped].filter((q) => p.delta.some((d) => d.includes(`<${q}>`) || d.includes(`res:${q}`))).map((q) => `L1 unmapped ${q}`)] });
  }
  for (const p of l1.values()) {
    p.affected.sort(cmpStr);
    p.delta.sort(cmpStr);
    p.realisedBy.sort(cmpStr);
    if (p.realisedBy.length > 0) p.counterexample = p.realisedBy[0] as string;
    parts.push(p);
  }

  // ---- heirs and per-claim questions ----------------------------------------------------------------
  const baseClaims = ctx.base.claims;
  const rhoHinted = new Map([...ctx.rho, ...ctx.hints]);
  const unmappedIn = (cb: Claim): string[] => [...ctx.unmapped].filter((q) => new RegExp(`(^|[^\\w:.])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`).test(cb.nf)).sort(cmpStr);
  for (const cb of baseClaims) {
    const heirs = ctx.heirs.get(cb.fp) ?? [];
    if (heirs.length > 0) continue;
    const um = unmappedIn(cb);
    const rho = um.length > 0 ? rhoHinted : ctx.rho;
    const q = cb.op === "effects.upper" ? "L2" : cb.op === "law" ? "L4" : cb.op === "edge.forbid" || cb.op === "path.forbid" || cb.op === "cycle.forbid" ? "L3" : null;
    if (!q) continue;
    let ps: LoosePart[] = [];
    if (q === "L2") ps = l2(ctx, cb, realising, rho);
    else if (q === "L3") {
      const p = l3(ctx, inp, cb, rho);
      ps = p ? [p] : [];
    } else ps = [l4(ctx, cb, rho)];
    if (um.length > 0) {
      const failed = ps.filter((p) => p.answer === "loosened");
      if (failed.length > 0) ps = failed;
      else
        ps = [
          {
            question: q,
            subject: cb.fp,
            answer: "undecided",
            affected: ps.flatMap((p) => p.affected),
            delta: [...ps.flatMap((p) => p.delta), ...um.map((x) => `${q} unmapped ${x}`)],
            counterexample: null,
            exploited: false,
            channels: ps.flatMap((p) => p.channels),
            realisedBy: []
          }
        ];
    }
    parts.push(...ps);
  }
  parts.push(...l6(ctx));
  parts.push(...l7(ctx));

  // exploited: realised counterexample, or blocking coverage tier with uncovered affected changes
  for (const p of parts) {
    if (p.question === "L0" || p.question === "L7") continue;
    if (p.realisedBy.length > 0) p.exploited = true;
    const tier = subjectTier(ctx, p.subject);
    if (!p.exploited && (inp.blocksCoverage(tier) || tier === "final")) {
      const changedAffected = p.affected.filter((x) => ctx.finest.has(x) || ctx.delta.has(x));
      if (changedAffected.some((x) => inp.coverageUncovered(x, p.channels))) p.exploited = true;
    }
  }
  return { parts: parts.sort((a, b) => cmpTuple([a.subject, a.question], [b.subject, b.question])), cells: cells.map((c) => ({ id: c.id, example: c.example })), l3Units: 0 };
}

function maxNullable(ts: (Tier | null)[]): Tier | null {
  let out: Tier | null = null;
  for (const t of ts) if (t) out = out ? maxTier(out, t) : t;
  return out;
}

// ---- L2 ------------------------------------------------------------------------------------------------

function l2(ctx: Ctx, cb: Claim, realising: (x: string, atom: string) => string[], rho: Map<string, string>): LoosePart[] {
  const Wh = ctx.Wh;
  const Wb = ctx.Wb as World;
  const u = String(cb.args.unit);
  const uh = rho.get(u) ?? u;
  const head = ctx.head.claims.find((c) => c.op === "effects.upper" && c.args.unit === uh);
  const Cb = (renameArgs(cb.args.atoms as JsonValue, rho) as string[]) ?? [];
  const code = [...(Wh.codeOfPos.get(uh) ?? [])];
  const out: LoosePart = {
    question: "L2",
    subject: cb.fp,
    answer: "loosened",
    affected: code,
    delta: [],
    counterexample: null,
    exploited: false,
    channels: ["call(*)", ...sortedUniq(Wh.esf.resources.flatMap((r) => r.bind)).map((t) => `effect(${t})`)],
    realisedBy: []
  };
  if (head) {
    for (const a of head.args.atoms as string[]) if (!inClosure(Wh, Cb, a)) out.delta.push(`L2 +${a}`);
    if (out.delta.length === 0) return [];
  } else {
    if (!Wb.unitBind.get(u)) return [];
    const unit = ctx.head.units.find((x) => x.q === uh);
    out.delta.push(!unit ? "L2 removed" : unit.summary?.mode === "partial" ? "L2 partial" : unit.summary ? "L2 removed" : "L2 unknown");
  }
  // realised: an atom of Xt(ρu) outside cl_b(C_b)
  const r = reach(ctx, code);
  for (const x of r.keys()) {
    for (const f of ctx.facts) {
      if (f.at !== x || f.type !== "effect" || !f.verb || !f.resource) continue;
      const res = Wh.resOfCode.get(f.resource);
      if (!res) continue;
      const atom = `${f.verb}<${res}>`;
      if (!inClosure(Wh, Cb, atom)) out.realisedBy.push(...realising(x, atom));
    }
  }
  out.realisedBy = sortedUniq(out.realisedBy);
  if (out.realisedBy.length > 0) out.counterexample = out.realisedBy[0] as string;
  out.delta.sort(cmpStr);
  return [out];
}

// ---- L3 ------------------------------------------------------------------------------------------------

interface SEdge {
  from: string;
  kind: string;
  to: string;
}

function structuralViolations(c: { op: string; args: Record<string, JsonValue> }, w: World, edges: SEdge[]): boolean {
  const ns = (x: JsonValue | undefined): Set<string> => nodeSet(w, (x as string[]) ?? []);
  if (c.op === "edge.forbid") {
    const S = ns(c.args.from);
    for (const x of ns(c.args.exceptFrom)) S.delete(x);
    const T = ns(c.args.to);
    for (const y of ns(c.args.exceptTo)) T.delete(y);
    return edges.some((e) => e.kind === c.args.kind && S.has(e.from) && T.has(e.to));
  }
  const K = new Set((c.args.kinds as string[]) ?? []);
  const kE = edges.filter((e) => K.has(e.kind));
  const adj = new Map<string, string[]>();
  for (const e of kE) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  if (c.op === "cycle.forbid") {
    const state = new Map<string, number>();
    const dfs = (v: string): boolean => {
      state.set(v, 1);
      for (const w2 of adj.get(v) ?? []) {
        const s = state.get(w2);
        if (s === 1) return true;
        if (s === undefined && dfs(w2)) return true;
      }
      state.set(v, 2);
      return false;
    };
    for (const v of adj.keys()) if (!state.has(v) && dfs(v)) return true;
    return false;
  }
  if (c.op === "path.forbid") {
    const S = ns(c.args.from);
    const T = ns(c.args.to);
    const V = ns(c.args.exceptVia);
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

function l3(ctx: Ctx, inp: LooseningInput, cb: Claim, rho: Map<string, string>): LoosePart | null {
  const Wh = ctx.Wh;
  const ren = { op: cb.op, args: renameArgs(cb.args, rho) as Record<string, JsonValue> };
  const headStruct = ctx.head.claims.filter((c) => c.op === "edge.forbid" || c.op === "path.forbid" || c.op === "cycle.forbid");
  const decl: SEdge[] = inp.declaredEdges.map((e) => ({ from: e.from, kind: e.kind, to: e.to }));
  const kindsB = cb.op === "edge.forbid" ? [String(cb.args.kind)] : ((cb.args.kinds as string[]) ?? []);
  const sharing = headStruct.filter((c) => {
    const ks = c.op === "edge.forbid" ? [String(c.args.kind)] : ((c.args.kinds as string[]) ?? []);
    return ks.some((k) => kindsB.includes(k));
  });
  const delta = sharing.map((c) => `L3 head ${c.fp}`).sort(cmpStr);
  const kindsDecl = new Map(Wh.esf.kinds.map((k) => [k.name, k]));
  const comps = Wh.esf.components.filter((c) => !c.q.startsWith("std::")).map((c) => c.q).sort(cmpStr);
  const ress = Wh.esf.resources.filter((r) => !r.q.startsWith("std::")).map((r) => r.q).sort(cmpStr);
  const declKey = new Set(decl.map((e) => `${e.from}|${e.kind}|${e.to}`));
  const headOk = (es: SEdge[]): boolean => !headStruct.some((c) => structuralViolations(c, Wh, es));
  // (1) G_A: W_decl(head) plus each type-correct new edge that alone keeps every head upper bound
  const GA: SEdge[] = [...decl];
  for (const k of [...kindsB].sort(cmpStr)) {
    const kd = kindsDecl.get(k);
    if (!kd) continue;
    const froms = kd.from === "component" ? comps : ress;
    const tos = kd.to === "component" ? comps : ress;
    for (const s of froms) for (const t of tos) {
      if (s === t || declKey.has(`${s}|${k}|${t}`)) continue;
      const e = { from: s, kind: k, to: t };
      if (headOk([...decl, e])) GA.push(e);
    }
  }
  const affectedFor = (): string[] => {
    const S = cb.op === "cycle.forbid" ? new Set(Wh.nodes) : nodeSet(Wh, (ren.args.from as string[]) ?? []);
    return sortedUniq([...S].flatMap((s) => compCode(Wh, s)));
  };
  const chans = kindsB.map((k) => (k === "calls" ? "call(*)" : `edge(${k})`));
  if (!structuralViolations(ren, Wh, GA)) return null;
  const observedEdges = new Set(inp.edgesHead.map((e) => `${e.from}|${e.kind}|${e.to}`));
  const mk = (cx: SEdge[] | null, answer: "loosened" | "undecided", units: number): LoosePart => {
    const realised = cx !== null && cx.every((e) => observedEdges.has(`${e.from}|${e.kind}|${e.to}`));
    const realisedBy = realised
      ? sortedUniq(
          (cx ?? []).flatMap((e) =>
            (inp.edgesHead.find((h) => h.from === e.from && h.kind === e.kind && h.to === e.to)?.facts ?? []).map((f) => f.fid)
          )
        )
      : [];
    return {
      question: "L3",
      subject: cb.fp,
      answer,
      affected: affectedFor(),
      delta: answer === "undecided" ? [...delta, `L3 budget ${units}`] : delta,
      counterexample: cx ? cx.map((e) => ({ from: e.from, kind: e.kind, to: e.to })) : null,
      exploited: false,
      channels: chans,
      realisedBy
    };
  };
  if (cb.op === "edge.forbid") {
    const S = nodeSet(Wh, (ren.args.from as string[]) ?? []);
    for (const x of nodeSet(Wh, (ren.args.exceptFrom as string[]) ?? [])) S.delete(x);
    const T = nodeSet(Wh, (ren.args.to as string[]) ?? []);
    for (const y of nodeSet(Wh, (ren.args.exceptTo as string[]) ?? [])) T.delete(y);
    const cx = GA.filter((e) => e.kind === ren.args.kind && S.has(e.from) && T.has(e.to)).sort((a, b) => cmpTuple([a.kind, a.from, a.to], [b.kind, b.from, b.to]))[0];
    return cx ? mk([cx], "loosened", 0) : null;
  }
  // (2) normative DFS within the budget (A.8.4.2)
  let units = 0;
  const K = new Set(kindsB);
  const gaK = GA.filter((e) => K.has(e.kind)).sort((a, b) => cmpTuple([a.from, a.kind, a.to], [b.from, b.kind, b.to]));
  const out = new Map<string, SEdge[]>();
  for (const e of gaK) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const isDecl = (e: SEdge): boolean => declKey.has(`${e.from}|${e.kind}|${e.to}`);
  let found: SEdge[] | null = null;
  let exhausted = false;
  if (cb.op === "path.forbid") {
    const S = nodeSet(Wh, (ren.args.from as string[]) ?? []);
    const T = nodeSet(Wh, (ren.args.to as string[]) ?? []);
    const V = nodeSet(Wh, (ren.args.exceptVia as string[]) ?? []);
    const dfs = (v: string, path: SEdge[], visited: Set<string>, start: string): boolean => {
      for (const e of out.get(v) ?? []) {
        units += 1;
        if (units > L3_BUDGET) {
          exhausted = true;
          return true;
        }
        if (visited.has(e.to)) continue;
        const P = [...path, e];
        if (!headOk([...decl, ...P.filter((x) => !isDecl(x))])) continue;
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
        if (!headOk([...decl, ...P.filter((x) => !isDecl(x))])) continue;
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
  if (exhausted) return mk(null, "undecided", units);
  if (found) return mk(found, "loosened", units);
  return null;
}

// ---- L4 ------------------------------------------------------------------------------------------------

function l4(ctx: Ctx, cb: Claim, rho: Map<string, string>): LoosePart {
  const sameName = ctx.head.claims.filter((c) => c.op === "law" && c.ids.some((id) => cb.ids.includes(id)));
  const sameOn = ctx.head.claims.filter(
    (c) => c.op === "law" && jcs(c.args.on) === jcs(renameArgs(cb.args.on as JsonValue, rho)) && c.statementForm === cb.statementForm
  );
  const related = sortedUniq([...sameName, ...sameOn].map((c) => c.fp));
  const removed = related.length === 0;
  const on = (renameArgs(cb.args.on as JsonValue, rho) as string[]) ?? [];
  const affected: string[] = [];
  for (const t of on) {
    if (t.startsWith("unit ")) {
      const x = ctx.Wh.unitBind.get(t.slice(5));
      if (x) affected.push(x);
    } else if (t.startsWith("component ")) affected.push(...compCode(ctx.Wh, t.slice(10)));
    else if (t.startsWith("code ")) affected.push(t.slice(5));
  }
  return {
    question: "L4",
    subject: cb.fp,
    answer: removed ? "loosened" : "undecided",
    affected: sortedUniq(affected),
    delta: removed ? ["L4 removed"] : related.map((f) => `L4 head ${f}`),
    counterexample: null,
    exploited: false,
    channels: [],
    realisedBy: []
  };
}

// ---- L6 ------------------------------------------------------------------------------------------------

interface Tuple {
  type: string;
  value: JsonValue;
  claim: Claim;
  base: boolean;
}

function conTuples(ctx: Ctx, w: World, x: string, claims: Claim[], rename: boolean): Tuple[] {
  const hinted = new Map([...ctx.rho, ...ctx.hints]);
  const pos = w.att(x);
  const comp = posComp(pos);
  const out: Tuple[] = [];
  const ns = (v: JsonValue | undefined): string[] => {
    const sels = (rename ? (renameArgs(v ?? [], hinted) as string[]) : (v as string[])) ?? [];
    return [...nodeSet(ctx.Wh, sels)].sort(cmpStr);
  };
  const ren = (v: JsonValue | undefined): JsonValue => (rename ? renameArgs(v ?? null, hinted) : (v ?? null));
  const compH = comp ? (rename ? (hinted.get(comp) ?? comp) : comp) : null;
  const unitH = rename ? (hinted.get(pos) ?? pos) : pos;
  for (const c of claims) {
    if (c.op === "path.forbid" && compH) {
      const S = ns(c.args.from);
      const T = ns(c.args.to);
      const V = ns(c.args.exceptVia);
      const K = [...(c.args.kinds as string[])].sort(cmpStr);
      if (S.includes(compH) && !V.includes(compH)) out.push({ type: "path-source", value: { T, K, V }, claim: c, base: rename });
      if (T.includes(compH)) out.push({ type: "path-target", value: { S, K, V }, claim: c, base: rename });
      if (V.includes(compH)) out.push({ type: "via", value: { S, T, K }, claim: c, base: rename });
    } else if (c.op === "edge.forbid" && compH) {
      const S = ns(c.args.from).filter((n) => !ns(c.args.exceptFrom).includes(n));
      const T = ns(c.args.to).filter((n) => !ns(c.args.exceptTo).includes(n));
      if (S.includes(compH)) out.push({ type: "edge-source", value: { k: String(c.args.kind), T }, claim: c, base: rename });
      if (T.includes(compH)) out.push({ type: "edge-target", value: { S, k: String(c.args.kind) }, claim: c, base: rename });
    } else if (c.op === "cycle.forbid" && compH) {
      out.push({ type: "cycle-member", value: { K: [...(c.args.kinds as string[])].sort(cmpStr) }, claim: c, base: rename });
    } else if (c.op === "effects.upper" && String(ren(c.args.unit as JsonValue)) === unitH) {
      out.push({ type: "summary-member", value: { C: ren(c.args.atoms as JsonValue) }, claim: c, base: rename });
    } else if (c.op === "law") {
      const on = (ren(c.args.on as JsonValue) as string[]) ?? [];
      if (on.includes(`unit ${unitH}`) || (compH && on.includes(`component ${compH}`)) || on.includes(`code ${x}`))
        out.push({ type: "law-member", value: { statement: ren(c.args.statement as JsonValue) }, claim: c, base: rename });
    }
  }
  return out;
}

function sup(a: string[], b: string[]): boolean {
  return b.every((x) => a.includes(x));
}

function dominates(ctx: Ctx, h: Tuple, b: Tuple): boolean {
  if (h.type !== b.type) return false;
  if (tierRank(h.claim.tier) < tierRank(b.claim.tier)) return false;
  const rh = h.claim.requirement;
  const rb = b.claim.requirement;
  if (rb && rh && levelRank(rh.level) < levelRank(rb.level)) return false;
  const hv = h.value as Record<string, JsonValue>;
  const bv = b.value as Record<string, JsonValue>;
  const arr = (v: JsonValue | undefined): string[] => (v as string[]) ?? [];
  switch (h.type) {
    case "path-source":
      return sup(arr(hv.T), arr(bv.T)) && sup(arr(hv.K), arr(bv.K)) && sup(arr(bv.V), arr(hv.V));
    case "path-target":
      return sup(arr(hv.S), arr(bv.S)) && sup(arr(hv.K), arr(bv.K)) && sup(arr(bv.V), arr(hv.V));
    case "edge-source":
      return hv.k === bv.k && sup(arr(hv.T), arr(bv.T));
    case "edge-target":
      return hv.k === bv.k && sup(arr(hv.S), arr(bv.S));
    case "cycle-member":
      return sup(arr(hv.K), arr(bv.K));
    case "summary-member":
      return arr(hv.C).every((a) => inClosure(ctx.Wh, arr(bv.C), a));
    default:
      return jcs(h.value) === jcs(b.value);
  }
}

function l6(ctx: Ctx): LoosePart[] {
  const Wb = ctx.Wb as World;
  const Wh = ctx.Wh;
  const parts = new Map<string, LoosePart>();
  const baseC = (ctx.base?.claims ?? []).filter((c) => ["path.forbid", "edge.forbid", "cycle.forbid", "effects.upper", "law"].includes(c.op));
  const headC = ctx.head.claims.filter((c) => ["path.forbid", "edge.forbid", "cycle.forbid", "effects.upper", "law"].includes(c.op));
  for (const x of [...ctx.Mh.ids.keys()].sort(cmpStr)) {
    const pb = Wb.att(x);
    const ph = Wh.att(x);
    const hinted = new Map([...ctx.rho, ...ctx.hints]);
    const pbH = hinted.get(pb) ?? (pb.endsWith(".*") ? `${hinted.get(pb.slice(0, -2)) ?? pb.slice(0, -2)}.*` : pb);
    if (pbH === ph) continue;
    const tb = conTuples(ctx, Wb, x, baseC, true);
    const th = conTuples(ctx, Wh, x, headC, false);
    for (const b of tb) {
      if (b.type === "via") continue;
      if (th.some((h) => dominates(ctx, h, b))) continue;
      const p =
        parts.get(b.claim.fp) ??
        ({ question: "L6", subject: b.claim.fp, answer: "loosened", affected: [], delta: [], counterexample: null, exploited: false, channels: [], realisedBy: [] } as LoosePart);
      if (!p.affected.includes(x)) p.affected.push(x);
      const d = `L6 drop ${x} ${jcs({ type: b.type, ...(b.value as Record<string, JsonValue>) })}`;
      if (!p.delta.includes(d)) p.delta.push(d);
      parts.set(b.claim.fp, p);
    }
    for (const h of th) {
      if (h.type !== "via") continue;
      if (tb.some((b) => b.type === "via" && jcs(b.value) === jcs(h.value))) continue;
      const subject = (ctx.heirOf.get(h.claim.fp) ?? [])[0] ?? h.claim.fp;
      const p =
        parts.get(subject) ??
        ({ question: "L6", subject, answer: "loosened", affected: [], delta: [], counterexample: null, exploited: false, channels: [], realisedBy: [] } as LoosePart);
      if (!p.affected.includes(x)) p.affected.push(x);
      const d = `L6 via ${x} ${jcs(h.value)}`;
      if (!p.delta.includes(d)) p.delta.push(d);
      parts.set(subject, p);
    }
    void UNGOVERNED;
  }
  return [...parts.values()].map((p) => ({ ...p, affected: p.affected.sort(cmpStr), delta: p.delta.sort(cmpStr) }));
}

// ---- L7 ------------------------------------------------------------------------------------------------

function l7(ctx: Ctx): LoosePart[] {
  const parts = new Map<string, LoosePart>();
  const base = ctx.base;
  if (!base) return [];
  const add = (subject: string, answer: "loosened" | "undecided", field: string, b: JsonValue, h: JsonValue): void => {
    const p =
      parts.get(subject) ??
      ({ question: "L7", subject, answer, affected: [], delta: [], counterexample: null, exploited: false, channels: [], realisedBy: [] } as LoosePart);
    if (answer === "loosened") p.answer = "loosened";
    p.delta.push(`L7 ${field} ${jcs(b)} ${jcs(h)}`);
    parts.set(subject, p);
  };
  // heirs must keep tier and requirement
  for (const cb of base.claims) {
    const heirs = (ctx.heirs.get(cb.fp) ?? []).map((f) => ctx.headClaims.get(f)).filter((c): c is Claim => !!c);
    if (heirs.length === 0) continue;
    const ok = heirs.some(
      (h) =>
        tierRank(h.tier) >= tierRank(cb.tier) &&
        (!cb.requirement || (h.requirement !== null && reqGeq(h.requirement, cb.requirement)))
    );
    if (!ok) {
      const best = heirs[0] as Claim;
      if (tierRank(best.tier) < tierRank(cb.tier)) add(cb.fp, "loosened", "tier", cb.tier, best.tier);
      else add(cb.fp, "loosened", "requirement", cb.requirement as unknown as JsonValue, best.requirement as unknown as JsonValue);
    }
    for (const h of heirs) if (h.owner !== cb.owner) add(cb.fp, "undecided", "owner", cb.owner, h.owner);
  }
  // policy entries
  for (const t of ["low", "normal", "critical"] as const) {
    const b = base.policy.tiers[t];
    const h = ctx.head.policy.tiers[t];
    if (!b.blocks.every((x) => h.blocks.includes(x))) add(`policy ${t}`, "loosened", "blocks", b.blocks, h.blocks);
    if (h.maxAge > b.maxAge) add(`policy ${t}`, "loosened", "max_age", b.maxAge, h.maxAge);
    if (levelRank(h.floor) < levelRank(b.floor)) add(`policy ${t}`, "loosened", "floor", b.floor, h.floor);
    if (!h.judges.every((j) => b.judges.includes(j))) add(`policy ${t}`, "loosened", "judges", b.judges, h.judges);
  }
  if (base.policy.budget !== null && (ctx.head.policy.budget === null || ctx.head.policy.budget > base.policy.budget))
    add("shape", "loosened", "budget", base.policy.budget, ctx.head.policy.budget);
  if (base.shape.owner !== "" && base.shape.owner !== ctx.head.shape.owner) add("shape", "undecided", "owner", base.shape.owner, ctx.head.shape.owner);
  // vocabulary items
  for (const kb of base.components.filter((k) => !k.q.startsWith("std::"))) {
    const kh = ctx.head.components.find((k) => k.q === (ctx.rho.get(kb.q) ?? kb.q));
    if (!kh) continue;
    const s = `component ${kb.q}`;
    if (tierRank(kh.tier) < tierRank(kb.tier)) add(s, "loosened", "tier", kb.tier, kh.tier);
    if (kh.allows.some((a) => !kb.allows.includes(a))) add(s, "loosened", "allows", kb.allows, kh.allows);
    if (kh.assumes.some((a) => !kb.assumes.some((x) => x.id === a.id))) add(s, "loosened", "assumes", kb.assumes.map((a) => a.id), kh.assumes.map((a) => a.id));
    if (kh.owner !== kb.owner) add(s, "undecided", "owner", kb.owner, kh.owner);
  }
  for (const rb of base.resources.filter((r) => !r.q.startsWith("std::"))) {
    const rh = ctx.head.resources.find((r) => r.q === (ctx.rho.get(rb.q) ?? rb.q));
    if (!rh) continue;
    if (tierRank(rh.tier) < tierRank(rb.tier)) add(`resource ${rb.q}`, "loosened", "tier", rb.tier, rh.tier);
    if (rh.owner !== rb.owner) add(`resource ${rb.q}`, "undecided", "owner", rb.owner, rh.owner);
  }
  for (const ub of base.units) {
    const uh = ctx.head.units.find((u) => u.q === (ctx.rho.get(ub.q) ?? ub.q));
    if (!uh) continue;
    if (tierRank(uh.tier) < tierRank(ub.tier)) add(`unit ${ub.q}`, "loosened", "tier", ub.tier, uh.tier);
    if (uh.owner !== ub.owner) add(`unit ${ub.q}`, "undecided", "owner", ub.owner, uh.owner);
  }
  // providers
  for (const pb of base.providers) {
    const ph = ctx.head.providers.find((p) => p.q === pb.q);
    const s = `provider ${pb.q}`;
    if (!ph) {
      add(s, "loosened", "removed", pb.q, null);
      continue;
    }
    if (ph.trusts.some((t) => !pb.trusts.some((x) => x[0] === t[0] && x[1] === t[1]))) add(s, "loosened", "trusts", pb.trusts, ph.trusts);
    const fields: (keyof typeof pb)[] = ["produces", "observes", "decides", "presence", "absence", "persist", "depsComplete", "identity", "implementation"];
    for (const f of fields) if (jcs(pb[f]) !== jcs(ph[f])) add(s, "undecided", String(f), pb[f] as JsonValue, ph[f] as JsonValue);
  }
  // actors
  for (const ab of base.actors.filter((a) => !a.q.startsWith("std::"))) {
    const ah = ctx.head.actors.find((a) => a.q === ab.q);
    if (!ah) continue;
    const s = `actor ${ab.q}`;
    if (ah.identities.some((i) => !ab.identities.includes(i))) add(s, "undecided", "identity", ab.identities, ah.identities);
    if (ah.members.some((m) => !ab.members.includes(m))) add(s, "undecided", "member", ab.members, ah.members);
    if (ah.operator !== ab.operator) add(s, "undecided", "operator", ab.operator, ah.operator);
  }
  return [...parts.values()].map((p) => ({ ...p, delta: sortedUniq(p.delta) }));
}

function reqGeq(h: { level: string; judged: boolean; pins: string[]; projection: string }, b: { level: string; judged: boolean; pins: string[]; projection: string }): boolean {
  const lr = (l: string): number => ["declared", "tested", "proven", "none"].indexOf(l);
  return lr(h.level) >= lr(b.level) && (!h.judged || b.judged) && b.pins.every((p) => h.pins.includes(p)) && (h.projection === "unit" || h.projection === b.projection);
}

// ---- subjects -----------------------------------------------------------------------------------------

/** A loosening subject's base tier (A.8.2.2). */
export function subjectTier(ctx: Ctx, subject: string): Tier {
  const base = ctx.base ?? ctx.gov;
  if (subject === "shape") return "critical";
  if (subject.startsWith("policy ")) {
    const t = subject.slice(7);
    return t === "low" || t === "normal" || t === "critical" ? t : "critical";
  }
  if (subject.startsWith("component ")) return base.components.find((k) => k.q === subject.slice(10))?.tier ?? "normal";
  if (subject.startsWith("resource ")) return base.resources.find((k) => k.q === subject.slice(9))?.tier ?? "normal";
  if (subject.startsWith("unit ")) return base.units.find((k) => k.q === subject.slice(5))?.tier ?? "normal";
  if (subject.startsWith("provider ")) {
    const p = base.providers.find((x) => x.q === subject.slice(9));
    let t: Tier = "normal";
    if (!p) return t;
    for (const c of base.claims) {
      const st = c.args.statement as { schema?: string; ref?: string } | undefined;
      const decides =
        c.op === "law" && !!st && p.decides.some((d) => (st.schema && d === `template ${st.schema}`) || (st.ref && d === `statements ${st.ref.split(":")[0]}`));
      const chans = ctx.Wb ? claimChannels(ctx, c) : [];
      const meets = chans.some((ch) => p.observes.some((o) => channelMeet(o, ch)));
      if (decides || meets) t = maxTier(t, c.tier);
    }
    return t;
  }
  if (subject.startsWith("actor ")) {
    const q = subject.slice(6);
    let t: Tier = "normal";
    for (const x of [...base.components, ...base.resources, ...base.units, ...base.claims]) if (x.owner === q) t = maxTier(t, x.tier);
    return t;
  }
  return ctx.baseClaims.get(subject)?.tier ?? "normal";
}

function claimChannels(ctx: Ctx, c: Claim): string[] {
  const w = ctx.Wb as World;
  if (c.op === "effect.forbid") {
    const a = parseAtom(String(c.args.atom));
    return (w.esf.resources.find((r) => r.q === a?.resource)?.bind ?? []).map((t) => `effect(${t})`);
  }
  if (c.op === "authority") return w.esf.resources.flatMap((r) => r.bind).map((t) => `effect(${t})`);
  return [];
}

function channelMeet(declared: string, needed: string): boolean {
  if (declared === needed) return true;
  const d = /^effect\((\w+)\.(\w+)\("(.*)"\)\)$/.exec(declared);
  const n = /^effect\((\w+)\.(\w+)\("(.*)"\)\)$/.exec(needed);
  return !!d && !!n && d[1] === n[1] && d[2] === n[2] && (d[3] === "*" || d[3] === n[3]);
}

/** The base owner who answers for a loosening subject (A.8.2.2). */
export function subjectOwner(ctx: Ctx, subject: string): string {
  const base = ctx.base ?? ctx.gov;
  if (subject === "shape" || subject.startsWith("policy ") || subject.startsWith("provider ") || subject.startsWith("actor ")) return base.shape.owner;
  if (subject.startsWith("component ")) return base.components.find((k) => k.q === subject.slice(10))?.owner ?? base.shape.owner;
  if (subject.startsWith("resource ")) return base.resources.find((k) => k.q === subject.slice(9))?.owner ?? base.shape.owner;
  if (subject.startsWith("unit ")) return base.units.find((k) => k.q === subject.slice(5))?.owner ?? base.shape.owner;
  return ctx.baseClaims.get(subject)?.owner ?? base.shape.owner;
}
