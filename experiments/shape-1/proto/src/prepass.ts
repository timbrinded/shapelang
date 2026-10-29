// The pre-pass as an exported API (A.11.2.1; A.7.8 steps 1–3, version 7): input integrity
// (A.16.1, A.16.2), elaboration of both revisions at now*, persisted-evidence errors (A.5.8.2),
// record parsing and validation (A.12.6, A.16.6), authors* (A.6.3.2), the review lines with their
// base actors, manifest authentication (A.5.2.17) and the values only the pre-pass can compute
// (inputDigest, rejected, clockClamped; A.16.3). derive (derive.ts) performs the same steps inline
// and then evaluates; this module evaluates nothing. experiments/shape-1/trials/DRT7 builds the
// kernel case shape.kernel.case/v1 from its result.
import { elaborate } from "./elaborate.ts";
import { processRecords, providerGovernance } from "./evidence.ts";
import { type Gov, buildGov, policyStar } from "./governance.ts";
import { type Revision, type Verified, inputDigest, verifyInput } from "./input.ts";
import type { CheckInput } from "./io-types.ts";
import { H, jcs } from "./jcs.ts";
import type { ESF, ShapeError } from "./model.ts";
import {
  type ParsedRecord,
  type Rejection,
  type ValidationContext,
  parseRecord,
  persistedPath
} from "./records.ts";
import { cmpStr, toSeconds } from "./util.ts";

/** One record as the pre-pass leaves it. */
export interface PrepassRecord {
  /** H(statement), or H(the input value) when it does not parse */
  id: string;
  /** null when the record does not parse (RJ01) */
  parsed: ParsedRecord | null;
  /** the first A.12.6 rejection, or null when the record is valid */
  rejection: Rejection | null;
  /** a verified signature by the identity its role requires: the relay's or the judge's for a
   *  judgment, the provider's base identity for an authenticated provider, any verified
   *  signature otherwise (A.5.2.11, A.12.6 RJ07–RJ08) */
  authenticated: boolean;
  /** listed in persisted.base (A.16.4(b)) */
  persistedBase: boolean;
  /** listed in persisted.head */
  persistedHead: boolean;
}

/** A CI-supplied review line of this change with its base actor (A.7.6). */
export interface PrepassReview {
  /** the base actor holding the identity, or null */
  actor: string | null;
  identity: string;
  line: string;
  change: string | null;
  /** the answer reference printed in answered.records (A.16.28) */
  ref: string;
}

export interface Prepass {
  ok: true;
  verified: Verified;
  mode: CheckInput["mode"];
  /** now* in integer seconds (A.6.1.3) */
  now: number;
  clockClamped: boolean;
  hasBase: boolean;
  baseUnreadable: boolean;
  emptyBase: boolean;
  /** the head ESF; its errors include the pre-pass's shape errors (E-parse, E-evidence-path,
   *  E-evidence-rewrite) */
  head: ESF;
  /** the base ESF (lenient) with the base defects of A.6.4.2 in its errors; null without a base
   *  or over an unreadable base */
  base: ESF | null;
  /** the governance base: the base, else the head (audit mode, unreadable base) */
  gov: ESF;
  gv: Gov;
  /** input.records and persisted.head, one entry per record id */
  records: PrepassRecord[];
  baseRecords: PrepassRecord[];
  /** the rejected section (records and baseRecords), sorted by (record, code) */
  rejected: Rejection[];
  /** review lines whose change is absent or one of change.ids, in input order */
  reviews: PrepassReview[];
  /** a base-declared provider produces judgment (A.7.6.3) */
  relayDeclared: boolean;
  manifestIdentity: string | null;
  headManifestAuthenticated: boolean;
  baseManifestAuthenticated: boolean;
  inputDigest: string;
}

export interface PrepassInvalid {
  ok: false;
  problems: string[];
  inputDigest: string;
}

function stmtOf(r: unknown): unknown {
  const o = r as { payloadType?: string; payload?: string };
  if (o && typeof o.payloadType === "string" && typeof o.payload === "string") {
    try {
      return JSON.parse(Buffer.from(o.payload, "base64").toString("utf8"));
    } catch {
      return r;
    }
  }
  return r;
}

const noCauses = (code: string, subject: string, message: string): ShapeError => ({
  code,
  subject,
  message,
  causes: [],
  dischargers: []
});

export function prepass(input: CheckInput): Prepass | PrepassInvalid {
  // ---- 1. verify (A.16.1, A.16.2) ------------------------------------------------------------
  const v = verifyInput(input);
  if (!v.ok) return { ok: false, problems: v.problems, inputDigest: inputDigest(input) };
  const nowRaw = toSeconds(input.now) as number;
  const baseTime = v.base?.committerTime ?? null;
  const now = Math.max(nowRaw, baseTime ?? nowRaw);
  const clockClamped = baseTime !== null && baseTime > nowRaw;
  const mode = input.mode;
  const hasBase = mode !== "audit" && !!v.base;
  const Mh = v.head.manifest;
  const Mb = hasBase ? (v.base as Revision).manifest : null;

  // ---- 2. elaborate ----------------------------------------------------------------------------
  const head = elaborate(v.head.source, { now, std: v.head.std });
  head.errors = [
    ...head.errors,
    ...v.head.shapeErrors.map((e) => noCauses(e.code, e.subject, e.message))
  ];
  const baseUnreadable = hasBase && !!v.base?.unreadable;
  let base: ESF | null = null;
  if (hasBase && v.base && !v.base.unreadable) {
    base = elaborate(v.base.source, { lenient: true, now, std: v.base.std });
    base.errors = [
      ...base.errors,
      ...(v.base.defects ?? []).map((d) => noCauses(d.code, d.subject, d.message))
    ];
  }
  const emptyBase = !!base && (v.base?.source?.modules ?? []).filter((m) => !m.pack).length === 0;
  const gov: ESF = base ?? head;
  // persisted evidence paths and append-only (A.5.8.2)
  for (const p of input.persisted?.head ?? []) {
    const id = H(stmtOf(p.record));
    if (p.path !== persistedPath(id))
      head.errors.push(noCauses("E-evidence-path", p.path, `expected ${persistedPath(id)}`));
  }
  for (const p of input.persisted?.base ?? []) {
    const h = (input.persisted?.head ?? []).find((x) => x.path === p.path);
    if (!h || jcs(h.record) !== jcs(p.record))
      head.errors.push(
        noCauses(
          "E-evidence-rewrite",
          p.path,
          h ? "persisted record rewritten" : "persisted record deleted"
        )
      );
  }

  // ---- 3. records (A.12.6, A.16.6) ------------------------------------------------------------
  const emptyEsf = elaborate({ v: "shape.source.v1", modules: [] }, { lenient: true, now });
  const provs = providerGovernance(baseUnreadable ? emptyEsf : gov, head);
  const authenticated = new Map<string, string>();
  for (const g of provs.values())
    if (g.authenticated && g.base && g.identity) authenticated.set(g.q, g.identity);
  const actorsMap = new Map(
    gov.actors.map((a) => [a.q, { identities: a.identities, kind: a.kind, operator: a.operator }])
  );
  const actorByIdentity = new Map<string, string>();
  for (const a of gov.actors) for (const i of a.identities) actorByIdentity.set(i, a.q);
  const relays = new Map<string, string | null>();
  if (!baseUnreadable)
    for (const p of gov.providers) if (p.produces.includes("judgment")) relays.set(p.q, p.identity);
  const manMap = (m: typeof Mh): Map<string, string> => {
    const out = new Map<string, string>();
    for (const info of m.ids.values())
      for (const [proj, d] of info.digests)
        out.set(`${info.id}\u0000${proj}\u0000${info.schemes.get(proj)}`, d);
    return out;
  };
  const manifests = new Map<string, Map<string, string>>([[Mh.revision, manMap(Mh)]]);
  const trees = new Map<string, Set<string>>([[Mh.revision, Mh.paths]]);
  if (Mb) {
    manifests.set(Mb.revision, manMap(Mb));
    trees.set(Mb.revision, Mb.paths);
  }
  const provEntry = (p: ESF["providers"][number]) => ({
    produces: p.produces,
    identity: p.identity,
    persist: p.persist
  });
  const govProviders = baseUnreadable ? [] : gov.providers;
  const headCtx: Omit<ValidationContext, "persisted"> = {
    now,
    mode,
    baseProviders: new Map(govProviders.map((p) => [p.q, provEntry(p)])),
    headProviders: new Map(head.providers.map((p) => [p.q, provEntry(p)])),
    authenticated,
    presence: new Set([...provs.values()].filter((g) => g.presenceA).map((g) => g.q)),
    actors: actorsMap,
    actorByIdentity,
    relays,
    headRevision: Mh.revision,
    baseRevision: Mb?.revision ?? null,
    manifests,
    trees
  };
  const persistedHeadRaw = (input.persisted?.head ?? []).map((p) => p.record);
  const recs = processRecords(input.records ?? [], persistedHeadRaw, headCtx);
  const baseRecs =
    hasBase && base
      ? processRecords(input.baseRecords ?? [], [], {
          ...headCtx,
          baseProviders: new Map(base.providers.map((p) => [p.q, provEntry(p)])),
          headProviders: new Map(),
          presence: new Set(base.providers.filter((p) => p.presence).map((p) => p.q)),
          headRevision: Mb?.revision ?? Mh.revision
        })
      : {
          valid: [] as ParsedRecord[],
          rejected: [] as Rejection[],
          persistedIds: new Set<string>()
        };
  const rejected = [...recs.rejected, ...baseRecs.rejected].sort(
    (a, b) => cmpStr(a.record, b.record) || cmpStr(a.code, b.code)
  );

  const authOf = (r: ParsedRecord): boolean => {
    const s = r.shape;
    const pq = s.provider?.id ?? null;
    if (s.kind === "judgment") {
      if (pq !== null && relays.has(pq)) {
        const relayId = relays.get(pq) ?? null;
        return relayId ? r.signers.includes(relayId) : r.signers.length > 0;
      }
      const judge = s.judge ? actorsMap.get(s.judge) : undefined;
      return !!judge && r.signers.some((x) => judge.identities.includes(x));
    }
    const id = pq !== null ? authenticated.get(pq) : undefined;
    return id ? r.signers.includes(id) : r.signers.length > 0;
  };
  const persistedBaseIds = new Set<string>();
  for (const p of input.persisted?.base ?? []) persistedBaseIds.add(H(stmtOf(p.record)));
  const collect = (
    raw: unknown[],
    persisted: unknown[],
    set: { valid: ParsedRecord[]; rejected: Rejection[] }
  ): PrepassRecord[] => {
    const rejectionOf = new Map(set.rejected.map((r) => [r.record, r]));
    const validById = new Map(set.valid.map((r) => [r.id, r]));
    const persistedIds = new Set<string>();
    const out = new Map<string, PrepassRecord>();
    const add = (x: unknown, isPersisted: boolean): void => {
      const p = parseRecord(x);
      const id = "error" in p ? H(x) : p.id;
      if (isPersisted) persistedIds.add(id);
      if (out.has(id)) return;
      const parsed = validById.get(id) ?? ("error" in p ? null : p);
      out.set(id, {
        id,
        parsed,
        rejection: rejectionOf.get(id) ?? null,
        authenticated: false,
        persistedBase: false,
        persistedHead: false
      });
    };
    for (const x of raw) add(x, false);
    for (const x of persisted) add(x, true);
    return [...out.values()]
      .map((r) => {
        // the merged record (signers united over envelopes of one statement, A.5.1.1)
        const merged = validById.get(r.id) ?? r.parsed;
        return {
          ...r,
          parsed: merged,
          authenticated: merged ? authOf(merged) : false,
          persistedBase: persistedBaseIds.has(r.id),
          persistedHead: persistedIds.has(r.id)
        };
      })
      .sort((a, b) => cmpStr(a.id, b.id));
  };
  const records = collect(input.records ?? [], persistedHeadRaw, recs);
  const baseRecords = collect(input.baseRecords ?? [], [], baseRecs);

  // ---- governance: authors* (A.6.3.2) and review lines (A.7.6) --------------------------------
  const policy = policyStar(gov.policy, head.policy);
  const gv = buildGov(gov, policy, gov.policy, input.authors ?? [], baseUnreadable);
  const changeIds = input.change?.ids ?? [];
  const reviews: PrepassReview[] = [];
  for (const rv of input.reviews ?? []) {
    if (rv.change !== undefined && !changeIds.includes(rv.change)) continue;
    const identity = String(rv.identity ?? "").trim();
    reviews.push({
      actor: gv.byIdentity.get(identity) ?? null,
      identity,
      line: String(rv.line ?? "").trim(),
      change: rv.change ?? null,
      ref: `review:${H(rv).slice(7, 23)}`
    });
  }
  // ---- the manifest identity (A.5.2.17 [D27]) -------------------------------------------------
  const manifestIdentity = baseUnreadable ? null : gov.shape.manifest;
  const signedBy = (r: Revision | null): boolean =>
    !!manifestIdentity && !!r && r.manifestSigners.includes(manifestIdentity);
  return {
    ok: true,
    verified: v,
    mode,
    now,
    clockClamped,
    hasBase,
    baseUnreadable,
    emptyBase,
    head,
    base,
    gov,
    gv,
    records,
    baseRecords,
    rejected,
    reviews,
    relayDeclared: relays.size > 0,
    manifestIdentity,
    headManifestAuthenticated: signedBy(v.head),
    baseManifestAuthenticated: hasBase ? signedBy(v.base) : false,
    inputDigest: inputDigest(input)
  };
}
