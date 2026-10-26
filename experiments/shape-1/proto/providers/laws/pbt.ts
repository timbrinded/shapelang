// The law-file API: seeded property tests under bun:test, bound to Shape law claims.
//
//   import { gen, law } from "<proto>/providers/laws/pbt.ts";
//   law("demo::ClampBounded", gen.tuple(gen.int(-50, 150)), ([x]) => clamp(x) >= 0 && clamp(x) <= 100,
//       { runs: 500, seed: 42 });
//   law.check("demo::Math.sum/Deterministic/law", () => sum([1, 2]) === 3);
//
// The first argument names the claim exactly as `shape judge` lines do: its id, or c:<≥16 hex of
// its fp>. Each law() is one bun test. When SHAPE_LAWS_OUT names a file, every law appends one JSON
// line {claim, name, file, result, runs, seed, counterexample?, error?} that the laws provider turns
// into a Test Result record; without it law files are ordinary tests. Generators are integer-only
// so counterexamples stay float-free (A.0.4).
import { appendFileSync } from "node:fs";
import { test } from "bun:test";

export type Rng = () => number;

/** Mulberry32: a deterministic 32-bit generator; returns integers in [0, 2^32). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export interface Gen<T> {
  /** draws a value; `size` grows from 0 to 100 over a run so small cases come first */
  sample(r: Rng, size: number): T;
  /** smaller candidates, simplest first */
  shrink(v: T): T[];
}

function intIn(r: Rng, lo: number, hi: number): number {
  const span = hi - lo + 1;
  return lo + (r() % span);
}

function shrinkInt(v: number, lo: number, hi: number): number[] {
  const target = lo <= 0 && hi >= 0 ? 0 : lo;
  if (v === target) return [];
  const out = new Set<number>([target]);
  let d = Math.trunc((v - target) / 2);
  while (d !== 0) {
    out.add(v - d);
    d = Math.trunc(d / 2);
  }
  out.add(v > target ? v - 1 : v + 1);
  return [...out].filter((x) => x >= lo && x <= hi && x !== v);
}

export const gen = {
  /** an integer in [lo, hi] (safe integers) */
  int(lo: number, hi: number): Gen<number> {
    return {
      sample: (r, size) => {
        const scale = Math.max(1, Math.floor(((hi - lo) * Math.max(size, 1)) / 100));
        const centre = lo <= 0 && hi >= 0 ? 0 : lo;
        const a = Math.max(lo, centre - scale);
        const b = Math.min(hi, centre + scale);
        return r() % 10 === 0 ? intIn(r, lo, hi) : intIn(r, a, b);
      },
      shrink: (v) => shrinkInt(v, lo, hi)
    };
  },
  nat(max = 1000): Gen<number> {
    return gen.int(0, max);
  },
  bool(): Gen<boolean> {
    return { sample: (r) => r() % 2 === 0, shrink: (v) => (v ? [false] : []) };
  },
  constant<T>(v: T): Gen<T> {
    return { sample: () => v, shrink: () => [] };
  },
  oneOf<T>(xs: readonly T[]): Gen<T> {
    if (xs.length === 0) throw new Error("gen.oneOf: empty");
    return {
      sample: (r) => xs[r() % xs.length] as T,
      shrink: (v) => {
        const i = xs.indexOf(v);
        return i > 0 ? xs.slice(0, i) : [];
      }
    };
  },
  string(alphabet = "abc", maxLen = 8): Gen<string> {
    const chars = [...alphabet];
    return {
      sample: (r, size) => {
        const n = intIn(r, 0, Math.max(0, Math.min(maxLen, Math.ceil((maxLen * Math.max(size, 1)) / 100))));
        let s = "";
        for (let i = 0; i < n; i += 1) s += chars[r() % chars.length] as string;
        return s;
      },
      shrink: (v) => {
        const out: string[] = [];
        if (v.length > 0) out.push("", v.slice(1), v.slice(0, -1));
        return [...new Set(out)].filter((x) => x !== v);
      }
    };
  },
  array<T>(g: Gen<T>, maxLen = 10): Gen<T[]> {
    return {
      sample: (r, size) => {
        const n = intIn(r, 0, Math.max(0, Math.min(maxLen, Math.ceil((maxLen * Math.max(size, 1)) / 100))));
        const out: T[] = [];
        for (let i = 0; i < n; i += 1) out.push(g.sample(r, size));
        return out;
      },
      shrink: (v) => {
        const out: T[][] = [];
        if (v.length > 0) out.push([]);
        for (let i = 0; i < v.length; i += 1) out.push([...v.slice(0, i), ...v.slice(i + 1)]);
        for (let i = 0; i < v.length; i += 1) for (const s of g.shrink(v[i] as T).slice(0, 3)) out.push([...v.slice(0, i), s, ...v.slice(i + 1)]);
        return out;
      }
    };
  },
  tuple<T extends unknown[]>(...gs: { [K in keyof T]: Gen<T[K]> }): Gen<T> {
    return {
      sample: (r, size) => gs.map((g) => g.sample(r, size)) as T,
      shrink: (v) => {
        const out: T[] = [];
        gs.forEach((g, i) => {
          for (const s of g.shrink(v[i])) {
            const c = [...v] as T;
            c[i] = s;
            out.push(c);
          }
        });
        return out;
      }
    };
  },
  record<T extends Record<string, unknown>>(shape: { [K in keyof T]: Gen<T[K]> }): Gen<T> {
    const keys = Object.keys(shape).sort() as (keyof T)[];
    return {
      sample: (r, size) => {
        const o = {} as T;
        for (const k of keys) o[k] = shape[k].sample(r, size);
        return o;
      },
      shrink: (v) => {
        const out: T[] = [];
        for (const k of keys) for (const s of shape[k].shrink(v[k])) out.push({ ...v, [k]: s });
        return out;
      }
    };
  },
  map<A, B>(g: Gen<A>, f: (a: A) => B): Gen<B> {
    // shrinking through f is not invertible; mapped generators shrink by resampling smaller sizes
    return { sample: (r, size) => f(g.sample(r, size)), shrink: () => [] };
  }
};

export interface LawOptions {
  runs?: number;
  seed?: number;
  /** a label distinguishing several laws on one claim */
  name?: string;
  /** a short description of the tested domain, copied into the record's bound */
  domain?: string;
  timeout?: number;
}

export interface LawLine {
  claim: string;
  name: string;
  file: string;
  result: "supports" | "contradicts" | "inconclusive";
  runs: number;
  seed: number;
  domain?: string;
  counterexample?: unknown;
  error?: string;
}

/** Float-free, JSON-only rendering of a counterexample (A.0.4). */
export function jsonSafe(v: unknown, depth = 0): unknown {
  if (depth > 20) return "…";
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case "number":
      return Number.isSafeInteger(v) ? v : String(v);
    case "bigint":
      return `${v.toString()}n`;
    case "string":
    case "boolean":
      return v;
    case "function":
    case "symbol":
      return String(v);
    case "object": {
      if (Array.isArray(v)) return v.map((x) => jsonSafe(x, depth + 1));
      if (v instanceof Map) return { $map: [...v.entries()].map(([a, b]) => [jsonSafe(a, depth + 1), jsonSafe(b, depth + 1)]) };
      if (v instanceof Set) return { $set: [...v].map((x) => jsonSafe(x, depth + 1)) };
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = jsonSafe((v as Record<string, unknown>)[k], depth + 1);
      return out;
    }
    default:
      return String(v);
  }
}

function caller(): string {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    const m = /\(?((?:file:\/\/)?\/[^():]+):\d+:\d+\)?\s*$/.exec(line);
    if (m && m[1] && !m[1].endsWith("/laws/pbt.ts")) return m[1].replace(/^file:\/\//, "");
  }
  return "";
}

function report(line: LawLine): void {
  const out = process.env.SHAPE_LAWS_OUT;
  if (!out) return;
  appendFileSync(out, `${JSON.stringify(line)}\n`);
}

function holds<T>(prop: (v: T) => boolean | void, v: T): { ok: boolean; error?: string } {
  try {
    const r = prop(v);
    return { ok: r !== false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs a property over seeded samples; on failure shrinks greedily (≤ 500 steps). */
export function checkProperty<T>(g: Gen<T>, prop: (v: T) => boolean | void, runs: number, seed: number): { ok: true; runs: number } | { ok: false; runs: number; counterexample: T; error?: string } {
  const r = rng(seed);
  for (let i = 0; i < runs; i += 1) {
    const size = runs <= 1 ? 100 : Math.floor((100 * i) / (runs - 1));
    const v = g.sample(r, size);
    const first = holds(prop, v);
    if (first.ok) continue;
    let cur = v;
    let err = first.error;
    let steps = 0;
    let improved = true;
    while (improved && steps < 500) {
      improved = false;
      for (const c of g.shrink(cur)) {
        steps += 1;
        const h = holds(prop, c);
        if (!h.ok) {
          cur = c;
          err = h.error;
          improved = true;
          break;
        }
        if (steps >= 500) break;
      }
    }
    return err === undefined ? { ok: false, runs: i + 1, counterexample: cur } : { ok: false, runs: i + 1, counterexample: cur, error: err };
  }
  return { ok: true, runs };
}

function defaultSeed(): number {
  const s = Number(process.env.SHAPE_LAWS_SEED ?? "42");
  return Number.isSafeInteger(s) ? s : 42;
}

/** A property-test law bound to a claim. */
export function law<T>(claim: string, g: Gen<T>, prop: (v: T) => boolean | void, opts: LawOptions = {}): void {
  const runs = opts.runs ?? 200;
  const seed = opts.seed ?? defaultSeed();
  const name = opts.name ?? "";
  const file = caller();
  test(
    `law ${claim}${name ? ` (${name})` : ""}`,
    () => {
      const res = checkProperty(g, prop, runs, seed);
      const base = { claim, name, file, runs: res.runs, seed, ...(opts.domain ? { domain: opts.domain } : {}) };
      if (res.ok) {
        report({ ...base, result: "supports" });
        return;
      }
      const ce = jsonSafe(res.counterexample);
      report({ ...base, result: "contradicts", counterexample: ce, ...(res.error ? { error: res.error } : {}) });
      throw new Error(`law ${claim} fails on ${JSON.stringify(ce)}${res.error ? `: ${res.error}` : ""}`);
    },
    opts.timeout
  );
}

/** A single deterministic example bound to a claim (one run, seed 0). A failing example is a
 *  reproducible counterexample, recorded as {example: <name>}. */
law.check = (claim: string, fn: () => boolean | void, opts: Omit<LawOptions, "runs" | "seed"> = {}): void => {
  const name = opts.name ?? "";
  const file = caller();
  test(
    `law ${claim}${name ? ` (${name})` : ""}`,
    () => {
      const h = holds(() => fn(), null);
      const base = { claim, name, file, runs: 1, seed: 0, ...(opts.domain ? { domain: opts.domain } : {}) };
      if (h.ok) {
        report({ ...base, result: "supports" });
        return;
      }
      const ce = { example: name || "check" };
      report({ ...base, result: "contradicts", counterexample: ce, ...(h.error ? { error: h.error } : {}) });
      throw new Error(`law ${claim} fails on example ${ce.example}${h.error ? `: ${h.error}` : ""}`);
    },
    opts.timeout
  );
};
