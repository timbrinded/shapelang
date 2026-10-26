// Laws of memory InspectionSchemaContract on unit shape.checker::ShapeChecker.inspectShapeModules.
import type { CheckModuleInput } from "../../../../packages/shp-checker/src/checker/model.ts";
import { inspectShapeModules, type ShapeInspection } from "../../../../packages/shp-checker/src/checker/inspection.ts";
import { parseShapeModule } from "../../../../packages/shp-checker/src/parser.ts";
import { type Rng, distinctNames, lawTest, property, rng as rngFrom, stable } from "./lawkit.ts";

interface ModSpec {
  module: string;
  file: string;
  origin: "authored" | "generated_ast";
  decls: string[];
}

function genModules(r: Rng): ModSpec[] {
  const n = r.int(1, 3);
  const modNames = distinctNames(r, n).map((x, i) => `mod${i}_${x.replace(/^_/, "u")}`.toLowerCase());
  return modNames.map((module, i) => {
    const names = distinctNames(r, 8).map((x) => x.replace(/^_/, "u_"));
    const resources = names.slice(0, r.int(1, 3)).map((x) => `R${x}`);
    const comps = names.slice(3, 3 + r.int(1, 3)).map((x) => `C${x}`);
    const decls: string[] = resources.map((x) => `resource ${x}`);
    for (const c of comps) {
      const res = r.pick(resources);
      decls.push([`component ${c} {`, `  grants Read<${res}>`, `  fn f${c}`, "    effects complete {", `      Read<${res}>`, "    }", "}"].join("\n"));
    }
    if (comps.length >= 2) decls.push([`relation Rel${comps[0]}${comps[1]} {`, "  kind calls", `  connects ${comps[0]} -> ${comps[1]}`, "}"].join("\n"));
    if (r.bool()) decls.push([`rule rule${i} {`, `  forbid path ${comps[0]} -> ${r.pick(comps)} over calls`, "}"].join("\n"));
    return { module, file: `shape/${r.bool(0.3) ? "generated/" : ""}${module}.shape`, origin: r.bool(0.4) ? "generated_ast" : "authored", decls };
  });
}

function inputs(specs: ModSpec[], r: Rng | null): CheckModuleInput[] {
  const list = r ? r.shuffle(specs) : specs;
  return list.map((s) => {
    const src = [`module ${s.module}`, ...(r ? r.shuffle(s.decls) : s.decls)].join("\n\n");
    const parsed = parseShapeModule(src, s.file);
    if (!parsed.ok) throw new Error(`does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}\n${src}`);
    return { module: parsed.module, filePath: s.file, origin: s.origin };
  });
}

const inspect = (xs: CheckModuleInput[]): ShapeInspection => inspectShapeModules(xs, { shapeVersion: "law", repoRoot: "/law" });

type Entity = { id: string; name: string; module: string; file: string; origin: string };
const entities = (i: ShapeInspection): [string, Entity[]][] => [
  ["resources", i.resources],
  ["components", i.components],
  ["functions", i.functions],
  ["relations", i.relations],
  ["implementations", i.implementations],
  ["bindings", i.bindings],
  ["rules", i.rules],
  ["memories", i.memories]
];

/** Independent oracle: code point order. */
function codepointLess(a: string, b: string): boolean {
  const x = [...a].map((c) => c.codePointAt(0) ?? 0);
  const y = [...b].map((c) => c.codePointAt(0) ?? 0);
  for (let k = 0; k < Math.min(x.length, y.length); k += 1) if (x[k] !== y[k]) return (x[k] ?? 0) < (y[k] ?? 0);
  return x.length < y.length;
}

// "stable module-qualified identities": every id is module-qualified by its declaring module,
// and adding unrelated declarations changes no existing id.
lawTest("shape.checker::InspectionQualifiedIdentities", "holds", () =>
  property(
    "shape.checker::InspectionQualifiedIdentities",
    { cases: 120, seed: 0x1d5e01 },
    (r) => genModules(r),
    (specs) => {
      const before = inspect(inputs(specs, null));
      for (const [kind, list] of entities(before))
        for (const e of list) {
          const local = kind === "functions" ? e.name.split(".").pop() : e.name;
          if (!e.id.startsWith(`${e.module}::`) || !e.id.endsWith(local ?? "")) return `${kind} id ${e.id} is not qualified by module ${e.module} and name ${e.name}`;
          if (!specs.some((s) => s.module === e.module)) return `${kind} ${e.id} names an undeclared module ${e.module}`;
        }
      const grown = specs.map((s, i) => (i === 0 ? { ...s, decls: [...s.decls, "resource ZzAddedLater"] } : s));
      const after = inspect(inputs(grown, null));
      const ids = (i: ShapeInspection) => new Set(entities(i).flatMap(([k, l]) => l.map((e) => `${k} ${e.id}`)));
      const a = ids(after);
      for (const id of ids(before)) if (!a.has(id)) return `adding a resource removed or renamed ${id}`;
      return null;
    }
  )
);

// "preserves authored or generated-AST origin"
lawTest("shape.checker::InspectionPreservesOrigin", "holds", () =>
  property(
    "shape.checker::InspectionPreservesOrigin",
    { cases: 120, seed: 0x1d5e02 },
    (r) => genModules(r),
    (specs) => {
      const out = inspect(inputs(specs, null));
      for (const d of out.documents) {
        const s = specs.find((x) => x.file === d.file);
        if (!s) return `document ${d.file} was not an input`;
        if (d.origin !== s.origin) return `document ${d.file} origin ${d.origin}, input ${s.origin}`;
      }
      if (out.documents.length !== specs.length) return `${out.documents.length} documents for ${specs.length} inputs`;
      for (const [kind, list] of entities(out))
        for (const e of list) {
          const s = specs.find((x) => x.file === e.file);
          if (s && e.origin !== s.origin) return `${kind} ${e.id} origin ${e.origin}, its file's ${s.origin}`;
        }
      return null;
    }
  )
);

// "codepoint ordering": every list is in code point order, whatever the input order.
lawTest("shape.checker::InspectionCodepointOrder", "holds", () =>
  property(
    "shape.checker::InspectionCodepointOrder",
    { cases: 120, seed: 0x1d5e03 },
    (r) => ({ specs: genModules(r), r2: r.int(1, 1 << 30) }),
    ({ specs, r2 }) => {
      const out = inspect(inputs(specs, null));
      const sorted = (xs: string[]) => xs.every((x, k) => k === 0 || !codepointLess(x, xs[k - 1] as string));
      if (!sorted(out.documents.map((d) => d.file))) return `documents not in code point order: ${out.documents.map((d) => d.file).join(", ")}`;
      for (const [kind, list] of entities(out)) if (!sorted(list.map((e) => e.id))) return `${kind} not in code point order: ${list.map((e) => e.id).join(", ")}`;
      for (const c of out.components) if (!sorted(c.functions)) return `component ${c.id} functions not in code point order`;
      const shuffled = inspect(inputs(specs, rngFrom(r2)));
      return stable(shuffled) === stable(out) ? null : "input order changed the inspection output";
    }
  )
);
