// Elaboration: shape.source.v1 (+ std) → shape.elaborated.v1. Pure; names resolved, templates
// expanded, claims normalised and fingerprinted (A.4, A.5.7, A.12.8), head shape errors (A.10.1).
import { H, jcs } from "./jcs.ts";
import {
  type Actor,
  type Args,
  type Claim,
  type ComponentItem,
  type ESF,
  type ExceptionItem,
  type ExceptionSubject,
  type Family,
  type JsonValue,
  type NoteItem,
  type Op,
  type Policy,
  type ProviderItem,
  type Requirement,
  type ResourceItem,
  type ShapeError,
  type TemplateItem,
  type TierPolicy,
  type UnitItem,
  TRUST,
  parseAtom
} from "./model.ts";
import { canonResourceCode } from "./resource-code.ts";
import type {
  Clause,
  ClaimMeta,
  Decl,
  EvidenceSpec,
  OrderDir,
  ParamKind,
  SourceDoc,
  SourceModule,
  TBody,
  TemplateApp
} from "./source.ts";
import { STD } from "./std.ts";
import {
  type Level,
  type Tier,
  cmpStr,
  collapseWs,
  levelRank,
  maxTier,
  nfc,
  sortedUniq,
  tierRank,
  toSeconds
} from "./util.ts";

type Sort =
  | "resource"
  | "component"
  | "unit"
  | "actor"
  | "rule"
  | "law"
  | "relation"
  | "provider"
  | "template"
  | "policy"
  | "exception"
  | "note"
  | "shape";

interface Entry {
  q: string;
  sort: Sort;
  decl: Decl;
  module: SourceModule;
}

export const HATCH_REGISTRY: Record<string, string[]> = {
  verus: [
    "external_body",
    "external",
    "assume",
    "admit",
    "assume_specification",
    "uninterp",
    "axiom"
  ],
  bend: ["unsafe"],
  ts: ["ts_ignore"]
};

interface ParamVal {
  kind: ParamKind;
  /** resolved Q, verb, kind, value, identity; or "$i" when building a template's NF */
  value: string | number;
  index: number;
}

interface Ctx {
  module: SourceModule;
  params: Map<string, ParamVal> | null;
  placeholder: boolean;
}

interface Draft {
  id: string;
  op: Op;
  args: Args;
  owner: string | null;
  tier: Tier | null;
  requirement: Requirement | null;
  bearer: string | null;
  /** Q of the component that supplies inherited owner and tier when there is no bearer */
  subject: string | null;
  template: string | null;
  statementForm: "schema" | "hosted" | "informal" | null;
}

export interface ElaborateOptions {
  /** base shapes are read leniently: defects never invalidate (A.6.4.2) */
  lenient?: boolean;
  /** now* in integer seconds, for exception expiry limits */
  now: number;
}

const FAMILY: Record<Op, Family> = {
  "edge.exists": "structure",
  "edge.forbid": "structure",
  "path.forbid": "structure",
  "cycle.forbid": "structure",
  authority: "authority",
  "effect.forbid": "authority",
  "effects.upper": "conduct",
  "effects.lower": "conduct",
  law: "law"
};

export function claimNf(op: Op, args: Args): { nf: string; fp: string } {
  const v = { v: "shape.claim.v1", op, args };
  return { nf: jcs(v), fp: H(v) };
}

export function sourceRefToId(ref: string): string | null {
  const m = /^\s*([A-Za-z_][\w-]*)\("((?:[^"\\]|\\.)*)"\)\s*$/.exec(ref);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const path = JSON.parse(`"${m[2]}"`) as string;
  return `${m[1]}:${nfc(path)}`;
}

export function idToSourceRef(id: string): string {
  const i = id.indexOf(":");
  return `${id.slice(0, i)}(${JSON.stringify(id.slice(i + 1))})`;
}

function strictestRequirement(a: Requirement | null, b: Requirement | null): Requirement | null {
  if (!a) return b;
  if (!b) return a;
  return {
    level: levelRank(a.level) >= levelRank(b.level) ? a.level : b.level,
    judged: a.judged && b.judged,
    pins: sortedUniq([...a.pins, ...b.pins]),
    projection: a.projection === b.projection ? a.projection : "unit"
  };
}

export function elaborate(doc: SourceDoc | null, opts: ElaborateOptions): ESF {
  const errors: ShapeError[] = [];
  const err = (code: string, subject: string, message: string): void => {
    errors.push({ code, subject, message, causes: [], dischargers: [] });
  };
  const modules: SourceModule[] = [STD, ...(doc?.modules ?? [])];
  for (const m of doc?.modules ?? [])
    if (m.module === "std")
      err("E-shadow", "module std", "a shape module reuses the pack name std");

  // ---- symbol table ---------------------------------------------------------
  const table = new Map<string, Entry>();
  const sortOf = (d: Decl): Sort | null => {
    switch (d.decl) {
      case "resource":
      case "component":
      case "actor":
      case "rule":
      case "law":
      case "relation":
      case "provider":
      case "template":
      case "policy":
      case "exception":
      case "note":
      case "shape":
        return d.decl;
      default:
        return null;
    }
  };
  for (const m of modules) {
    for (const d of m.decls) {
      const sort = sortOf(d);
      if (!sort || d.decl === "hatch") continue;
      const q = `${m.module}::${d.name}`;
      if (table.has(q)) err("E-shadow", `${sort} ${q}`, `${q} is declared twice`);
      else table.set(q, { q, sort, decl: d, module: m });
      if (d.decl === "component") {
        for (const u of d.units ?? []) {
          const uq = `${q}.${u.name}`;
          if (table.has(uq)) err("E-shadow", `unit ${uq}`, `${uq} is declared twice`);
          else table.set(uq, { q: uq, sort: "unit", decl: d, module: m });
        }
      }
    }
  }

  const candidates = (name: string, mod: SourceModule): string[] => {
    const n = name.trim();
    if (n.includes("::")) return [n];
    return [`${mod.module}::${n}`, ...(mod.imports ?? []).map((i) => `${i}::${n}`), `std::${n}`];
  };
  const lookup = (name: string, mod: SourceModule, sorts: Sort[], where: string): Entry | null => {
    let wrong: Entry | null = null;
    for (const c of candidates(name, mod)) {
      const e = table.get(c);
      if (e && sorts.includes(e.sort)) return e;
      if (e) wrong = e;
    }
    err(
      "E-unknown",
      where,
      wrong
        ? `${name} is a ${wrong.sort}, expected ${sorts.join(" or ")}`
        : `unresolved reference ${name}`
    );
    return null;
  };

  // ---- verbs, kinds, hatch kinds (one namespace, A.0.3) ------------------------
  const implies = new Map<string, Set<string>>();
  const kinds = new Map<
    string,
    { name: string; from: "component" | "resource"; to: "component" | "resource" }
  >();
  const hatches: { kind: string; lang: string }[] = [];
  const nsOwner = new Map<string, string>();
  const claimNs = (name: string, what: string): void => {
    const prev = nsOwner.get(name);
    if (prev && prev !== what)
      err("E-shadow", `${what} ${name}`, `${name} is declared as ${prev} and ${what}`);
    else nsOwner.set(name, what);
  };
  for (const m of modules) {
    for (const d of m.decls) {
      if (d.decl === "effect") {
        claimNs(d.name, "effect");
        const s = implies.get(d.name) ?? new Set<string>();
        for (const i of d.implies ?? []) s.add(i);
        implies.set(d.name, s);
      } else if (d.decl === "kind") {
        claimNs(d.name, "kind");
        kinds.set(d.name, { name: d.name, from: d.from, to: d.to });
      }
    }
  }
  for (const m of modules) {
    for (const d of m.decls) {
      if (d.decl !== "hatch") continue;
      for (const h of d.names) {
        if (!(HATCH_REGISTRY[d.lang] ?? []).includes(h)) {
          err("E-unknown", `hatch ${h}`, `${h} is not a registry hatch kind of ${d.lang}`);
          continue;
        }
        if (!implies.has(h)) claimNs(h, "effect");
        const s = implies.get(h) ?? new Set<string>();
        s.add("Hatch");
        implies.set(h, s);
        if (!hatches.some((x) => x.kind === h && x.lang === d.lang))
          hatches.push({ kind: h, lang: d.lang });
      }
    }
  }
  for (const [v, s] of implies)
    for (const i of s)
      if (!implies.has(i)) err("E-unknown", `effect ${v}`, `${v} implies undeclared ${i}`);
  // acyclicity (E-effect-order)
  {
    const state = new Map<string, number>();
    const visit = (v: string): boolean => {
      const st = state.get(v);
      if (st === 1) return false;
      if (st === 2) return true;
      state.set(v, 1);
      for (const i of implies.get(v) ?? []) if (implies.has(i) && !visit(i)) return false;
      state.set(v, 2);
      return true;
    };
    for (const v of [...implies.keys()].sort(cmpStr))
      if (!visit(v)) {
        err("E-effect-order", `effect ${v}`, `implies has a cycle through ${v}`);
        break;
      }
  }

  // ---- shape declaration, actors ---------------------------------------------
  const shapeDecls = (doc?.modules ?? []).flatMap((m) =>
    m.decls.flatMap((d) => (d.decl === "shape" ? [{ d, m }] : []))
  );
  if (shapeDecls.length !== 1)
    err(
      "E-parse",
      "shape",
      shapeDecls.length === 0 ? "no shape declaration" : "more than one shape declaration"
    );
  const shapeDecl = shapeDecls[0];
  const actors = new Map<string, Actor>();
  const resolveOwner = (o: string | undefined, mod: SourceModule, where: string): string | null => {
    if (o === undefined) return null;
    if (/^[A-Za-z_][\w-]*\(".*"\)$/.test(o.trim())) {
      const id = o.trim();
      if (!actors.has(id))
        actors.set(id, { q: id, kind: "person", operator: null, identities: [id], members: [] });
      return id;
    }
    const e = lookup(o, mod, ["actor"], where);
    return e ? e.q : null;
  };
  for (const m of modules) {
    for (const d of m.decls) {
      if (d.decl !== "actor") continue;
      actors.set(`${m.module}::${d.name}`, {
        q: `${m.module}::${d.name}`,
        kind: d.kind,
        operator: null,
        identities: sortedUniq((d.identities ?? []).map((s) => s.trim())),
        members: []
      });
    }
  }
  for (const m of modules) {
    for (const d of m.decls) {
      if (d.decl !== "actor") continue;
      const a = actors.get(`${m.module}::${d.name}`) as Actor;
      a.members = sortedUniq(
        (d.members ?? []).flatMap((x) => {
          const e = lookup(x, m, ["actor"], `actor ${a.q}`);
          return e ? [e.q] : [];
        })
      );
      if (d.operator) {
        const e = lookup(d.operator, m, ["actor"], `actor ${a.q}`);
        a.operator = e ? e.q : null;
      }
    }
  }
  const shapeOwner =
    (shapeDecl ? resolveOwner(shapeDecl.d.owner, shapeDecl.m, "shape") : null) ?? "";
  const shapeQ = shapeDecl ? `${shapeDecl.m.module}::${shapeDecl.d.name}` : "shape";

  // ---- resolution helpers ------------------------------------------------------
  const param = (name: string, ctx: Ctx): ParamVal | null => ctx.params?.get(name.trim()) ?? null;
  const pv = (p: ParamVal, ctx: Ctx): string => (ctx.placeholder ? `$${p.index}` : String(p.value));

  const resourceRef = (
    name: string,
    ctx: Ctx,
    where: string,
    allowTrust: boolean
  ): string | null => {
    const p = param(name, ctx);
    if (p) {
      if (p.kind !== "resource")
        err("E-template", where, `${name} is a ${p.kind} parameter, expected resource`);
      return pv(p, ctx);
    }
    const e = lookup(name, ctx.module, ["resource"], where);
    if (!e) return null;
    if (e.q === TRUST && !allowTrust) {
      err("E-unknown", where, "Trust may not be named in a grant, summary or binding");
      return null;
    }
    return e.q;
  };
  const verbOk = (verb: string, where: string): boolean => {
    if (implies.has(verb)) return true;
    err("E-unknown", where, `undeclared effect ${verb}`);
    return false;
  };
  const atomRef = (atom: string, ctx: Ctx, where: string, allowTrust: boolean): string | null => {
    const a = parseAtom(atom);
    if (!a) {
      err("E-parse", where, `bad atom ${atom}`);
      return null;
    }
    let verb = a.verb;
    const pVerb = param(verb, ctx);
    if (pVerb && pVerb.kind === "effect") verb = pv(pVerb, ctx);
    else if (!verbOk(verb, where)) return null;
    const r = resourceRef(a.resource, ctx, where, allowTrust);
    return r === null ? null : `${verb}<${r}>`;
  };
  const anyRef = (
    name: string,
    ctx: Ctx,
    sorts: Sort[],
    where: string
  ): { q: string; sort: Sort } | null => {
    const p = param(name, ctx);
    if (p) {
      if (!(sorts as string[]).includes(p.kind)) {
        err("E-unknown", where, `${name} is a ${p.kind} parameter, expected ${sorts.join(" or ")}`);
        return null;
      }
      return { q: pv(p, ctx), sort: p.kind as Sort };
    }
    const e = lookup(name, ctx.module, sorts, where);
    return e ? { q: e.q, sort: e.sort } : null;
  };
  const unitSel = (s: string, ctx: Ctx, where: string): string | null => {
    const t = s.trim();
    if (t === "*" || t === "ungoverned") return t;
    const m = /^(component|unit|resource)\s+(.+)$/.exec(t);
    if (m && m[1] === "resource") {
      err("E-unknown", where, `a resource is not a unit selector: ${t}`);
      return null;
    }
    const r = m
      ? anyRef(m[2] ?? "", ctx, [m[1] as Sort], where)
      : anyRef(t, ctx, ["component", "unit"], where);
    return r ? `${r.sort} ${r.q}` : null;
  };
  const nodeSel = (s: string, ctx: Ctx, where: string): string | null => {
    const t = s.trim();
    if (t === "*") return t;
    if (t === "ungoverned") {
      err("E-unknown", where, "ungoverned is never a node");
      return null;
    }
    const m = /^(component|resource|unit)\s+(.+)$/.exec(t);
    if (m && m[1] === "unit") {
      err("E-unknown", where, `a unit is not a node: ${t}`);
      return null;
    }
    const r = m
      ? anyRef(m[2] ?? "", ctx, [m[1] as Sort], where)
      : anyRef(t, ctx, ["component", "resource"], where);
    return r ? `${r.sort} ${r.q}` : null;
  };
  const kindOk = (k: string, ctx: Ctx, where: string): string | null => {
    const p = param(k, ctx);
    if (p && p.kind === "kind") return pv(p, ctx);
    if (kinds.has(k)) return k;
    err("E-unknown", where, `undeclared edge kind ${k}`);
    return null;
  };
  const target = (s: string, ctx: Ctx, where: string): string | null => {
    const t = s.trim();
    const code = /^code\s+(.+)$/.exec(t);
    if (code) {
      const p = param(code[1] ?? "", ctx);
      if (p && p.kind === "code") return `code ${pv(p, ctx)}`;
      const id = sourceRefToId(code[1] ?? "");
      if (!id) err("E-parse", where, `bad code reference ${t}`);
      return id ? `code ${id}` : null;
    }
    const m = /^(unit|component|resource|rule|law|relation|exception)\s+(.+)$/.exec(t);
    if (!m) {
      const r = anyRef(t, ctx, ["unit", "component", "resource"], where);
      return r ? `${r.sort} ${r.q}` : null;
    }
    const r = anyRef(m[2] ?? "", ctx, [m[1] as Sort], where);
    return r ? `${r.sort} ${r.q}` : null;
  };
  const sortClean = (xs: (string | null)[]): string[] =>
    sortedUniq(xs.filter((x): x is string => x !== null));

  // ---- vocabulary ----------------------------------------------------------------
  const resources: ResourceItem[] = [];
  const components: ComponentItem[] = [];
  const units: UnitItem[] = [];
  const resourceCodeOwner = new Map<string, string>();
  for (const m of modules) {
    const ctx: Ctx = { module: m, params: null, placeholder: false };
    for (const d of m.decls) {
      if (d.decl === "resource") {
        const q = `${m.module}::${d.name}`;
        const bind: string[] = [];
        for (const b of d.bind ?? []) {
          const c = canonResourceCode(b);
          if (!c) err("E-parse", `resource ${q}`, `bad resource code ${b}`);
          else {
            const prev = resourceCodeOwner.get(c);
            if (prev && prev !== q)
              err("E-overlap", `resource ${q}`, `${c} is bound by ${prev} and ${q}`);
            resourceCodeOwner.set(c, q);
            bind.push(c);
          }
        }
        resources.push({
          q,
          owner: resolveOwner(d.owner, m, `resource ${q}`) ?? shapeOwner,
          tier: d.tier ?? "normal",
          bind: sortedUniq(bind),
          was: d.was ?? null,
          attach: (d.attach ?? []).map((a) => a.name)
        });
      } else if (d.decl === "component") {
        const q = `${m.module}::${d.name}`;
        const owner = resolveOwner(d.owner, m, `component ${q}`) ?? shapeOwner;
        const tier = d.tier ?? "normal";
        let grants: string[] | null = null;
        if (d.grants === "none") grants = [];
        else if (Array.isArray(d.grants))
          grants = sortClean(d.grants.map((g) => atomRef(g, ctx, `component ${q}`, false)));
        const comp: ComponentItem = {
          q,
          boundary: d.boundary ?? false,
          owner,
          tier,
          paths: [...(d.paths ?? [])].map(nfc).sort(cmpStr),
          grants,
          allows: sortedUniq(d.allows ?? []),
          assumes: [...(d.assumes ?? [])].sort((a, b) => cmpStr(a.id, b.id)),
          complete: sortClean(
            (d.relationsComplete ?? []).map((k) => kindOk(k, ctx, `component ${q}`))
          ),
          was: d.was ?? null,
          units: [],
          attach: (d.attach ?? []).map((a) => a.name)
        };
        for (const h of comp.allows)
          if (!hatches.some((x) => x.kind === h) && h !== "Hatch")
            err("E-unknown", `component ${q}`, `undeclared hatch kind ${h}`);
        if (!d.boundary && (comp.allows.length > 0 || comp.assumes.length > 0))
          err("E-parse", `component ${q}`, "allows and assumes are boundary fields");
        for (const u of d.units ?? []) {
          const uq = `${q}.${u.name}`;
          comp.units.push(uq);
          let bind: string | null = null;
          if (u.bind) {
            bind = sourceRefToId(u.bind);
            if (!bind) err("E-parse", `unit ${uq}`, `bad source reference ${u.bind}`);
          }
          let summary: UnitItem["summary"] = null;
          if (u.effects && u.effects.mode !== "unknown") {
            summary = {
              mode: u.effects.mode,
              atoms: (u.effects.atoms ?? []).flatMap((e) => {
                const atom = atomRef(e.atom, ctx, `unit ${uq}`, false);
                if (!atom) return [];
                let via: string | null = null;
                if (e.via) {
                  const v = anyRef(e.via, ctx, ["unit"], `unit ${uq}`);
                  via = v ? v.q : null;
                }
                return [{ atom, via }];
              })
            };
          }
          units.push({
            q: uq,
            component: q,
            name: u.name,
            owner: resolveOwner(u.owner, m, `unit ${uq}`) ?? owner,
            tier: u.tier ?? tier,
            bind,
            was: u.was ?? null,
            summary,
            attach: (u.attach ?? []).map((a) => a.name)
          });
        }
        comp.units.sort(cmpStr);
        components.push(comp);
      }
    }
  }
  const compByQ = new Map(components.map((c) => [c.q, c]));
  const unitByQ = new Map(units.map((u) => [u.q, u]));
  const resByQ = new Map(resources.map((r) => [r.q, r]));

  // ---- templates -------------------------------------------------------------------
  const templates = new Map<
    string,
    { item: TemplateItem; decl: Extract<Decl, { decl: "template" }>; module: SourceModule }
  >();
  const drafts: Draft[] = [];

  const clauseArgs = (
    c: Clause,
    ctx: Ctx,
    where: string
  ): { op: Op; args: Args; final: boolean }[] => {
    const final = c.final ?? false;
    switch (c.forbid) {
      case "effect": {
        const atom = atomRef(c.atom, ctx, where, true);
        if (!atom) return [];
        const scope =
          c.within && c.within.length > 0
            ? sortClean(c.within.map((s) => unitSel(s, ctx, where)))
            : ["*"];
        const except = sortClean((c.except ?? []).map((s) => unitSel(s, ctx, where)));
        return [{ op: "effect.forbid", args: { atom, scope, except }, final }];
      }
      case "path":
        return [
          {
            op: "path.forbid",
            args: {
              from: sortClean(c.from.map((s) => nodeSel(s, ctx, where))),
              to: sortClean(c.to.map((s) => nodeSel(s, ctx, where))),
              kinds: sortClean(c.over.map((k) => kindOk(k, ctx, where))),
              exceptVia: sortClean((c.exceptVia ?? []).map((s) => nodeSel(s, ctx, where)))
            },
            final
          }
        ];
      case "edge": {
        const kind = kindOk(c.kind, ctx, where);
        if (!kind) return [];
        return [
          {
            op: "edge.forbid",
            args: {
              from: sortClean(c.from.map((s) => nodeSel(s, ctx, where))),
              exceptFrom: sortClean((c.exceptFrom ?? []).map((s) => nodeSel(s, ctx, where))),
              kind,
              to: sortClean(c.to.map((s) => nodeSel(s, ctx, where))),
              exceptTo: sortClean((c.exceptTo ?? []).map((s) => nodeSel(s, ctx, where)))
            },
            final
          }
        ];
      }
      case "cycle":
        return [
          {
            op: "cycle.forbid",
            args: { kinds: sortClean(c.over.map((k) => kindOk(k, ctx, where))) },
            final
          }
        ];
      case "hatch": {
        // forbid hatch K outside boundaries: one effect.forbid(h<std::Trust>, [*], boundaries allowing h)
        // per hatch verb h ⇒ K, `*` reading as Hatch, itself included (A.4.2.4).
        const targets = c.kinds.map((k) => (k === "*" ? "Hatch" : k));
        const verbs = new Set<string>();
        for (const t of targets) {
          if (!implies.has(t)) {
            err("E-unknown", where, `undeclared hatch kind ${t}`);
            continue;
          }
          for (const v of implies.keys())
            if (impliesStar(implies, v, t) && impliesStar(implies, v, "Hatch")) verbs.add(v);
        }
        return [...verbs].sort(cmpStr).map((h) => ({
          op: "effect.forbid" as Op,
          args: {
            atom: `${h}<${TRUST}>`,
            scope: ["*"],
            except: components
              .filter((b) => b.boundary && b.allows.includes(h))
              .map((b) => `component ${b.q}`)
              .sort(cmpStr)
          },
          final
        }));
      }
    }
  };

  // template NF (schemaFp): body clause NFs with "$<index>" parameters (A.12.8.3)
  for (const m of modules) {
    for (const d of m.decls) {
      if (d.decl !== "template") continue;
      const q = `${m.module}::${d.name}`;
      const params = new Map<string, ParamVal>();
      d.params.forEach(([p, k], i) => params.set(p, { kind: k, value: `$${i}`, index: i }));
      const ctx: Ctx = { module: m, params, placeholder: true };
      const body: unknown[] = [];
      const order: [string, OrderDir][] = [];
      const notes: string[] = [];
      for (const b of d.body) {
        if ("forbid" in b) {
          if (b.forbid === "hatch")
            body.push({ op: "forbid.hatch", args: { kinds: [...b.kinds].sort(cmpStr) } });
          else
            for (const c of clauseArgs(b, ctx, `template ${q}`))
              body.push({ op: c.op, args: c.args });
        } else if ("grants" in b) {
          const a = atomRef(b.grants, ctx, `template ${q}`, false);
          if (a) body.push({ op: "grants", args: { atom: a } });
        } else if ("law" in b) {
          const on =
            b.law.on !== undefined
              ? sortClean(b.law.on.map((t) => target(t, ctx, `template ${q}`)))
              : d.params.flatMap(([, k], i) =>
                  k === "unit" || k === "component" || k === "code" ? [`$${i}`] : []
                );
          const args: Record<string, unknown> = { on };
          if (b.law.informal !== undefined) args.statement = { text: collapseWs(b.law.informal) };
          body.push({ op: "law", args });
        } else if ("requiresNote" in b) notes.push(b.requiresNote);
        else if ("order" in b) order.push(b.order);
      }
      const tnf = {
        v: "shape.template.v1",
        name: q,
        params: d.params.map(([p, k]) => [p, k]),
        body: body
          .map((x) => ({ x, k: jcs(x) }))
          .sort((a, b) => cmpStr(a.k, b.k))
          .map((x) => x.x),
        order: order.map(([p, o]) => [p, o]).sort((a, b) => cmpStr(jcs(a), jcs(b))),
        notes: [...notes].sort(cmpStr)
      };
      templates.set(q, {
        item: {
          q,
          schemaFp: H(tnf),
          params: d.params,
          order: [...order].sort((a, b) => cmpStr(a[0], b[0])),
          notes: tnf.notes
        },
        decl: d,
        module: m
      });
    }
  }

  const reqFrom = (
    informal: boolean,
    tmplEv: EvidenceSpec | undefined,
    ev: EvidenceSpec | undefined,
    mod: SourceModule,
    where: string
  ): Requirement => {
    const merged: EvidenceSpec = { ...tmplEv, ...ev };
    let level: Level;
    let judged: boolean;
    if (informal) {
      level = "none";
      judged = true;
    } else if (merged.judged && !merged.level) {
      level = "none";
      judged = true;
    } else {
      level = merged.level ?? "declared";
      judged = merged.orJudged ?? false;
    }
    const pins = sortedUniq(
      (merged.by ?? []).flatMap((b) => {
        const e = lookup(b, mod, ["provider", "actor"], where);
        return e ? [e.q] : [];
      })
    );
    return { level, judged, pins, projection: merged.at ?? "unit" };
  };

  const encodeArg = (p: ParamVal): JsonValue => {
    switch (p.kind) {
      case "resource":
      case "component":
      case "unit":
        return `${p.kind} ${p.value}`;
      case "code":
        return `code ${p.value}`;
      default:
        return p.value;
    }
  };

  const resolveArg = (
    kind: ParamKind,
    raw: string | number,
    ctx: Ctx,
    where: string
  ): string | number | null => {
    if (kind === "value") {
      if (typeof raw === "number" && !Number.isSafeInteger(raw)) {
        err("E-template", where, `value ${raw} is not a safe integer`);
        return null;
      }
      return typeof raw === "string" ? nfc(raw) : raw;
    }
    if (typeof raw !== "string") {
      err("E-template", where, `argument ${raw} is not a ${kind}`);
      return null;
    }
    if (kind === "effect") return verbOk(raw, where) ? raw : null;
    if (kind === "kind") return kindOk(raw, ctx, where);
    if (kind === "code") {
      const id = sourceRefToId(raw.replace(/^code\s+/, ""));
      if (!id) err("E-template", where, `bad code argument ${raw}`);
      return id;
    }
    const r = anyRef(raw.replace(/^(resource|component|unit)\s+/, ""), ctx, [kind], where);
    return r ? r.q : null;
  };

  /** Expands a template application into claim drafts (attachment when bearer is set). */
  const expand = (
    app: TemplateApp,
    bearer: { q: string; sort: Sort } | null,
    ctx: Ctx,
    meta: ClaimMeta,
    idBase: string,
    named: boolean,
    instanceOn: string[] | undefined,
    where: string
  ): void => {
    const te = lookup(app.name, ctx.module, ["template"], where);
    if (!te) return;
    const t = templates.get(te.q);
    if (!t) return;
    const raw: (string | number)[] = [...(bearer ? [bearer.q] : []), ...(app.args ?? [])];
    if (raw.length !== t.item.params.length) {
      err(
        "E-template",
        where,
        `${te.q} takes ${t.item.params.length} arguments, got ${raw.length}`
      );
      return;
    }
    const params = new Map<string, ParamVal>();
    let ok = true;
    t.item.params.forEach(([p, k], i) => {
      const r = raw[i] as string | number;
      const v =
        bearer && i === 0 ? (bearer.sort === k ? bearer.q : null) : resolveArg(k, r, ctx, where);
      if (bearer && i === 0 && bearer.sort !== k)
        err("E-template", where, `${te.q} attaches to a ${k}, not a ${bearer.sort}`);
      if (v === null) ok = false;
      else params.set(p, { kind: k, value: v, index: i });
    });
    if (!ok) return;
    const tctx: Ctx = { module: t.module, params, placeholder: false };
    const short = te.q.split("::").pop() ?? te.q;
    const local: Draft[] = [];
    const subjectComp = (): string | null => {
      for (const [, v] of params) {
        if (v.kind === "component") return String(v.value);
        if (v.kind === "unit") return unitByQ.get(String(v.value))?.component ?? null;
      }
      return null;
    };
    for (const b of t.decl.body as TBody[]) {
      if ("forbid" in b) {
        for (const c of clauseArgs(b, tctx, where)) {
          local.push({
            id: named ? idBase : `${idBase}/${short}/${c.op}-${clauseTag(c.op, c.args)}`,
            op: c.op,
            args: c.args,
            owner: meta.owner ? resolveOwner(meta.owner, ctx.module, where) : null,
            tier: c.final ? "final" : (meta.tier ?? null),
            requirement: null,
            bearer: bearer?.q ?? null,
            subject: subjectComp(),
            template: te.q,
            statementForm: null
          });
        }
      } else if ("grants" in b) {
        const a = atomRef(b.grants, tctx, where, false);
        const comp = bearer && bearer.sort === "component" ? compByQ.get(bearer.q) : undefined;
        if (a && comp) comp.grants = sortedUniq([...(comp.grants ?? []), a]);
      } else if ("law" in b) {
        let on: string[];
        const fromParams = t.item.params.flatMap(([p, k]) => {
          const v = params.get(p);
          return v && (k === "unit" || k === "component" || k === "code")
            ? [String(encodeArg(v))]
            : [];
        });
        if (b.law.on !== undefined) on = sortClean(b.law.on.map((x) => target(x, tctx, where)));
        else if (fromParams.length > 0) on = sortedUniq(fromParams);
        else on = sortClean((instanceOn ?? []).map((x) => target(x, ctx, where)));
        if (on.length === 0) err("E-law-target", where, "a law needs a target (on)");
        else if (on.every((x) => x.startsWith("resource ")))
          err("E-law-target", where, "a law on resources only");
        const informal = b.law.informal !== undefined;
        const statement: JsonValue = informal
          ? { text: collapseWs(b.law.informal ?? "") }
          : {
              schema: te.q,
              schemaFp: t.item.schemaFp,
              args: t.item.params.map(([p]) => encodeArg(params.get(p) as ParamVal))
            };
        local.push({
          id: named ? idBase : `${idBase}/${short}/law`,
          op: "law",
          args: { on, statement },
          owner: meta.owner ? resolveOwner(meta.owner, ctx.module, where) : null,
          tier: meta.tier ?? null,
          requirement: reqFrom(informal, b.law.evidence, meta.evidence, ctx.module, where),
          bearer: bearer?.q ?? null,
          subject: lawSubject(on),
          template: te.q,
          statementForm: informal ? "informal" : "schema"
        });
      }
    }
    if (local.length > 1) {
      const ids = new Map<string, number>();
      for (const l of local) ids.set(l.id, (ids.get(l.id) ?? 0) + 1);
      for (const l of local)
        if ((ids.get(l.id) ?? 0) > 1) l.id = `${l.id}/${claimNf(l.op, l.args).fp.slice(7, 19)}`;
    }
    drafts.push(...local);
  };

  const lawSubject = (on: string[]): string | null => {
    for (const o of on) {
      if (o.startsWith("component ")) return o.slice(10);
      if (o.startsWith("unit ")) return unitByQ.get(o.slice(5))?.component ?? null;
    }
    return null;
  };

  // ---- claims from declarations --------------------------------------------------------
  for (const m of modules) {
    if (m.module === "std") continue;
    const ctx: Ctx = { module: m, params: null, placeholder: false };
    for (const d of m.decls) {
      if (d.decl === "resource") {
        const q = `${m.module}::${d.name}`;
        for (const a of d.attach ?? [])
          expand(a, { q, sort: "resource" }, ctx, {}, q, false, undefined, `resource ${q}`);
      } else if (d.decl === "component") {
        const q = `${m.module}::${d.name}`;
        const comp = compByQ.get(q) as ComponentItem;
        for (const a of d.attach ?? [])
          expand(a, { q, sort: "component" }, ctx, {}, q, false, undefined, `component ${q}`);
        for (const u of d.units ?? []) {
          const uq = `${q}.${u.name}`;
          for (const a of u.attach ?? [])
            expand(a, { q: uq, sort: "unit" }, ctx, {}, uq, false, undefined, `unit ${uq}`);
        }
        void comp;
      } else if (d.decl === "relation") {
        const q = `${m.module}::${d.name}`;
        const kind = kindOk(d.kind, ctx, `relation ${q}`);
        const ends = d.connects.map((c) =>
          anyRef(c, ctx, ["component", "resource"], `relation ${q}`)
        );
        if (!kind || ends.some((e) => e === null)) continue;
        const pairs: Draft[] = [];
        for (let i = 0; i + 1 < ends.length; i += 1) {
          const a = ends[i] as { q: string; sort: Sort };
          const b = ends[i + 1] as { q: string; sort: Sort };
          pairs.push({
            id: q,
            op: "edge.exists",
            args: { from: a.q, kind, to: b.q },
            owner: d.owner ? resolveOwner(d.owner, m, `relation ${q}`) : null,
            tier: d.tier ?? null,
            requirement: null,
            bearer: null,
            subject: a.sort === "component" ? a.q : null,
            template: null,
            statementForm: null
          });
        }
        if (pairs.length > 1)
          for (const p of pairs) p.id = `${q}/${claimNf(p.op, p.args).fp.slice(7, 19)}`;
        drafts.push(...pairs);
      } else if (d.decl === "rule") {
        const q = `${m.module}::${d.name}`;
        if (d.template) {
          expand(d.template, null, ctx, d, q, true, undefined, `rule ${q}`);
          continue;
        }
        const local: Draft[] = [];
        const instances: Map<string, ParamVal>[] = [];
        if (d.when && d.when.length > 0) {
          const w = d.when[0] as { param: string; has: string };
          const te = lookup(w.has, m, ["template"], `rule ${q}`);
          if (te) {
            const bearers: { q: string; kind: ParamKind; attach: string[]; mod: string }[] = [
              ...resources.map((r) => ({
                q: r.q,
                kind: "resource" as ParamKind,
                attach: r.attach,
                mod: r.q.split("::")[0] ?? ""
              })),
              ...components.map((c) => ({
                q: c.q,
                kind: "component" as ParamKind,
                attach: c.attach,
                mod: c.q.split("::")[0] ?? ""
              })),
              ...units.map((u) => ({
                q: u.q,
                kind: "unit" as ParamKind,
                attach: u.attach,
                mod: u.q.split("::")[0] ?? ""
              }))
            ];
            for (const b of bearers) {
              const hit = b.attach.some((a) => {
                const mod = modules.find((x) => x.module === b.mod);
                return mod ? candidates(a, mod).includes(te.q) : false;
              });
              if (hit) instances.push(new Map([[w.param, { kind: b.kind, value: b.q, index: 0 }]]));
            }
          }
        } else instances.push(new Map());
        for (const params of instances) {
          const ictx: Ctx = {
            module: m,
            params: params.size > 0 ? params : null,
            placeholder: false
          };
          for (const c of d.clauses ?? []) {
            for (const ca of clauseArgs(c, ictx, `rule ${q}`)) {
              local.push({
                id: q,
                op: ca.op,
                args: ca.args,
                owner: d.owner ? resolveOwner(d.owner, m, `rule ${q}`) : null,
                tier: ca.final ? "final" : (d.tier ?? null),
                requirement: null,
                bearer: null,
                subject: null,
                template: null,
                statementForm: null
              });
            }
          }
        }
        if (local.length > 1)
          for (const l of local) l.id = `${q}/${claimNf(l.op, l.args).fp.slice(7, 19)}`;
        drafts.push(...local);
      } else if (d.decl === "law") {
        const q = `${m.module}::${d.name}`;
        if (d.template) {
          expand(d.template, null, ctx, d, q, true, d.on, `law ${q}`);
          continue;
        }
        const on = sortClean((d.on ?? []).map((t) => target(t, ctx, `law ${q}`)));
        if (on.every((x) => x.startsWith("resource ")))
          err("E-law-target", `law ${q}`, "a law needs a unit, component or code target");
        let statement: JsonValue;
        let form: "hosted" | "informal";
        if (d.statement !== undefined) {
          const id = sourceRefToId(d.statement);
          if (!id) {
            err("E-parse", `law ${q}`, `bad statement reference ${d.statement}`);
            continue;
          }
          statement = { ref: id, projection: "closure" };
          form = "hosted";
        } else if (d.informal !== undefined) {
          statement = { text: collapseWs(d.informal) };
          form = "informal";
        } else {
          err("E-parse", `law ${q}`, "a law needs a statement, informal text or template");
          continue;
        }
        drafts.push({
          id: q,
          op: "law",
          args: { on, statement },
          owner: d.owner ? resolveOwner(d.owner, m, `law ${q}`) : null,
          tier: d.tier ?? null,
          requirement: reqFrom(form === "informal", undefined, d.evidence, m, `law ${q}`),
          bearer: null,
          subject: lawSubject(on),
          template: null,
          statementForm: form
        });
      }
    }
  }

  // component-borne claims: authority, relations complete; unit summaries
  for (const c of components) {
    if (c.q.startsWith("std::")) continue;
    if (c.grants !== null)
      drafts.push({
        id: `${c.q}/authority`,
        op: "authority",
        args: { component: c.q, grants: c.grants },
        owner: null,
        tier: null,
        requirement: null,
        bearer: c.q,
        subject: c.q,
        template: null,
        statementForm: null
      });
    for (const k of c.complete) {
      const targets = drafts
        .filter((d) => d.op === "edge.exists" && d.args.from === c.q && d.args.kind === k)
        .map((d) => {
          const to = String(d.args.to);
          return `${resByQ.has(to) ? "resource" : "component"} ${to}`;
        });
      drafts.push({
        id: `${c.q}/relations.complete-${k}`,
        op: "edge.forbid",
        args: {
          from: [`component ${c.q}`],
          exceptFrom: [],
          kind: k,
          to: ["*"],
          exceptTo: sortedUniq(targets)
        },
        owner: null,
        tier: null,
        requirement: null,
        bearer: c.q,
        subject: c.q,
        template: null,
        statementForm: null
      });
    }
  }
  for (const u of units) {
    if (!u.summary) continue;
    const base = {
      owner: null,
      tier: null,
      requirement: null,
      bearer: u.q,
      subject: u.component,
      template: null,
      statementForm: null
    };
    if (u.summary.mode === "complete")
      drafts.push({
        ...base,
        id: `${u.q}/effects.upper`,
        op: "effects.upper",
        args: { unit: u.q, atoms: sortedUniq(u.summary.atoms.map((a) => a.atom)) }
      });
    if (u.summary.atoms.length > 0)
      drafts.push({
        ...base,
        id: `${u.q}/effects.lower`,
        op: "effects.lower",
        args: {
          unit: u.q,
          atoms: sortedUniq(u.summary.atoms.map((a) => (a.via ? `${a.atom} via ${a.via}` : a.atom)))
        }
      });
  }

  // ---- finalise: owner, tier, nf, fp; merge equal fps (A.4.1.7) -------------------------
  const inheritedOwner = (d: Draft): string => {
    if (d.owner) return d.owner;
    const b = d.bearer;
    if (b) {
      const it = unitByQ.get(b) ?? compByQ.get(b) ?? resByQ.get(b);
      if (it) return it.owner;
    }
    if (d.subject) {
      const c = compByQ.get(d.subject);
      if (c) return c.owner;
    }
    return shapeOwner;
  };
  const inheritedTier = (d: Draft): Tier => {
    if (d.tier) return d.tier;
    const b = d.bearer;
    if (b) {
      const it = unitByQ.get(b) ?? compByQ.get(b) ?? resByQ.get(b);
      if (it) return it.tier;
    }
    if (d.subject) {
      const c = compByQ.get(d.subject);
      if (c) return c.tier;
    }
    return "normal";
  };
  const byFp = new Map<string, { claim: Claim; ownerTier: Tier; ownerId: string }>();
  for (const d of drafts) {
    const { nf, fp } = claimNf(d.op, d.args);
    const owner = inheritedOwner(d);
    const tier = inheritedTier(d);
    const prev = byFp.get(fp);
    if (!prev) {
      byFp.set(fp, {
        claim: {
          ids: [d.id],
          op: d.op,
          args: d.args,
          nf,
          fp,
          owner,
          tier,
          requirement: d.requirement,
          family: FAMILY[d.op],
          polarity:
            d.op === "law"
              ? "law"
              : d.op === "edge.exists" || d.op === "effects.lower"
                ? "lower"
                : "upper",
          bearer: d.bearer,
          template: d.template,
          statementForm: d.statementForm
        },
        ownerTier: tier,
        ownerId: d.id
      });
      continue;
    }
    const c = prev.claim;
    c.ids = sortedUniq([...c.ids, d.id]);
    if (
      tierRank(tier) > tierRank(prev.ownerTier) ||
      (tier === prev.ownerTier && cmpStr(d.id, prev.ownerId) < 0)
    ) {
      prev.ownerTier = tier;
      prev.ownerId = d.id;
      c.owner = owner;
    }
    c.tier = maxTier(c.tier, tier);
    c.requirement = strictestRequirement(c.requirement, d.requirement);
  }
  const claims = [...byFp.values()].map((x) => x.claim).sort((a, b) => cmpStr(a.fp, b.fp));

  // ---- policy -------------------------------------------------------------------------------
  const policyName = shapeDecl?.d.policy ?? "std::DefaultPolicy";
  const policyEntry = shapeDecl
    ? lookup(policyName, shapeDecl.m, ["policy"], "shape")
    : (table.get("std::DefaultPolicy") ?? null);
  const policy = buildPolicy(
    policyEntry,
    (name, mod) => lookup(name, mod, ["actor"], "policy")?.q ?? null,
    err
  );

  // ---- providers ---------------------------------------------------------------------------
  const providers: ProviderItem[] = [];
  for (const m of modules) {
    for (const d of m.decls) {
      if (d.decl !== "provider") continue;
      const q = `${m.module}::${d.name}`;
      const decides = (d.decides ?? []).map((x) => {
        const t = /^template\s+(.+)$/.exec(x.trim());
        if (t) {
          const e = lookup(t[1] ?? "", m, ["template"], `provider ${q}`);
          return e ? `template ${e.q}` : x;
        }
        return x.trim().replace(/\s+/g, " ");
      });
      providers.push({
        q,
        produces: [...d.produces].sort(cmpStr),
        observes: sortedUniq((d.observes ?? []).map(canonChannel)),
        decides: sortedUniq(decides),
        presence: (d.sound ?? []).includes("presence"),
        absence: (d.sound ?? []).includes("absence"),
        persist: d.persist ?? false,
        depsComplete: d.depsComplete ?? false,
        identity: d.identity?.trim() ?? null,
        trusts: [...(d.trusts ?? [])].sort((a, b) => cmpStr(a.join("@"), b.join("@"))),
        implementation: d.implementation
          ? {
              paths: [...(d.implementation.paths ?? [])].sort(cmpStr),
              digest: d.implementation.digest ?? null
            }
          : null
      });
      const needsImpl = d.produces.some(
        (k) => k === "observation" || k === "test" || k === "proof"
      );
      if (needsImpl && !d.implementation)
        err(
          "E-provider",
          `provider ${q}`,
          "observation, test and proof providers need an implementation"
        );
    }
  }
  providers.sort((a, b) => cmpStr(a.q, b.q));
  {
    const ids = new Map<string, string>();
    for (const p of providers) {
      if (!p.identity) continue;
      const prev = ids.get(p.identity);
      if (prev) err("E-provider", `provider ${p.q}`, `shares identity ${p.identity} with ${prev}`);
      else ids.set(p.identity, p.q);
    }
  }

  // ---- exceptions ----------------------------------------------------------------------------
  const exceptions: ExceptionItem[] = [];
  for (const m of modules) {
    const ctx: Ctx = { module: m, params: null, placeholder: false };
    for (const d of m.decls) {
      if (d.decl !== "exception") continue;
      const q = `${m.module}::${d.name}`;
      const where = `exception ${q}`;
      const expires = toSeconds(d.expires);
      if (expires === null) {
        err("E-exception", where, `bad expiry ${d.expires}`);
        continue;
      }
      let target: ExceptionItem["target"] | null = null;
      const t = d.target.trim();
      const cm = /^component\s+(.+)$/.exec(t);
      if (cm) {
        const e = lookup(cm[1] ?? "", m, ["component"], where);
        if (e) {
          target = { kind: "component", q: e.q };
          if (compByQ.get(e.q)?.tier === "final")
            err("E-exception", where, "an exception never applies to tier final");
        }
      } else {
        const fps = resolveClaimRef(
          t,
          m,
          claims,
          (name, sorts) => lookup(name, m, sorts as Sort[], where)?.q ?? null
        );
        if (fps.length === 0) err("E-exception", where, `unknown target ${t}`);
        else {
          target = { kind: "claim", fps, ref: t };
          for (const fp of fps) {
            const c = claims.find((x) => x.fp === fp);
            if (c?.tier === "final")
              err("E-exception", where, "an exception never applies to tier final");
            if (c?.op === "law" && d.for && d.for.length > 0)
              err("E-exception", where, "a law exception is whole-claim (no for)");
          }
        }
      }
      if (expires > opts.now + 365 * 86400)
        err("E-exception", where, "expiry beyond now* + 365 days");
      if (!target) continue;
      const subjects: ExceptionSubject[] | null = d.for
        ? d.for.flatMap((s): ExceptionSubject[] => {
            const st = s.trim();
            const code = /^code\s+(.+)$/.exec(st);
            if (code) {
              const id = sourceRefToId(code[1] ?? "");
              return id ? [{ kind: "code", id }] : [];
            }
            const pair = /^pair\s+(.+?)\s*->\s*(.+)$/.exec(st);
            if (pair) {
              const a = anyRef(pair[1] ?? "", ctx, ["component", "resource"], where);
              const b = anyRef(pair[2] ?? "", ctx, ["component", "resource"], where);
              return a && b ? [{ kind: "pair", from: a.q, to: b.q }] : [];
            }
            const u = unitSel(st, ctx, where);
            return u ? [{ kind: "unit", sel: u }] : [];
          })
        : null;
      exceptions.push({
        q,
        waives:
          d.waives && d.waives.length > 0
            ? [...new Set(d.waives)].sort(cmpStr)
            : ["contradiction", "unestablished"],
        target,
        for: subjects,
        owner: resolveOwner(d.owner, m, where) ?? shapeOwner,
        expires,
        expiresText: d.expires
      });
    }
  }
  exceptions.sort((a, b) => cmpStr(a.q, b.q));

  // ---- notes and requires note ----------------------------------------------------------------
  const notes: NoteItem[] = [];
  for (const m of modules) {
    const ctx: Ctx = { module: m, params: null, placeholder: false };
    for (const d of m.decls) {
      if (d.decl !== "note") continue;
      const q = `${m.module}::${d.name}`;
      notes.push({
        q,
        kind: d.kind,
        about: sortClean(d.about.map((a) => target(a, ctx, `note ${q}`))),
        owner: resolveOwner(d.owner, m, `note ${q}`) ?? shapeOwner,
        text: d.text ?? "",
        confidence: d.confidence ?? null
      });
    }
  }
  notes.sort((a, b) => cmpStr(a.q, b.q));
  for (const c of claims) {
    if (!c.template) continue;
    const t = templates.get(c.template);
    for (const k of t?.item.notes ?? []) {
      const subjects = new Set<string>();
      if (c.bearer) {
        if (unitByQ.has(c.bearer)) subjects.add(`unit ${c.bearer}`);
        else if (compByQ.has(c.bearer)) subjects.add(`component ${c.bearer}`);
        else subjects.add(`resource ${c.bearer}`);
      }
      for (const id of c.ids) {
        subjects.add(`rule ${id}`);
        subjects.add(`law ${id}`);
      }
      if (!notes.some((n) => n.kind === k && n.about.some((a) => subjects.has(a))))
        err(
          "E-note-missing",
          `claim ${c.ids[0] ?? c.fp}`,
          `${c.template} requires a ${k} note about ${c.bearer ?? c.ids[0]}`
        );
    }
  }

  // ---- E-route, E-policy (head well-formedness, A.9.4) -------------------------------------------
  for (const c of claims) {
    if (c.op !== "law" || !c.requirement) continue;
    const r = c.requirement;
    const tp = c.tier === "final" ? policy.tiers.critical : policy.tiers[c.tier];
    const floor = tp.floor;
    const level: Level = levelRank(r.level) >= levelRank(floor) ? r.level : floor;
    if (r.judged && tp.judges.length === 0)
      err("E-policy", `claim ${c.ids[0]}`, "or judged without judges");
    const routed =
      level === "declared" ||
      providers.some(
        (p) =>
          lawDecidedBy(c, p) &&
          p.produces.some(
            (k) =>
              (k === "test" && levelRank(level) <= 1) || (k === "proof" && levelRank(level) <= 2)
          )
      ) ||
      (r.judged && tp.judges.length > 0);
    if (!routed)
      err("E-route", `claim ${c.ids[0]}`, `no route establishes ${c.ids[0]} at ${level}`);
  }
  for (const a of actors.values())
    if (a.kind === "agent" && !a.operator)
      err("E-policy", `actor ${a.q}`, "an agent needs an operator");
  {
    const persons = (q: string): Set<string> => personsOf(q, actors);
    const finalOwners = new Set<string>();
    for (const c of claims) if (c.tier === "final") finalOwners.add(c.owner);
    for (const x of [...resources, ...components, ...units])
      if (x.tier === "final") finalOwners.add(x.owner);
    for (const o of finalOwners) {
      const a = persons(o);
      const b = persons(shapeOwner);
      const two = [...a].some((p) => [...b].some((s) => s !== p));
      if (!two)
        err(
          "E-policy",
          `owner ${o}`,
          "a final item needs two distinct persons across its owner and the shape owner"
        );
    }
  }

  const effects = [...implies.entries()]
    .map(([verb, s]) => ({ verb, implies: [...s].sort(cmpStr) }))
    .sort((a, b) => cmpStr(a.verb, b.verb));
  const esf: ESF = {
    v: "shape.elaborated.v1",
    shape: { q: shapeQ, owner: shapeOwner, policy: policyEntry?.q ?? "std::DefaultPolicy" },
    actors: [...actors.values()].sort((a, b) => cmpStr(a.q, b.q)),
    effects,
    kinds: [...kinds.values()].sort((a, b) => cmpStr(a.name, b.name)),
    hatches: hatches.sort((a, b) => cmpStr(`${a.kind}@${a.lang}`, `${b.kind}@${b.lang}`)),
    resources: resources.sort((a, b) => cmpStr(a.q, b.q)),
    components: components.sort((a, b) => cmpStr(a.q, b.q)),
    units: units.sort((a, b) => cmpStr(a.q, b.q)),
    claims,
    templates: [...templates.values()].map((t) => t.item).sort((a, b) => cmpStr(a.q, b.q)),
    exceptions,
    notes,
    providers,
    policy,
    errors: dedupeErrors(errors)
  };
  return esf;
}

function clauseTag(op: Op, args: Args): string {
  if (op === "effect.forbid") return String(args.atom).split("<")[0] ?? "";
  if (op === "edge.forbid") return String(args.kind);
  if (op === "path.forbid" || op === "cycle.forbid") return (args.kinds as string[]).join("+");
  return op;
}

export function impliesStar(implies: Map<string, Set<string>>, a: string, b: string): boolean {
  if (a === b) return true;
  const seen = new Set<string>();
  const stack = [a];
  while (stack.length > 0) {
    const v = stack.pop() as string;
    if (v === b) return true;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const i of implies.get(v) ?? []) stack.push(i);
  }
  return false;
}

export function canonChannel(ch: string): string {
  const t = ch.trim();
  const m = /^effect\((.+)\)$/.exec(t);
  if (m) return `effect(${canonResourceCode(m[1] ?? "") ?? m[1]})`;
  const e = /^edge\(\s*([\w]+)\s*(?:,\s*(.+))?\)$/.exec(t);
  if (e) return e[2] ? `edge(${e[1]}, ${canonResourceCode(e[2]) ?? e[2]})` : `edge(${e[1]})`;
  return t.replace(/\s+/g, "");
}

/** Does provider p decide law c (decides template Q / statements L)? */
export function lawDecidedBy(c: Claim, p: ProviderItem): boolean {
  if (c.op !== "law") return false;
  const st = c.args.statement as { schema?: string; ref?: string; text?: string };
  for (const d of p.decides) {
    if (st.schema && d === `template ${st.schema}`) return true;
    if (st.ref && d === `statements ${st.ref.split(":")[0]}`) return true;
  }
  return false;
}

export function personsOf(
  q: string,
  actors: Map<string, Actor> | Actor[],
  seen = new Set<string>()
): Set<string> {
  const map = actors instanceof Map ? actors : new Map(actors.map((a) => [a.q, a]));
  const out = new Set<string>();
  if (seen.has(q)) return out;
  seen.add(q);
  const a = map.get(q);
  if (!a) return out;
  if (a.kind === "person") out.add(a.q);
  else if (a.kind === "team")
    for (const m of a.members) for (const p of personsOf(m, map, seen)) out.add(p);
  return out;
}

/** Members of an owner, one eligible actor per member: persons and agents (A.6.2.5). */
export function membersOf(
  q: string,
  actors: Map<string, Actor> | Actor[],
  seen = new Set<string>()
): Set<string> {
  const map = actors instanceof Map ? actors : new Map(actors.map((a) => [a.q, a]));
  const out = new Set<string>();
  if (seen.has(q)) return out;
  seen.add(q);
  const a = map.get(q);
  if (!a) return out;
  if (a.kind === "team")
    for (const m of a.members) for (const p of membersOf(m, map, seen)) out.add(p);
  else out.add(a.q);
  return out;
}

function resolveClaimRef(
  t: string,
  _m: SourceModule,
  claims: Claim[],
  lookupQ: (name: string, sorts: string[]) => string | null
): string[] {
  const m = /^(rule|law|relation|authority|claim)\s+(.+)$/.exec(t);
  if (!m) return [];
  const kind = m[1] as string;
  const name = (m[2] ?? "").trim();
  if (kind === "claim") {
    const n = name.replace(/^"|"$/g, "");
    if (n.startsWith("c:"))
      return claims.filter((c) => c.fp.slice(7).startsWith(n.slice(2))).map((c) => c.fp);
    return claims.filter((c) => c.ids.includes(n)).map((c) => c.fp);
  }
  if (kind === "authority") {
    const q = lookupQ(name, ["component"]);
    return q ? claims.filter((c) => c.ids.includes(`${q}/authority`)).map((c) => c.fp) : [];
  }
  const q = lookupQ(name, [kind]);
  if (!q) return [];
  return claims
    .filter((c) => c.ids.some((id) => id === q || id.startsWith(`${q}/`)))
    .map((c) => c.fp);
}

function buildPolicy(
  entry: Entry | null,
  resolveActor: (name: string, mod: SourceModule) => string | null,
  err: (code: string, subject: string, message: string) => void
): Policy {
  const std = STD.decls.find((d) => d.decl === "policy" && d.name === "DefaultPolicy") as Extract<
    Decl,
    { decl: "policy" }
  >;
  const d = entry && entry.decl.decl === "policy" ? entry.decl : std;
  const mod = entry?.module ?? STD;
  const tier = (t: "low" | "normal" | "critical"): TierPolicy => {
    const src = d.tiers[t] ?? std.tiers[t] ?? {};
    const judges = (src.judges ?? ["owner"]).flatMap((j) => {
      if (j === "owner" || j === "agents") return [j];
      const q = resolveActor(j, mod);
      if (!q) err("E-policy", `policy ${t}`, `unresolved judge ${j}`);
      return q ? [q] : [];
    });
    return {
      floor: src.floor ?? "declared",
      blocks: [...new Set(src.blocks ?? [])].sort(cmpStr),
      maxAge: src.maxAge ?? 365,
      judges: sortedUniq(judges)
    };
  };
  return {
    tiers: { low: tier("low"), normal: tier("normal"), critical: tier("critical") },
    budget: d.budget ?? null
  };
}

function dedupeErrors(errors: ShapeError[]): ShapeError[] {
  const seen = new Set<string>();
  const out: ShapeError[] = [];
  for (const e of errors) {
    const k = `${e.code}\u0000${e.subject}\u0000${e.message ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort(
    (a, b) =>
      cmpStr(`${a.code}\u0000${a.subject}`, `${b.code}\u0000${b.subject}`) ||
      cmpStr(a.message ?? "", b.message ?? "")
  );
}
