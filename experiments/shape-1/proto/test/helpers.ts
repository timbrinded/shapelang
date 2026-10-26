// Test helpers: deep clone, seeded permutation of semantically unordered input lists, lookups.
import { derive } from "../src/derive.ts";
import type { CheckInput, CheckOutput, ObligationOut } from "../src/io-types.ts";
import { type ManifestPredicate, manifestStatement } from "../src/manifest.ts";
import type { SourceDoc } from "../src/source.ts";

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], r: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function permuteSource(s: SourceDoc | null, r: () => number): SourceDoc | null {
  if (!s) return s;
  return {
    ...s,
    modules: shuffle(
      s.modules.map((m) => ({
        ...m,
        imports: shuffle(m.imports ?? [], r),
        decls: shuffle(
          m.decls.map((d) => (d.decl === "component" && d.units ? { ...d, units: shuffle(d.units, r), grants: Array.isArray(d.grants) ? shuffle(d.grants, r) : d.grants } : d)),
          r
        )
      })),
      r
    )
  };
}

function permuteManifest(st: CheckInput["head"]["manifest"], r: () => number): CheckInput["head"]["manifest"] {
  const p = st.predicate.shape as ManifestPredicate;
  const shuffled = { ...p, tree: shuffle(p.tree, r), entries: shuffle(p.entries, r) };
  // the statement subject is over the sorted predicate, so it is unchanged; keep the shuffled body
  const s = manifestStatement(p);
  return { ...s, predicate: { ...s.predicate, shape: shuffled } };
}

/** Permutes every list whose order carries no meaning (T1). */
export function permute(input: CheckInput, seed: number): CheckInput {
  const r = rng(seed);
  const x = clone(input);
  x.head = { ...x.head, source: permuteSource(x.head.source, r), manifest: permuteManifest(x.head.manifest, r) };
  if (x.base) x.base = { ...x.base, source: permuteSource(x.base.source, r), manifest: permuteManifest(x.base.manifest, r) };
  x.records = shuffle(x.records, r);
  x.baseRecords = shuffle(x.baseRecords, r);
  x.reviews = shuffle(x.reviews, r);
  x.authors = shuffle(x.authors, r);
  x.change = { ids: shuffle(x.change.ids, r) };
  return x;
}

export function run(input: CheckInput): CheckOutput {
  return derive(input);
}

export function ob(out: CheckOutput, keyPrefix: string): ObligationOut | undefined {
  return out.obligations.find((o) => o.key.startsWith(keyPrefix));
}

export function obsOf(out: CheckOutput, kind: ObligationOut["kind"]): ObligationOut[] {
  return out.obligations.filter((o) => o.kind === kind);
}
