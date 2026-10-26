// std::Deterministic<shape.checker::ShapeChecker.checkShapeModules>: the same modules and options
// give the same result, whatever the module or declaration order and whatever the wall clock.
import { checkShapeModules, parseShapeModule, requireIsoCalendarDate, type CheckModuleInput, type CheckOptions } from "../../../../packages/shp-checker/src/index.ts";
import { type Rng, lawTest, property, rng, stable } from "./lawkit.ts";

interface Spec {
  module: string;
  imports: string[];
  decls: string[];
}

function genSpecs(r: Rng): { specs: Spec[]; options: CheckOptions } {
  const res = ["Ledger", "Catalog", "Vault"].slice(0, r.int(1, 3));
  const specs: Spec[] = [{ module: "resources", imports: [], decls: [...res.map((x) => `resource ${x}`), "trait Kept<T: Resource> {\n  forbid final HardDelete<T>\n}"] }];
  const comps: string[] = [];
  for (let i = 0; i < r.int(1, 3); i += 1) {
    const c = `Comp${i}`;
    comps.push(c);
    const x = r.pick(res);
    const decls = [
      [`component ${c} {`, `  grants ${r.pick(["Read", "Append", "HardDelete"])}<${x}>`, `  fn act${r.bool(0.5) ? " : RefactorSensitive" : ""}`, "    effects complete {", `      ${r.pick(["Read", "Append", "HardDelete"])}<${x}>`, "    }", "}"].join("\n")
    ];
    if (r.bool(0.6))
      decls.push(
        [`memory ${c}Memory : RefactorConstraint<fn ${c}.act> {`, `  applies_to fn ${c}.act`, "  status Explained", "  confidence High", '  summary "s"', "  who {", "    owner Team", "  }", "  when {", `    review_by "2026-0${r.int(1, 9)}-15"`, "  }", "}"].join("\n")
      );
    specs.push({ module: `mod${i}`, imports: ["resources"], decls });
  }
  const glue: string[] = [];
  for (let k = 0; k < r.int(0, 4); k += 1) {
    const [a, b] = [r.pick(comps), r.pick(comps)];
    if (a !== b) glue.push([`relation Glue${k} {`, `  kind ${r.pick(["calls", "callbacks"])}`, `  connects ${a} -> ${b}`, "}"].join("\n"));
  }
  if (r.bool()) glue.push(["rule acyclic {", "  forbid hypercycle over calls or callbacks", "}"].join("\n"));
  if (comps.length > 1 && r.bool()) glue.push(["rule nopath {", `  forbid path ${comps[0]} -> ${comps[1]} over calls`, "}"].join("\n"));
  if (r.bool(0.4)) glue.push("rule kept {\n  when Ledger has Kept\n}");
  specs.push({ module: "glue", imports: specs.slice(1).map((s) => s.module).concat("resources"), decls: glue });
  const options: CheckOptions = { includeFacts: true, ...(r.bool() ? { freshnessDate: requireIsoCalendarDate("2026-05-01") } : {}) };
  return { specs, options };
}

function inputs(specs: Spec[], r: Rng | null): CheckModuleInput[] {
  return (r ? r.shuffle(specs) : specs).map((s) => {
    const src = [`module ${s.module}`, ...(r ? r.shuffle(s.imports) : s.imports).map((m) => `import ${m}`), ...(r ? r.shuffle(s.decls) : s.decls)].join("\n\n");
    const p = parseShapeModule(src, `shape/${s.module}.shape`);
    if (!p.ok) throw new Error(`does not parse: ${p.diagnostics.map((d) => d.message).join("; ")}\n${src}`);
    return { module: p.module, filePath: `shape/${s.module}.shape`, origin: "authored" };
  });
}

/** Runs f with the global Date frozen at t (the checker must not notice). */
function atClock<T>(t: number, f: () => T): T {
  const Real = globalThis.Date;
  class Frozen extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(t);
      else super(...(args as [string | number]));
    }
    static override now(): number {
      return t;
    }
  }
  globalThis.Date = Frozen as DateConstructor;
  try {
    return f();
  } finally {
    globalThis.Date = Real;
  }
}

lawTest("shape.checker::CheckIsDeterministic", "holds", () =>
  property(
    "shape.checker::CheckIsDeterministic",
    { cases: 100, seed: 0xde7e01 },
    (r) => ({ ...genSpecs(r), seed: r.int(1, 1 << 30) }),
    ({ specs, options, seed }) => {
      const base = stable(atClock(Date.UTC(2026, 0, 1), () => checkShapeModules(inputs(specs, null), options)));
      const again = stable(atClock(Date.UTC(2031, 6, 1), () => checkShapeModules(inputs(specs, null), options)));
      if (again !== base) return "the wall clock changed the result";
      const r = rng(seed);
      for (let k = 0; k < 3; k += 1) {
        const other = stable(checkShapeModules(inputs(specs, r), options));
        if (other !== base) return `module/declaration order ${k} changed the result`;
      }
      return null;
    }
  )
);
