// Evidence pipeline: provider governance G* (A.6.2.6), record validation, usable observation
// entries and the observed world W_obs° with presence-soundness and novelty (A.4.4.5, A.7.3.1).
import { H } from "./jcs.ts";
import { type ManifestIndex, ancestorsOrSelf } from "./manifest.ts";
import type { ESF, ProviderItem } from "./model.ts";
import {
  type Fact,
  type ParsedRecord,
  type Rejection,
  type ScopeEntry,
  type ValidationContext,
  mergeRecords,
  parseRecord,
  validateRecord
} from "./records.ts";
import { canonResourceCode, channelMatches } from "./resource-code.ts";
import { cmpStr, sortedUniq } from "./util.ts";

export interface ProvG {
  q: string;
  base: ProviderItem | null;
  head: ProviderItem | null;
  /** (a) contradiction and refutation force: base ∨ head */
  presenceA: boolean;
  absenceA: boolean;
  /** (b) establishing, coverage, deps complete: base ∧ head */
  presenceB: boolean;
  absenceB: boolean;
  depsCompleteB: boolean;
  channelsB: string[];
  channelsA: string[];
  decidesB: string[];
  decidesA: string[];
  /** establishing force at its level only when declared in both (else `declared`) */
  establishes: boolean;
  identity: string | null;
  authenticated: boolean;
  implementationPaths: string[];
  implementationDigests: string[];
  produces: string[];
  trusts: [string, string][];
  persist: boolean;
}

export function providerGovernance(base: ESF, head: ESF): Map<string, ProvG> {
  const out = new Map<string, ProvG>();
  const qs = sortedUniq([...base.providers.map((p) => p.q), ...head.providers.map((p) => p.q)]);
  for (const q of qs) {
    const b = base.providers.find((p) => p.q === q) ?? null;
    const h = head.providers.find((p) => p.q === q) ?? null;
    const both = !!b && !!h;
    const inter = (x: string[] | undefined, y: string[] | undefined): string[] => (x && y ? x.filter((c) => y.includes(c)) : []);
    out.set(q, {
      q,
      base: b,
      head: h,
      presenceA: !!b?.presence || !!h?.presence,
      absenceA: !!b?.absence || !!h?.absence,
      presenceB: both && !!b?.presence && !!h?.presence,
      absenceB: both && !!b?.absence && !!h?.absence,
      depsCompleteB: both && !!b?.depsComplete && !!h?.depsComplete,
      channelsB: inter(b?.observes, h?.observes),
      channelsA: sortedUniq([...(b?.observes ?? []), ...(h?.observes ?? [])]),
      decidesB: inter(b?.decides, h?.decides),
      decidesA: sortedUniq([...(b?.decides ?? []), ...(h?.decides ?? [])]),
      establishes: both,
      identity: b?.identity ?? null,
      authenticated: !!b?.identity,
      implementationPaths: sortedUniq([...(b?.implementation?.paths ?? []), ...(h?.implementation?.paths ?? [])]),
      implementationDigests: sortedUniq(
        [b?.implementation?.digest, h?.implementation?.digest].filter((x): x is string => typeof x === "string")
      ),
      produces: b ? b.produces : (h?.produces ?? []),
      trusts: b?.trusts ?? [],
      persist: b?.persist ?? false
    });
  }
  return out;
}

export interface RecordSet {
  valid: ParsedRecord[];
  rejected: Rejection[];
  persistedIds: Set<string>;
}

export function processRecords(
  raw: unknown[],
  persisted: unknown[],
  vctx: Omit<ValidationContext, "persisted">
): RecordSet {
  const parsed: ParsedRecord[] = [];
  const parsedPersisted: ParsedRecord[] = [];
  const rejected: Rejection[] = [];
  for (const r of raw) {
    const p = parseRecord(r);
    if ("error" in p) rejected.push({ record: H(r), code: "RJ01", detail: p.error });
    else parsed.push(p);
  }
  for (const r of persisted) {
    const p = parseRecord(r);
    if ("error" in p) rejected.push({ record: H(r), code: "RJ01", detail: p.error });
    else parsedPersisted.push(p);
  }
  const persistedIds = new Set(parsedPersisted.map((p) => p.id));
  const all = mergeRecords([...parsed, ...parsedPersisted]);
  const valid: ParsedRecord[] = [];
  for (const r of all) {
    const rej = validateRecord(r, { ...vctx, persisted: persistedIds.has(r.id) });
    if (rej) rejected.push(rej);
    else valid.push(r);
  }
  const seen = new Set<string>();
  const rej2 = rejected
    .filter((r) => {
      const k = `${r.record}|${r.code}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmpStr(a.record, b.record) || cmpStr(a.code, b.code));
  return { valid, rejected: rej2, persistedIds };
}

// ---- facts --------------------------------------------------------------------------------------

export interface WFact {
  fid: string;
  type: "effect" | "hatch" | "call" | "edge" | "declared";
  /** code identity the fact is at (relocated), or null for declared facts of unbound units */
  at: string | null;
  verb: string | null;
  resource: string | null;
  /** call target identity or edge target (identity or resource code) */
  to: string | null;
  kind: string | null;
  /** declared facts: the claim (fp), the unit position and atom */
  claim: string | null;
  unit: string | null;
  atom: string | null;
  declared: boolean;
  observed: boolean;
  presenceSound: boolean;
  relocated: boolean;
  n: number;
  sources: { record: string; provider: string }[];
  raw: Record<string, unknown>;
}

export function factId(f: Record<string, unknown>): string {
  const { n: _n, ...rest } = f;
  void _n;
  const g = { ...rest };
  if (g.type === "effect" && typeof g.resource === "string") g.resource = canonResourceCode(g.resource) ?? g.resource;
  return H(g);
}

export function parentOfId(id: string): string | null {
  const hash = id.indexOf("#");
  if (hash < 0) return null;
  const file = id.slice(0, hash);
  const sym = id.slice(hash + 1);
  const sep = id.startsWith("rust:") || id.startsWith("verus:") ? "::" : ".";
  const i = sym.lastIndexOf(sep);
  return i > 0 ? `${file}#${sym.slice(0, i)}` : file;
}

export interface UsableEntry {
  record: string;
  provider: string;
  entry: ScopeEntry;
  producerChanged: boolean;
}

export interface ObservationIndex {
  /** identity → usable entries anchored there */
  entries: Map<string, UsableEntry[]>;
  facts: WFact[];
  unanchored: number;
  externalCalls: number;
}

function digestOk(man: ManifestIndex, id: string, projection: string, digest: string, equiv: (a: string, b: string) => boolean): boolean {
  const d = man.ids.get(id)?.digests.get(projection);
  return d !== undefined && equiv(d, digest);
}

/** Usable observation entries and their facts at head (A.4.4.5, A.5.4.2). */
export function observedWorld(
  records: ParsedRecord[],
  man: ManifestIndex,
  headRevision: string,
  provs: Map<string, ProvG>,
  producerChanged: (r: ParsedRecord) => boolean,
  equiv: (a: string, b: string) => boolean
): ObservationIndex {
  const entries = new Map<string, UsableEntry[]>();
  const byFid = new Map<string, WFact>();
  let unanchored = 0;
  let externalCalls = 0;
  for (const r of records) {
    if (r.shape.kind !== "observation" || !r.shape.provider) continue;
    const pq = r.shape.provider.id;
    const g = provs.get(pq);
    if (!g) continue;
    const pc = producerChanged(r);
    const usable = new Map<string, ScopeEntry>();
    for (const e of r.shape.scope?.entries ?? []) {
      const atHead = r.shape.revision === headRevision;
      const ok =
        digestOk(man, e.id, e.projection, e.digest, equiv) &&
        (atHead || (g.depsCompleteB && (e.deps ?? []).every((d) => digestOk(man, d.id, d.projection, d.digest, equiv))));
      if (!ok) continue;
      usable.set(e.id, e);
      const list = entries.get(e.id) ?? [];
      list.push({ record: r.id, provider: pq, entry: e, producerChanged: pc });
      entries.set(e.id, list);
    }
    for (const f of r.shape.facts ?? []) {
      if (f.type === "hatch") continue;
      let at = f.at;
      let relocated = false;
      if (!man.ids.has(at)) {
        let p = parentOfId(at);
        while (p && !man.ids.has(p)) p = parentOfId(p);
        if (!p) {
          unanchored += 1;
          continue;
        }
        at = p;
        relocated = true;
      }
      const anchor = ancestorsOrSelf(man, at).find((a) => usable.has(a));
      if (!anchor) {
        unanchored += 1;
        continue;
      }
      if (f.type === "call" && !man.ids.has(f.to)) {
        externalCalls += 1;
        continue;
      }
      const rawFact: Record<string, unknown> = { ...f };
      if (f.type === "effect") rawFact.resource = canonResourceCode(f.resource) ?? f.resource;
      const fid = factId(rawFact);
      const presence = g.presenceA && !relocated;
      const prev = byFid.get(fid);
      const n = f.n ?? 1;
      if (prev) {
        prev.n = Math.max(prev.n, n);
        prev.presenceSound = prev.presenceSound || presence;
        prev.sources.push({ record: r.id, provider: pq });
        continue;
      }
      byFid.set(fid, {
        fid,
        type: f.type,
        at,
        verb: f.type === "effect" ? f.verb : null,
        resource: f.type === "effect" ? (rawFact.resource as string) : null,
        to: f.type === "call" || f.type === "edge" ? f.to : null,
        kind: f.type === "edge" ? f.kind : null,
        claim: null,
        unit: null,
        atom: null,
        declared: false,
        observed: true,
        presenceSound: presence,
        relocated,
        n,
        sources: [{ record: r.id, provider: pq }],
        raw: rawFact
      });
    }
  }
  for (const list of entries.values()) list.sort((a, b) => cmpStr(a.record, b.record));
  const facts = [...byFid.values()].sort((a, b) => cmpStr(a.fid, b.fid));
  for (const f of facts) f.sources.sort((a, b) => cmpStr(a.record, b.record));
  return { entries, facts, unanchored, externalCalls };
}

/** Manifest hatch facts (x, h, n): presence- and absence-sound at hatch-complete identities. */
export function hatchFacts(man: ManifestIndex): WFact[] {
  const out: WFact[] = [];
  for (const info of [...man.ids.values()].sort((a, b) => cmpStr(a.id, b.id))) {
    for (const [kind, n] of Object.entries(info.markers).sort((a, b) => cmpStr(a[0], b[0]))) {
      if (n <= 0) continue;
      const raw = { type: "hatch", at: info.id, kind };
      out.push({
        fid: factId(raw),
        type: "hatch",
        at: info.id,
        verb: kind,
        resource: null,
        to: null,
        kind,
        claim: null,
        unit: null,
        atom: null,
        declared: false,
        observed: true,
        presenceSound: true,
        relocated: false,
        n,
        sources: [{ record: `manifest:${man.revision}`, provider: "manifest" }],
        raw: { ...raw, n }
      });
    }
  }
  return out;
}

/** Facts reported by usable base-revision entries (for novelty): fid → max n. */
export function baseReported(records: ParsedRecord[], baseMan: ManifestIndex | null, baseRevision: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!baseMan || !baseRevision) return out;
  for (const r of records) {
    if (r.shape.kind !== "observation" || r.shape.revision !== baseRevision) continue;
    const usable = new Set(
      (r.shape.scope?.entries ?? [])
        .filter((e) => baseMan.ids.get(e.id)?.digests.get(e.projection) === e.digest)
        .map((e) => e.id)
    );
    for (const f of r.shape.facts ?? []) {
      const anchor = baseMan.ids.has(f.at) ? ancestorsOrSelf(baseMan, f.at).find((a) => usable.has(a)) : undefined;
      if (!anchor) continue;
      const rawFact: Record<string, unknown> = { ...f };
      if (f.type === "effect") rawFact.resource = canonResourceCode(f.resource) ?? f.resource;
      const fid = factId(rawFact);
      out.set(fid, Math.max(out.get(fid) ?? 0, (f as Fact).n ?? 1));
    }
  }
  return out;
}

/** Does a provider declare a channel matching a needed channel string? */
export function channelCovered(declared: string[], needed: string): boolean {
  for (const d of declared) {
    if (d === needed) return true;
    const dm = /^effect\((.+)\)$/.exec(d);
    const nm = /^effect\((.+)\)$/.exec(needed);
    if (dm && nm && channelMatches(dm[1] ?? "", nm[1] ?? "")) return true;
    const de = /^edge\((\w+)(?:, (.+))?\)$/.exec(d);
    const ne = /^edge\((\w+)(?:, (.+))?\)$/.exec(needed);
    if (de && ne && de[1] === ne[1] && (!de[2] || (ne[2] && channelMatches(de[2], ne[2])))) return true;
  }
  return false;
}
