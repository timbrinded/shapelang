// Differential check of the closed-form teeth against `derive` (A.11.2: teeth are executable and
// differentially tested). Each sampled mutant is realised as a real input and run through the
// checker in audit mode:
//   W1  an observation (synthetic presence-sound provider) reporting the atom's verb on a synthetic
//       binding of its resource at an identity attributed to the position;
//   W2  a declared relation (a W_decl edge);
//   P1  the grant added to the component plus the W1 fact at one of its K.* identities.
// A mutant is killed by derive iff the run adds a contradiction obligation or a coherence error
// absent from the baseline. Agreement = closed form and derive give the same killed/survived.
import { derive } from "../../src/derive.ts";
import type { CheckInput } from "../../src/io-types.ts";
import type { Statement } from "../../src/manifest.ts";
import type { ESF } from "../../src/model.ts";
import { type ShapeRecord, makeStatement, scopeRoot } from "../../src/records.ts";
import type { Decl, SourceDoc } from "../../src/source.ts";
import { cmpStr } from "../../src/util.ts";
import { type World, impl, protectingForbids } from "../../src/world.ts";
import { w1Killers, worldFacts } from "./mutants.ts";

const PROVIDER = "teeth::probe";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function splitQ(q: string): { module: string; name: string } {
  const i = q.lastIndexOf("::");
  return { module: q.slice(0, i), name: q.slice(i + 2) };
}

function findDecl(src: SourceDoc, kind: Decl["decl"], q: string): Decl | null {
  const { module, name } = splitQ(q);
  const m = src.modules.find((x) => x.module === module);
  return (
    (m?.decls.find((d) => d.decl === kind && "name" in d && d.name === name) as Decl | undefined) ??
    null
  );
}

const probeCode = (r: string): string =>
  `ts.call(${JSON.stringify(`teeth.${r.replace(/::/g, ".")}`)})`;

/** The baseline source: every non-std resource gains a synthetic ts.call binding, and a
 *  presence-sound observer of them is declared, so W1 facts lift to atoms. */
export function probeSource(src: SourceDoc, esf: ESF): SourceDoc {
  const s = clone(src);
  for (const r of esf.resources) {
    if (r.q.startsWith("std::")) continue;
    const d = findDecl(s, "resource", r.q);
    if (d && d.decl === "resource") d.bind = [...(d.bind ?? []), probeCode(r.q)];
  }
  const mod = s.modules[0];
  if (mod) {
    mod.decls.push({
      decl: "provider",
      name: "probe",
      produces: ["observation"],
      observes: ['effect(ts.call("*"))'],
      sound: ["presence"],
      implementation: { paths: ["teeth-probe"] }
    });
    // keep the provider's Q stable: teeth::probe is resolved below by module name
  }
  return s;
}

function observation(
  revision: string,
  man: Statement,
  at: string,
  verb: string,
  resource: string
): unknown {
  const pred = man.predicate.shape as {
    entries: { id: string; projection: string; scheme: string; digest: string }[];
  };
  const e =
    pred.entries.find((x) => x.id === at && (x.projection === "unit" || x.projection === "file")) ??
    pred.entries.find((x) => x.id === at);
  const entries = e
    ? [
        {
          id: e.id,
          projection: e.projection,
          scheme: e.scheme,
          digest: e.digest,
          complete: false,
          deps: []
        }
      ]
    : [];
  const rec: ShapeRecord = {
    v: "shape.evidence.v1",
    kind: "observation",
    result: "observes",
    provider: { id: PROVIDER, version: "0" },
    revision,
    time: "2026-01-01T00:00:00Z",
    scope: { root: scopeRoot(entries), entries },
    // version 7 (RJ14 [D15]): a presence-sound observer reports n on every effect fact
    facts: [{ type: "effect", at, verb, resource: probeCode(resource), n: 1 }],
    harness: [],
    assumptions: []
  };
  return makeStatement(rec);
}

export interface ValidateResult {
  sampled: number;
  agree: number;
  disagreements: { op: string; mutant: string; closedForm: boolean; derive: boolean }[];
  byOp: Record<string, { sampled: number; agree: number }>;
  ms: number;
}

function keysOf(out: ReturnType<typeof derive>): Set<string> {
  const s = new Set<string>();
  for (const e of out.errors)
    if (e.code === "E-conduct" || e.code === "E-structure")
      s.add(`${e.code} ${e.subject} ${e.message ?? ""}`);
  for (const o of out.obligations) if (o.kind === "contradiction") s.add(o.key);
  return s;
}

/** Evenly spaced sample (deterministic). */
function sample<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)] as T);
}

export function validateTeeth(o: {
  source: SourceDoc;
  esf: ESF;
  world: World;
  manifest: Statement;
  revision: string;
  now: string;
  perOp: number;
}): ValidateResult {
  const t0 = Date.now();
  const W = o.world;
  const base = probeSource(o.source, o.esf);
  // the probe provider lives in the first module
  const probeQ = `${base.modules[0]?.module ?? "teeth"}::probe`;
  const fix = (rec: unknown): unknown =>
    JSON.parse(JSON.stringify(rec).replaceAll(PROVIDER, probeQ));
  const input = (src: SourceDoc, records: unknown[]): CheckInput => ({
    contract: "shape.check.input/v1",
    mode: "audit",
    now: o.now,
    head: { revision: o.revision, source: src, manifest: o.manifest },
    base: null,
    change: { ids: ["teeth"] },
    authors: [],
    reviews: [],
    records,
    baseRecords: [],
    persisted: { base: [], head: [] },
    options: { health: false, teeth: false }
  });
  const baseline = keysOf(derive(input(base, [])));
  const res: ValidateResult = { sampled: 0, agree: 0, disagreements: [], byOp: {}, ms: 0 };
  const record = (
    op: string,
    mutant: string,
    closed: boolean,
    out: ReturnType<typeof derive>
  ): void => {
    const now = keysOf(out);
    const killed = [...now].some((k) => !baseline.has(k));
    res.sampled += 1;
    const b = res.byOp[op] ?? { sampled: 0, agree: 0 };
    b.sampled += 1;
    if (killed === closed) {
      res.agree += 1;
      b.agree += 1;
    } else res.disagreements.push({ op, mutant, closedForm: closed, derive: killed });
    res.byOp[op] = b;
  };
  const resources = o.esf.resources.filter((r) => !r.q.startsWith("std::")).map((r) => r.q);
  const verbs = o.esf.effects
    .map((e) => e.verb)
    .filter((v) => v !== "Hatch" && !impl(W, v, "Hatch"));
  // W1: positions with at least one identity
  const w1: { pos: string; at: string; verb: string; res: string }[] = [];
  for (const pos of W.positions) {
    const at = (W.codeOfPos.get(pos) ?? []).find(
      (x) =>
        W.man.ids.get(x)?.lang === "ts" ||
        W.man.ids.get(x)?.lang === "rust" ||
        W.man.ids.get(x)?.lang === "verus"
    );
    if (!at) continue;
    for (const r of resources) for (const v of verbs) w1.push({ pos, at, verb: v, res: r });
  }
  const { reachOf } = worldFacts({ esf: o.esf, world: W });
  const uppers = o.esf.claims.filter((c) => c.op === "effects.upper");
  for (const m of sample(w1, o.perOp)) {
    const atom = `${m.verb}<${m.res}>`;
    const closed = w1Killers(W, uppers, reachOf, m.pos, atom).length > 0;
    record(
      "W1",
      `${m.pos} ${atom}`,
      closed,
      derive(input(base, [fix(observation(o.revision, o.manifest, m.at, m.verb, m.res))]))
    );
  }
  // W2: declared relations between components (closed form from the teeth module's rules)
  const comps = W.nodes.filter((n) => W.compByQ.has(n)).sort(cmpStr);
  const w2: { a: string; b: string; kind: string }[] = [];
  for (const k of o.esf.kinds.filter((x) => x.to === "component"))
    for (const a of comps) for (const b of comps) if (a !== b) w2.push({ a, b, kind: k.name });
  for (const m of sample(w2, o.perOp)) {
    const src = clone(base);
    const mod = src.modules.find((x) => x.module === splitQ(m.a).module) ?? src.modules[0];
    if (!mod) continue;
    mod.decls.push({
      decl: "relation",
      name: `TeethProbe_${res.sampled}`,
      kind: m.kind,
      connects: [m.a, m.b]
    });
    record(
      "W2",
      `${m.a} -${m.kind}-> ${m.b}`,
      closedW2(o.esf, W, m.a, m.kind, m.b),
      derive(input(src, []))
    );
  }
  // P1: grant + fact at K.*
  const p1: { comp: string; at: string; verb: string; res: string }[] = [];
  const p1Verbs = o.esf.effects.map((e) => e.verb).filter((v) => impl(W, v, "HardDelete"));
  for (const c of [...W.compByQ.values()].filter(
    (x) => !x.q.startsWith("std::") && x.grants !== null
  )) {
    const at = (W.codeOfPos.get(`${c.q}.*`) ?? []).find((x) =>
      ["ts", "rust", "verus"].includes(W.man.ids.get(x)?.lang ?? "")
    );
    if (!at) continue;
    for (const r of resources) for (const v of p1Verbs) p1.push({ comp: c.q, at, verb: v, res: r });
  }
  for (const m of sample(p1, o.perOp)) {
    const src = clone(base);
    const d = findDecl(src, "component", m.comp);
    if (!d || d.decl !== "component") continue;
    const atom = `${m.verb}<${m.res}>`;
    d.grants = [...(Array.isArray(d.grants) ? d.grants : []), atom];
    const closed = protectingForbids(W, `${m.comp}.*`, atom).length > 0;
    record(
      "P1",
      `${m.comp} +${atom}`,
      closed,
      derive(input(src, [fix(observation(o.revision, o.manifest, m.at, m.verb, m.res))]))
    );
  }
  res.ms = Date.now() - t0;
  return res;
}

/** Closed-form W2 for one edge, from the elaborated structure claims over W_decl edges. */
export function closedW2(esf: ESF, W: World, a: string, kind: string, b: string): boolean {
  const edges = new Map<string, Set<string>>();
  const add = (k: string, x: string, y: string): void => {
    const key = `${k}\u0000${x}`;
    const s = edges.get(key) ?? new Set<string>();
    s.add(y);
    edges.set(key, s);
  };
  for (const c of esf.claims)
    if (c.op === "edge.exists") add(String(c.args.kind), String(c.args.from), String(c.args.to));
  const nodes = (sels: string[]): Set<string> => {
    const out = new Set<string>();
    for (const s of sels) {
      if (s === "*") for (const n of W.nodes) out.add(n);
      else if (s.startsWith("component ")) out.add(s.slice(10));
      else if (s.startsWith("resource ")) out.add(s.slice(9));
    }
    return out;
  };
  const reach = (ks: string[], from: string, allow: (n: string) => boolean): Set<string> => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const x = stack.pop() as string;
      for (const k of ks)
        for (const y of edges.get(`${k}\u0000${x}`) ?? []) {
          if (seen.has(y)) continue;
          seen.add(y);
          if (allow(y)) stack.push(y);
        }
    }
    return seen;
  };
  for (const c of esf.claims) {
    if (c.op === "edge.forbid" && String(c.args.kind) === kind) {
      const S = nodes(c.args.from as string[]);
      const X = nodes(c.args.exceptFrom as string[]);
      const T = nodes(c.args.to as string[]);
      const Y = nodes(c.args.exceptTo as string[]);
      if (S.has(a) && !X.has(a) && T.has(b) && !Y.has(b)) return true;
    } else if (c.op === "cycle.forbid" && (c.args.kinds as string[]).includes(kind)) {
      if (reach(c.args.kinds as string[], b, () => true).has(a)) return true;
    } else if (c.op === "path.forbid" && (c.args.kinds as string[]).includes(kind)) {
      const ks = c.args.kinds as string[];
      const V = nodes(c.args.exceptVia as string[]);
      const S = [...nodes(c.args.from as string[])].filter((s) => !V.has(s));
      const T = nodes(c.args.to as string[]);
      const aOk = S.some((s) => s === a || (!V.has(a) && reach(ks, s, (n) => !V.has(n)).has(a)));
      const bOk =
        T.has(b) || (!V.has(b) && [...T].some((t) => reach(ks, b, (n) => !V.has(n)).has(t)));
      if (aOk && bOk) return true;
    }
  }
  return false;
}
