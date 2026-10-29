// Ordering helpers: every output list is sorted by codepoint (A.0.2).

/** Maps a UTF-16 code unit so that comparing mapped units yields codepoint order. */
function unitKey(u: number): number {
  if (u >= 0xd800 && u <= 0xdfff) return u + 0x2000;
  if (u >= 0xe000) return u - 0x800;
  return u;
}

export function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return unitKey(x) - unitKey(y);
  }
  return a.length - b.length;
}

export type Key = string | number | boolean | null;

export function cmpKey(a: Key, b: Key): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
  return cmpStr(String(a), String(b));
}

export function cmpTuple(a: readonly Key[], b: readonly Key[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const c = cmpKey(a[i] ?? null, b[i] ?? null);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

export function sortStrings(xs: Iterable<string>): string[] {
  return [...xs].sort(cmpStr);
}

export function sortedUniq(xs: Iterable<string>): string[] {
  return [...new Set(xs)].sort(cmpStr);
}

export function sortBy<T>(xs: Iterable<T>, key: (x: T) => readonly Key[]): T[] {
  return [...xs]
    .map((x) => ({ x, k: key(x) }))
    .sort((p, q) => cmpTuple(p.k, q.k))
    .map((p) => p.x);
}

export function minBy<T>(xs: Iterable<T>, key: (x: T) => readonly Key[]): T | undefined {
  let best: T | undefined;
  let bestKey: readonly Key[] | undefined;
  for (const x of xs) {
    const k = key(x);
    if (bestKey === undefined || cmpTuple(k, bestKey) < 0) {
      best = x;
      bestKey = k;
    }
  }
  return best;
}

export function groupBy<T>(xs: Iterable<T>, key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function setUnion<T>(...sets: Iterable<T>[]): Set<T> {
  const out = new Set<T>();
  for (const s of sets) for (const x of s) out.add(x);
  return out;
}

export function isSubset<T>(a: Iterable<T>, b: Set<T>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function pushMap<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function nfc(s: string): string {
  return s.normalize("NFC");
}

export function collapseWs(s: string): string {
  return nfc(s).replace(/\s+/g, " ").trim();
}

/** Integer UTC seconds from an RFC 3339 string or a date (A.0.5). Returns null when unparsable. */
export function toSeconds(s: string): number | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      s
    );
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, tz] = m;
  let t = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh ?? 0),
    Number(mm ?? 0),
    Number(ss ?? 0)
  );
  if (tz && tz !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const [th, tm] = tz.slice(1).split(":");
    t -= sign * (Number(th) * 3600 + Number(tm) * 60) * 1000;
  }
  return Math.floor(t / 1000);
}

export function fromSeconds(t: number): string {
  return `${new Date(t * 1000).toISOString().slice(0, 19)}Z`;
}

export const TIERS = ["low", "normal", "critical", "final"] as const;
export type Tier = (typeof TIERS)[number];
export function tierRank(t: Tier): number {
  return TIERS.indexOf(t);
}
export function maxTier(...ts: Tier[]): Tier {
  let best: Tier = "low";
  for (const t of ts) if (tierRank(t) > tierRank(best)) best = t;
  return best;
}
export function isTier(s: unknown): s is Tier {
  return typeof s === "string" && (TIERS as readonly string[]).includes(s);
}

export const LEVELS = ["declared", "tested", "proven", "none"] as const;
export type Level = (typeof LEVELS)[number];
export function levelRank(l: Level): number {
  return LEVELS.indexOf(l);
}

export function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

export function assertNever(x: never): never {
  throw new Error(`unexpected ${String(x)}`);
}
