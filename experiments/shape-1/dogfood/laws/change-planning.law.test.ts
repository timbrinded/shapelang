// Laws of memory AtomicChangePlanning on unit shape.checker::ShapeModelLowerer.lowerChange.
import { commitPlannedChange } from "../../../../packages/shp-checker/src/checker/change-planning.ts";
import { lowerShapeModules } from "../../../../packages/shp-checker/src/checker/lowerer.ts";
import {
  lowerChange,
  planChange
} from "../../../../packages/shp-checker/src/checker/lowering/changes.ts";
import type { Model } from "../../../../packages/shp-checker/src/checker/model.ts";
import { moduleContext } from "../../../../packages/shp-checker/src/checker/symbols.ts";
import {
  type ChangeDecl,
  isChangeDecl
} from "../../../../packages/shp-checker/src/language/generated/ast.ts";
import { parseShapeModule } from "../../../../packages/shp-checker/src/parser.ts";
import { type Rng, lawTest, property, stableDeep } from "./lawkit.ts";

interface Case {
  base: string;
  changes: string[];
}

const EFFECTS = ["Read", "Append", "Update"] as const;

function genCase(r: Rng): Case {
  const resources = ["Ledger", "Catalog", "Vault"].slice(0, r.int(1, 3));
  const comps = Array.from({ length: r.int(1, 3) }, (_, i) => ({
    name: `Comp${i}`,
    fns: Array.from({ length: r.int(1, 3) }, (_, j) => `fn${j}`)
  }));
  const atom = () => `${r.pick(EFFECTS)}<${r.pick(resources)}>`;
  const base = [
    "module law",
    ...resources.map((x) => `resource ${x}`),
    ...comps.map((c) =>
      [
        `component ${c.name} {`,
        ...EFFECTS.flatMap((e) => resources.map((x) => `  grants ${e}<${x}>`)),
        ...c.fns.flatMap((f) => [
          `  fn ${f}${r.bool(0.4) ? " : RefactorSensitive" : ""}`,
          ...(r.bool(0.4) ? ['    description "Kept local for review."'] : []),
          "    effects complete {",
          `      ${atom()}`,
          "    }"
        ]),
        "}"
      ].join("\n")
    )
  ].join("\n\n");
  const changes = Array.from({ length: r.int(1, 3) }, (_, k) => {
    const entries: string[] = [];
    for (let e = 0; e < r.int(1, 4); e += 1) {
      const c = r.pick(comps);
      const f = r.pick(c.fns);
      const op = r.pick(["modify", "modify", "remove", "add"] as const);
      if (op === "modify")
        entries.push(
          [
            `  modify fn ${c.name}.${f}`,
            ...(r.bool(0.3) ? ["    transform ExtractHelper"] : []),
            "    effects complete {",
            `      ${atom()}`,
            "    }"
          ].join("\n")
        );
      else if (op === "remove") entries.push(`  remove fn ${c.name}.${f}`);
      else
        entries.push(
          [
            `  add fn ${c.name}.added${k}x${e}`,
            "    effects complete {",
            `      ${atom()}`,
            "    }"
          ].join("\n")
        );
    }
    return ["module law", [`change Change${k} {`, ...entries, "}"].join("\n")].join("\n\n");
  });
  return { base, changes };
}

function load(c: Case): {
  model: Model;
  changes: { decl: ChangeDecl; ctx: ReturnType<typeof moduleContext> }[];
} {
  const p = parseShapeModule(c.base, "law.shape");
  if (!p.ok)
    throw new Error(`base does not parse: ${p.diagnostics.map((d) => d.message).join("; ")}`);
  const model = lowerShapeModules([
    { module: p.module, filePath: "law.shape", origin: "authored" }
  ]);
  const changes = c.changes.map((src, i) => {
    const q = parseShapeModule(src, `change${i}.shape`);
    if (!q.ok)
      throw new Error(
        `change does not parse: ${q.diagnostics.map((d) => d.message).join("; ")}\n${src}`
      );
    const decl = q.module.declarations.find(isChangeDecl);
    if (!decl) throw new Error("no change declaration");
    return {
      decl,
      ctx: moduleContext({ module: q.module, filePath: `change${i}.shape`, origin: "authored" })
    };
  });
  return { model, changes };
}

// "each change declaration is applied to an isolated snapshot": planning leaves the effective
// model untouched, and planning one change first does not alter another's plan.
lawTest("shape.checker::ChangePlanStagedInIsolation", "holds", () =>
  property(
    "shape.checker::ChangePlanStagedInIsolation",
    { cases: 150, seed: 0xc4a901 },
    genCase,
    (c) => {
      const { model, changes } = load(c);
      const before = stableDeep(model);
      const plans = changes.map((ch) => planChange(ch.decl, ch.ctx, model));
      if (stableDeep(model) !== before) return "planning mutated the effective model before commit";
      const last = changes.at(-1);
      if (last && changes.length > 1) {
        const alone = load(c);
        const lastAlone = alone.changes.at(-1);
        if (!lastAlone) return "missing change";
        const solo = planChange(lastAlone.decl, lastAlone.ctx, alone.model);
        if (stableDeep(solo) !== stableDeep(plans.at(-1)))
          return "planning earlier changes altered a later change's plan";
      }
      return null;
    }
  )
);

// "the plan is committed only after every entry is staged": a commit applies the whole staged
// model and every event at once, exactly as lowerChange does, never a prefix of the entries.
lawTest("shape.checker::ChangePlanCommitsOnlyWhenFullyStaged", "holds", () =>
  property(
    "shape.checker::ChangePlanCommitsOnlyWhenFullyStaged",
    { cases: 150, seed: 0xc4a902 },
    genCase,
    (c) => {
      const a = load(c);
      const b = load(c);
      for (const [i, ch] of a.changes.entries()) {
        const eventsBefore = a.model.changeEvents.length;
        const plan = planChange(ch.decl, ch.ctx, a.model);
        const staged = stableDeep({ ...plan.stagedModel, changeEvents: undefined });
        commitPlannedChange(a.model, plan);
        if (stableDeep({ ...a.model, changeEvents: undefined }) !== staged)
          return `change ${i}: committed model differs from the fully staged one`;
        if (stableDeep(a.model.changeEvents.slice(eventsBefore)) !== stableDeep(plan.events))
          return `change ${i}: commit did not append exactly the plan's events`;
        const other = b.changes[i];
        if (!other) return "missing change";
        lowerChange(other.decl, other.ctx, b.model);
        if (stableDeep(b.model) !== stableDeep(a.model))
          return `change ${i}: lowerChange differs from plan-then-commit`;
      }
      return null;
    }
  )
);
