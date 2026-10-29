// Law kit: seeded generators and a property runner for Shape's own laws.
//
// Each law test is named by the law's claim id (`module::LawName`). `lawTest` runs the property
// over generated cases and
//   - appends the verdict to $SHAPE_LAW_RESULTS (JSONL) when set, which the bunTest provider
//     reads: the property's outcome, not the test's;
//   - asserts the verdict the dogfood currently expects, so the repository's `bun test` stays
//     green while a contradicted law is documented by its counterexample ("fails").
import { test } from "bun:test";
import { appendFileSync } from "node:fs";

export interface Rng {
  /** uniform in [0, 1) */
  next(): number;
  /** integer in [lo, hi] */
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  bool(p?: number): boolean;
  shuffle<T>(xs: readonly T[]): T[];
  subset<T>(xs: readonly T[], min?: number): T[];
}

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => {
    if (xs.length === 0) throw new Error("pick from empty list");
    return xs[int(0, xs.length - 1)] as T;
  };
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  const subset = <T>(xs: readonly T[], min = 0): T[] => {
    const out = xs.filter(() => next() < 0.5);
    while (out.length < Math.min(min, xs.length)) {
      const x = pick(xs);
      if (!out.includes(x)) out.push(x);
    }
    return out;
  };
  return { next, int, pick, bool: (p = 0.5) => next() < p, shuffle, subset };
}

export interface Verdict {
  law: string;
  holds: boolean;
  cases: number;
  seed: number;
  /** the first failing case: its index and a float-free description */
  counterexample: { index: number; detail: string } | null;
}

/**
 * Checks `prop` over `cases` generated inputs. `prop` returns null when the property holds for
 * the case, else a short description of the violation.
 */
export function property<C>(
  law: string,
  opts: { cases: number; seed: number },
  gen: (r: Rng, i: number) => C,
  prop: (c: C) => string | null
): Verdict {
  const r = rng(opts.seed);
  for (let i = 0; i < opts.cases; i += 1) {
    const c = gen(r, i);
    let detail: string | null;
    try {
      detail = prop(c);
    } catch (e) {
      detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (detail !== null)
      return {
        law,
        holds: false,
        cases: i + 1,
        seed: opts.seed,
        counterexample: { index: i, detail: detail.slice(0, 2000) }
      };
  }
  return { law, holds: true, cases: opts.cases, seed: opts.seed, counterexample: null };
}

export function record(v: Verdict): void {
  const out = process.env.SHAPE_LAW_RESULTS;
  if (out) appendFileSync(out, `${JSON.stringify(v)}\n`);
}

/**
 * Registers the law's test. `expect` is what the dogfood currently records for the law:
 * "holds", or "fails" for a law whose clause the implementation contradicts.
 */
export function lawTest(
  law: string,
  expect: "holds" | "fails",
  run: () => Verdict,
  timeoutMs = 60_000
): void {
  test(
    law,
    () => {
      const v = run();
      record(v);
      if (expect === "holds" && !v.holds)
        throw new Error(
          `${law} fails at case ${v.counterexample?.index}: ${v.counterexample?.detail}`
        );
      if (expect === "fails" && v.holds)
        throw new Error(`${law} now holds over ${v.cases} cases; record it as "holds"`);
    },
    timeoutMs
  );
}

/** Stable JSON with Maps and Sets as sorted entry lists (for comparing models and results). */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Map)
      return {
        $map: [...v.entries()]
          .map(([k, x]) => [String(k), x])
          .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))
      };
    if (v instanceof Set)
      return { $set: [...v].map((x) => (typeof x === "string" ? x : JSON.stringify(x))).sort() };
    return v;
  });
}

/** Identifier pool (Shape IDs are ASCII): mixed case, digits and underscores, so codepoint order
 *  (B < _ < a) differs from locale order. */
export const NAMES = [
  "Alpha",
  "Bravo",
  "charlie",
  "Delta",
  "Echo",
  "Zulu",
  "_hidden",
  "a",
  "B",
  "Z",
  "z",
  "Ab",
  "aB",
  "a_b",
  "A9",
  "a10",
  "a2",
  "Ledger",
  "Catalog",
  "Store",
  "Gateway",
  "Policy",
  "Vault"
];

export function distinctNames(r: Rng, n: number, prefix = ""): string[] {
  const pool = r.shuffle(NAMES);
  const out: string[] = [];
  for (let i = 0; out.length < n; i += 1)
    out.push(
      `${prefix}${pool[i % pool.length]}${i >= pool.length ? String(Math.floor(i / pool.length)) : ""}`
    );
  return out;
}

/**
 * Stable, cycle-safe serialisation of checker models: Maps and Sets as sorted entries, Langium
 * AST back-references (keys starting with `$`) dropped, and a back edge to an ancestor printed
 * as "[cycle]".
 */
export function stableDeep(value: unknown): string {
  const ancestors: object[] = [];
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return typeof v === "bigint" ? `${v}n` : v;
    if (ancestors.includes(v)) return "[cycle]";
    ancestors.push(v);
    let out: unknown;
    if (v instanceof Map)
      out = {
        $map: [...v.entries()]
          .map(([k, x]) => [String(k), walk(x)])
          .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))
      };
    else if (v instanceof Set) out = { $set: [...v].map((x) => JSON.stringify(walk(x))).sort() };
    else if (Array.isArray(v)) out = v.map(walk);
    else {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort())
        if (!k.startsWith("$")) o[k] = walk((v as Record<string, unknown>)[k]);
      out = o;
    }
    ancestors.pop();
    return out;
  };
  return JSON.stringify(walk(value));
}
