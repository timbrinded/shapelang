// Claim strength ⊒ (A.5.6.3-4): equal NF under ρ, the op order, and contributing records; heirs.
import { claimNf } from "./elaborate.ts";
import type { Args, Claim, JsonValue, Op, TemplateItem } from "./model.ts";
import { cmpStr } from "./util.ts";
import { type World, impl, nodeSet } from "./world.ts";
import { parseAtom } from "./model.ts";

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
  const walk = (v: JsonValue): JsonValue => {
    if (typeof v === "string") return fix(v);
    if (Array.isArray(v))
      return v.map(walk).sort((a, b) => cmpStr(JSON.stringify(a), JSON.stringify(b)));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(args);
}

export function renamedFp(c: Claim, rho: Map<string, string>): string {
  const args = renameArgs(c.args, rho) as Args;
  // keep scalar arrays sorted as the NF requires
  return claimNf(c.op, normaliseArrays(args) as Args).fp;
}

function normaliseArrays(v: JsonValue): JsonValue {
  if (Array.isArray(v)) {
    const xs = v.map(normaliseArrays);
    return xs.every((x) => typeof x === "string") ? [...new Set(xs as string[])].sort(cmpStr) : xs;
  }
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normaliseArrays(x)]));
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
