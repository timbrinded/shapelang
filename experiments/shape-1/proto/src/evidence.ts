// Evidence pipeline (version 7): provider governance G* (A.6.2.6), record validation for head and
// base records (A.12.6, A.16.6), usable observation entries and the observed world W_obs° with
// presence-soundness and novelty (A.4.4.5, A.7.3.1, A.15.9).
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
  /** (d) identity, produces, persist: base */
  identity: string | null;
  /** a base identity no other base provider shares (A.5.2.11) */
  authenticated: boolean;
  /** (c) producer change: implementations united */
  implementationPaths: string[];
  implementationIds: string[];
  implementationDigests: string[];
  produces: string[];
  trusts: [string, string][];
  persist: boolean;
}

export function providerGovernance(base: ESF, head: ESF): Map<string, ProvG> {
  const out = new Map<string, ProvG>();
  const qs = sortedUniq([...base.providers.map((p) => p.q), ...head.providers.map((p) => p.q)]);
  const idCount = new Map<string, number>();
  for (const p of base.providers)
    if (p.identity) idCount.set(p.identity, (idCount.get(p.identity) ?? 0) + 1);
  for (const q of qs) {
    const b = base.providers.find((p) => p.q === q) ?? null;
    const h = head.providers.find((p) => p.q === q) ?? null;
    const both = !!b && !!h;
    const inter = (x: string[] | undefined, y: string[] | undefined): string[] =>
      x && y ? x.filter((c) => y.includes(c)) : [];
    const identity = b?.identity ?? null;
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
      identity,
      authenticated: identity !== null && (idCount.get(identity) ?? 0) === 1,
      implementationPaths: sortedUniq([
        ...(b?.implementation?.paths ?? []),
        ...(h?.implementation?.paths ?? [])
      ]),
      implementationIds: sortedUniq([
        ...(b?.implementation?.ids ?? []),
        ...(h?.implementation?.ids ?? [])
      ]),
      implementationDigests: sortedUniq(
        [b?.implementation?.digest, h?.implementation?.digest].filter(
          (x): x is string => typeof x === "string"
        )
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

/** Parses, merges (one record per statement) and validates a list of records (A.12.6). */
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
      if (seen.has(r.record)) return false;
      seen.add(r.record);
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
  /** sites or markers; null when no source reported n (unknown, A.12.8.4) */
  n: number | null;
  sources: { record: string; provider: string }[];
  /** the anchors (entry identities) the fact was reported under */
  anchors: string[];
  raw: Record<string, unknown>;
}

export function factId(f: Record<string, unknown>): string {
  const { n: _n, ...rest } = f;
  void _n;
  const g = { ...rest };
  if (g.type === "effect" && typeof g.resource === "string")
    g.resource = canonResourceCode(g.resource) ?? g.resource;
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

function digestOk(
  man: ManifestIndex,
  id: string,
  projection: string,
  digest: string,
  equiv: (a: string, b: string) => boolean
): boolean {
  const d = man.ids.get(id)?.digests.get(projection);
  return d !== undefined && equiv(d, digest);
}

/** Usable observation entries and their facts (A.4.4.5, A.5.4.2): entries usable at the
 *  revision, or reused with deps complete and digests and deps ≡ the manifest. */
export function observedWorld(
  records: ParsedRecord[],
  man: ManifestIndex,
  revision: string,
  provs: Map<string, ProvG>,
  producerChanged: (r: ParsedRecord) => boolean,
  equiv: (a: string, b: string) => boolean,
  presence: (g: ProvG) => boolean
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
    const atRevision = r.shape.revision === revision;
    // a moved harness digest makes the record stale (A.5.4.1)
    const harnessOk = (r.shape.harness ?? []).every((h) =>
      digestOk(man, h.id, h.projection, h.digest, equiv)
    );
    const usable = new Set<string>();
    for (const e of r.shape.scope?.entries ?? []) {
      const ok =
        harnessOk &&
        digestOk(man, e.id, e.projection, e.digest, equiv) &&
        (atRevision ||
          (g.depsCompleteB &&
            (e.deps ?? []).every((d) => digestOk(man, d.id, d.projection, d.digest, equiv))));
      if (!ok) continue;
      usable.add(e.id);
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
      // anchors to the entry of the nearest ancestor-or-self with a usable entry (A.15.9)
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
      // the fact id keeps the raw at; the fact is placed at its relocated identity (A.12.8.4)
      const fid = factId(rawFact);
      const ps = presence(g) && !relocated;
      const prev = byFid.get(fid);
      const n = typeof f.n === "number" ? f.n : null;
      if (prev) {
        prev.n = prev.n === null ? n : n === null ? prev.n : Math.max(prev.n, n);
        prev.presenceSound = prev.presenceSound || ps;
        prev.sources.push({ record: r.id, provider: pq });
        if (!prev.anchors.includes(anchor)) prev.anchors.push(anchor);
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
        presenceSound: ps,
        relocated,
        n,
        sources: [{ record: r.id, provider: pq }],
        anchors: [anchor],
        raw: rawFact
      });
    }
  }
  for (const list of entries.values()) list.sort((a, b) => cmpStr(a.record, b.record));
  const facts = [...byFid.values()].sort((a, b) => cmpStr(a.fid, b.fid));
  for (const f of facts) {
    f.sources.sort((a, b) => cmpStr(a.record, b.record) || cmpStr(a.provider, b.provider));
    f.anchors.sort(cmpStr);
  }
  return { entries, facts, unanchored, externalCalls };
}

/** Manifest hatch facts (x, h, n): presence-sound; absence-sound at hatch-complete identities. */
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
        anchors: [info.id],
        raw: { ...raw, n }
      });
    }
  }
  return out;
}

/** Does a provider declare a channel matching a needed channel string (A.5.2.3)? */
export function channelCovered(declared: string[], needed: string): boolean {
  for (const d of declared) {
    if (d === needed) return true;
    const dm = /^effect\((.+)\)$/.exec(d);
    const nm = /^effect\((.+)\)$/.exec(needed);
    if (dm && nm && channelMatches(dm[1] ?? "", nm[1] ?? "")) return true;
    const de = /^edge\((\w+)(?:, (.+))?\)$/.exec(d);
    const ne = /^edge\((\w+)(?:, (.+))?\)$/.exec(needed);
    if (de && ne && de[1] === ne[1] && (!de[2] || (ne[2] && channelMatches(de[2], ne[2]))))
      return true;
  }
  return false;
}

export type { Fact };
