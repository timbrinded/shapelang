// derive: the checker's one pure function (A.7.8). Input → verdict, errors, obligations, debt,
// health. Reads only its input; every list is sorted; core output is permutation-invariant.
import {
  type Contra,
  buildCalls,
  declaredFacts,
  evalEffects,
  evalLower,
  evalStructure,
  evalUpper,
  footprint,
  liftedEdges,
  tierStar
} from "./checker.ts";
import type { Ctx } from "./context.ts";
import { type CoverageOb, type VocabOb, computeCoverage } from "./coverage.ts";
import { elaborate } from "./elaborate.ts";
import {
  type ProvG,
  type WFact,
  baseReported,
  channelCovered,
  hatchFacts,
  observedWorld,
  processRecords,
  providerGovernance
} from "./evidence.ts";
import {
  type Gov,
  buildGov,
  eligibleByRole,
  eligibleNow,
  isEligible,
  isPerson,
  policyStar,
  tierPolicy
} from "./governance.ts";
import type { CheckInput, CheckOutput, ObligationOut, Severity } from "./io-types.ts";
import { H, hexh, jcs } from "./jcs.ts";
import {
  type LawEval,
  type ClaimJudgmentReview,
  evaluateLaws,
  ownerStar,
  producerChanged,
  providerMissing
} from "./laws.ts";
import { type LoosePart, decideLoosening, subjectOwner, subjectTier } from "./loosening.ts";
import {
  type ManifestIndex,
  type ManifestPredicate,
  type Statement,
  gitTreeId,
  indexManifest,
  sortManifest
} from "./manifest.ts";
import type { Decl } from "./source.ts";
import type {
  Cause,
  Claim,
  Discharger,
  ESF,
  ExceptionItem,
  JsonValue,
  ShapeError
} from "./model.ts";
import { type ParsedRecord, persistedPath } from "./records.ts";
import { opOrderGeq, renameArgs, renamedFp } from "./strength.ts";
import { type Tier, cmpStr, cmpTuple, maxTier, sortedUniq, tierRank, toSeconds } from "./util.ts";
import { UNGOVERNED, buildWorld, compCode, posComp } from "./world.ts";

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
  code: [string, string, string | null, string | null][];
  delta: string[];
  supportFacts: string[];
  witness: string[];
  facts: Record<string, JsonValue>;
  counterexample: JsonValue;
  exploited: boolean | null;
  final: boolean;
  causes: Cause[];
  message: string;
  excluding: Claim[];
  law: LawEval | null;
  coverage: CoverageOb | null;
  vocab: VocabOb | null;
  parts: LoosePart[] | null;
  producerChangedReqDelta: boolean;
  binding: string;
  group: string;
  matched: ExceptionItem[];
  exceptionAnswered: boolean;
  discharged: { records: string[]; self: boolean } | null;
  exceptionAnswer: { records: string[]; self: boolean } | null;
}

function emptyEsf(): ESF {
  return elaborate({ v: "shape.source.v1", modules: [] }, { lenient: true, now: 0 });
}

function obKey(kind: string, claim: string | null, subject: JsonValue): string {
  const o: Record<string, JsonValue> = { v: "shape.obligation.v1", kind, subject };
  if (claim !== null) o.claim = claim;
  return `ob:${hexh(o)}`;
}

function bindingOf(
  key: string,
  affected: string[],
  code: [string, string, string | null, string | null][],
  delta: string[]
): string {
  return `bd:${hexh({
    v: "shape.binding.v1",
    key,
    affected: sortedUniq(affected),
    code: [...code].sort((a, b) => cmpStr(a[0], b[0]) || cmpStr(a[1], b[1])),
    delta: sortedUniq(delta)
  })}`;
}

function invalid(input: CheckInput, problems: string[]): CheckOutput {
  return {
    contract: "shape.check.output/v1",
    mode: input?.mode ?? "change",
    inputDigest: safeDigest(input),
    verdict: "invalid",
    errors: problems.sort(cmpStr).map((p) => ({
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
    renames: [],
    debt: [],
    preexisting: [],
    budget: { limit: null, used: 0, overflow: [] },
    health: {}
  };
}

function safeDigest(input: unknown): string {
  try {
    return H(canonicalInput(input as CheckInput));
  } catch {
    return "sha256:invalid";
  }
}

/** The input with every list in canonical order, for inputDigest (A.12.7.6). */
export function canonicalInput(input: CheckInput): unknown {
  const sortJ = <T>(xs: T[] | undefined): T[] =>
    [...(xs ?? [])].sort((a, b) => cmpStr(jcs(a), jcs(b)));
  const declKey = (d: Decl): string =>
    `${d.decl}\u0000${d.decl === "hatch" ? d.names.join(",") : d.name}`;
  const set = (xs: string[] | undefined): string[] | undefined => (xs ? [...xs].sort(cmpStr) : xs);
  const canonDecl = (d: Decl): Decl => {
    switch (d.decl) {
      case "component":
        return {
          ...d,
          units: d.units ? [...d.units].sort((a, b) => cmpStr(a.name, b.name)) : d.units,
          grants: Array.isArray(d.grants) ? [...d.grants].sort(cmpStr) : d.grants,
          paths: set(d.paths),
          allows: set(d.allows),
          relationsComplete: set(d.relationsComplete),
          assumes: d.assumes ? [...d.assumes].sort((a, b) => cmpStr(a.id, b.id)) : d.assumes
        };
      case "resource":
        return { ...d, bind: set(d.bind) };
      case "actor":
        return { ...d, identities: set(d.identities), members: set(d.members) };
      case "provider":
        return {
          ...d,
          observes: set(d.observes),
          decides: set(d.decides),
          produces: [...d.produces].sort(cmpStr),
          sound: d.sound ? [...d.sound].sort(cmpStr) : d.sound
        };
      case "note":
        return { ...d, about: [...d.about].sort(cmpStr) };
      default:
        return d;
    }
  };
  const src = (s: CheckInput["head"]["source"]): unknown =>
    s === null || s === undefined
      ? null
      : {
          ...s,
          modules: [...s.modules]
            .map((m) => ({
              ...m,
              file: undefined,
              imports: [...(m.imports ?? [])].sort(cmpStr),
              decls: m.decls
                .map(canonDecl)
                .sort((a, b) => cmpStr(declKey(a), declKey(b)) || cmpStr(jcs(a), jcs(b)))
            }))
            .sort((a, b) => cmpStr(a.module, b.module))
        };
  const man = (st: Statement | undefined): unknown => {
    const p = st?.predicate?.shape as ManifestPredicate | undefined;
    return p && Array.isArray(p.tree) && Array.isArray(p.entries)
      ? { ...st, predicate: { ...st?.predicate, shape: sortManifest(p) } }
      : st;
  };
  const rev = (r: CheckInput["head"] | null): unknown =>
    r ? { ...r, source: src(r.source), manifest: man(r.manifest) } : null;
  return {
    ...input,
    head: rev(input.head),
    base: rev(input.base),
    change: { ids: sortJ(input.change?.ids) },
    authors: sortJ(input.authors),
    reviews: sortJ(input.reviews),
    records: sortJ(input.records),
    baseRecords: sortJ(input.baseRecords),
    persisted: { base: sortJ(input.persisted?.base), head: sortJ(input.persisted?.head) }
  };
}

export function derive(input: CheckInput): CheckOutput {
  // ---- 1. verify ------------------------------------------------------------------------------------
  const problems: string[] = [];
  if (!input || input.contract !== "shape.check.input/v1")
    return invalid(input, ["contract: not shape.check.input/v1"]);
  if (!["change", "audit", "preview"].includes(input.mode))
    problems.push(`mode: ${String(input.mode)}`);
  const nowRaw = toSeconds(input.now ?? "");
  if (nowRaw === null) problems.push("now: not RFC 3339");
  if (input.mode === "audit" && input.base !== null) problems.push("base: audit mode has no base");
  if (input.mode !== "audit" && !input.base)
    problems.push("base: change and preview need a base (possibly empty)");
  if (!input.head?.source || input.head.source.v !== "shape.source.v1")
    problems.push("head: source is not shape.source.v1");
  const mh = indexManifest(input.head?.manifest);
  for (const p of mh.problems) problems.push(`head manifest: ${p.code} ${p.detail}`);
  let mb: ReturnType<typeof indexManifest> | null = null;
  if (input.base) {
    mb = indexManifest(input.base.manifest);
    for (const p of mb.problems) problems.push(`base manifest: ${p.code} ${p.detail}`);
  }
  if (mh.index && input.head.treeId && gitTreeId(mh.index.tree) !== input.head.treeId)
    problems.push("head manifest: tree does not rebuild to treeId");
  if (mb?.index && input.base?.treeId && gitTreeId(mb.index.tree) !== input.base.treeId)
    problems.push("base manifest: tree does not rebuild to treeId");
  if (mh.index && mh.index.revision !== input.head.revision)
    problems.push("head manifest: revision mismatch");
  if (problems.length > 0 || !mh.index || nowRaw === null) return invalid(input, problems);
  const Mh = mh.index;
  const Mb = mb?.index ?? null;
  const baseTime = input.base?.committerTime ? toSeconds(input.base.committerTime) : null;
  const now = Math.max(nowRaw, baseTime ?? nowRaw);
  const clockClamped = baseTime !== null && baseTime > nowRaw;
  const mode = input.mode;
  const preview = mode === "preview";

  // ---- 2. elaborate --------------------------------------------------------------------------------
  const head = elaborate(input.head.source, { now });
  const errors: ShapeError[] = [...head.errors];
  let base: ESF | null = null;
  let baseUnreadable = false;
  if (input.base) {
    if (input.base.source === null || input.base.source?.v !== "shape.source.v1")
      baseUnreadable = true;
    else base = elaborate(input.base.source, { lenient: true, now });
  }
  const hasBase = mode !== "audit" && !!input.base;
  const gov: ESF = mode === "audit" ? head : (base ?? (baseUnreadable ? head : emptyEsf()));

  // persisted evidence paths and append-only
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

  // ---- 3. records ----------------------------------------------------------------------------------
  const provs = providerGovernance(gov, head);
  const actorsMap = new Map(
    gov.actors.map((a) => [a.q, { identities: a.identities, kind: a.kind, operator: a.operator }])
  );
  const actorByIdentity = new Map<string, string>();
  for (const a of gov.actors) for (const i of a.identities) actorByIdentity.set(i, a.q);
  const relays = new Map<string, string | null>();
  for (const p of gov.providers) if (p.produces.includes("judgment")) relays.set(p.q, p.identity);
  const manifests = new Map<string, Map<string, string>>();
  const trees = new Map<string, Set<string>>();
  const manMap = (m: ManifestIndex): Map<string, string> => {
    const out = new Map<string, string>();
    for (const info of m.ids.values())
      for (const [proj, d] of info.digests)
        out.set(`${info.id}\u0000${proj}\u0000${info.schemes.get(proj)}`, d);
    return out;
  };
  manifests.set(Mh.revision, manMap(Mh));
  trees.set(Mh.revision, Mh.paths);
  if (Mb) {
    manifests.set(Mb.revision, manMap(Mb));
    trees.set(Mb.revision, Mb.paths);
  }
  const vctx = {
    now,
    mode,
    baseProviders: new Map(
      gov.providers.map((p) => [p.q, { produces: p.produces, identity: p.identity }])
    ),
    headProviders: new Map(
      head.providers.map((p) => [p.q, { produces: p.produces, identity: p.identity }])
    ),
    actors: actorsMap,
    actorByIdentity,
    relays,
    headRevision: Mh.revision,
    baseRevision: Mb?.revision ?? null,
    manifests,
    trees
  };
  const recs = processRecords(
    input.records ?? [],
    (input.persisted?.head ?? []).map((p) => p.record),
    vctx
  );
  const baseRecs = processRecords(input.baseRecords ?? [], [], vctx);
  let records = recs.valid;
  if (preview) records = records.filter((r) => r.shape.kind !== "judgment");

  // ---- 4. worlds, deltas, ρ, ≡, heirs, G* ----------------------------------------------------------
  const Wh = buildWorld(head, Mh, { side: "h" });
  errors.push(...Wh.errors);
  const Wb = base && hasBase ? buildWorld(base, Mh, { side: "b", baseMan: Mb }) : null;
  const delta = new Set<string>();
  const deleted = new Set<string>();
  const finest = new Set<string>();
  if (hasBase && Mb) {
    for (const [id, info] of Mh.ids) {
      const b = Mb.ids.get(id);
      if (!b) {
        delta.add(id);
        finest.add(id);
        continue;
      }
      for (const [proj, d] of info.digests) {
        const bd = b.digests.get(proj);
        if (bd !== undefined && b.schemes.get(proj) === info.schemes.get(proj) && bd !== d)
          delta.add(id);
      }
      const ob = b.digests.get("own");
      const oh = info.digests.get("own");
      if (ob !== undefined && oh !== undefined && ob !== oh) finest.add(id);
    }
    for (const id of Mb.ids.keys()) if (!Mh.ids.has(id)) deleted.add(id);
  }
  // ≡ by contributing equivalence records (code space)
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
  // ρ
  const rho = new Map<string, string>();
  const hints = new Map<string, string>();
  const unmapped = new Set<string>();
  const renames: CheckOutput["renames"] = [];
  if (base) {
    const items = (e: ESF): { q: string; kind: string; was: string | null; bind: string }[] => [
      ...e.components.map((c) => ({
        q: c.q,
        kind: "component",
        was: c.was,
        bind: c.paths.join("\n")
      })),
      ...e.resources.map((r) => ({
        q: r.q,
        kind: "resource",
        was: r.was,
        bind: r.bind.join("\n")
      })),
      ...e.units.map((u) => ({
        q: u.q,
        kind: "unit",
        was: u.was,
        bind: (Wh.unitBind.get(u.q) ?? "") as string
      }))
    ];
    const hi = items(head);
    const bi = items(base);
    const taken = new Set<string>();
    for (const b of bi) {
      const same = hi.find((h) => h.q === b.q && h.kind === b.kind);
      if (same) {
        rho.set(b.q, b.q);
        taken.add(same.q);
      }
    }
    for (const b of bi) {
      if (rho.has(b.q)) continue;
      const wasHits = hi.filter(
        (h) =>
          h.kind === b.kind &&
          h.was &&
          (h.was === b.q || b.q.endsWith(`::${h.was}`) || b.q.endsWith(`.${h.was}`))
      );
      if (wasHits.length === 1 && !taken.has((wasHits[0] as { q: string }).q)) {
        const h = wasHits[0] as { q: string };
        rho.set(b.q, h.q);
        taken.add(h.q);
        renames.push({ base: b.q, head: h.q, rule: "was" });
        continue;
      }
      if (b.bind === "") continue;
      const bindHits = hi.filter(
        (h) => h.kind === b.kind && !taken.has(h.q) && h.bind === b.bind && h.bind !== ""
      );
      if (bindHits.length === 1) {
        const h = bindHits[0] as { q: string };
        rho.set(b.q, h.q);
        taken.add(h.q);
        renames.push({ base: b.q, head: h.q, rule: "binding" });
      }
    }
    // units follow renamed components
    for (const u of base.units) {
      if (rho.has(u.q)) continue;
      const comp = rho.get(u.component);
      if (comp && comp !== u.component && head.units.some((x) => x.q === `${comp}.${u.name}`)) {
        rho.set(u.q, `${comp}.${u.name}`);
        renames.push({ base: u.q, head: `${comp}.${u.name}`, rule: "component" });
      }
    }
    // rule 3: a unique remove-and-add per kind and module is a hint only
    const mod = (q: string): string => q.split("::")[0] ?? "";
    for (const kind of ["component", "resource", "unit"]) {
      const removed = bi.filter((b) => b.kind === kind && !rho.has(b.q));
      const added = hi.filter((h) => h.kind === kind && ![...rho.values()].includes(h.q));
      for (const b of removed) unmapped.add(b.q);
      const mods = new Set([...removed.map((b) => mod(b.q)), ...added.map((h) => mod(h.q))]);
      for (const m of mods) {
        const r = removed.filter((b) => mod(b.q) === m);
        const a = added.filter((h) => mod(h.q) === m);
        if (r.length === 1 && a.length === 1) {
          hints.set((r[0] as { q: string }).q, (a[0] as { q: string }).q);
          renames.push({
            base: (r[0] as { q: string }).q,
            head: (a[0] as { q: string }).q,
            rule: "hint"
          });
        }
      }
    }
    // units of hinted components follow as hints
    for (const u of base.units) {
      if (rho.has(u.q) || hints.has(u.q)) continue;
      const comp = hints.get(u.component);
      if (comp && head.units.some((x) => x.q === `${comp}.${u.name}`))
        hints.set(u.q, `${comp}.${u.name}`);
    }
    for (const h of hi) {
      if (!h.was) continue;
      const survivors = hi.filter(
        (x) => x.kind === h.kind && (x.q === h.was || x.q.endsWith(`::${h.was}`))
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
  const baseClaims = new Map((base?.claims ?? (mode === "audit" ? [] : [])).map((c) => [c.fp, c]));
  const templates = new Map([...head.templates, ...(base?.templates ?? [])].map((t) => [t.q, t]));
  const claimImplies = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.shape.kind !== "equivalence" || r.shape.pair?.space !== "claim" || !contributing(r))
      continue;
    const { from, to } = r.shape.pair;
    claimImplies.set(from, new Set([...(claimImplies.get(from) ?? []), to]));
    if (r.shape.result === "equivalent")
      claimImplies.set(to, new Set([...(claimImplies.get(to) ?? []), from]));
  }
  const heirs = new Map<string, string[]>();
  const heirOf = new Map<string, string[]>();
  for (const cb of base?.claims ?? []) {
    const rfp = renamedFp(cb, rho);
    const ren = { op: cb.op, args: renameArgs(cb.args, rho) as Claim["args"] };
    const hs: string[] = [];
    for (const ch of head.claims) {
      if (ch.op !== cb.op) continue;
      let ok = ch.fp === rfp || ch.fp === cb.fp;
      if (!ok && cb.op !== "effect.forbid" && cb.op !== "authority")
        ok = opOrderGeq(ch, ren, Wh, templates);
      if (!ok && (claimImplies.get(ch.fp)?.has(cb.fp) || claimImplies.get(ch.fp)?.has(rfp)))
        ok = true;
      if (ok) hs.push(ch.fp);
    }
    heirs.set(cb.fp, hs.sort(cmpStr));
    for (const h of hs) heirOf.set(h, [...(heirOf.get(h) ?? []), cb.fp].sort(cmpStr));
  }
  const policy = policyStar(gov.policy, head.policy);

  const ctx: Ctx = {
    input,
    mode,
    now,
    hasBase,
    head,
    base: hasBase ? base : null,
    baseUnreadable,
    gov,
    Mh,
    Mb,
    Wh,
    Wb,
    delta,
    deleted,
    finest,
    rho,
    hints,
    unmapped,
    renames,
    provs,
    records,
    baseRecords: baseRecs.valid,
    facts: [],
    factById: new Map(),
    newFact: () => false,
    headClaims,
    baseClaims,
    heirs,
    heirOf,
    policy,
    errors,
    equiv,
    calls: new Map(),
    health: {},
    obsEntries: new Map()
  };

  // ---- 6. W_eval -------------------------------------------------------------------------------
  const pcCache = new Map<string, boolean>();
  const pc = (r: ParsedRecord): boolean => {
    let v = pcCache.get(r.id);
    if (v === undefined) {
      v = producerChanged(ctx, r);
      pcCache.set(r.id, v);
    }
    return v;
  };
  const obs = observedWorld(records, Mh, Mh.revision, provs, pc, equiv);
  ctx.obsEntries = obs.entries;
  const decl = declaredFacts(ctx);
  const facts: WFact[] = [...decl, ...obs.facts, ...hatchFacts(Mh)].sort((a, b) =>
    cmpStr(a.fid, b.fid)
  );
  ctx.facts = facts;
  ctx.factById = new Map(facts.map((f) => [f.fid, f]));
  const reported = baseReported(baseRecs.valid, Mb, Mb?.revision ?? null);
  const baseLowerFps = new Set<string>();
  for (const cb of base?.claims ?? [])
    if (cb.op === "effects.lower" || cb.op === "edge.exists") {
      baseLowerFps.add(cb.fp);
      baseLowerFps.add(renamedFp(cb, rho));
    }
  ctx.newFact = (f: WFact): boolean => {
    if (!hasBase) return false;
    if (f.declared) return !baseLowerFps.has(f.claim ?? "");
    if (f.type === "hatch") {
      const nb = Mb?.ids.get(f.at ?? "")?.markers[f.kind ?? ""] ?? 0;
      return f.n > nb;
    }
    if (!f.at || !delta.has(f.at)) return false;
    return (reported.get(f.fid) ?? 0) < f.n;
  };
  ctx.calls = buildCalls(facts);
  const { edges, ungovernedCalls, droppedEdges } = liftedEdges(ctx, Wh, facts);
  const declaredEdges = liftedEdges(ctx, Wh, decl).edges;

  // ---- 5/7. coherence and contradictions -----------------------------------------------------------
  const contras: Contra[] = [
    ...evalEffects(ctx, facts, errors),
    ...evalUpper(ctx, facts, errors),
    ...evalLower(ctx, facts, edges),
    ...evalStructure(ctx, edges, errors)
  ];

  // ---- governance ---------------------------------------------------------------------------------
  const gv = buildGov(gov, policy, input.authors ?? []);

  // review lines (no relay): approvals and claim judgments, this run only
  const reviewApprovals: { actor: string; refs: string[]; source: string }[] = [];
  const claimReviews: ClaimJudgmentReview[] = [];
  const unauthenticatedReviews: string[] = [];
  if (!preview) {
    for (const rv of input.reviews ?? []) {
      const actor = gv.byIdentity.get(rv.identity.trim());
      if (!actor) continue;
      if (rv.change && !(input.change?.ids ?? []).includes(rv.change)) continue;
      const line = rv.line.trim();
      const ap = /^shape\s+approve\s+((?:bd:[0-9a-f]{16,}\s*)+)$/.exec(line);
      const jd = /^shape\s+judge\s+(\S+)\s*$/.exec(line);
      const rj = /^shape\s+reject\s+(\S+)\s+(.+)$/.exec(line);
      if (ap)
        reviewApprovals.push({
          actor,
          refs: (ap[1] ?? "").trim().split(/\s+/),
          source: `review:${H(rv).slice(7, 23)}`
        });
      else if (jd)
        claimReviews.push({ actor, claimSel: jd[1] ?? "", reject: false, text: "", line });
      else if (rj)
        claimReviews.push({ actor, claimSel: rj[1] ?? "", reject: true, text: rj[2] ?? "", line });
      else continue;
      unauthenticatedReviews.push(`${actor}: ${line}`);
    }
  }

  // ---- 8. laws ---------------------------------------------------------------------------------------
  const nfOf = (x: {
    fp: string;
    nf?: string;
  }): { op: Claim["op"]; args: Claim["args"] } | null => {
    if (x.nf) {
      try {
        const v = JSON.parse(x.nf) as { op: Claim["op"]; args: Claim["args"] };
        if (H(v) === x.fp) return { op: v.op, args: v.args };
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
    return !!n && c.op === "law" && opOrderGeq(n, c, Wh, templates);
  };
  const leq = (r: { fp: string; nf?: string }, c: Claim): boolean => {
    if (r.fp === c.fp) return true;
    const bc = baseClaims.get(r.fp);
    if (bc && renamedFp(bc, rho) === c.fp) return true;
    if (claimImplies.get(c.fp)?.has(r.fp)) return true;
    const n = nfOf(r);
    return !!n && c.op === "law" && opOrderGeq(c, n, Wh, templates);
  };
  const laws = evaluateLaws(ctx, gv, geq, leq, claimReviews);
  const selfJudgments = laws.flatMap((l) =>
    l.evals
      .filter((e) => e.self && e.applicable && !e.reason)
      .map((e) => `judgment ${l.claim.ids[0] ?? l.claim.fp} by ${e.judge}`)
  );
  errors.push(...providerMissing(ctx, laws));

  // ---- 10. coverage ------------------------------------------------------------------------------
  const cov = computeCoverage(ctx, edges);

  // ---- 9. loosening --------------------------------------------------------------------------------
  const blocksCoverage = (t: Tier): boolean => tierPolicy(policy, t).blocks.includes("coverage");
  const loose = decideLoosening({
    ctx,
    edgesHead: edges,
    declaredEdges,
    coverageUncovered: (x, chans) => {
      const needs = cov.needs.get(x);
      if (!needs) return false;
      return needs.some(
        (n) =>
          !n.met &&
          (chans.length === 0 ||
            chans.some(
              (c) => c === n.channel || (c === "call(*)" && n.channel.startsWith("call("))
            ))
      );
    },
    blocksCoverage
  });

  // ---- 11. obligations, introduced, bindings, groups ---------------------------------------------
  const obs2: Ob[] = [];
  const own = (m: ManifestIndex | null, id: string, p: string): string | null =>
    m?.ids.get(id)?.digests.get(p) ?? null;
  const finestCode = (affected: string[]): [string, string, string | null, string | null][] =>
    affected
      .filter((x) => finest.has(x))
      .map((x) => [x, "own", own(Mb, x, "own"), own(Mh, x, "own")]);
  const blank = (): Omit<
    Ob,
    "kind" | "key" | "claim" | "subject" | "tier" | "owner" | "affected" | "code"
  > => ({
    reason: null,
    questions: null,
    force: null,
    introduced: false,
    delta: [],
    supportFacts: [],
    witness: [],
    facts: {},
    counterexample: null,
    exploited: null,
    final: false,
    causes: [],
    message: "",
    excluding: [],
    law: null,
    coverage: null,
    vocab: null,
    parts: null,
    producerChangedReqDelta: false,
    binding: "",
    group: "",
    matched: [],
    exceptionAnswered: false,
    discharged: null,
    exceptionAnswer: null
  });
  // checker-decided contradictions
  for (const c of contras) {
    const key = obKey("contradiction", c.claim.fp, c.subject);
    const affected = c.supportCode;
    obs2.push({
      ...blank(),
      kind: "contradiction",
      key,
      claim: c.claim,
      subject: c.subject,
      force: c.force,
      tier: c.tierStar,
      owner: ownerStar(ctx, c.claim),
      introduced: hasBase && c.support.some((f) => ctx.newFact(f)),
      affected,
      code: finestCode(affected),
      supportFacts: c.support.map((f) => f.fid),
      witness: c.witness.map((f) => f.fid),
      facts: Object.fromEntries(c.witness.map((f) => [f.fid, f.raw as JsonValue])),
      final: c.tierStar === "final",
      causes: c.causes,
      message: c.message,
      excluding: c.excluding
    });
  }
  // laws
  const changed = new Set([...delta, ...deleted]);
  for (const l of laws) {
    const reqCode: [string, string, string | null, string | null][] = l.bindingReq.map((p) => [
      p.id,
      p.projection,
      own(Mb, p.id, p.projection),
      own(Mh, p.id, p.projection)
    ]);
    const reqIds = sortedUniq(l.bindingReq.map((p) => p.id));
    const baseOb = {
      ...blank(),
      claim: l.claim,
      tier: l.tierStar,
      owner: ownerStar(ctx, l.claim),
      introduced: l.introduced,
      code: reqCode,
      final: l.tierStar === "final",
      excluding: [l.claim],
      law: l
    };
    const contraEv = l.soundContra ?? l.heurContras[0] ?? null;
    if (contraEv) {
      obs2.push({
        ...baseOb,
        kind: "contradiction",
        key: obKey("contradiction", l.claim.fp, null),
        subject: null,
        force: l.soundContra ? "sound" : "heuristic",
        affected: reqIds,
        witness: contraEv.record ? [contraEv.record.id] : [],
        causes: [
          {
            type: "record",
            id: contraEv.record?.id ?? contraEv.review ?? "",
            text: `${contraEv.record ? `${contraEv.record.shape.kind} by ${contraEv.record.shape.provider?.id ?? contraEv.judge}` : `review by ${contraEv.judge}`} contradicts ${l.claim.ids[0]}`
          }
        ],
        message: `${l.claim.ids[0]} is contradicted by ${contraEv.record ? contraEv.record.shape.kind : "a review judgment"}${l.soundContra ? "" : " (heuristic)"}.`
      });
    }
    if (!l.sat && !l.soundContra) {
      const affected = sortedUniq([
        ...reqIds,
        ...(l.reason === "producer-changed" ? l.producerFinest : [])
      ]);
      obs2.push({
        ...baseOb,
        kind: "unestablished",
        key: obKey("unestablished", l.claim.fp, null),
        subject: null,
        reason: l.reason,
        affected,
        producerChangedReqDelta:
          l.reason === "producer-changed" && reqIds.some((x) => changed.has(x)),
        causes: l.evals
          .filter((e) => e.reason)
          .map((e) => ({
            type: "record" as const,
            id: e.record?.id ?? e.review ?? "",
            text: `${e.record?.shape.kind ?? "review"} for ${l.claim.ids[0]} is ${e.reason}`
          })),
        message: `${l.claim.ids[0]} is not established at ${l.req.level}${l.req.judged ? " or judged" : ""}: ${l.reason}.`
      });
    }
  }
  // loosening: one obligation per base item
  const bySubject = new Map<string, LoosePart[]>();
  for (const p of loose.parts) bySubject.set(p.subject, [...(bySubject.get(p.subject) ?? []), p]);
  const looseningRows: CheckOutput["loosening"] = [];
  for (const [subject, ps] of [...bySubject.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const key = obKey("loosening", null, subject);
    const tier = subjectTier(ctx, subject);
    const affected = sortedUniq(ps.flatMap((p) => p.affected));
    const deltaL = sortedUniq(ps.flatMap((p) => p.delta));
    const exploited = ps.some((p) => p.exploited);
    const cxs = ps.map((p) => p.counterexample).filter((x) => x !== null);
    const bc = baseClaims.get(subject) ?? null;
    obs2.push({
      ...blank(),
      kind: "loosening",
      key,
      claim: bc,
      subject,
      questions: sortedUniq(ps.map((p) => p.question)),
      tier,
      owner: subjectOwner(ctx, subject),
      introduced: true,
      affected,
      code: finestCode(affected),
      delta: deltaL,
      supportFacts: sortedUniq(ps.flatMap((p) => p.realisedBy)),
      counterexample:
        cxs.length === 0 ? null : cxs.length === 1 ? (cxs[0] as JsonValue) : (cxs as JsonValue),
      exploited,
      final: tier === "final",
      causes: ps.map((p) => ({
        type: "base-claim" as const,
        id: subject,
        text: `${p.question} ${p.answer}: ${p.delta.slice(0, 3).join("; ")}`
      })),
      message: `${subject}: ${deltaL.slice(0, 4).join("; ")} (${sortedUniq(ps.map((p) => p.question)).join(", ")}), at ${affected.filter((a) => !a.startsWith("cell:")).length} files and ${affected.filter((a) => a.startsWith("cell:")).length} regions.`,
      parts: ps
    });
    for (const p of ps)
      looseningRows.push({
        question: p.question,
        subject,
        answer: p.answer,
        exploited: p.exploited,
        final: tier === "final",
        affected: p.affected,
        counterexample: p.counterexample,
        obligation: key
      });
  }
  // coverage
  for (const c of cov.obligations) {
    if (c.healthOnly) continue;
    const key = obKey("coverage", null, c.subject);
    const affected = c.uncovered;
    const code = [
      ...finestCode(affected),
      ...c.depCode
        .filter((d) => finest.has(d))
        .map((d): [string, string, string | null, string | null] => [
          d,
          "own",
          own(Mb, d, "own"),
          own(Mh, d, "own")
        ])
    ];
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
      final: c.tier === "final",
      coverage: c,
      causes: c.unmet.map((u) => ({
        type: "code" as const,
        id: u.id,
        text: `${u.id} needs ${u.channel} for ${headClaims.get(u.claim)?.ids[0] ?? u.claim}`
      })),
      message: `changed code under ${c.subject === UNGOVERNED ? "no component" : c.subject} is not covered: ${affected.join(", ")}.`
    });
  }
  for (const v of cov.vocab) {
    const key = obKey("coverage", null, v.subject);
    obs2.push({
      ...blank(),
      kind: "coverage",
      key,
      claim: null,
      subject: v.subject,
      tier: v.tier,
      owner: gov.shape.owner,
      introduced: true,
      affected: v.sites,
      code: finestCode(v.sites),
      supportFacts: v.facts.map((f) => f.fid),
      final: v.tier === "final",
      vocab: v,
      causes: v.facts.map((f) => ({
        type: "fact" as const,
        id: f.fid,
        text: `${f.verb} at ${f.at} on ${f.resource}`
      })),
      message: `${v.subject} appears in new facts at ${v.sites.join(", ")} but is not in the vocabulary.`
    });
  }
  if (!hasBase) for (const o of obs2) o.introduced = false;
  for (const o of obs2) o.binding = bindingOf(o.key, o.affected, o.code, o.delta);

  // groups: shared support facts or shared affected finest changes
  const parent = obs2.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  const owners = new Map<string, number>();
  obs2.forEach((o, i) => {
    const tokens = [
      ...o.supportFacts.map((f) => `f:${f}`),
      ...o.affected.filter((x) => finest.has(x)).map((x) => `x:${x}`)
    ];
    for (const t of tokens) {
      const j = owners.get(t);
      if (j === undefined) owners.set(t, i);
      else {
        const a = root(i);
        const b = root(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const groupsByRoot = new Map<number, string[]>();
  obs2.forEach((o, i) => groupsByRoot.set(root(i), [...(groupsByRoot.get(root(i)) ?? []), o.key]));
  obs2.forEach((o, i) => {
    o.group = `g:${hexh(sortedUniq(groupsByRoot.get(root(i)) ?? [o.key]))}`;
  });

  // ---- 12. exceptions -----------------------------------------------------------------------------
  const activeExceptions = head.exceptions.filter((e) => now < e.expires);
  for (const o of obs2) {
    if (o.kind !== "contradiction" && o.kind !== "unestablished") continue;
    if (o.tier === "final") continue;
    const excl = o.excluding.length > 0 ? o.excluding : o.claim ? [o.claim] : [];
    const matchedBy: ExceptionItem[] = [];
    let all = excl.length > 0;
    for (const c of excl) {
      const m = activeExceptions.find((e) => exceptionMatches(ctx, e, o, c));
      if (m) {
        if (!matchedBy.includes(m)) matchedBy.push(m);
      } else all = false;
    }
    if (all) o.matched = matchedBy.sort((a, b) => cmpStr(a.q, b.q));
  }

  // ---- 13. answers ------------------------------------------------------------------------------------
  const answers: { actor: string; refs: string[]; source: string }[] = [...reviewApprovals];
  if (!preview) {
    for (const r of records) {
      const s = r.shape;
      if (s.kind !== "judgment" || s.result !== "approves" || !s.about || !s.judge) continue;
      if (!(input.change?.ids ?? []).includes(s.about.change)) continue;
      answers.push({ actor: s.judge, refs: s.about.refs, source: r.id });
    }
  }
  const answersFor = new Map<string, { actor: string; source: string }[]>();
  for (const a of answers) {
    for (const ref of a.refs) {
      if (!/^bd:[0-9a-f]{16,}$/.test(ref)) continue;
      const hits = obs2.filter((o) => o.binding.startsWith(ref));
      if (hits.length !== 1) continue;
      const o = hits[0] as Ob;
      answersFor.set(o.key, [
        ...(answersFor.get(o.key) ?? []),
        { actor: a.actor, source: a.source }
      ]);
    }
  }
  const selfCount: string[] = [];
  for (const o of obs2) {
    const as = answersFor.get(o.key) ?? [];
    if (as.length === 0) continue;
    const res = answerItemsSatisfied(ctx, gv, o, as);
    if (res.ok && answerable(o)) {
      o.discharged = { records: sortedUniq(res.sources), self: res.self };
      if (res.self) selfCount.push(o.key);
      continue;
    }
    if (o.matched.length > 0 && o.introduced) {
      const ex = exceptionAnswerSatisfied(ctx, gv, o, as);
      if (ex.ok) {
        o.exceptionAnswered = true;
        o.exceptionAnswer = { records: sortedUniq(ex.sources), self: false };
      }
    }
  }

  // ---- 14. severity, dischargers, budget, verdict, debt, health ----------------------------------------
  const outObs: ObligationOut[] = [];
  const answered: CheckOutput["answered"] = [];
  const debt: CheckOutput["debt"] = [];
  const preexisting: CheckOutput["preexisting"] = [];
  const unanswered: JsonValue[] = [];
  for (const o of obs2) {
    if (o.discharged) {
      answered.push({
        obligation: o.key,
        records: o.discharged.records,
        self: o.discharged.self,
        exploited: o.exploited,
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
        exploited: o.exploited,
        as: "exception-answer"
      });
    const dis = dischargers(ctx, gv, o);
    const out: ObligationOut = {
      key: o.key,
      kind: o.kind,
      reason: o.reason,
      questions: o.questions,
      introduced: o.introduced,
      severity,
      tier: o.tier,
      budget: ["rerun", "provide", "edit-code", "add-was"].includes(dis[0]?.act ?? "")
        ? "mechanical"
        : "judgment",
      force: o.force,
      owner: o.owner,
      assignee: null,
      group: o.group,
      claim: o.claim ? { fp: o.claim.fp, ids: o.claim.ids, tier: o.claim.tier } : null,
      subject: o.subject,
      witness: o.witness,
      facts: o.facts,
      counterexample: o.counterexample,
      exploited: o.exploited,
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
    if (rule === 5) {
      const ex = o.matched[0] as ExceptionItem;
      const days = Math.ceil((ex.expires - now) / 86400);
      debt.push({
        obligation: o.key,
        exception: ex.q,
        owner: ex.owner,
        expiresInDays: days,
        flagged: days <= 14
      });
    }
    if (rule === 6 || (hasBase && !o.introduced && rule === 2))
      preexisting.push({ obligation: o.key, owner: o.owner });
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

  // budget (A.10.3)
  const groups = new Map<string, ObligationOut[]>();
  for (const o of outObs) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  const judgmentGroups = [...groups.entries()]
    .filter(([, os]) => os.some((o) => o.budget === "judgment"))
    .map(([g, os]) => ({
      g,
      os,
      blocking: os.some((o) => o.severity === "blocking"),
      tier: os.reduce<Tier>((t, o) => maxTier(t, o.tier), "low")
    }))
    .sort((a, b) =>
      cmpTuple(
        [a.blocking ? 0 : 1, -tierRank(a.tier), a.g],
        [b.blocking ? 0 : 1, -tierRank(b.tier), b.g]
      )
    );
  const agentOk = judgmentGroups.filter(
    (x) =>
      tierPolicy(policy, x.tier).judges.includes("agents") &&
      !x.os.some(
        (o) =>
          o.kind === "loosening" || (o.matched && o.introduced) || o.reason === "producer-changed"
      )
  );
  const limit = policy.budget;
  const taken = limit === null ? agentOk : agentOk.slice(0, limit);
  const overflow = limit === null ? [] : agentOk.slice(limit).map((x) => x.g);
  for (const t of taken) for (const o of t.os) if (o.budget === "judgment") o.assignee = "agents";

  const blocking = errors.length > 0 || outObs.some((o) => o.severity === "blocking");
  const verdict: CheckOutput["verdict"] = blocking
    ? "blocked"
    : outObs.length > 0
      ? "owed"
      : "pass";

  // phase-1 summary per group
  const summary: NonNullable<CheckOutput["summary"]> = [];
  for (const [g, os] of [...groups.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    const answerableRefs = os
      .filter((o) => {
        const ob = obs2.find((x) => x.key === o.key);
        return !!ob && (answerable(ob) || (ob.matched.length > 0 && ob.introduced));
      })
      .map((o) => o.binding.slice(0, 19));
    const judge = os
      .filter((o) => o.kind === "unestablished" && o.dischargers.some((d) => d.act === "judge"))
      .map((o) => `shape judge ${o.claim?.ids[0] ?? ""}`);
    const eligible = sortedUniq(
      os.flatMap((o) =>
        o.dischargers.flatMap((d) =>
          d.act === "answer" || d.act === "exception" || d.act === "judge" ? d.eligible : []
        )
      )
    );
    summary.push({
      group: g,
      tier: os.reduce<Tier>((t, o) => maxTier(t, o.tier), "low"),
      eligible,
      approve:
        answerableRefs.length > 0 ? `shape approve ${sortedUniq(answerableRefs).join(" ")}` : null,
      judge: sortedUniq(judge),
      members: os.map((o) => o.key).sort(cmpStr)
    });
  }

  // health (A.10.4)
  const unobservable: string[] = [];
  for (const c of head.claims) {
    if (c.op === "law") continue;
    const fp = footprint(ctx, Wh, c);
    const observedBy =
      fp.channels.some((t) => t.startsWith("hatch(")) ||
      [...provs.values()].some(
        (g: ProvG) =>
          g.absenceB &&
          fp.channels.some((t) =>
            t === "call(*)"
              ? g.channelsB.some((ch) => ch.startsWith("call("))
              : channelCovered(g.channelsB, t)
          )
      );
    if (fp.channels.length === 0 || !observedBy) unobservable.push(c.ids[0] ?? c.fp);
  }
  const unmappedCodes = sortedUniq(
    facts
      .filter((f) => f.type === "effect" && f.resource && !Wh.resOfCode.get(f.resource))
      .map((f) => f.resource as string)
  );
  const health: Record<string, JsonValue> = {
    coverage: { num: cov.coveredCount, den: cov.checked },
    unobservable: sortedUniq(unobservable),
    unanswered: unanswered.sort((a, b) => cmpStr(jcs(a), jcs(b))),
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
    unauthenticated: sortedUniq([
      ...[...provs.values()].filter((g) => !g.authenticated).map((g) => `provider ${g.q}`),
      ...unauthenticatedReviews.map((r) => `review ${r}`)
    ]),
    executesHead: [...provs.values()]
      .filter((g) => g.produces.some((k) => k === "test" || k === "proof" || k === "equivalence"))
      .map((g) => g.q)
      .sort(cmpStr),
    baseObservations:
      hasBase &&
      (input.baseRecords ?? []).length === 0 &&
      [...provs.values()].some((g) => g.base?.produces.includes("observation"))
        ? "missing"
        : "present",
    baseDefects: (base?.errors ?? []).map((e) => `${e.code} ${e.subject}`).sort(cmpStr),
    clockClamped,
    trustDebt: debt.length,
    budget: { limit, used: taken.length, overflow: overflow.length },
    self: sortedUniq([...selfCount, ...selfJudgments]),
    preexisting: preexisting.length,
    renames: renames.length,
    assumption: "dependency code and configuration data",
    cells: loose.cells.map((c) => c.id),
    records: { valid: records.length, rejected: recs.rejected.length + baseRecs.rejected.length },
    baseUnreadable
  };
  if (input.options?.teeth) health.teeth = teeth(ctx, facts) as JsonValue;

  const out: CheckOutput = {
    contract: "shape.check.output/v1",
    mode,
    inputDigest: safeDigest(input),
    verdict,
    errors: dedupErrors(errors),
    rejected: [...recs.rejected, ...baseRecs.rejected].sort(
      (a, b) => cmpStr(a.record, b.record) || cmpStr(a.code, b.code)
    ),
    obligations: outObs,
    answered: answered.sort((a, b) => cmpStr(a.obligation, b.obligation)),
    loosening: looseningRows.sort((a, b) =>
      cmpTuple([a.subject, a.question], [b.subject, b.question])
    ),
    renames: renames.sort((a, b) => cmpStr(a.base, b.base)),
    debt: debt.sort((a, b) => cmpStr(a.obligation, b.obligation)),
    preexisting: preexisting.sort((a, b) => cmpStr(a.obligation, b.obligation)),
    budget: { limit, used: taken.length, overflow: overflow.sort(cmpStr) },
    health,
    summary
  };
  return out;
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
  const seen = new Set<string>();
  const out: ShapeError[] = [];
  for (const e of errors) {
    const k = `${e.code}\u0000${e.subject}\u0000${e.message ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort(
    (a, b) =>
      cmpStr(a.code, b.code) ||
      cmpStr(a.subject, b.subject) ||
      cmpStr(a.message ?? "", b.message ?? "")
  );
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
      attributed =
        code.has(s.code) ||
        posComp(s.code.startsWith("unit:") ? s.code.slice(5) : W.att(s.code)) === K;
    else if (s && typeof s.unit === "string") attributed = posComp(s.unit) === K;
    else if (s && typeof s.from === "string") attributed = s.from === K;
    else if (s && Array.isArray(s.nodes)) attributed = (s.nodes as string[]).includes(K);
    if (!attributed) return false;
  }
  if (e.for) {
    const inSigma = (x: string): boolean =>
      e.for?.some((sub) =>
        sub.kind === "code"
          ? sub.id === x
          : sub.kind === "unit"
            ? matchUnitSel(W, sub.sel, x)
            : false
      ) ?? false;
    if (o.law) return reqIds.length > 0 && reqIds.every(inSigma);
    if (s && typeof s.code === "string") return inSigma(s.code);
    if (s && typeof s.unit === "string") return (W.codeOfPos.get(s.unit) ?? []).every(inSigma);
    if (s && typeof s.from === "string")
      return e.for.some((sub) => sub.kind === "pair" && sub.from === s.from && sub.to === s.to);
    return false;
  }
  return true;
}

function matchUnitSel(W: Ctx["Wh"], sel: string, x: string): boolean {
  const pos = W.att(x);
  if (sel === "*") return true;
  if (sel === UNGOVERNED) return pos === UNGOVERNED;
  if (sel.startsWith("component ")) return posComp(pos) === sel.slice(10);
  if (sel.startsWith("unit ")) return pos === sel.slice(5);
  return false;
}

// ---- answers -------------------------------------------------------------------------------------------------

function answerable(o: Ob): boolean {
  if (o.kind === "loosening" || o.kind === "coverage") return true;
  if (o.kind === "contradiction") return o.force === "heuristic";
  return o.kind === "unestablished" && o.reason === "producer-changed";
}

function answerItemsSatisfied(
  ctx: Ctx,
  gov: Gov,
  o: Ob,
  as: { actor: string; source: string }[]
): { ok: boolean; self: boolean; sources: string[] } {
  const items: { owner: string; noAgent: boolean; persons: boolean; final: boolean }[] = [];
  if (o.kind === "loosening") {
    const subject = String(o.subject);
    items.push({ owner: subjectOwner(ctx, subject), noAgent: true, persons: true, final: o.final });
    if (o.final) items.push({ owner: gov.shapeOwner, noAgent: true, persons: true, final: true });
  } else if (o.kind === "contradiction" && o.claim) {
    items.push({ owner: ownerStar(ctx, o.claim), noAgent: false, persons: false, final: o.final });
  } else if (o.kind === "unestablished" && o.claim) {
    items.push({ owner: ownerStar(ctx, o.claim), noAgent: true, persons: true, final: o.final });
  } else if (o.kind === "coverage") {
    if (o.vocab)
      items.push({ owner: gov.shapeOwner, noAgent: false, persons: false, final: o.final });
    else if (o.coverage) {
      items.push({ owner: o.coverage.owner, noAgent: o.final, persons: o.final, final: o.final });
      for (const fp of o.coverage.unmetClaims) {
        const c = ctx.headClaims.get(fp);
        if (!c) continue;
        const fin = o.coverage.unmetFinalOwners.includes(fp);
        items.push({ owner: ownerStar(ctx, c), noAgent: fin, persons: fin, final: fin });
      }
    }
  }
  const used = new Set<string>();
  let self = false;
  const sources: string[] = [];
  for (const it of items) {
    const hit = as.find((a) => {
      if (o.final && used.has(a.actor)) return false;
      if (it.persons && !isPerson(gov, a.actor)) return false;
      const e = isEligible(gov, a.actor, {
        tier: o.tier,
        owner: it.owner,
        noAgent: it.noAgent,
        final: it.final
      });
      if (e.ok && e.self) self = true;
      return e.ok;
    });
    if (!hit) return { ok: false, self: false, sources: [] };
    used.add(hit.actor);
    sources.push(hit.source);
  }
  return { ok: items.length > 0, self, sources };
}

function exceptionAnswerSatisfied(
  ctx: Ctx,
  gov: Gov,
  o: Ob,
  as: { actor: string; source: string }[]
): { ok: boolean; sources: string[] } {
  const sources: string[] = [];
  const excl = o.excluding.length > 0 ? o.excluding : o.claim ? [o.claim] : [];
  for (const c of excl) {
    const hit = as.find(
      (a) =>
        isEligible(gov, a.actor, {
          tier: o.tier,
          owner: ownerStar(ctx, c),
          noAgent: true,
          final: false
        }).ok
    );
    if (!hit) return { ok: false, sources: [] };
    sources.push(hit.source);
  }
  return { ok: excl.length > 0, sources };
}

// ---- severity (A.7.5) ------------------------------------------------------------------------------------------

function severityOf(ctx: Ctx, o: Ob): { severity: Severity; rule: number } {
  if (o.kind === "contradiction" && o.force === "sound" && o.tier === "final")
    return { severity: "blocking", rule: 2 };
  if (o.kind === "loosening" && (o.questions ?? []).includes("L0"))
    return { severity: "blocking", rule: 3 };
  if (o.kind === "loosening" && o.tier === "final") return { severity: "blocking", rule: 4 };
  if (o.kind === "coverage" && o.coverage && o.coverage.unmetFinalOwners.length > 0)
    return { severity: "blocking", rule: 4 };
  if (o.matched.length > 0 && (!o.introduced || o.exceptionAnswered))
    return { severity: "owed", rule: 5 };
  if (ctx.hasBase && !o.introduced) return { severity: "owed", rule: 6 };
  if (o.kind === "contradiction")
    return { severity: o.force === "sound" ? "blocking" : "owed", rule: 7 };
  if (o.kind === "loosening" && o.exploited) return { severity: "blocking", rule: 8 };
  if (o.kind === "unestablished" && o.reason === "producer-changed" && o.producerChangedReqDelta)
    return { severity: "blocking", rule: 8 };
  const blocks = tierPolicy(ctx.policy, o.tier).blocks;
  const kind = o.kind === "loosening" ? "latent-loosening" : o.kind;
  return { severity: (blocks as string[]).includes(kind) ? "blocking" : "owed", rule: 9 };
}

// ---- dischargers (A.7.1.3) -------------------------------------------------------------------------------------

function dischargers(ctx: Ctx, gov: Gov, o: Ob): Discharger[] {
  const out: Discharger[] = [];
  const ref = o.binding.slice(0, 19);
  const elig = (owner: string, noAgent: boolean): string[] =>
    eligibleNow(gov, { tier: o.tier, owner, noAgent, final: o.final });
  if (o.kind === "contradiction") {
    const exc: Discharger | null = o.final
      ? null
      : {
          act: "exception",
          by: "judges",
          agentSafe: false,
          eligible: sortedUniq(o.excluding.flatMap((c) => elig(ownerStar(ctx, c), true))),
          creates: null,
          command: `shape approve ${ref}`
        };
    const looseOwners = sortedUniq([
      o.claim ? ownerStar(ctx, o.claim) : gov.shapeOwner,
      ...(o.final ? [gov.shapeOwner] : [])
    ]);
    const editShape: Discharger = {
      act: "edit-shape",
      by: "author",
      agentSafe: true,
      eligible: [],
      creates: o.law
        ? null
        : { kind: "loosening", tier: o.tier, answers: o.final ? 2 : 1, owners: looseOwners }
    };
    if (o.force === "heuristic") {
      out.push({
        act: "answer",
        by: "judges",
        agentSafe: false,
        eligible: o.claim ? elig(ownerStar(ctx, o.claim), false) : [],
        creates: null,
        command: `shape approve ${ref}`
      });
      out.push({ act: "edit-code", by: "author", agentSafe: true, eligible: [], creates: null });
    } else if (o.law) {
      out.push({ act: "edit-code", by: "author", agentSafe: true, eligible: [], creates: null });
      out.push({ act: "rerun", by: "ci", agentSafe: true, eligible: [], creates: null });
    } else
      out.push({ act: "edit-code", by: "author", agentSafe: true, eligible: [], creates: null });
    if (exc) out.push(exc);
    out.push(editShape);
  } else if (o.kind === "unestablished" && o.law) {
    const l = o.law;
    const provRerun = [...ctx.provs.values()].some(
      (g) =>
        g.head &&
        g.decidesA.some((d) => {
          const st = l.claim.args.statement as { schema?: string; ref?: string };
          return (
            (st.schema && d === `template ${st.schema}`) ||
            (st.ref && d === `statements ${st.ref.split(":")[0]}`)
          );
        }) &&
        g.produces.some((k) => k === "observation" || k === "test" || (k === "proof" && !g.persist))
    );
    const judge: Discharger | null = l.req.judged
      ? {
          act: "judge",
          by: "judges",
          agentSafe: tierPolicy(ctx.policy, o.tier).judges.includes("agents"),
          eligible: elig(ownerStar(ctx, l.claim), false),
          creates: null,
          command: `shape judge ${l.claim.ids[0] ?? ""}`
        }
      : null;
    const exc: Discharger | null = o.final
      ? null
      : {
          act: "exception",
          by: "judges",
          agentSafe: false,
          eligible: elig(ownerStar(ctx, l.claim), true),
          creates: null
        };
    const lower: Discharger = {
      act: "lower-requirement",
      by: "author",
      agentSafe: true,
      eligible: [],
      creates: {
        kind: "loosening",
        tier: o.tier,
        answers: o.final ? 2 : 1,
        owners: [ownerStar(ctx, l.claim)]
      }
    };
    switch (o.reason) {
      case "producer-changed":
        out.push({
          act: "answer",
          by: "judges",
          agentSafe: false,
          eligible: elig(ownerStar(ctx, l.claim), true),
          creates: null,
          command: `shape approve ${ref}`
        });
        if (provRerun)
          out.push({ act: "rerun", by: "ci", agentSafe: true, eligible: [], creates: null });
        break;
      case "assumption":
        out.push({ act: "edit-code", by: "author", agentSafe: true, eligible: [], creates: null });
        out.push({
          act: "declare",
          by: "author",
          agentSafe: false,
          eligible: [],
          creates: {
            kind: "loosening",
            tier: o.tier,
            answers: 1,
            owners: [ownerStar(ctx, l.claim)]
          }
        });
        break;
      case "expired":
        if (judge) out.push(judge);
        break;
      default:
        if (provRerun)
          out.push({ act: "rerun", by: "ci", agentSafe: true, eligible: [], creates: null });
        else if (!l.req.judged)
          out.push({ act: "provide", by: "author", agentSafe: true, eligible: [], creates: null });
        if (judge) out.push(judge);
    }
    if (exc) out.push(exc);
    out.push(lower);
  } else if (o.kind === "loosening") {
    const subject = String(o.subject);
    const ownerQ = subjectOwner(ctx, subject);
    out.push({ act: "revert", by: "author", agentSafe: true, eligible: [], creates: null });
    if (
      (o.parts ?? []).some(
        (p) => p.answer === "undecided" && p.question !== "L4" && p.question !== "L7"
      )
    )
      out.push({ act: "add-was", by: "author", agentSafe: true, eligible: [], creates: null });
    if ((o.parts ?? []).some((p) => p.question === "L4" && p.answer === "undecided"))
      out.push({ act: "provide", by: "ci", agentSafe: true, eligible: [], creates: null });
    const eligible = sortedUniq([
      ...elig(ownerQ, true),
      ...(o.final ? elig(gov.shapeOwner, true) : [])
    ]).filter((a) => isPerson(gov, a));
    out.push({
      act: "answer",
      by: "judges",
      agentSafe: false,
      eligible,
      creates: null,
      command: `shape approve ${ref}`
    });
  } else if (o.kind === "coverage") {
    const owners = o.coverage
      ? [
          o.coverage.owner,
          ...o.coverage.unmetClaims.map((f) =>
            ctx.headClaims.get(f) ? ownerStar(ctx, ctx.headClaims.get(f) as Claim) : gov.shapeOwner
          )
        ]
      : [gov.shapeOwner];
    const eligible = sortedUniq(owners.flatMap((w) => elig(w, o.final))).filter(
      (a) => !o.final || isPerson(gov, a)
    );
    out.push({
      act: "answer",
      by: "judges",
      agentSafe: false,
      eligible,
      creates: null,
      command: `shape approve ${ref}`
    });
    out.push({ act: "bind", by: "author", agentSafe: true, eligible: [], creates: null });
    out.push({ act: "provide", by: "author", agentSafe: true, eligible: [], creates: null });
  }
  if (out.length > 0 && out.every((d) => d.eligible.length === 0 && d.by === "judges"))
    for (const d of out) d.snippet = "no eligible answerer";
  void eligibleByRole;
  return out;
}

// ---- teeth (minimal, A.10.5) ---------------------------------------------------------------------------------------

function teeth(ctx: Ctx, facts: WFact[]): Record<string, JsonValue> {
  const W = ctx.Wh;
  const unusedGrants: string[] = [];
  for (const c of W.esf.components) {
    if (!c.grants) continue;
    const code = new Set(compCode(W, c.q));
    for (const g of c.grants) {
      const used = facts.some((f) => {
        const at = f.declared ? f.at : f.at;
        if (!at || !code.has(at)) return false;
        const r = f.resource ? (W.resOfCode.get(f.resource) ?? f.resource) : null;
        const atom = f.atom ?? (f.verb && r ? `${f.verb}<${r}>` : null);
        return atom === g;
      });
      if (!used) unusedGrants.push(`${c.q} ${g}`);
    }
  }
  const vacuous = ctx.head.claims
    .filter(
      (c) =>
        (c.op === "effect.forbid" || c.op === "authority") && footprint(ctx, W, c).code.length === 0
    )
    .map((c) => c.ids[0] ?? c.fp);
  const gaps = W.esf.resources
    .filter(
      (r) =>
        !r.q.startsWith("std::") && !W.forbids.some((f) => String(f.args.atom).endsWith(`<${r.q}>`))
    )
    .map((r) => r.q);
  return {
    unusedGrants: unusedGrants.sort(cmpStr),
    vacuous: vacuous.sort(cmpStr),
    gaps: gaps.sort(cmpStr),
    redundant: []
  };
}

export { tierStar };
