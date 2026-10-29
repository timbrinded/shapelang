// @ts-nocheck
// DRT7 per-feature detectors: which version 7 decisions a gate case exercises. Each detector is a
// predicate over the input after the pre-pass (proto/src/prepass.ts) and, where the decision is
// only visible in what was derived, over the prototype's output. A case "has" D<n> when the
// predicate holds; the coverage report counts cases per decision. The predicates:
//   D1  a hatch rule expands to the Undeclared clause (effect.forbid of Undeclared<std::Trust>, the
//       version 7 expansion of `forbid hatch *`) in base or head, and the head manifest lists a
//       hatch marker;
//   D2  the head has a complete summary (effects.upper) and either a unit's summary claims differ
//       between base and head (L1 decides them), an observed call leaves a summarised unit's bound
//       identity, or a summary states `a via v`;
//   D4  a head law has a valid record (test, proof, judgment) whose cone beyond its cited code (its
//       deps, and the manifest refs of cited identities, closed) meets the code delta or the deleted
//       identities, or a valid base-revision record contradicts a head law (the counterexample
//       clause of A.7.3.3);
//   D5  change or preview mode with a base, and the prototype raises a structure contradiction
//       (subject {from, to} or {nodes}), whose introducedness the lifted-edge rule decides;
//   D6  a new head identity is relocated from a deleted one (unique kind and own digest), or a head
//       identity with hatch markers is a finest change;
//   D7  the prototype raises a refutation (a contradiction of an effects.lower or edge.exists
//       claim), whose introducedness the footprint and base-report rule decides;
//   D9  a provider with a valid record has an implementation that differs between base and head or
//       whose implementation identity is in the code delta, or a valid test or proof cites a
//       harness digest the head manifest does not list;
//   D11 the prototype raises an obligation at tier final, or a final claim meets two distinct
//       approvers;
//   D12 authors* is non-empty and a base actor acts (a review line or a valid judgment record), or
//       persisted.base holds a judgment, or the head policy's judges differ from the base's;
//   D14 the prototype lists a vacuous law (health.vacuousLaws, empty Req);
//   D15 an observation record (records or baseRecords) reports an effect fact without n.
import { H } from "../../proto/src/jcs.ts";

export const DECISIONS = ["D1", "D2", "D4", "D5", "D6", "D7", "D9", "D11", "D12", "D14", "D15"];

function codeDelta(pp) {
  const v = pp.verified;
  const Mh = v.head.manifest;
  const Mb = pp.hasBase ? v.base.manifest : null;
  const delta = new Set();
  const deleted = new Set();
  const finest = new Set();
  const added = [];
  if (!Mb) return { delta, deleted, finest, relocated: new Map() };
  for (const [id, info] of Mh.ids) {
    const b = Mb.ids.get(id);
    if (!b) {
      delta.add(id);
      added.push(id);
      continue;
    }
    for (const [proj, d] of info.digests) {
      const bd = b.digests.get(proj);
      if (bd !== undefined && bd !== d) delta.add(id);
    }
    const ob = b.digests.get("own");
    const oh = info.digests.get("own");
    if (ob !== undefined && oh !== undefined && ob !== oh) finest.add(id);
  }
  for (const id of Mb.ids.keys()) if (!Mh.ids.has(id)) deleted.add(id);
  const key = (i) => `${i.kind}\u0000${i.digests.get("own") ?? ""}`;
  const newBy = new Map();
  for (const x of added) {
    const i = Mh.ids.get(x);
    if (i.digests.get("own") === undefined) continue;
    newBy.set(key(i), [...(newBy.get(key(i)) ?? []), x]);
  }
  const delBy = new Map();
  for (const y of deleted) {
    const i = Mb.ids.get(y);
    if (i.digests.get("own") === undefined) continue;
    delBy.set(key(i), [...(delBy.get(key(i)) ?? []), y]);
  }
  const relocated = new Map();
  for (const [k, xs] of newBy) {
    const ys = delBy.get(k) ?? [];
    if (xs.length === 1 && ys.length === 1 && Mh.ids.get(xs[0]).lang === Mb.ids.get(ys[0]).lang)
      relocated.set(xs[0], ys[0]);
  }
  for (const x of added) if (!relocated.has(x)) finest.add(x);
  return { delta, deleted, finest, relocated };
}

const idOfBind = (b) => {
  const m = /^\s*(\w+)\("([^"]+)"\)\s*$/.exec(b ?? "");
  return m ? `${m[1]}:${m[2]}` : null;
};

/** The decisions (and some sub-features) a case exercises. */
export function features(input, pp, out) {
  const f = new Set();
  if (!pp?.ok) return [];
  const Mh = pp.verified.head.manifest;
  const valid = pp.records.filter((r) => r.parsed && !r.rejection);
  const validBase = pp.baseRecords.filter((r) => r.parsed && !r.rejection);
  const { delta, deleted, finest, relocated } = codeDelta(pp);
  const headClaims = pp.head.claims;
  const baseClaims = pp.base?.claims ?? [];
  const opOf = new Map([...baseClaims, ...headClaims].map((c) => [c.fp, c.op]));
  const obs = out?.obligations ?? [];
  // D1
  const undeclaredClause = [...headClaims, ...baseClaims].some(
    (c) => c.op === "effect.forbid" && c.args?.atom === "Undeclared<std::Trust>"
  );
  const markers = [...Mh.ids.values()].some((i) =>
    Object.values(i.markers ?? {}).some((n) => n > 0)
  );
  if (undeclaredClause && markers) f.add("D1");
  // D2
  const upper = headClaims.filter((c) => c.op === "effects.upper");
  if (upper.length > 0) {
    const sumOf = (cs) => {
      const m = new Map();
      for (const c of cs)
        if (c.op === "effects.upper" || c.op === "effects.lower")
          m.set(c.args.unit, [...(m.get(c.args.unit) ?? []), c.fp].sort().join(","));
      return m;
    };
    const hs = sumOf(headClaims);
    const bs = sumOf(baseClaims);
    let edited = false;
    for (const [u, fps] of bs) if (hs.has(u) && hs.get(u) !== fps) edited = true;
    const summarised = new Set();
    for (const u of pp.head.units)
      if (u.summary?.mode === "complete" && u.bind) summarised.add(idOfBind(u.bind));
    const callOut = valid.some((r) =>
      (r.parsed.shape.facts ?? []).some((x) => x.type === "call" && summarised.has(x.at))
    );
    const via = pp.head.units.some((u) => (u.summary?.atoms ?? []).some((a) => a.via));
    if (edited || callOut || via) f.add("D2");
  }
  // D4
  const lawFps = new Set(headClaims.filter((c) => c.op === "law").map((c) => c.fp));
  const meets = (id) => delta.has(id) || deleted.has(id);
  for (const r of valid) {
    const s = r.parsed.shape;
    if (!s.claim || !lawFps.has(s.claim.fp) || !["test", "proof", "judgment"].includes(s.kind))
      continue;
    const cited = new Set((s.code ?? []).map((c) => c.id));
    const cone = new Set((s.deps ?? []).map((c) => c.id));
    const stack = [...cited, ...cone];
    const seen = new Set(stack);
    while (stack.length) {
      const x = stack.pop();
      for (const y of Mh.ids.get(x)?.refs ?? [])
        if (!seen.has(y)) {
          seen.add(y);
          cone.add(y);
          stack.push(y);
        }
    }
    if ([...cone].some((x) => !cited.has(x) && meets(x))) f.add("D4");
  }
  if (
    validBase.some(
      (r) =>
        r.parsed.shape.result === "contradicts" &&
        r.parsed.shape.claim &&
        lawFps.has(r.parsed.shape.claim.fp)
    )
  )
    f.add("D4");
  // D5
  if (
    pp.hasBase &&
    obs.some(
      (o) =>
        o.kind === "contradiction" &&
        o.subject &&
        typeof o.subject === "object" &&
        ("nodes" in o.subject || ("from" in o.subject && "to" in o.subject))
    )
  )
    f.add("D5");
  // D6
  if (
    pp.hasBase &&
    (relocated.size > 0 ||
      [...Mh.ids.values()].some(
        (i) => finest.has(i.id) && Object.values(i.markers ?? {}).some((n) => n > 0)
      ))
  )
    f.add("D6");
  if (relocated.size > 0) f.add("relocated");
  // D7
  if (
    obs.some(
      (o) =>
        o.kind === "contradiction" &&
        o.claim &&
        ["effects.lower", "edge.exists"].includes(opOf.get(o.claim.fp))
    )
  )
    f.add("D7");
  // D9
  if (pp.hasBase && pp.base) {
    const implOf = (e, q) => e.providers.find((p) => p.q === q)?.implementation ?? null;
    const provsWithRecords = new Set(valid.map((r) => r.parsed.shape.provider?.id).filter(Boolean));
    for (const q of provsWithRecords) {
      const bi = implOf(pp.base, q);
      const hi = implOf(pp.head, q);
      const ids = [...(bi?.ids ?? []), ...(hi?.ids ?? [])].map(idOfBind).filter(Boolean);
      const paths = [...(bi?.paths ?? []), ...(hi?.paths ?? [])];
      const pathIds = [...Mh.ids.values()]
        .filter((i) => !i.symbol && paths.includes(i.path))
        .map((i) => i.id);
      if (H(bi) !== H(hi) || [...ids, ...pathIds].some((x) => delta.has(x))) f.add("D9");
    }
    for (const r of valid) {
      const s = r.parsed.shape;
      if (!["test", "proof"].includes(s.kind)) continue;
      if (
        (s.harness ?? []).some((c) => {
          const d = Mh.ids.get(c.id)?.digests.get(c.projection);
          return d !== undefined && d !== c.digest;
        })
      )
        f.add("D9");
    }
  }
  // D11
  const approvers = new Set();
  for (const rv of pp.reviews)
    if (rv.actor && /^shape\s+approve\s/.test(rv.line)) approvers.add(rv.actor);
  for (const r of valid)
    if (
      r.parsed.shape.kind === "judgment" &&
      r.parsed.shape.result === "approves" &&
      r.parsed.shape.judge
    )
      approvers.add(r.parsed.shape.judge);
  const finalClaim = [...headClaims, ...baseClaims].some((c) => c.tier === "final");
  if (obs.some((o) => o.tier === "final") || (finalClaim && approvers.size >= 2)) f.add("D11");
  // D12
  const actsByActor =
    pp.reviews.some((rv) => rv.actor) || valid.some((r) => r.parsed.shape.kind === "judgment");
  const judgesOf = (e) =>
    JSON.stringify(Object.values(e?.policy?.tiers ?? {}).map((t) => t.judges));
  if (
    (pp.gv.authors.size > 0 && actsByActor) ||
    (input.persisted?.base ?? []).length > 0 ||
    (pp.base && judgesOf(pp.base) !== judgesOf(pp.head))
  )
    f.add("D12");
  // D14
  if ((out?.health?.vacuousLaws ?? []).length > 0) f.add("D14");
  // D15
  const factNoN = (r) =>
    (r.parsed?.shape?.facts ?? []).some((x) => x.type === "effect" && x.n === undefined);
  if (
    [...pp.records, ...pp.baseRecords].some(
      (r) => r.parsed && r.parsed.shape.kind === "observation" && factNoN(r)
    )
  )
    f.add("D15");
  return [...f].sort();
}
