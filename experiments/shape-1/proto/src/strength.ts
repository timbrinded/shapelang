// Claim strength ⊒ (A.5.6.3-4): equal NF under ρ, the op order, and contributing records; heirs.
import { claimNf } from "./elaborate.ts";
import type { Args, Claim, JsonValue, Op, TemplateItem } from "./model.ts";
import { cmpStr } from "./util.ts";
import { type World, impl, nodeSet } from "./world.ts";
import { parseAtom } from "./model.ts";
// version 7: hosted heirs need equal closure digests [D13]; heirs are computed for both passes

/** Renames qualified names in an NF's args by ρ (base Q → head Q). */
export function renameArgs(args: JsonValue, rho: Map<string, string>): JsonValue {
  const keys = [...rho.entries()]
    .filter(([a, b]) => a !== b)
    .sort((a, b) => b[0].length - a[0].length || cmpStr(a[0], b[0]));
  if (keys.length === 0) return args;
  const fix = (s: string): string => {
    let out = s;
    for (const [from, to] of keys) {
      const re = new RegExp(
        `(^|[\\s<])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s>.]|\\.\\*)`,
        "g"
      );
      out = out.replace(re, (_m, p: string) => `${p}${to}`);
    }
    return out;
  };
  // a schema statement's args are the template's parameters in order: renaming keeps their
  // positions (A.5.6, A.6.2.1: NFs equal after renaming); every other array is a set
  const walk = (v: JsonValue, positional = false): JsonValue => {
    if (typeof v === "string") return fix(v);
    if (Array.isArray(v)) {
      const xs = v.map((x) => walk(x));
      return positional ? xs : xs.sort((a, b) => cmpStr(JSON.stringify(a), JSON.stringify(b)));
    }
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, isSchemaArgs(v, k))])
      );
    return v;
  };
  return walk(args);
}

/** The args of a schema statement {schema, schemaFp, args}: a positional list. */
function isSchemaArgs(o: { [k: string]: JsonValue }, k: string): boolean {
  return k === "args" && typeof o.schema === "string" && Array.isArray(o.args);
}

export function renamedFp(c: Claim, rho: Map<string, string>): string {
  const args = renameArgs(c.args, rho) as Args;
  // keep scalar arrays sorted as the NF requires
  return claimNf(c.op, normaliseArrays(args) as Args).fp;
}

function normaliseArrays(v: JsonValue, positional = false): JsonValue {
  if (Array.isArray(v)) {
    const xs = v.map((x) => normaliseArrays(x));
    return !positional && xs.every((x) => typeof x === "string")
      ? [...new Set(xs as string[])].sort(cmpStr)
      : xs;
  }
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, normaliseArrays(x, isSchemaArgs(v, k))])
    );
  return v;
}

function supset(a: Set<string>, b: Set<string>): boolean {
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

function cmpValue(a: JsonValue, b: JsonValue): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return cmpStr(a, b);
  return null;
}

/** Op order: does `a` (head-side) hold at least as strictly as `b` (renamed base)? */
export function opOrderGeq(
  a: { op: Op; args: Args },
  b: { op: Op; args: Args },
  w: World,
  templates: Map<string, TemplateItem>
): boolean {
  if (a.op !== b.op) return false;
  if (claimNf(a.op, a.args).fp === claimNf(b.op, b.args).fp) return true;
  const ns = (x: JsonValue | undefined): Set<string> => nodeSet(w, (x as string[]) ?? []);
  switch (a.op) {
    case "effects.upper": {
      if (a.args.unit !== b.args.unit) return false;
      const ca = a.args.atoms as string[];
      const cb = b.args.atoms as string[];
      // cl(C_a) ⊆ cl(C_b): every atom of a is implied by some atom of b on the same resource
      return ca.every((x) => {
        const p = parseAtom(x);
        return (
          !!p &&
          cb.some((y) => {
            const q = parseAtom(y);
            return !!q && q.resource === p.resource && impl(w, q.verb, p.verb);
          })
        );
      });
    }
    case "path.forbid":
      return (
        supset(ns(a.args.from), ns(b.args.from)) &&
        supset(ns(a.args.to), ns(b.args.to)) &&
        supset(new Set(a.args.kinds as string[]), new Set(b.args.kinds as string[])) &&
        supset(ns(b.args.exceptVia), ns(a.args.exceptVia))
      );
    case "edge.forbid":
      return (
        a.args.kind === b.args.kind &&
        supset(ns(a.args.from), ns(b.args.from)) &&
        supset(ns(a.args.to), ns(b.args.to)) &&
        supset(ns(b.args.exceptFrom), ns(a.args.exceptFrom)) &&
        supset(ns(b.args.exceptTo), ns(a.args.exceptTo))
      );
    case "cycle.forbid":
      return supset(new Set(a.args.kinds as string[]), new Set(b.args.kinds as string[]));
    case "law": {
      const sa = a.args.statement as { schema?: string; schemaFp?: string; args?: JsonValue[] };
      const sb = b.args.statement as { schema?: string; schemaFp?: string; args?: JsonValue[] };
      if (!sa.schema || sa.schema !== sb.schema || sa.schemaFp !== sb.schemaFp) return false;
      if (JSON.stringify(a.args.on) !== JSON.stringify(b.args.on)) return false;
      const t = templates.get(sa.schema);
      if (!t) return false;
      const order = new Map(t.order);
      return t.params.every(([p], i) => {
        const x = sa.args?.[i] ?? null;
        const y = sb.args?.[i] ?? null;
        const dir = order.get(p) ?? "equal";
        if (dir === "equal") return JSON.stringify(x) === JSON.stringify(y);
        const c = cmpValue(x, y);
        if (dir === "geq") return c !== null && c >= 0;
        if (dir === "leq") return c !== null && c <= 0;
        const xs = new Set(Array.isArray(x) ? (x as string[]) : [String(x)]);
        const ys = new Set(Array.isArray(y) ? (y as string[]) : [String(y)]);
        return dir === "subset" ? supset(ys, xs) : supset(xs, ys);
      });
    }
    default:
      return false;
  }
}

export interface HeirEnv {
  /** base ESF claims and head ESF claims */
  baseClaims: Claim[];
  headClaims: Claim[];
  rho: Map<string, string>;
  /** the head world (node sets of selectors) */
  w: World;
  templates: Map<string, TemplateItem>;
  /** contributing claim-space equivalence records: fp → fps it implies */
  claimImplies: Map<string, Set<string>>;
  /** hosted laws: are the statement ref's closure digests ≡ between M_b and M_h? (A.5.6.4) */
  closureEqual: (ref: string) => boolean;
}

/** H(c_b) = {c_h ⊒ ρc_b}; effect forbids and authority: equal NF only (A.6.2.1, A.5.6.3-4). */
export function computeHeirs(env: HeirEnv): {
  heirs: Map<string, string[]>;
  heirOf: Map<string, string[]>;
} {
  const heirs = new Map<string, string[]>();
  const heirOf = new Map<string, string[]>();
  for (const cb of env.baseClaims) {
    const rfp = renamedFp(cb, env.rho);
    const ren = { op: cb.op, args: renameArgs(cb.args, env.rho) as Args };
    const hosted = cb.op === "law" ? (cb.args.statement as { ref?: string }).ref : undefined;
    const hs: string[] = [];
    for (const ch of env.headClaims) {
      if (ch.op !== cb.op) continue;
      let ok = ch.fp === rfp || ch.fp === cb.fp;
      if (ok && hosted !== undefined && !env.closureEqual(hosted)) ok = false;
      if (!ok && cb.op !== "effect.forbid" && cb.op !== "authority" && hosted === undefined)
        ok = opOrderGeq(ch, ren, env.w, env.templates);
      if (!ok && (env.claimImplies.get(ch.fp)?.has(cb.fp) || env.claimImplies.get(ch.fp)?.has(rfp)))
        ok = true;
      if (ok) hs.push(ch.fp);
    }
    heirs.set(cb.fp, hs.sort(cmpStr));
    for (const h of hs) heirOf.set(h, [...(heirOf.get(h) ?? []), cb.fp].sort(cmpStr));
  }
  return { heirs, heirOf };
}
