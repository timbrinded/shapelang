// Laws on shape.checker::ShapeRuleEngine units: memories FinalForbidPrecedence,
// ForbiddenPathWitness, HypercycleWitness and FreshnessDeterminism.
import {
  checkShapeModules,
  parseShapeModule,
  requireIsoCalendarDate,
  type CheckOptions,
  type CheckResult
} from "../../../../packages/shp-checker/src/index.ts";
import { type Rng, lawTest, rng as lawkitRng, property, stable } from "./lawkit.ts";

function check(decls: string[], options: CheckOptions = {}): CheckResult {
  const src = ["module law", ...decls].join("\n\n");
  const parsed = parseShapeModule(src, "law.shape");
  if (!parsed.ok)
    throw new Error(
      `does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}\n${src}`
    );
  return checkShapeModules([parsed.module], options);
}

const strip = (q: string): string => q.replace(/^law::/, "");

// ---- final forbids -------------------------------------------------------------------------

const EFFECTS = ["HardDelete", "Truncate", "DropStorage", "Append", "Read", "Update"] as const;

interface FinalModel {
  traits: { name: string; forbids: string[] }[];
  resources: { name: string; traits: string[] }[];
  components: { name: string; grants: string[]; fns: { name: string; effects: string[] }[] }[];
}

function genFinal(r: Rng): FinalModel {
  const traits = Array.from({ length: r.int(1, 2) }, (_, i) => ({
    name: `Guard${i}`,
    forbids: r.subset(EFFECTS, 1)
  }));
  const resources = Array.from({ length: r.int(1, 3) }, (_, i) => ({
    name: `Res${i}`,
    traits: r.subset(traits.map((t) => t.name))
  }));
  const atoms = resources.flatMap((x) => EFFECTS.map((e) => `${e}<${x.name}>`));
  const components = Array.from({ length: r.int(1, 3) }, (_, i) => ({
    name: `Comp${i}`,
    grants: r.subset(atoms).slice(0, 6),
    fns: Array.from({ length: r.int(1, 2) }, (_, j) => ({
      name: `fn${i}x${j}`,
      effects: r.subset(atoms, 1).slice(0, 3)
    }))
  }));
  return { traits, resources, components };
}

function finalDecls(m: FinalModel, r: Rng | null): string[] {
  const order = <T>(xs: T[]): T[] => (r ? r.shuffle(xs) : xs);
  return order([
    ...m.traits.map((t) =>
      [
        `trait ${t.name}<T: Resource> {`,
        ...order(t.forbids).map((e) => `  forbid final ${e}<T>`),
        "}"
      ].join("\n")
    ),
    ...m.resources.map((x) =>
      x.traits.length > 0
        ? `resource ${x.name} : ${order(x.traits).join(", ")}`
        : `resource ${x.name}`
    ),
    ...m.components.map((c) =>
      [
        `component ${c.name} {`,
        ...order(c.grants).map((g) => `  grants ${g}`),
        ...c.fns.flatMap((f) => [
          `  fn ${f.name}`,
          "    effects complete {",
          ...order(f.effects).map((e) => `      ${e}`),
          "    }"
        ]),
        "}"
      ].join("\n")
    )
  ]);
}

/** Oracle: (component, fn, effect, target) for every declared effect a final forbid on its target names. */
function expectedFinal(m: FinalModel): string[] {
  const out: string[] = [];
  for (const c of m.components)
    for (const f of c.fns)
      for (const a of f.effects) {
        const [, e, res] = /^(\w+)<(\w+)>$/.exec(a) ?? [];
        const traits = m.resources.find((x) => x.name === res)?.traits ?? [];
        if (traits.some((t) => m.traits.find((x) => x.name === t)?.forbids.includes(e ?? "")))
          out.push(`${c.name}.${f.name} ${e}<${res}>`);
      }
  return [...new Set(out)].sort();
}

function actualFinal(res: CheckResult): string[] {
  return [
    ...new Set(
      res.diagnostics.flatMap((d) =>
        d.kind === "final_forbidden_effect"
          ? [`${strip(d.component)}.${d.functionName} ${d.effect}<${strip(d.target)}>`]
          : []
      )
    )
  ].sort();
}

// "final forbids remain stronger than component grants"
lawTest("shape.checker::FinalForbidBeatsGrant", "holds", () =>
  property(
    "shape.checker::FinalForbidBeatsGrant",
    { cases: 200, seed: 0xf1a101 },
    (r) => {
      const m = genFinal(r);
      // grant every forbidden atom in half the cases, so grants and final forbids collide
      if (r.bool())
        for (const c of m.components)
          c.grants = [...new Set([...c.grants, ...c.fns.flatMap((f) => f.effects)])];
      return m;
    },
    (m) => {
      const want = expectedFinal(m);
      const got = actualFinal(check(finalDecls(m, null)));
      return stable(want) === stable(got)
        ? null
        : `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)} for:\n${finalDecls(m, null).join("\n")}`;
    }
  )
);

// "concrete targets resolve deterministically": any declaration, attachment or member order gives
// the same resolved (component, fn, effect, target) set. Which trait a diagnostic names is not
// target resolution and does follow the resource's attachment order (`R : A, B` names A,
// `R : B, A` names B): recorded as a finding, not as this law.
lawTest("shape.checker::FinalForbidTargetsDeterministic", "holds", () =>
  property(
    "shape.checker::FinalForbidTargetsDeterministic",
    { cases: 150, seed: 0xf1a102 },
    (r) => ({ m: genFinal(r), seed: r.int(1, 1 << 30) }),
    ({ m, seed }) => {
      const finals = (res: CheckResult) => stable(actualFinal(res));
      const base = finals(check(finalDecls(m, null)));
      const rr = lawkitRng(seed);
      for (let k = 0; k < 4; k += 1) {
        const other = finals(check(finalDecls(m, rr)));
        if (other !== base)
          return `permutation ${k} changed final-forbid diagnostics:\n${base}\n${other}`;
      }
      return null;
    }
  )
);

// "final forbids cannot be waived by rationale or memory"
lawTest("shape.checker::FinalForbidNotWaivedByContext", "holds", () =>
  property(
    "shape.checker::FinalForbidNotWaivedByContext",
    { cases: 150, seed: 0xf1a103 },
    (r) => {
      const m = genFinal(r);
      for (const c of m.components)
        c.grants = [...new Set([...c.grants, ...c.fns.flatMap((f) => f.effects)])];
      const context: string[] = [];
      let i = 0;
      for (const c of m.components)
        for (const f of c.fns) {
          if (r.bool(0.7)) {
            const mem = `Mem${i}`;
            context.push(
              [
                `memory ${mem} : RefactorConstraint<fn ${c.name}.${f.name}> {`,
                `  applies_to fn ${c.name}.${f.name}`,
                "  status Explained",
                "  confidence High",
                '  summary "Deleting here is intended."',
                "  who {",
                "    owner Team",
                "  }",
                "}"
              ].join("\n")
            );
            if (r.bool())
              context.push(
                [
                  `reevaluation Re${i} {`,
                  `  satisfies memory ${mem}`,
                  "  outcome Confirmed",
                  '  summary "Reviewed."',
                  '  evidence test("law.test.ts")',
                  "  reviewer Team",
                  '  decided_on "2026-06-02"',
                  "}"
                ].join("\n")
              );
          }
          if (r.bool(0.5))
            context.push(
              [
                `rationale Why${i} : InlineRationale<fn ${c.name}.${f.name}> {`,
                `  applies_to fn ${c.name}.${f.name}`,
                "  why Intended",
                "}"
              ].join("\n")
            );
          i += 1;
        }
      return { m, context };
    },
    ({ m, context }) => {
      const bare = actualFinal(check(finalDecls(m, null)));
      const withContext = actualFinal(check([...finalDecls(m, null), ...context]));
      return stable(bare) === stable(withContext)
        ? null
        : `context changed final-forbid diagnostics: ${JSON.stringify(bare)} -> ${JSON.stringify(withContext)}`;
    }
  )
);

// ---- relation graphs -----------------------------------------------------------------------

interface Graph {
  nodes: string[];
  edges: { name: string; kind: string; from: string; to: string }[];
}

function genGraph(r: Rng, kinds: readonly string[], maxNodes = 7): Graph {
  const nodes = Array.from({ length: r.int(3, maxNodes) }, (_, i) => `N${i}`);
  const edges: Graph["edges"] = [];
  const density = 0.15 + r.next() * 0.3;
  for (const a of nodes)
    for (const b of nodes) {
      if (a === b || !r.bool(density)) continue;
      const kind = r.pick(kinds);
      edges.push({ name: `E${edges.length}_${a}_${b}_${kind}`, kind, from: a, to: b });
    }
  return { nodes, edges };
}

function graphDecls(g: Graph, r: Rng | null): string[] {
  const nodes = g.nodes.map((n) => `component ${n} {}`);
  const rels = g.edges.map((e) =>
    [`relation ${e.name} {`, `  kind ${e.kind}`, `  connects ${e.from} -> ${e.to}`, "}"].join("\n")
  );
  return r ? r.shuffle([...nodes, ...rels]) : [...nodes, ...rels];
}

function bfs(g: Graph, kinds: Set<string>, from: string): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const x = queue.shift() as string;
    for (const e of g.edges)
      if (kinds.has(e.kind) && e.from === x && !dist.has(e.to)) {
        dist.set(e.to, (dist.get(x) ?? 0) + 1);
        queue.push(e.to);
      }
  }
  return dist;
}

function girth(g: Graph, kinds: Set<string>): number | null {
  let best: number | null = null;
  for (const n of g.nodes) {
    const d = bfs(g, kinds, n);
    for (const e of g.edges)
      if (kinds.has(e.kind) && e.to === n && d.has(e.from)) {
        const len = (d.get(e.from) ?? 0) + 1;
        if (best === null || len < best) best = len;
      }
  }
  return best;
}

interface PathCase {
  g: Graph;
  from: string;
  to: string;
  kinds: string[];
  seed: number;
}

function genPath(r: Rng): PathCase {
  const g = genGraph(r, ["calls", "callbacks"]);
  const [from = "N0", to = "N1"] = r.shuffle(g.nodes);
  return {
    g,
    from,
    to,
    kinds: r.bool(0.6) ? ["calls"] : ["calls", "callbacks"],
    seed: r.int(1, 1 << 30)
  };
}

function pathWitness(c: PathCase, r: Rng | null) {
  const res = check([
    ...graphDecls(c.g, r),
    [`rule nopath {`, `  forbid path ${c.from} -> ${c.to} over ${c.kinds.join(" or ")}`, "}"].join(
      "\n"
    )
  ]);
  return res.diagnostics.find((d) => d.kind === "forbidden_path");
}

// ShortestWitness<findShortestPath>: the forbidden-path witness is a fewest-hop directed path,
// and the same one under any declaration order.
lawTest("shape.checker::ForbiddenPathFewestHops", "holds", () =>
  property(
    "shape.checker::ForbiddenPathFewestHops",
    { cases: 250, seed: 0xfa7101 },
    genPath,
    (c) => {
      const dist = bfs(c.g, new Set(c.kinds), c.from).get(c.to);
      const w = pathWitness(c, null);
      if (dist === undefined)
        return w ? `reported a path where none exists: ${JSON.stringify(w)}` : null;
      if (!w || w.kind !== "forbidden_path")
        return `missed a ${dist}-hop path ${c.from} -> ${c.to}`;
      if (w.steps.length !== dist) return `witness has ${w.steps.length} hops, shortest is ${dist}`;
      const rr = lawkitRng(c.seed);
      for (let k = 0; k < 3; k += 1) {
        const other = pathWitness(c, rr);
        if (
          !other ||
          stable(other.kind === "forbidden_path" ? other.steps : null) !== stable(w.steps)
        )
          return `declaration order changed the witness: ${JSON.stringify(w.steps)} vs ${JSON.stringify(other)}`;
      }
      return null;
    }
  )
);

// "each hop preserves relation kind, name and provenance"
lawTest("shape.checker::ForbiddenPathHopsKeepProvenance", "holds", () =>
  property(
    "shape.checker::ForbiddenPathHopsKeepProvenance",
    { cases: 250, seed: 0xfa7102 },
    genPath,
    (c) => {
      const w = pathWitness(c, null);
      if (!w || w.kind !== "forbidden_path") return null;
      let at = c.from;
      for (const s of w.steps) {
        const e = c.g.edges.find((x) => x.name === strip(s.relation));
        if (!e) return `hop names unknown relation ${s.relation}`;
        if (strip(s.from) !== at || e.from !== strip(s.from) || e.to !== strip(s.to))
          return `hop ${s.from} -> ${s.to} does not follow ${e.name} (${e.from} -> ${e.to}) from ${at}`;
        if (s.kind !== e.kind || !c.kinds.includes(s.kind))
          return `hop over ${e.name} reports kind ${s.kind}, declared ${e.kind}`;
        if (!w.causedBy.includes(`relation ${e.name}`))
          return `causedBy lacks the provenance of ${e.name}: ${JSON.stringify(w.causedBy)}`;
        at = e.to;
      }
      return at === c.to ? null : `witness ends at ${at}, not ${c.to}`;
    }
  )
);

// ShortestWitness<findHypercycle>: a forbidden cycle is reported with a closed witness of the
// graph's shortest cycle length, the same under any declaration order.
lawTest("shape.checker::HypercycleShortestWitness", "holds", () =>
  property(
    "shape.checker::HypercycleShortestWitness",
    { cases: 250, seed: 0xc7c101 },
    (r) => ({
      g: genGraph(r, ["calls", "callbacks"], 6),
      kinds: r.bool(0.6) ? ["calls"] : ["calls", "callbacks"],
      seed: r.int(1, 1 << 30)
    }),
    (c) => {
      const rule = [`rule nocycle {`, `  forbid hypercycle over ${c.kinds.join(" or ")}`, "}"].join(
        "\n"
      );
      const find = (rr: Rng | null) =>
        check([...graphDecls(c.g, rr), rule]).diagnostics.find(
          (d) => d.kind === "forbidden_hypercycle"
        );
      const want = girth(c.g, new Set(c.kinds));
      const w = find(null);
      if (want === null)
        return w ? `reported a cycle in an acyclic graph: ${JSON.stringify(w)}` : null;
      if (!w || w.kind !== "forbidden_hypercycle") return `missed a cycle of length ${want}`;
      if (w.vertices[0] !== w.vertices.at(-1))
        return `witness is not closed: ${JSON.stringify(w.vertices)}`;
      if (w.vertices.length - 1 !== want)
        return `witness length ${w.vertices.length - 1}, shortest cycle ${want}: ${JSON.stringify(w.vertices)}`;
      for (let i = 0; i + 1 < w.vertices.length; i += 1) {
        const a = strip(w.vertices[i] ?? "");
        const b = strip(w.vertices[i + 1] ?? "");
        if (!c.g.edges.some((e) => e.from === a && e.to === b && c.kinds.includes(e.kind)))
          return `witness step ${a} -> ${b} is not a declared edge of the named kinds`;
      }
      const rr = lawkitRng(c.seed);
      for (let k = 0; k < 3; k += 1) {
        const other = find(rr);
        if (stable(other) !== stable(w))
          return `declaration order changed the witness: ${JSON.stringify(w.vertices)} vs ${JSON.stringify(other)}`;
      }
      return null;
    }
  )
);

// ---- freshness -----------------------------------------------------------------------------

/** Independent oracle: a real Gregorian calendar date written exactly YYYY-MM-DD. */
function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function genDate(r: Rng): string {
  const y = r.int(2020, 2030);
  const mo = r.int(1, 12);
  const d = r.int(1, 28);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function genReviewBy(r: Rng): string {
  const good = genDate(r);
  const [y, mo, d] = good.split("-");
  return r.pick([
    good,
    good,
    `${y}-${Number(mo)}-${d}`,
    `${y}/${mo}/${d}`,
    `${d}-${mo}-${y}`,
    `${y}-02-30`,
    `${y}-13-01`,
    `${y}-00-10`,
    "2024-02-29",
    "2023-02-29",
    `${good}T00:00:00Z`,
    ` ${good}`,
    "tomorrow",
    ""
  ]);
}

// "only ISO YYYY-MM-DD values are enforced"
lawTest("shape.checker::FreshnessEnforcesOnlyIsoDates", "holds", () =>
  property(
    "shape.checker::FreshnessEnforcesOnlyIsoDates",
    { cases: 300, seed: 0xd47e01 },
    (r) => ({ reviewBy: genReviewBy(r), asOf: genDate(r) }),
    ({ reviewBy, asOf }) => {
      const res = check(
        [
          "component C {\n  fn f : RefactorSensitive\n    effects unknown\n}",
          [
            "memory M : RefactorConstraint<fn C.f> {",
            "  applies_to fn C.f",
            "  status Explained",
            "  confidence High",
            '  summary "s"',
            "  who {",
            "    owner Team",
            "  }",
            "  when {",
            `    review_by ${JSON.stringify(reviewBy)}`,
            "  }",
            "}"
          ].join("\n")
        ],
        { freshnessDate: requireIsoCalendarDate(asOf), allowUnknownEffects: true }
      );
      const stale = res.diagnostics.some((d) => d.kind === "stale_memory");
      const want = isCalendarDate(reviewBy) && reviewBy < asOf;
      return stale === want
        ? null
        : `review_by ${JSON.stringify(reviewBy)} as of ${asOf}: stale=${stale}, expected ${want}`;
    }
  )
);
