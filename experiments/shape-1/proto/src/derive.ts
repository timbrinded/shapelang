// derive (version 7): the checker's one pure function (A.7.8). Input → verdict, errors,
// obligations, answered, loosening, order, renames, debt, preexisting, budget, health. Reads only
// its input; every list is sorted; the core output is permutation-invariant.
import {
  type Contra,
  type Edge,
  buildCalls,
  declaredFacts,
  declaredFactsOf,
  evalEffects,
  evalLower,
  evalStructure,
  footprint,
  liftedEdges
} from "./checker.ts";
import type { Ctx } from "./context.ts";
import { type CoverageOb, type VocabOb, computeCoverage, observable } from "./coverage.ts";
import { elaborate, lawDecidedBy } from "./elaborate.ts";
import {
  type WFact,
  channelCovered,
  factId,
  hatchFacts,
  observedWorld,
  processRecords,
  providerGovernance
} from "./evidence.ts";
import { computeCells } from "./globs.ts";
import {
  type EligibilityQuery,
  type Gov,
  buildGov,
  eligibleNow,
  isEligible,
  isPerson,
  persons,
  policyStar,
  tierPolicy
} from "./governance.ts";
import { type Revision, inputDigest, verifyInput } from "./input.ts";
import type { CheckInput, CheckOutput, ObligationOut, Review, Severity } from "./io-types.ts";
import { H, hexh, jcs } from "./jcs.ts";
import {
  type LawEval,
  type Pair,
  evaluateLaws,
  ownerStar,
  producerCauses,
  producerChanged,
  providerMissing,
  reqOf,
  tierStar
} from "./laws.ts";
import {
  type LoosePart,
  type PassEnv,
  QUESTION_ORDER,
  orderClass,
  runPass,
  subjectOwner,
  subjectTier
} from "./loosening.ts";
import { type ManifestIndex, ancestorsOrSelf } from "./manifest.ts";
import {
  type Cause,
  type Claim,
  type Discharger,
  type ESF,
  type ExceptionItem,
  type JsonValue,
  type ShapeError,
  TRUST,
  type TemplateItem,
  parseAtom
} from "./model.ts";
import { type ParsedRecord, persistedPath } from "./records.ts";
import { channelAt, nearestEntries } from "./checker.ts";
import { computeHeirs, opOrderGeq, renameArgs, renamedFp } from "./strength.ts";
import {
  type Tier,
  cmpStr,
  cmpTuple,
  levelRank,
  maxTier,
  sortedUniq,
  tierRank,
  toSeconds
} from "./util.ts";
import {
  UNGOVERNED,
  type World,
  buildWorld,
  compCode,
  excludingClaims,
  liftHatch,
  posComp
} from "./world.ts";

type CodeRow = [string, string, string | null, string | null];

interface Ob {
  kind: "contradiction" | "unestablished" | "loosening" | "coverage";
  key: string;
  claim: Claim | null;
  subject: JsonValue;
  reason: string | null;
  questions: string[] | null;
  force: "sound" | "heuristic" | null;
  tier: Tier;
  owner: string;
  introduced: boolean;
  affected: string[];
  code: CodeRow[];
  delta: string[];
  /** group tokens (A.7.2.3) */
  tokens: string[];
  witness: string[];
  facts: Record<string, JsonValue>;
  counterexample: JsonValue;
  exploited: boolean | null;
  final: boolean;
  causes: Cause[];
  message: string;
  excluding: Claim[];
  contra: Contra | null;
  law: LawEval | null;
  lawContra: boolean;
  coverage: CoverageOb | null;
  vocab: VocabOb | null;
  parts: LoosePart[] | null;
  /** producer-changed with Req meeting Δcode ∪ deleted (rule 8) */
  pcReqDelta: boolean;
  binding: string;
  group: string;
  matched: ExceptionItem[];
  exceptionAnswered: boolean;
  discharged: { records: string[]; self: boolean; selfActors: string[] } | null;
  exceptionAnswer: { records: string[] } | null;
}

interface Answer {
  actor: string;
  refs: string[];
  source: string;
}

function obKey(kind: string, claim: string | null, subject: JsonValue): string {
  const o: Record<string, JsonValue> = { v: "shape.obligation.v1", kind, subject };
  if (claim !== null) o.claim = claim;
  return `ob:${hexh(o)}`;
}

function bindingOf(key: string, affected: string[], code: CodeRow[], delta: string[]): string {
  const rows = [...new Map(code.map((r) => [JSON.stringify(r), r])).values()].sort(
    (a, b) => cmpStr(a[0], b[0]) || cmpStr(a[1], b[1])
  );
  return `bd:${hexh({
    v: "shape.binding.v1",
    key,
    affected: sortedUniq(affected),
    code: rows,
    delta: sortedUniq(delta)
  })}`;
}

function emptyHealth(): Record<string, JsonValue> {
  return {};
}

function invalid(input: CheckInput, problems: string[]): CheckOutput {
  return {
    contract: "shape.check.output/v1",
    mode: input?.mode ?? "change",
    inputDigest: inputDigest(input),
    verdict: "invalid",
    errors: [...new Set(problems)].sort(cmpStr).map((p) => ({
      code: "E-input",
      subject: p.split(":")[0] ?? "input",
      message: p,
      causes: [],
      dischargers: []
    })),
    rejected: [],
    obligations: [],
    answered: [],
    loosening: [],
    order: null,
    renames: [],
    debt: [],
    preexisting: [],
    budget: { limit: null, used: 0, overflow: [] },
    health: emptyHealth()
  };
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

function dedupErrors(errors: ShapeError[]): ShapeError[] {
  const seen = new Map<string, ShapeError>();
  for (const e of errors) {
    const k = `${e.code}\u0000${e.subject}`;
    if (!seen.has(k)) seen.set(k, e);
  }
  return [...seen.values()].sort((a, b) => cmpStr(a.code, b.code) || cmpStr(a.subject, b.subject));
}

function manMap(m: ManifestIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const info of m.ids.values())
    for (const [proj, d] of info.digests)
      out.set(`${info.id}\u0000${proj}\u0000${info.schemes.get(proj)}`, d);
  return out;
}

const CHECKER_OPS = new Set([
  "edge.exists",
  "edge.forbid",
  "path.forbid",
  "cycle.forbid",
  "authority",
  "effect.forbid",
  "effects.upper",
  "effects.lower"
]);

export function derive(input: CheckInput): CheckOutput {
  // ---- 1. verify (A.16.1, A.16.2) ------------------------------------------------------------------
  const v = verifyInput(input);
  if (!v.ok) return invalid(input, v.problems);
  const nowRaw = toSeconds(input.now) as number;
  const baseTime = v.base?.committerTime ?? null;
  const now = Math.max(nowRaw, baseTime ?? nowRaw);
  const clockClamped = baseTime !== null && baseTime > nowRaw;
  const mode = input.mode;
  const preview = mode === "preview";
  const hasBase = mode !== "audit" && !!v.base;
  const Mh = v.head.manifest;
  const Mb = hasBase ? (v.base as Revision).manifest : null;

  // ---- 2. elaborate ------------------------------------------------------------------------------
  const head = elaborate(v.head.source, { now, std: v.head.std });
  const errors: ShapeError[] = [
    ...head.errors,
    ...v.head.shapeErrors.map((e) => ({
      code: e.code,
      subject: e.subject,
      message: e.message,
      causes: [],
      dischargers: []
    }))
  ];
  let base: ESF | null = null;
  const baseUnreadable = hasBase && !!v.base?.unreadable;
  if (hasBase && v.base && !v.base.unreadable)
    base = elaborate(v.base.source, { lenient: true, now, std: v.base.std });
  const emptyBase =
    !!base && (v.base?.source?.modules ?? []).filter((m) => !m.pack).length === 0;
  const baseDefects = sortedUniq([
    ...(v.base?.defects ?? []).map((d) => `${d.code} ${d.subject}`),
    ...(base?.errors ?? []).map((e) => `${e.code} ${e.subject}`)
  ]);
  // governance base: the base; the head in audit mode or over an unreadable base (A.16.16)
  const gov: ESF = base ?? head;

  // persisted evidence paths and append-only (A.5.8.2)
  for (const p of input.persisted?.head ?? []) {
    const id = H(stmtOf(p.record));
    if (p.path !== persistedPath(id))
      errors.push({
        code: "E-evidence-path",
        subject: p.path,
        message: `expected ${persistedPath(id)}`,
        causes: [],
        dischargers: []
      });
  }
  for (const p of input.persisted?.base ?? []) {
    const h = (input.persisted?.head ?? []).find((x) => x.path === p.path);
    if (!h || jcs(h.record) !== jcs(p.record))
      errors.push({
        code: "E-evidence-rewrite",
        subject: p.path,
        message: h ? "persisted record rewritten" : "persisted record deleted",
        causes: [],
        dischargers: []
      });
  }

  // ---- 3. records (A.12.6, A.16.6) -----------------------------------------------------------------
  const emptyEsf = elaborate({ v: "shape.source.v1", modules: [] }, { lenient: true, now });
  const provs = providerGovernance(baseUnreadable ? emptyEsf : gov, head);
  const authenticated = new Map<string, string>();
  for (const g of provs.values()) if (g.authenticated && g.base && g.identity) authenticated.set(g.q, g.identity);
  const actorsMap = new Map(
    gov.actors.map((a) => [a.q, { identities: a.identities, kind: a.kind, operator: a.operator }])
  );
  const actorByIdentity = new Map<string, string>();
  for (const a of gov.actors) for (const i of a.identities) actorByIdentity.set(i, a.q);
  const relays = new Map<string, string | null>();
  if (!baseUnreadable)
    for (const p of gov.providers) if (p.produces.includes("judgment")) relays.set(p.q, p.identity);
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
  const recs = processRecords(
    input.records ?? [],
    (input.persisted?.head ?? []).map((p) => p.record),
    {
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
    }
  );
  const baseRecs =
    hasBase && base
      ? processRecords(input.baseRecords ?? [], [], {
          now,
          mode,
          baseProviders: new Map(base.providers.map((p) => [p.q, provEntry(p)])),
          headProviders: new Map(),
          authenticated,
          presence: new Set(base.providers.filter((p) => p.presence).map((p) => p.q)),
          actors: actorsMap,
          actorByIdentity,
          relays,
          headRevision: Mb?.revision ?? Mh.revision,
          baseRevision: Mb?.revision ?? null,
          manifests,
          trees
        })
      : { valid: [] as ParsedRecord[], rejected: [], persistedIds: new Set<string>() };
  let records = recs.valid;
  if (preview) records = records.filter((r) => r.shape.kind !== "judgment");
  const rejected = [...recs.rejected, ...baseRecs.rejected].sort(
    (a, b) => cmpStr(a.record, b.record) || cmpStr(a.code, b.code)
  );

  // ---- 4. worlds, deltas, ρ, ≡, heirs, G* ----------------------------------------------------------
  const Wh = buildWorld(head, Mh, { side: "h" });
  errors.push(...Wh.errors);
  // head globs of two components with intersecting languages (A.3.3.6)
  {
    const cr = computeCells(
      Wh.globOwners.map((o) => ({ side: "h" as const, glob: o.glob, owner: o.owner, except: o.except }))
    );
    for (const c of cr.cells)
      if (Array.isArray(c.h))
        errors.push({
          code: "E-overlap",
          subject: c.h.map((w) => `component ${posComp(w)}`).sort(cmpStr).join(" "),
          message: `equally specific globs of ${c.h.join(" and ")} match ${c.example}`,
          causes: [],
          dischargers: []
        });
  }
  const Wb = base && Mb ? buildWorld(base, Mh, { side: "b", baseMan: Mb }) : null;
  const delta = new Set<string>();
  const deltaPairs = new Set<string>();
  const deleted = new Set<string>();
  const finest = new Set<string>();
  const relocatedFrom = new Map<string, string>();
  if (hasBase && Mb) {
    const added: string[] = [];
    for (const [id, info] of Mh.ids) {
      const b = Mb.ids.get(id);
      if (!b) {
        delta.add(id);
        for (const p of info.digests.keys()) deltaPairs.add(`${id}\u0000${p}`);
        added.push(id);
        continue;
      }
      for (const [proj, d] of info.digests) {
        const bd = b.digests.get(proj);
        if (bd !== undefined && b.schemes.get(proj) === info.schemes.get(proj) && bd !== d) {
          delta.add(id);
          deltaPairs.add(`${id}\u0000${proj}`);
        }
      }
      const ob = b.digests.get("own");
      const oh = info.digests.get("own");
      if (ob !== undefined && oh !== undefined && ob !== oh) finest.add(id);
    }
    for (const id of Mb.ids.keys()) if (!Mh.ids.has(id)) deleted.add(id);
    // relocation (A.6.1.5 [D6]): unique (kind, own) among new and deleted identities
    const groupKey = (kind: string, own: string | undefined): string => `${kind}\u0000${own ?? ""}`;
    const newBy = new Map<string, string[]>();
    for (const x of added) {
      const i = Mh.ids.get(x);
      const own = i?.digests.get("own");
      if (!i || own === undefined) continue;
      const k = groupKey(i.kind, own);
      newBy.set(k, [...(newBy.get(k) ?? []), x]);
    }
    const delBy = new Map<string, string[]>();
    for (const y of deleted) {
      const i = Mb.ids.get(y);
      const own = i?.digests.get("own");
      if (!i || own === undefined) continue;
      const k = groupKey(i.kind, own);
      delBy.set(k, [...(delBy.get(k) ?? []), y]);
    }
    for (const [k, xs] of newBy) {
      const ys = delBy.get(k) ?? [];
      if (xs.length !== 1 || ys.length !== 1) continue;
      const x = xs[0] as string;
      const y = ys[0] as string;
      if (Mh.ids.get(x)?.lang !== Mb.ids.get(y)?.lang) continue;
      relocatedFrom.set(x, y);
    }
    for (const x of added) if (!relocatedFrom.has(x)) finest.add(x);
  }
  // ≡ by contributing code-space equivalence records (A.5.6)
  const uf = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (uf.has(r) && uf.get(r) !== r) r = uf.get(r) as string;
    return r;
  };
  const contributing = (r: ParsedRecord): boolean => {
    const g = r.shape.provider ? provs.get(r.shape.provider.id) : undefined;
    return !!g && g.presenceB && g.decidesB.includes("equivalence");
  };
  for (const r of records) {
    if (
      r.shape.kind !== "equivalence" ||
      r.shape.pair?.space !== "code" ||
      r.shape.result !== "equivalent" ||
      !contributing(r)
    )
      continue;
    const a = find(r.shape.pair.from);
    const b = find(r.shape.pair.to);
    if (a !== b) uf.set(cmpStr(a, b) < 0 ? b : a, cmpStr(a, b) < 0 ? a : b);
  }
  const equiv = (a: string, b: string): boolean => a === b || find(a) === find(b);

  // ρ (A.6.1.4 [D17, D18])
  const rho = new Map<string, string>();
  const hints = new Map<string, string>();
  const unmapped = new Set<string>();
  const renames: CheckOutput["renames"] = [];
  if (base && Wb) {
    type Item = { q: string; kind: string; was: string | null; bind: string };
    const items = (e: ESF, w: World): Item[] => [
      ...e.components
        .filter((c) => !c.q.startsWith("std::"))
        .map((c) => ({
          q: c.q,
          kind: "component",
          was: c.was,
          bind: [...c.paths, "\u0001", ...c.exceptPaths].join("\n")
        })),
      ...e.resources
        .filter((r) => !r.q.startsWith("std::"))
        .map((r) => ({ q: r.q, kind: "resource", was: r.was, bind: r.bind.join("\n") })),
      ...e.units.map((u) => ({
        q: u.q,
        kind: "unit",
        was: u.was,
        bind: (w.unitBinds.get(u.q) ?? []).join("\n")
      })),
      // actors map by name or by was, never by bindings (A.6.1.4; A.16.38), so their bind is empty
      ...e.actors.map((a) => ({ q: a.q, kind: "actor", was: a.was, bind: "" }))
    ];
    const hi = items(head, Wh);
    const bi = items(base, Wb);
    const taken = new Set<string>();
    for (const b of bi) {
      const same = hi.find((h) => h.q === b.q && h.kind === b.kind);
      if (same) {
        rho.set(b.q, b.q);
        taken.add(same.q);
      }
    }
    const wasNames = (h: Item, b: Item): boolean =>
      !!h.was && (h.was === b.q || b.q.endsWith(`::${h.was}`) || b.q.endsWith(`.${h.was}`));
    for (const b of bi) {
      if (rho.has(b.q)) continue;
      const hits = hi.filter((h) => h.kind === b.kind && wasNames(h, b) && !taken.has(h.q));
      if (hits.length === 1) {
        const h = hits[0] as Item;
        rho.set(b.q, h.q);
        taken.add(h.q);
        renames.push({ base: b.q, head: h.q, rule: "was" });
      }
    }
    for (const b of bi) {
      if (rho.has(b.q) || b.bind === "" || b.bind === "\u0001") continue;
      const hits = hi.filter((h) => h.kind === b.kind && !taken.has(h.q) && h.bind === b.bind);
      const bhits = bi.filter((x) => x.kind === b.kind && !rho.has(x.q) && x.bind === b.bind);
      if (hits.length === 1 && bhits.length === 1) {
        const h = hits[0] as Item;
        rho.set(b.q, h.q);
        taken.add(h.q);
        renames.push({ base: b.q, head: h.q, rule: "binding" });
      }
    }
    // units follow renamed components
    for (const u of base.units) {
      if (rho.has(u.q)) continue;
      const comp = rho.get(u.component);
      const hq = comp ? `${comp}.${u.name}` : null;
      if (comp && comp !== u.component && hq && head.units.some((x) => x.q === hq) && !taken.has(hq)) {
        rho.set(u.q, hq);
        taken.add(hq);
        renames.push({ base: u.q, head: hq, rule: "component" });
      }
    }
    // rule 3: a unique remove-and-add per kind and module is a hint only
    const mod = (q: string): string => q.split("::")[0] ?? "";
    for (const kind of ["component", "resource", "unit"]) {
      const removed = bi.filter((b) => b.kind === kind && !rho.has(b.q));
      const addedH = hi.filter((h) => h.kind === kind && !taken.has(h.q));
      for (const b of removed) unmapped.add(b.q);
      const mods = sortedUniq([...removed.map((b) => mod(b.q)), ...addedH.map((h) => mod(h.q))]);
      for (const m of mods) {
        const r = removed.filter((b) => mod(b.q) === m);
        const a = addedH.filter((h) => mod(h.q) === m);
        if (r.length === 1 && a.length === 1) hints.set((r[0] as Item).q, (a[0] as Item).q);
      }
    }
    for (const u of base.units) {
      if (rho.has(u.q) || hints.has(u.q)) continue;
      const comp = hints.get(u.component);
      if (comp && head.units.some((x) => x.q === `${comp}.${u.name}`)) hints.set(u.q, `${comp}.${u.name}`);
    }
    for (const h of hi) {
      if (!h.was) continue;
      const survivors = hi.filter(
        (x) => x.kind === h.kind && x.q !== h.q && (x.q === h.was || x.q.endsWith(`::${h.was}`))
      );
      if (survivors.length > 0)
        errors.push({
          code: "E-was",
          subject: `${h.kind} ${h.q}`,
          message: `was ${h.was} while ${h.was} survives`,
          causes: [],
          dischargers: []
        });
      if (hi.filter((x) => x.was === h.was && x.kind === h.kind).length > 1)
        errors.push({
          code: "E-was",
          subject: `${h.kind} ${h.q}`,
          message: `${h.was} is named twice`,
          causes: [],
          dischargers: []
        });
    }
  }
  const headClaims = new Map(head.claims.map((c) => [c.fp, c]));
  const baseClaims = new Map((base?.claims ?? []).map((c) => [c.fp, c]));
  const templates = new Map<string, TemplateItem>(
    [...(base?.templates ?? []), ...head.templates].map((t) => [t.q, t])
  );
  const claimImplies = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.shape.kind !== "equivalence" || r.shape.pair?.space !== "claim" || !contributing(r)) continue;
    const { from, to } = r.shape.pair;
    claimImplies.set(from, new Set([...(claimImplies.get(from) ?? []), to]));
    if (r.shape.result === "equivalent")
      claimImplies.set(to, new Set([...(claimImplies.get(to) ?? []), from]));
  }
  const closureEqual = (ref: string): boolean => {
    const b = Mb?.ids.get(ref)?.digests.get("closure");
    const h = Mh.ids.get(ref)?.digests.get("closure");
    return b !== undefined && h !== undefined && equiv(b, h);
  };
  const { heirs, heirOf } =
    base && Wb
      ? computeHeirs({
          baseClaims: base.claims,
          headClaims: head.claims,
          rho,
          w: Wh,
          templates,
          claimImplies,
          closureEqual
        })
      : { heirs: new Map<string, string[]>(), heirOf: new Map<string, string[]>() };
  const policy = policyStar(gov.policy, head.policy);
  const gv = buildGov(gov, policy, gov.policy, input.authors ?? [], baseUnreadable);

  // ---- 4b. the manifest identity (A.5.2.17 [D27]) ---------------------------------------------
  const manifestIdentity = baseUnreadable ? null : gov.shape.manifest;
  const unauthManifests: string[] = [];
  if (manifestIdentity) {
    const ok = (r: Revision | null): boolean => !r || r.manifestSigners.includes(manifestIdentity);
    if (!ok(v.head) || (hasBase && !ok(v.base)))
      errors.push({
        code: "E-provider-missing",
        subject: "manifest",
        message: `a manifest is not DSSE-signed by the manifest identity ${manifestIdentity}`,
        causes: [],
        dischargers: [{ act: "rerun", by: "ci", agentSafe: true, eligible: [], creates: null }]
      });
  } else {
    unauthManifests.push("manifest head");
    if (hasBase) unauthManifests.push("manifest base");
  }

  const ctx: Ctx = {
    input,
    mode,
    now,
    hasBase,
    head,
    base,
    baseUnreadable,
    emptyBase,
    gov,
    Mh,
    Mb,
    Wh,
    Wb,
    delta,
    deltaPairs,
    deleted,
    finest,
    relocatedFrom,
    rho,
    hints,
    unmapped,
    renames,
    provs,
    records,
    baseRecords: baseRecs.valid,
    usableAtBase: () => false,
    facts: [],
    factById: new Map(),
    newFact: () => false,
    headClaims,
    baseClaims,
    heirs,
    heirOf,
    hAOf: new Map(),
    policy,
    gv,
    errors,
    equiv,
    calls: new Map(),
    refs: new Map(),
    obsEntries: new Map(),
    finalAnswered: new Set()
  };

  // usable base-revision records (A.16.6(c))
  const baseOk = (c: { id: string; projection: string; digest: string }): boolean => {
    const d = Mb?.ids.get(c.id)?.digests.get(c.projection);
    return d !== undefined && equiv(d, c.digest);
  };
  ctx.usableAtBase = (r: ParsedRecord): boolean => {
    if (!base || !Mb) return false;
    const s = r.shape;
    if (s.kind === "judgment") {
      if (![...(s.code ?? [])].every(baseOk)) return false;
      const bc = s.claim ? baseClaims.get(s.claim.fp) : undefined;
      const maxAge = tierPolicy(base.policy, bc?.tier ?? "normal").maxAge;
      return now - (toSeconds(s.time) ?? 0) <= maxAge * 86400;
    }
    const p = s.provider ? base.providers.find((x) => x.q === s.provider?.id) : undefined;
    if (!p) return false;
    if (![...(s.code ?? []), ...(s.deps ?? []), ...(s.harness ?? [])].every(baseOk)) return false;
    return s.revision === Mb.revision || (p.depsComplete && Array.isArray(s.deps));
  };

  // ---- 6. W_eval ------------------------------------------------------------------------------------
  const pcCache = new Map<string, boolean>();
  const pc = (r: ParsedRecord): boolean => {
    let x = pcCache.get(r.id);
    if (x === undefined) {
      x = producerChanged(ctx, r);
      pcCache.set(r.id, x);
    }
    return x;
  };
  const obs = observedWorld(records, Mh, Mh.revision, provs, pc, equiv, (g) => g.presenceA);
  ctx.obsEntries = obs.entries;
  const decl = declaredFacts(ctx);
  const facts: WFact[] = [...decl, ...obs.facts, ...hatchFacts(Mh)].sort((a, b) => cmpStr(a.fid, b.fid));
  ctx.facts = facts;
  ctx.factById = new Map(facts.map((f) => [f.fid, f]));
  // facts reported by usable base-revision entries (A.7.3.1, A.16.6(c))
  const baseReports = new Map<string, number | null>();
  if (base && Mb) {
    const bprovs = providerGovernance(base, base);
    const bobs = observedWorld(
      baseRecs.valid.filter((r) => r.shape.kind === "observation" && ctx.usableAtBase(r)),
      Mb,
      Mb.revision,
      bprovs,
      () => false,
      equiv,
      (g) => !!g.base?.presence
    );
    for (const f of bobs.facts) baseReports.set(f.fid, f.n);
  }
  const baseLowerFps = new Set<string>();
  for (const cb of base?.claims ?? [])
    if (cb.op === "effects.lower" || cb.op === "edge.exists") {
      baseLowerFps.add(cb.fp);
      baseLowerFps.add(renamedFp(cb, rho));
    }
  const anchorDepsChanged = (f: WFact): boolean =>
    f.anchors.some((a) =>
      (ctx.obsEntries.get(a) ?? []).some((e) =>
        (e.entry.deps ?? []).some((d) => delta.has(d.id) || deleted.has(d.id))
      )
    );
  ctx.newFact = (f: WFact): boolean => {
    if (!hasBase) return false;
    if (f.declared) return !baseLowerFps.has(f.claim ?? "");
    if (f.type === "hatch") {
      const x = f.at ?? "";
      if (finest.has(x)) return true;
      const n = f.n ?? 0;
      const nb = Mb?.ids.get(x)?.markers[f.kind ?? ""] ?? 0;
      const y = relocatedFrom.get(x);
      const ny = y ? (Mb?.ids.get(y)?.markers[f.kind ?? ""] ?? 0) : 0;
      return !(nb >= n || ny >= n);
    }
    const x = f.at ?? "";
    if (!delta.has(x) && !anchorDepsChanged(f)) return false;
    const ids = [f.fid];
    const y = relocatedFrom.get(x);
    if (y) ids.push(factId({ ...f.raw, at: y }));
    for (const id of ids) {
      if (!baseReports.has(id)) continue;
      const nb = baseReports.get(id) ?? null;
      if (nb !== null && f.n !== null && nb >= f.n) return false;
    }
    return true;
  };
  ctx.calls = buildCalls(facts);
  for (const info of Mh.ids.values())
    ctx.refs.set(
      info.id,
      info.refs.filter((r) => Mh.ids.has(r) && r !== info.id)
    );
  const { edges, ungovernedCalls, droppedEdges } = liftedEdges(Wh, facts);
  const declEdges = liftedEdges(Wh, decl).edges;
  const edgeNew = (e: Edge): boolean => e.facts.length > 0 && e.facts.every((f) => ctx.newFact(f));

  // ---- 9. loosening, forward and reverse (A.8; needed first for A.16.13) -------------------------------
  const reqIdsOver = (W: World, c: Claim): string[] => {
    const tierB = c.tier;
    const floor = tierPolicy(base?.policy ?? policy, tierB).floor;
    const req = c.requirement ?? { level: "declared" as const, judged: false, pins: [], projection: "unit" as const };
    const level = levelRank(req.level) >= levelRank(floor) ? req.level : floor;
    const kind = level !== "declared" && level !== "none" ? "test" : req.judged ? "judgment" : "test";
    const proj = kind === "test" ? (req.projection === "trust" ? "trust" : "unit") : req.projection;
    const save = ctx.Wh;
    ctx.Wh = W;
    try {
      return sortedUniq(reqOf(ctx, c, kind, proj).map((p) => p.id));
    } finally {
      ctx.Wh = save;
    }
  };
  let parts: LoosePart[] = [];
  let order: CheckOutput["order"] = null;
  if (hasBase && baseUnreadable) {
    parts = [
      {
        question: "L0",
        subject: "shape",
        answer: "undecided",
        affected: [],
        delta: [`L0 ${v.base?.unreadable ?? "unreadable"}`],
        counterexample: null,
        channels: [],
        realisedBy: [],
        realised: false,
        unmapped: false,
        exploited: false
      }
    ];
    order = "undecided";
  } else if (hasBase && base && Wb) {
    const fwdEnv: PassEnv = {
      base,
      head,
      Wb,
      Wh,
      M: Mh,
      rho,
      hints,
      unmapped,
      heirs,
      templates,
      claimImplies,
      closureEqual,
      emptyBase,
      facts,
      evalEdges: edges,
      declEdges,
      reqIds: (c) => reqIdsOver(Wh, c)
    };
    const fwd = runPass(fwdEnv);
    parts = fwd.parts;
    for (const [b, hs] of fwd.hA) for (const h of hs) ctx.hAOf.set(h, sortedUniq([...(ctx.hAOf.get(h) ?? []), b]));
    // reverse pass: base and head exchanged over the union code (A.8.1.3 [D17])
    const Mu = unionManifest(Mh, Mb as ManifestIndex);
    const rWb = buildWorld(head, Mu, { side: "b", baseMan: Mh });
    const rWh = buildWorld(base, Mu, { side: "b", baseMan: Mb });
    const rRho = new Map<string, string>();
    for (const [b, h] of rho) rRho.set(h, b);
    const rHints = new Map<string, string>();
    for (const [b, h] of hints) rHints.set(h, b);
    const rUnmapped = new Set<string>();
    for (const x of [...head.components, ...head.resources, ...head.units])
      if (!x.q.startsWith("std::") && !rRho.has(x.q)) rUnmapped.add(x.q);
    const rHeirs = computeHeirs({
      baseClaims: head.claims,
      headClaims: base.claims,
      rho: rRho,
      w: rWh,
      templates,
      claimImplies: invertImplies(claimImplies),
      closureEqual
    }).heirs;
    const rDecl = liftedEdges(rWh, declaredFactsOf(base.claims, rWh)).edges;
    const rev = runPass({
      base: head,
      head: base,
      Wb: rWb,
      Wh: rWh,
      M: Mu,
      rho: rRho,
      hints: rHints,
      unmapped: rUnmapped,
      heirs: rHeirs,
      templates,
      claimImplies: invertImplies(claimImplies),
      closureEqual,
      emptyBase: false,
      facts: [],
      evalEdges: rDecl,
      declEdges: rDecl,
      reqIds: (c) => reqIdsOver(rWh, c)
    });
    order = orderClass(parts, rev.parts);
  }
  const looseBase: ESF = base ?? head;
  const subjTier = (subject: string): Tier =>
    baseUnreadable ? "critical" : subjectTier(looseBase, Wb, subject);
  const subjOwner = (subject: string): string =>
    baseUnreadable ? head.shape.owner : subjectOwner(looseBase, subject);

  const own = (m: ManifestIndex | null, id: string, p: string): string | null =>
    m?.ids.get(id)?.digests.get(p) ?? null;
  const finestCode = (affected: string[]): CodeRow[] =>
    affected.filter((x) => finest.has(x)).map((x) => [x, "own", own(Mb, x, "own"), own(Mh, x, "own")]);
  const blank = (): Omit<
    Ob,
    "kind" | "key" | "claim" | "subject" | "tier" | "owner" | "affected" | "code"
  > => ({
    reason: null,
    questions: null,
    force: null,
    introduced: false,
    delta: [],
    tokens: [],
    witness: [],
    facts: {},
    counterexample: null,
    exploited: null,
    final: false,
    causes: [],
    message: "",
    excluding: [],
    contra: null,
    law: null,
    lawContra: false,
    coverage: null,
    vocab: null,
    parts: null,
    pcReqDelta: false,
    binding: "",
    group: "",
    matched: [],
    exceptionAnswered: false,
    discharged: null,
    exceptionAnswer: null
  });
  const finestTokens = (affected: string[]): string[] =>
    affected.filter((x) => finest.has(x)).map((x) => `x:${x}`);

  // loosening obligations: one per base item (A.8.2.1)
  const looseObs: Ob[] = [];
  const bySubject = new Map<string, LoosePart[]>();
  for (const p of parts) bySubject.set(p.subject, [...(bySubject.get(p.subject) ?? []), p]);
  for (const [subject, ps] of [...bySubject.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const key = obKey("loosening", null, subject);
    const tier = subjTier(subject);
    const affected = sortedUniq(ps.flatMap((p) => p.affected));
    const deltaL = sortedUniq(ps.flatMap((p) => p.delta));
    const qs = sortedUniq(ps.map((p) => p.question));
    let cx: JsonValue = null;
    for (const q of QUESTION_ORDER) {
      const p = ps.find((x) => x.question === q && x.counterexample !== null);
      if (p) {
        cx = p.counterexample;
        break;
      }
    }
    const bc = baseClaims.get(subject) ?? null;
    const code = finestCode(affected);
    looseObs.push({
      ...blank(),
      kind: "loosening",
      key,
      claim: bc,
      subject,
      questions: qs,
      tier,
      owner: subjOwner(subject),
      introduced: true,
      affected,
      code,
      delta: deltaL,
      tokens: [
        ...ps.flatMap((p) => p.realisedBy.map((f) => `f:${f}`)),
        ...finestTokens(affected),
        `b:${subject}`
      ],
      counterexample: cx,
      exploited: false,
      final: tier === "final",
      causes: [{ type: "base-claim", id: subject, text: `${qs.join(", ")}: ${deltaL.slice(0, 3).join("; ")}` }],
      message: `${subject}: ${deltaL.slice(0, 4).join("; ")} (${qs.join(", ")}), at ${affected.filter((a) => !a.startsWith("cell:")).length} files and ${affected.filter((a) => a.startsWith("cell:")).length} regions.`,
      parts: ps,
      binding: bindingOf(key, affected, code, deltaL)
    });
  }

  // ---- 13a. answers and claim reviews (A.7.6) ------------------------------------------------------------
  const changeIds = input.change?.ids ?? [];
  const relayDeclared = relays.size > 0;
  const answers: Answer[] = [];
  const unauthenticatedReviews: string[] = [];
  const unrecorded: string[] = [];
  if (!preview) {
    if (!relayDeclared)
      for (const rv of input.reviews ?? []) {
        if (rv.change !== undefined && !changeIds.includes(rv.change)) continue;
        const ident = String(rv.identity ?? "").trim();
        const actor = gv.byIdentity.get(ident) ?? null;
        const line = String(rv.line ?? "").trim();
        const ap = /^shape\s+approve\s+(.+)$/.exec(line);
        const jd = /^shape\s+(judge|reject)\s+\S+/.exec(line);
        if (ap) {
          unauthenticatedReviews.push(`review ${actor ?? ident}: ${line}`);
          if (actor)
            answers.push({
              actor,
              refs: (ap[1] ?? "").trim().split(/\s+/),
              source: `review:${H(rv as Review).slice(7, 23)}`
            });
        } else if (jd) unrecorded.push(`review ${actor ?? ident}: ${line}`);
      }
    for (const r of records) {
      const s = r.shape;
      if (s.kind !== "judgment" || s.result !== "approves" || !s.about || !s.judge) continue;
      if (!changeIds.includes(s.about.change)) continue;
      answers.push({ actor: s.judge, refs: s.about.refs, source: r.id });
    }
  }
  const resolve = (pool: Ob[]): Map<string, { actor: string; source: string }[]> => {
    const out = new Map<string, { actor: string; source: string }[]>();
    for (const a of answers)
      for (const ref of a.refs) {
        if (!/^bd:[0-9a-f]{16,}$/.test(ref)) continue;
        const hits = pool.filter((o) => o.binding.startsWith(ref));
        if (hits.length !== 1) continue;
        const o = hits[0] as Ob;
        const list = out.get(o.key) ?? [];
        if (!list.some((x) => x.actor === a.actor && x.source === a.source))
          list.push({ actor: a.actor, source: a.source });
        out.set(o.key, list);
      }
    return out;
  };

  // A.16.13: base claims whose final loosening two persons answered in this run
  {
    const pre = resolve(looseObs);
    for (const o of looseObs) {
      if (!o.final || !baseClaims.has(String(o.subject))) continue;
      const res = answerItems(ctx, gv, o, pre.get(o.key) ?? [], subjOwner);
      if (res.ok) ctx.finalAnswered.add(String(o.subject));
    }
  }

  // ---- 7. contradictions ------------------------------------------------------------------------------
  const rhoInv = new Map<string, string>();
  for (const [b, h] of rho) rhoInv.set(h, b);
  const lvlB = (x: string, atomH: string, f: WFact): Tier | null => {
    if (!Wb) {
      // audit: G* reads the head as governance base (A.6.1.6), so Lvl_b is the head's Lvl at
      // the head attribution, for the head atom (A.6.2.3)
      if (mode !== "audit") return null;
      let t: Tier | null = null;
      for (const pos of Wh.attAll(x)) for (const c of excludingClaims(Wh, pos, atomH)) t = t ? maxTier(t, c.tier) : c.tier;
      return t;
    }
    let atomB: string | null = null;
    if (f.type === "effect" && f.verb && f.resource) {
      const r = Wb.resOfCode.get(f.resource);
      atomB = r ? `${f.verb}<${r}>` : null;
    } else if (f.type === "hatch" && f.kind) atomB = liftHatch(Wb, f.kind, Mh.ids.get(x)?.lang ?? "");
    else if (f.declared && f.atom) {
      // a declared summary atom names its resource by its head Q: the base shape reads it as
      // ρ⁻¹ of that resource, or as itself when the base has a resource of that name; Lvl_b at
      // att_b(x) applies to declared facts as to observed ones (A.6.2.3, A.4.4.7)
      const a = parseAtom(f.atom);
      if (a) {
        const rb = rhoInv.get(a.resource) ?? a.resource;
        if (rb === TRUST || base?.resources.some((r) => r.q === rb)) atomB = `${a.verb}<${rb}>`;
      }
    }
    if (!atomB) return null;
    let t: Tier | null = null;
    for (const pos of Wb.attAll(x))
      for (const c of excludingClaims(Wb, pos, atomB)) {
        let ct: Tier | null = c.tier;
        if (ctx.finalAnswered.has(c.fp)) {
          const hs = (heirs.get(c.fp) ?? []).map((h) => headClaims.get(h)).filter((y): y is Claim => !!y);
          ct = hs.length === 0 ? null : maxTier(...hs.map((y) => y.tier));
        }
        if (ct) t = t ? maxTier(t, ct) : ct;
      }
    return t;
  };
  const contras: Contra[] = [
    ...evalEffects(ctx, facts, errors, lvlB),
    ...evalLower(ctx, facts, edges),
    ...evalStructure(ctx, edges, errors)
  ];
  for (const c of contras)
    if (c.claim.op !== "effect.forbid" && c.claim.op !== "effects.upper" && c.claim.op !== "authority")
      c.tierStar = tierStar(ctx, c.claim);

  // ---- 8. laws ------------------------------------------------------------------------------------------
  const nfOf = (x: { fp: string; nf?: string }): { op: Claim["op"]; args: Claim["args"] } | null => {
    if (x.nf) {
      try {
        const y = JSON.parse(x.nf) as { op: Claim["op"]; args: Claim["args"] };
        if (H(y) === x.fp) return { op: y.op, args: y.args };
      } catch {
        // fall through
      }
    }
    const c = headClaims.get(x.fp) ?? baseClaims.get(x.fp);
    return c ? { op: c.op, args: c.args } : null;
  };
  const geq = (r: { fp: string; nf?: string }, c: Claim): boolean => {
    if (r.fp === c.fp) return true;
    const bc = baseClaims.get(r.fp);
    if (bc && renamedFp(bc, rho) === c.fp) return true;
    if (claimImplies.get(r.fp)?.has(c.fp)) return true;
    const n = nfOf(r);
    return !!n && c.op === "law" && n.op === "law" && opOrderGeq(n, c, Wh, templates);
  };
  const leq = (r: { fp: string; nf?: string }, c: Claim): boolean => {
    if (r.fp === c.fp) return true;
    const bc = baseClaims.get(r.fp);
    if (bc && renamedFp(bc, rho) === c.fp) return true;
    if (claimImplies.get(c.fp)?.has(r.fp)) return true;
    const n = nfOf(r);
    return !!n && c.op === "law" && n.op === "law" && opOrderGeq(c, n, Wh, templates);
  };
  // persisted judgments of earlier changes keep their eligibility (A.16.4(b))
  const earlier = new Set<string>();
  for (const p of input.persisted?.base ?? []) earlier.add(H(stmtOf(p.record)));
  for (const r of baseRecs.valid)
    if (!r.shape.about || !changeIds.includes(r.shape.about.change)) earlier.add(r.id);
  const lawDeps = { geq, leq, earlier };
  const laws = evaluateLaws(ctx, lawDeps);
  errors.push(...providerMissing(ctx, laws, lawDeps));

  // ---- 10. coverage -------------------------------------------------------------------------------------
  const cov = computeCoverage(ctx);

  // exploited (A.8.3.1, A.16.10)
  const uncoveredOn = (x: string, chans: string[]): boolean => {
    const info = Mh.ids.get(x);
    if (!info) return false;
    const obsCh = chans.filter((ch) => observable(ctx, ch));
    if (obsCh.length === 0) return true;
    for (const ch0 of obsCh) {
      const ch = channelAt(ch0, info);
      if (!ch) continue;
      if (ch.startsWith("hatch(")) {
        if (!info.hatchComplete) return true;
        continue;
      }
      const met = nearestEntries(ctx, x).some((e) => {
        const g = provs.get(e.provider);
        return e.entry.complete && !e.producerChanged && !!g && g.absenceB && channelCovered(g.channelsB, ch);
      });
      if (!met) return true;
    }
    return false;
  };
  for (const o of looseObs) {
    let ex = false;
    for (const p of o.parts ?? []) {
      if (p.question === "L0" || p.question === "L7") continue;
      let e = p.realised;
      const tp = tierPolicy(policy, o.tier);
      if (!e && (tp.blocks.includes("coverage") || o.tier === "final"))
        e = p.affected.some((x) => delta.has(x) && uncoveredOn(x, p.channels));
      p.exploited = e;
      ex = ex || e;
    }
    o.exploited = ex;
  }

  // ---- 11. obligations, introduced, bindings, groups ----------------------------------------------
  const obs2: Ob[] = [];
  for (const c of contras) {
    const key = obKey("contradiction", c.claim.fp, c.subject);
    const affected = c.refuted ? footprint(Wh, c.claim).code : c.supportCode;
    let introduced = false;
    if (hasBase) {
      if (c.refuted) introduced = affected.some((x) => delta.has(x)) || refutedAtBase(ctx, c);
      else if (c.supportEdges.length > 0 || isStructural(c.claim)) introduced = c.supportEdges.some(edgeNew);
      else introduced = c.witness.some((f) => ctx.newFact(f));
    }
    const facts2: Record<string, JsonValue> = {};
    for (const f of c.witness) {
      const { n: _n, ...raw } = f.raw;
      void _n;
      facts2[f.fid] = (f.declared || f.n === null ? raw : { ...raw, n: f.n }) as JsonValue;
    }
    if (c.refuted) for (const k of Object.keys(facts2)) delete facts2[k];
    obs2.push({
      ...blank(),
      kind: "contradiction",
      key,
      claim: c.claim,
      subject: c.subject,
      force: c.force,
      tier: c.tierStar,
      owner: ownerStar(ctx, c.claim),
      introduced,
      affected,
      code: finestCode(affected),
      tokens: [...c.support.map((f) => `f:${f.fid}`), ...finestTokens(affected)],
      witness: c.refuted ? [] : c.witness.map((f) => f.fid),
      facts: facts2,
      final: c.tierStar === "final",
      causes: c.causes,
      message: c.message,
      excluding: c.excluding,
      contra: c
    });
  }
  const lawsContradictedAtBase: JsonValue[] = [];
  for (const l of laws) {
    for (const cx of l.baseContradictions)
      lawsContradictedAtBase.push({ claim: l.claim.fp, counterexample: cx });
    const reqCode: CodeRow[] = l.bindingReq.map((p: Pair) => [
      p.id,
      p.projection,
      own(Mb, p.id, p.projection),
      own(Mh, p.id, p.projection)
    ]);
    const reqIds = sortedUniq(l.bindingReq.map((p) => p.id));
    const common = {
      ...blank(),
      claim: l.claim,
      tier: l.tierStar,
      owner: ownerStar(ctx, l.claim),
      final: l.tierStar === "final",
      excluding: [l.claim],
      law: l
    };
    const contraEv = l.soundContra ?? l.heurContras[0] ?? null;
    if (contraEv) {
      obs2.push({
        ...common,
        kind: "contradiction",
        key: obKey("contradiction", l.claim.fp, null),
        subject: null,
        force: l.soundContra ? "sound" : "heuristic",
        introduced: l.contraIntroduced,
        affected: reqIds,
        code: reqCode,
        tokens: finestTokens(reqIds),
        witness: [contraEv.record.id],
        counterexample: contraEv.counterexample,
        lawContra: true,
        causes: [
          {
            type: "record",
            id: contraEv.record.id,
            text: `${contraEv.record.shape.kind} by ${contraEv.record.shape.provider?.id ?? contraEv.judge} contradicts ${l.claim.ids[0]}`
          },
          { type: "claim", id: l.claim.fp, text: `${l.claim.ids[0]}` }
        ],
        message: `${l.claim.ids[0]} is contradicted by ${contraEv.record.shape.kind}${l.soundContra ? "" : " (heuristic)"}.`
      });
    }
    if (!l.sat && !l.soundContra) {
      const pcAffected = l.reason === "producer-changed" ? l.producerFinest : [];
      const affected = sortedUniq([...reqIds, ...pcAffected]);
      const code: CodeRow[] = [
        ...reqCode,
        ...pcAffected.map((x): CodeRow => [x, "own", own(Mb, x, "own"), own(Mh, x, "own")])
      ];
      const holder = [...l.reasonRecords].sort((a, b) => cmpStr(a.record.id, b.record.id))[0];
      const pcCauses =
        l.reason === "producer-changed" ? l.reasonRecords.flatMap((e) => producerCauses(ctx, e.record)) : [];
      obs2.push({
        ...common,
        kind: "unestablished",
        key: obKey("unestablished", l.claim.fp, null),
        subject: null,
        reason: l.reason,
        introduced: l.unestIntroduced,
        affected,
        code,
        tokens: [...finestTokens(affected), ...pcCauses.map((x) => `x:${x}`)],
        pcReqDelta:
          l.reason === "producer-changed" &&
          l.bindingReq.some((p) => deltaPairs.has(`${p.id}\u0000${p.projection}`) || deleted.has(p.id)),
        causes: holder
          ? [
              {
                type: "record",
                id: holder.record.id,
                text: `${holder.record.shape.kind} for ${l.claim.ids[0]} is ${holder.reason}`
              }
            ]
          : [],
        message: `${l.claim.ids[0]} is not established at ${l.req.level}${l.req.judged ? " or judged" : ""}: ${l.reason}.`
      });
    }
  }
  obs2.push(...looseObs);
  // coverage (A.7.4.4)
  for (const c of cov.obligations) {
    if (c.healthOnly) continue;
    const key = obKey("coverage", null, c.subject);
    const affected = c.uncovered;
    const code: CodeRow[] = [
      ...finestCode(affected),
      ...c.depCode.map((d): CodeRow => [d, "own", own(Mb, d, "own"), own(Mh, d, "own")])
    ];
    const deltaC = sortedUniq(c.unmet.map((u) => `${u.claim} ${u.channel}`));
    obs2.push({
      ...blank(),
      kind: "coverage",
      key,
      claim: null,
      subject: c.subject,
      tier: c.tier,
      owner: c.owner,
      introduced: true,
      affected,
      code,
      delta: deltaC,
      tokens: finestTokens(affected),
      final: c.tier === "final",
      coverage: c,
      causes: affected.map((x) => ({ type: "code" as const, id: x })),
      message: `changed code under ${c.subject === UNGOVERNED ? "no component" : c.subject} is not covered: ${affected.join(", ")}.`
    });
  }
  for (const vo of cov.vocab) {
    const key = obKey("coverage", null, vo.subject);
    obs2.push({
      ...blank(),
      kind: "coverage",
      key,
      claim: null,
      subject: vo.subject,
      tier: vo.tier,
      owner: gov.shape.owner,
      introduced: true,
      affected: vo.sites,
      code: finestCode(vo.sites),
      tokens: finestTokens(vo.sites),
      final: vo.tier === "final",
      vocab: vo,
      causes: sortedUniq(vo.facts.map((f) => f.fid)).map((id) => ({ type: "fact" as const, id })),
      message: `${vo.subject} appears in new facts at ${vo.sites.join(", ")} but is not in the vocabulary.`
    });
  }
  if (!hasBase) for (const o of obs2) o.introduced = false;
  for (const o of obs2) if (!o.binding) o.binding = bindingOf(o.key, o.affected, o.code, o.delta);

  // groups (A.7.2.3 [D10]; A.15.11)
  const parent = obs2.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  const tokOwner = new Map<string, number>();
  obs2.forEach((o, i) => {
    for (const t of sortedUniq(o.tokens)) {
      const j = tokOwner.get(t);
      if (j === undefined) tokOwner.set(t, i);
      else {
        const a = root(i);
        const b = root(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const byRoot = new Map<number, string[]>();
  obs2.forEach((o, i) => byRoot.set(root(i), [...(byRoot.get(root(i)) ?? []), o.key]));
  obs2.forEach((o, i) => {
    o.group = `g:${hexh(sortedUniq(byRoot.get(root(i)) ?? [o.key]))}`;
  });

  // ---- 12. exceptions (A.4.6) ------------------------------------------------------------------------------
  const active = head.exceptions.filter((e) => now < e.expires);
  const usedExceptions = new Set<string>();
  for (const o of obs2) {
    if (o.kind !== "contradiction" && o.kind !== "unestablished") continue;
    if (o.tier === "final") continue;
    const excl = o.excluding.length > 0 ? o.excluding : o.claim ? [o.claim] : [];
    if (excl.length === 0) continue;
    const matchedBy: ExceptionItem[] = [];
    let all = true;
    for (const c of excl) {
      const ms = active.filter((e) => exceptionMatches(ctx, e, o, c));
      if (ms.length === 0) all = false;
      for (const m of ms) if (!matchedBy.includes(m)) matchedBy.push(m);
    }
    if (all) {
      o.matched = matchedBy.sort((a, b) => a.expires - b.expires || cmpStr(a.q, b.q));
      for (const m of matchedBy) usedExceptions.add(m.q);
    }
  }
  const inertExceptions = active.filter((e) => !usedExceptions.has(e.q)).map((e) => e.q);

  // ---- 13b. answers (A.7.6.5-6) -----------------------------------------------------------------------------
  const answersFor = resolve(obs2);
  const selfUses: string[] = [];
  for (const o of obs2) {
    const as = answersFor.get(o.key) ?? [];
    if (as.length === 0) continue;
    if (answerable(o)) {
      const res = answerItems(ctx, gv, o, as, subjOwner);
      if (res.ok) {
        o.discharged = { records: sortedUniq(res.sources), self: res.self, selfActors: res.selfActors };
        for (const a of res.selfActors) selfUses.push(`answer ${o.key} by ${a}`);
        continue;
      }
    }
    if (o.matched.length > 0 && o.introduced) {
      const ex = exceptionAnswer(ctx, gv, o, as);
      if (ex.ok) {
        o.exceptionAnswered = true;
        o.exceptionAnswer = { records: sortedUniq(ex.sources) };
      }
    }
  }
  // a use of the self fallback is a judgment it made eligible that acts: one establishing its
  // claim (supports and usable) or contradicting it with force (A.16.30, A.16.43)
  for (const l of laws)
    for (const e of l.evals)
      if (
        e.self &&
        e.applicable &&
        ((e.direction === "supports" && e.reason === null) || (e.direction === "contradicts" && e.force !== null))
      )
        selfUses.push(`judgment ${l.claim.ids[0] ?? l.claim.fp} by ${e.judge}`);

  // ---- 14. severity, dischargers, budget, verdict, debt, health -----------------------------------------
  const outObs: ObligationOut[] = [];
  const answered: CheckOutput["answered"] = [];
  const debt: CheckOutput["debt"] = [];
  const preexisting: CheckOutput["preexisting"] = [];
  const unanswered: JsonValue[] = [];
  const finalDrift: string[] = [];
  const rows: { o: Ob; out: ObligationOut; rule: number }[] = [];
  for (const o of obs2) {
    if (o.discharged) {
      answered.push({
        obligation: o.key,
        records: o.discharged.records,
        self: o.discharged.self,
        exploited: o.kind === "loosening" ? o.exploited : null,
        as: "discharge"
      });
      continue;
    }
    const { severity, rule } = severityOf(ctx, o);
    if (o.exceptionAnswer)
      answered.push({
        obligation: o.key,
        records: o.exceptionAnswer.records,
        self: false,
        exploited: o.kind === "loosening" ? o.exploited : null,
        as: "exception-answer"
      });
    const dis = dischargers(ctx, gv, o, subjOwner);
    const first = dis[0]?.act ?? "";
    const out: ObligationOut = {
      key: o.key,
      kind: o.kind,
      reason: o.reason,
      questions: o.questions,
      introduced: o.introduced,
      severity,
      tier: o.tier,
      budget: ["rerun", "provide", "edit-code", "add-was"].includes(first) ? "mechanical" : "judgment",
      force: o.force,
      owner: o.owner,
      assignee: null,
      group: o.group,
      claim: o.claim ? { fp: o.claim.fp, ids: o.claim.ids, tier: o.claim.tier } : null,
      subject: o.subject,
      witness: o.witness,
      facts: o.facts,
      counterexample: o.counterexample,
      exploited: o.kind === "loosening" ? o.exploited : null,
      final: o.final,
      binding: o.binding,
      exception: rule === 5 ? (o.matched[0]?.q ?? null) : null,
      dischargers: dis,
      message: o.message,
      causes: o.causes,
      affected: o.affected,
      rule,
      matched: o.matched.length > 0
    };
    outObs.push(out);
    rows.push({ o, out, rule });
    if (rule === 5) {
      const ex = o.matched[0] as ExceptionItem;
      debt.push({
        obligation: o.key,
        exceptions: o.matched.map((e) => e.q).sort(cmpStr),
        exception: ex.q,
        owner: ex.owner,
        expiresInDays: Math.ceil((ex.expires - now) / 86400)
      });
    }
    if (rule === 6) {
      preexisting.push({ obligation: o.key, owner: o.owner });
      if (o.kind === "contradiction" && o.force === "sound" && o.tier === "final") finalDrift.push(o.key);
    }
    if (severity === "owed" && (o.kind === "loosening" || o.kind === "coverage"))
      unanswered.push({
        key: o.key,
        kind: o.kind,
        subject: o.subject,
        questions: o.questions,
        tier: o.tier,
        affected: o.affected
      });
  }
  outObs.sort((a, b) => cmpTuple([a.severity, a.kind, a.key], [b.severity, b.kind, b.key]));

  // budget (A.10.3, A.9.2): judgment groups; owed loosening and coverage lapse outside budget
  const inBudget = rows.filter(
    (r) => !(r.out.severity === "owed" && (r.o.kind === "loosening" || r.o.kind === "coverage"))
  );
  const groups = new Map<string, { o: Ob; out: ObligationOut; rule: number }[]>();
  for (const r of inBudget) groups.set(r.out.group, [...(groups.get(r.out.group) ?? []), r]);
  const judgmentGroups = [...groups.entries()]
    .filter(([, rs]) => rs.some((r) => r.out.budget === "judgment"))
    .map(([g, rs]) => ({
      g,
      rs,
      blocking: rs.some((r) => r.out.severity === "blocking"),
      tier: rs.reduce<Tier>((t, r) => maxTier(t, r.out.tier), "low")
    }))
    .sort((a, b) =>
      cmpTuple([a.blocking ? 0 : 1, -tierRank(a.tier), a.g], [b.blocking ? 0 : 1, -tierRank(b.tier), b.g])
    );
  const agentOk = judgmentGroups.filter(
    (x) =>
      x.tier !== "final" &&
      tierPolicy(policy, x.tier).judges.includes("agents") &&
      !x.rs.some(
        (r) =>
          r.o.kind === "loosening" ||
          (r.o.matched.length > 0 && r.o.introduced) ||
          r.o.reason === "producer-changed" ||
          r.o.final
      )
  );
  const limit = policy.budget;
  const taken = limit === null ? agentOk : agentOk.slice(0, limit);
  const overflow = limit === null ? [] : agentOk.slice(limit).map((x) => x.g);
  for (const t of taken) for (const r of t.rs) if (r.out.budget === "judgment") r.out.assignee = "agents";

  const blocking = errors.length > 0 || outObs.some((o) => o.severity === "blocking");
  const verdict: CheckOutput["verdict"] = blocking ? "blocked" : outObs.length > 0 ? "owed" : "pass";

  // phase-1 summary per group (display, A.7.6.2)
  const summary: NonNullable<CheckOutput["summary"]> = [];
  const allGroups = new Map<string, Ob[]>();
  for (const r of rows) allGroups.set(r.out.group, [...(allGroups.get(r.out.group) ?? []), r.o]);
  for (const [g, os] of [...allGroups.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const refs = os
      .filter((o) => answerable(o) || (o.matched.length > 0 && o.introduced))
      .map((o) => o.binding.slice(0, 19));
    const outs = outObs.filter((x) => x.group === g);
    summary.push({
      group: g,
      tier: os.reduce<Tier>((t, o) => maxTier(t, o.tier), "low"),
      eligible: sortedUniq(
        outs.flatMap((o) => o.dischargers.flatMap((d) => (d.by === "judges" ? d.eligible : [])))
      ),
      approve: refs.length > 0 ? `shape approve ${sortedUniq(refs).join(" ")}` : null,
      judge: relayDeclared
        ? sortedUniq(
            outs
              .filter((o) => o.kind === "unestablished" && o.dischargers.some((d) => d.act === "judge"))
              .map((o) => `shape judge ${o.claim?.ids[0] ?? ""}`)
          )
        : [],
      members: os.map((o) => o.key).sort(cmpStr)
    });
  }

  // health (A.16.30)
  const govProvs = baseUnreadable ? [] : gov.providers;
  const declaredOnly: JsonValue[] = [];
  for (const c of head.claims) {
    if (!CHECKER_OPS.has(c.op)) continue;
    const chans = footprint(Wh, c).channels;
    if (chans.some((t) => observable(ctx, t))) continue;
    const declaredBy = govProvs.some((p) =>
      chans.some((t) =>
        t === "call(*)" ? p.observes.some((o) => o.startsWith("call(")) : channelCovered(p.observes, t)
      )
    );
    declaredOnly.push({ claim: c.fp, route: declaredBy ? "contradiction-only" : "declared-only", tier: c.tier });
  }
  declaredOnly.sort((a, b) => cmpStr(String((a as { claim: string }).claim), String((b as { claim: string }).claim)));
  const unmappedCodes = sortedUniq(
    facts
      .filter((f) => f.type === "effect" && f.observed && f.resource && !Wh.resOfCode.get(f.resource))
      .map((f) => f.resource as string)
  );
  const provUnauth = [...provs.values()]
    .filter((g) => !g.authenticated)
    .map((g) => `provider ${g.q}`);
  const health: Record<string, JsonValue> = {
    coverage: { num: cov.coveredCount, den: cov.checked },
    unobservable: cov.unobservable,
    declaredOnly,
    unanswered: unanswered.sort((a, b) =>
      cmpStr(String((a as { key: string }).key), String((b as { key: string }).key))
    ),
    openAuthority: head.components
      .filter((c) => c.grants === null && !c.q.startsWith("std::"))
      .map((c) => c.q)
      .sort(cmpStr),
    ungoverned: { num: (Wh.codeOfPos.get(UNGOVERNED) ?? []).length, den: Mh.ids.size },
    unmapped: unmappedCodes,
    externalCalls: obs.externalCalls,
    ungovernedCalls,
    unanchored: obs.unanchored,
    droppedEdges,
    unauthenticated: sortedUniq([...unauthManifests, ...provUnauth, ...unauthenticatedReviews]),
    unrecorded: sortedUniq(unrecorded),
    rejected: { count: rejected.length, rj06: rejected.filter((r) => r.code === "RJ06").length },
    executesHead: sortedUniq(
      [...provs.values()]
        .filter((g) =>
          [...(g.base?.produces ?? []), ...(g.head?.produces ?? [])].some(
            (k) => k === "test" || k === "proof" || k === "equivalence"
          )
        )
        .map((g) => g.q)
    ),
    baseObservations:
      hasBase &&
      (input.baseRecords ?? []).length === 0 &&
      (base?.providers ?? []).some((p) => p.produces.includes("observation"))
        ? "missing"
        : "present",
    baseDefects,
    clockClamped,
    trustDebt: debt.length,
    finalDrift: sortedUniq(finalDrift),
    lawsContradictedAtBase: lawsContradictedAtBase.sort((a, b) => cmpStr(jcs(a), jcs(b))),
    inertExceptions: sortedUniq(inertExceptions),
    vacuousLaws: sortedUniq(laws.filter((l) => l.vacuous).map((l) => l.claim.fp)),
    budget: { limit, used: taken.length, overflow: overflow.length },
    self: sortedUniq(selfUses),
    preexisting: preexisting.length,
    renames: renames.length,
    assumption: "dependency code and configuration data"
  };
  if (input.options?.teeth) health.teeth = teeth(ctx, facts) as JsonValue;

  // loosening rows (A.12.10.1, A.16.24(b))
  const looseningRows: CheckOutput["loosening"] = [];
  for (const o of looseObs)
    for (const p of o.parts ?? [])
      looseningRows.push({
        question: p.question,
        subject: String(o.subject),
        answer: p.answer,
        exploited: p.exploited,
        final: o.tier === "final",
        affected: p.affected,
        counterexample: p.counterexample,
        obligation: o.key
      });

  return {
    contract: "shape.check.output/v1",
    mode,
    inputDigest: inputDigest(input),
    verdict,
    errors: dedupErrors(errors),
    rejected,
    obligations: outObs,
    answered: answered.sort((a, b) => cmpStr(a.obligation, b.obligation)),
    loosening: looseningRows.sort((a, b) => cmpTuple([a.subject, a.question], [b.subject, b.question])),
    order: mode === "audit" ? null : order ?? "equivalent",
    renames: renames.sort((a, b) => cmpStr(a.base, b.base)),
    debt: debt.sort((a, b) => cmpStr(a.obligation, b.obligation)),
    preexisting: preexisting.sort((a, b) => cmpStr(a.obligation, b.obligation)),
    budget: { limit, used: taken.length, overflow: overflow.sort(cmpStr) },
    health: input.options?.health === false ? {} : health,
    summary
  };
}

function isStructural(c: Claim): boolean {
  return c.op === "edge.forbid" || c.op === "path.forbid" || c.op === "cycle.forbid";
}

function invertImplies(m: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [a, bs] of m) for (const b of bs) out.set(b, new Set([...(out.get(b) ?? []), a]));
  return out;
}

/** M_h ∪ M_b (head entries win), for the reverse pass. */
function unionManifest(Mh: ManifestIndex, Mb: ManifestIndex): ManifestIndex {
  const ids = new Map(Mh.ids);
  for (const [k, v] of Mb.ids) if (!ids.has(k)) ids.set(k, v);
  const children = new Map<string, string[]>();
  for (const [k, v] of Mb.children) children.set(k, [...v]);
  for (const [k, v] of Mh.children) children.set(k, sortedUniq([...(children.get(k) ?? []), ...v]));
  return {
    revision: Mh.revision,
    ids,
    tree: Mh.tree,
    paths: new Set([...Mh.paths, ...Mb.paths]),
    children,
    root: Mh.root
  };
}

/** Did a usable base-revision record report the fact a refutation finds missing (A.7.3.3 [D7])? */
function refutedAtBase(ctx: Ctx, c: Contra): boolean {
  if (!ctx.Wb || !ctx.Mb) return false;
  const code = new Set(footprint(ctx.Wh, c.claim).code);
  for (const r of ctx.baseRecords) {
    if (r.shape.kind !== "observation" || !ctx.usableAtBase(r)) continue;
    for (const f of r.shape.facts ?? []) {
      if (c.claim.op === "effects.lower" && f.type === "effect") {
        const subj = c.subject as { atom?: string } | null;
        const want = subj?.atom ? /^(\w+)<(.+)>$/.exec(subj.atom) : null;
        const res = ctx.Wh.resOfCode.get(f.resource);
        if (want && code.has(f.at) && res === want[2] && f.verb === want[1]) return true;
      } else if (c.claim.op === "edge.exists" && f.type === "call") {
        const a = posComp(ctx.Wh.att(f.at));
        const b = ctx.Mh.ids.has(f.to) ? posComp(ctx.Wh.att(f.to)) : null;
        if (a === c.claim.args.from && b === c.claim.args.to) return true;
      }
    }
  }
  return false;
}

// ---- exceptions ------------------------------------------------------------------------------------------

function exceptionMatches(ctx: Ctx, e: ExceptionItem, o: Ob, c: Claim): boolean {
  if (!e.waives.includes(o.kind as "contradiction" | "unestablished")) return false;
  const W = ctx.Wh;
  const s = o.subject as Record<string, JsonValue> | null;
  const reqIds = o.law ? sortedUniq(o.law.bindingReq.map((p) => p.id)) : [];
  if (e.target.kind === "claim") {
    if (!e.target.fps.includes(c.fp)) return false;
  } else {
    const K = e.target.q;
    const code = new Set(compCode(W, K));
    let attributed = false;
    if (o.law) attributed = reqIds.length > 0 && reqIds.every((x) => code.has(x));
    else if (s && typeof s.code === "string")
      attributed = s.code.startsWith("unit:") ? posComp(s.code.slice(5)) === K : code.has(s.code);
    else if (s && typeof s.unit === "string") attributed = posComp(s.unit) === K;
    else if (s && typeof s.from === "string") attributed = s.from === K;
    else if (s && Array.isArray(s.nodes)) attributed = (s.nodes as string[]).includes(K);
    if (!attributed) return false;
  }
  if (e.for) {
    const inSigma = (x: string): boolean =>
      e.for?.some((sub) =>
        sub.kind === "code" ? sub.id === x : sub.kind === "unit" ? matchUnitSel(W, sub.sel, x) : false
      ) ?? false;
    if (o.law) return reqIds.length > 0 && reqIds.every(inSigma);
    if (s && typeof s.code === "string") return inSigma(s.code);
    if (s && typeof s.unit === "string") {
      const xs = W.codeOfPos.get(s.unit) ?? [];
      return xs.length > 0 && xs.every(inSigma);
    }
    if (s && typeof s.from === "string")
      return e.for.some((sub) => sub.kind === "pair" && sub.from === s.from && sub.to === s.to);
    return false;
  }
  return true;
}

function matchUnitSel(W: World, sel: string, x: string): boolean {
  const pos = W.att(x);
  if (sel === "*") return true;
  if (sel === UNGOVERNED) return pos === UNGOVERNED;
  if (sel.startsWith("component ")) return posComp(pos) === sel.slice(10);
  if (sel.startsWith("unit ")) return pos === sel.slice(5);
  return false;
}

// ---- answers ---------------------------------------------------------------------------------------------

function answerable(o: Ob): boolean {
  if (o.kind === "loosening" || o.kind === "coverage") return true;
  if (o.kind === "contradiction") return o.force === "heuristic";
  return o.kind === "unestablished" && o.reason === "producer-changed";
}

interface Item {
  owner: string;
  noAgent: boolean;
}

/** Answer items (A.7.6.5) and the two-person rule for final ones (A.6.3.4, A.16.12). */
function answerItems(
  ctx: Ctx,
  gov: Gov,
  o: Ob,
  as: { actor: string; source: string }[],
  subjOwner: (s: string) => string
): { ok: boolean; self: boolean; selfActors: string[]; sources: string[] } {
  const fail = { ok: false, self: false, selfActors: [], sources: [] };
  if (as.length === 0) return fail;
  const tier = o.tier;
  const elig = (actor: string, it: Item, final: boolean): { ok: boolean; self: boolean } =>
    isEligible(gov, actor, { tier, owner: it.owner, noAgent: it.noAgent, final } as EligibilityQuery);
  // final: two distinct eligible persons covering the required owners and the base shape owner
  if (o.final) {
    const owners: string[] = [];
    if (o.kind === "loosening") owners.push(subjOwner(String(o.subject)));
    else if (o.kind === "coverage" && o.coverage) {
      owners.push(o.coverage.owner);
      for (const fp of o.coverage.unmetFinalClaims) {
        const c = ctx.headClaims.get(fp);
        if (c) owners.push(ownerStar(ctx, c));
      }
    } else if (o.claim) owners.push(ownerStar(ctx, o.claim));
    else owners.push(gov.shapeOwner);
    owners.push(gov.shapeOwner);
    const need = sortedUniq(owners);
    const ok = sortedUniq(
      as
        .map((a) => a.actor)
        .filter((a) => isPerson(gov, a) && need.some((w) => elig(a, { owner: w, noAgent: true }, true).ok))
    );
    // choose two distinct persons covering every needed owner (persons of each actor)
    for (const x of ok)
      for (const y of ok) {
        if (x >= y) continue;
        const covers = need.every((w) => {
          const ps = new Set(persons(gov, w));
          return ps.has(x) || ps.has(y);
        });
        const twoOfSame = need.length === 1 ? persons(gov, need[0] as string).filter((p) => p === x || p === y).length === 2 : true;
        if (covers && twoOfSame)
          return {
            ok: true,
            self: false,
            selfActors: [],
            // A.16.40: every answer from a person who counts for the final item is listed
            sources: as.filter((a) => ok.includes(a.actor)).map((a) => a.source)
          };
      }
    return fail;
  }
  const items: Item[] = [];
  if (o.kind === "loosening") items.push({ owner: subjOwner(String(o.subject)), noAgent: true });
  else if (o.kind === "contradiction" && o.claim) items.push({ owner: ownerStar(ctx, o.claim), noAgent: false });
  else if (o.kind === "unestablished" && o.claim) items.push({ owner: ownerStar(ctx, o.claim), noAgent: true });
  else if (o.kind === "coverage") {
    if (o.vocab) items.push({ owner: gov.shapeOwner, noAgent: false });
    else if (o.coverage) {
      items.push({ owner: o.coverage.owner, noAgent: false });
      for (const fp of o.coverage.unmetClaims) {
        const c = ctx.headClaims.get(fp);
        if (c) items.push({ owner: ownerStar(ctx, c), noAgent: false });
      }
    }
  }
  let self = false;
  const selfActors: string[] = [];
  const sources: string[] = [];
  // A.16.40 (amending A.16.28): records list every answer eligible for at least one item, none
  // chosen over another, so they never depend on input order (T1); self is read over them
  for (const it of items) {
    const hits = as.filter((a) => (!it.noAgent || isPerson(gov, a.actor)) && elig(a.actor, it, false).ok);
    if (hits.length === 0) return fail;
    for (const hit of hits) {
      if (elig(hit.actor, it, false).self) {
        self = true;
        if (!selfActors.includes(hit.actor)) selfActors.push(hit.actor);
      }
      sources.push(hit.source);
    }
  }
  return { ok: items.length > 0, self, selfActors: selfActors.sort(cmpStr), sources };
}

function exceptionAnswer(
  ctx: Ctx,
  gov: Gov,
  o: Ob,
  as: { actor: string; source: string }[]
): { ok: boolean; sources: string[] } {
  const sources: string[] = [];
  const excl = o.excluding.length > 0 ? o.excluding : o.claim ? [o.claim] : [];
  // A.16.40: every answer from an eligible non-agent for some excluding claim's owner* is listed
  for (const c of excl) {
    const hits = as.filter(
      (a) =>
        isPerson(gov, a.actor) &&
        isEligible(gov, a.actor, { tier: o.tier, owner: ownerStar(ctx, c), noAgent: true, final: false }).ok
    );
    if (hits.length === 0) return { ok: false, sources: [] };
    for (const hit of hits) sources.push(hit.source);
  }
  return { ok: excl.length > 0, sources };
}

// ---- severity (A.7.5, A.16.24) -------------------------------------------------------------------------------

function severityOf(ctx: Ctx, o: Ob): { severity: Severity; rule: number } {
  if (o.kind === "contradiction" && o.force === "sound" && o.tier === "final" && o.introduced)
    return { severity: "blocking", rule: 2 };
  if (o.kind === "loosening" && (o.questions ?? []).includes("L0")) return { severity: "blocking", rule: 3 };
  if (o.kind === "loosening" && o.tier === "final") return { severity: "blocking", rule: 4 };
  if (o.kind === "coverage" && o.coverage && o.coverage.unmetFinalClaims.length > 0)
    return { severity: "blocking", rule: 4 };
  if (o.matched.length > 0 && (!o.introduced || o.exceptionAnswered)) return { severity: "owed", rule: 5 };
  if (!o.introduced) return { severity: "owed", rule: 6 };
  if (o.kind === "contradiction") return { severity: o.force === "sound" ? "blocking" : "owed", rule: 7 };
  if (o.kind === "loosening" && o.exploited) return { severity: "blocking", rule: 8 };
  if (o.kind === "unestablished" && o.reason === "producer-changed" && o.pcReqDelta)
    return { severity: "blocking", rule: 8 };
  const blocks = tierPolicy(ctx.policy, o.tier).blocks as string[];
  const kind = o.kind === "loosening" ? "latent-loosening" : o.kind;
  return { severity: blocks.includes(kind) ? "blocking" : "owed", rule: 9 };
}

// ---- dischargers (A.7.1.3, A.16.27) ------------------------------------------------------------------------

function dischargers(ctx: Ctx, gov: Gov, o: Ob, subjOwner: (s: string) => string): Discharger[] {
  const out: Discharger[] = [];
  const ref = o.binding.slice(0, 19);
  const tp = tierPolicy(ctx.policy, o.tier);
  const agentsListed = o.tier !== "final" && tp.judges.includes("agents");
  const elig = (owner: string, noAgent: boolean): string[] =>
    eligibleNow(gov, { tier: o.tier, owner, noAgent: noAgent || o.final, final: o.final });
  const finalElig = (owners: string[]): string[] =>
    sortedUniq(owners.flatMap((w) => elig(w, true))).filter((a) => isPerson(gov, a));
  const author = (act: Discharger["act"], agentSafe = true, creates: Discharger["creates"] = null): Discharger => ({
    act,
    by: "author",
    agentSafe,
    eligible: [],
    creates
  });
  const ci = (act: Discharger["act"]): Discharger => ({ act, by: "ci", agentSafe: true, eligible: [], creates: null });
  // the loosening an edit would raise, or null when it changes only items the base lacks
  const creates = (c: Claim | null): Discharger["creates"] => {
    if (!c || !ctx.hasBase || ctx.baseUnreadable) return null;
    const inherits = (ctx.heirOf.get(c.fp) ?? []).length > 0 || (ctx.hAOf.get(c.fp) ?? []).length > 0;
    if (!inherits) return null;
    const owners = sortedUniq([ownerStar(ctx, c), ...(o.final ? [gov.shapeOwner] : [])]);
    return { kind: "loosening", tier: o.tier, answers: o.final ? 2 : 1, owners };
  };
  const exception = (): Discharger | null =>
    o.final
      ? null
      : {
          act: "exception",
          by: "judges",
          agentSafe: false,
          eligible: sortedUniq(
            (o.excluding.length > 0 ? o.excluding : o.claim ? [o.claim] : []).flatMap((c) =>
              elig(ownerStar(ctx, c), true).filter((a) => isPerson(gov, a))
            )
          ),
          creates: null,
          command: `shape approve ${ref}`
        };
  if (o.kind === "contradiction") {
    if (o.force === "heuristic")
      out.push({
        act: "answer",
        by: "judges",
        agentSafe: agentsListed,
        eligible: o.final
          ? finalElig([o.claim ? ownerStar(ctx, o.claim) : gov.shapeOwner, gov.shapeOwner])
          : o.claim
            ? elig(ownerStar(ctx, o.claim), false)
            : [],
        creates: null,
        command: `shape approve ${ref}`
      });
    out.push(author("edit-code"));
    const ex = exception();
    if (ex) out.push(ex);
    out.push(author("edit-shape", true, creates(o.claim)));
  } else if (o.kind === "unestablished" && o.law) {
    const l = o.law;
    const owner = ownerStar(ctx, l.claim);
    const decidedBy = [...ctx.provs.values()].filter(
      (g) => lawDecidedBy(l.claim, { decides: g.decidesA }) &&
        g.produces.some((k) => k === "test" || (k === "proof" && !g.persist) || k === "observation")
    );
    const judge: Discharger | null = l.req.judged
      ? {
          act: "judge",
          by: "judges",
          agentSafe: agentsListed,
          eligible: o.final ? finalElig([owner, gov.shapeOwner]) : elig(owner, false),
          creates: null,
          command: `shape judge ${l.claim.ids[0] ?? ""}`
        }
      : null;
    switch (o.reason) {
      case "producer-changed":
        out.push({
          act: "answer",
          by: "judges",
          agentSafe: false,
          eligible: o.final ? finalElig([owner, gov.shapeOwner]) : elig(owner, true).filter((a) => isPerson(gov, a)),
          creates: null,
          command: `shape approve ${ref}`
        });
        break;
      case "assumption":
        out.push(author("edit-code"));
        out.push(author("declare", false, creates(l.claim)));
        break;
      case "expired":
        if (judge) out.push(judge);
        break;
      default:
        if (decidedBy.length > 0) out.push(ci("rerun"));
        else if (!l.req.judged) out.push(author("provide"));
        if (judge) out.push(judge);
    }
    const ex = exception();
    if (ex) out.push(ex);
    out.push(author("lower-requirement", true, creates(l.claim)));
  } else if (o.kind === "loosening") {
    const subject = String(o.subject);
    out.push(author("revert"));
    if ((o.parts ?? []).some((p) => p.answer === "undecided" && p.unmapped)) out.push(author("add-was"));
    if ((o.parts ?? []).some((p) => p.question === "L4" && p.answer === "undecided")) out.push(ci("provide"));
    const ownerQ = subjOwner(subject);
    out.push({
      act: "answer",
      by: "judges",
      agentSafe: false,
      eligible: o.final ? finalElig([ownerQ, gov.shapeOwner]) : elig(ownerQ, true).filter((a) => isPerson(gov, a)),
      creates: null,
      command: `shape approve ${ref}`
    });
  } else if (o.kind === "coverage" && o.vocab) {
    out.push(author("declare"));
    out.push({
      act: "answer",
      by: "judges",
      agentSafe: agentsListed,
      eligible: o.final ? finalElig([gov.shapeOwner]) : elig(gov.shapeOwner, false),
      creates: null,
      command: `shape approve ${ref}`
    });
  } else if (o.kind === "coverage" && o.coverage) {
    const c = o.coverage;
    const owners = [
      c.owner,
      ...c.unmetClaims.map((f) => {
        const cl = ctx.headClaims.get(f);
        return cl ? ownerStar(ctx, cl) : gov.shapeOwner;
      })
    ];
    out.push({
      act: "answer",
      by: "judges",
      agentSafe: agentsListed,
      eligible: o.final ? finalElig([...owners, gov.shapeOwner]) : sortedUniq(owners.flatMap((w) => elig(w, false))),
      creates: null,
      command: `shape approve ${ref}`
    });
    out.push(author("declare"));
    out.push(author("provide"));
  }
  if (out.length > 0 && out.filter((d) => d.by === "judges").every((d) => d.eligible.length === 0))
    for (const d of out) if (d.by === "judges") d.snippet = "no eligible answerer";
  return out;
}

// ---- teeth (minimal, A.10.5) ------------------------------------------------------------------------------

function teeth(ctx: Ctx, facts: WFact[]): Record<string, JsonValue> {
  const W = ctx.Wh;
  const unusedGrants: string[] = [];
  for (const c of W.esf.components) {
    if (!c.grants) continue;
    const code = new Set(compCode(W, c.q));
    for (const g of c.grants) {
      const used = facts.some((f) => {
        if (!f.at || !code.has(f.at)) return false;
        const r = f.resource ? (W.resOfCode.get(f.resource) ?? f.resource) : null;
        const atom = f.atom ?? (f.verb && r ? `${f.verb}<${r}>` : null);
        return atom === g;
      });
      if (!used) unusedGrants.push(`${c.q} ${g}`);
    }
  }
  const vacuous = ctx.head.claims
    .filter((c) => (c.op === "effect.forbid" || c.op === "authority") && footprint(W, c).code.length === 0)
    .map((c) => c.ids[0] ?? c.fp);
  const gaps = W.esf.resources
    .filter((r) => !r.q.startsWith("std::") && !W.forbids.some((f) => String(f.args.atom).endsWith(`<${r.q}>`)))
    .map((r) => r.q);
  return {
    unusedGrants: unusedGrants.sort(cmpStr),
    vacuous: vacuous.sort(cmpStr),
    gaps: gaps.sort(cmpStr),
    redundant: []
  };
}

export { ancestorsOrSelf, renameArgs };
