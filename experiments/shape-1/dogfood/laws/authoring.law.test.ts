// Law of memory AuthoringUnknownSafety on unit shape.tooling::ShapeAuthoring.generateShapeUpdateDraft.
import { generateShapeUpdateDraft } from "../../../../packages/shp-checker/src/authoring.ts";
import { checkShapeModules, parseShapeModule } from "../../../../packages/shp-checker/src/index.ts";
import { type Rng, lawTest, property } from "./lawkit.ts";

const EXT = ["ts", "tsx", "js", "mjs", "rs", "py", "go", "swift", "sql", "sh", "md"] as const;

function genInput(r: Rng) {
  const files = [...new Set(Array.from({ length: r.int(1, 6) }, () => `${r.pick(["src", "lib", "app/api", "db"])}/${r.pick(["store", "purge", "index", "handler", "a_b", "x9"])}${r.int(0, 3)}.${r.pick(EXT)}`))];
  return { componentName: r.pick(["AuditStore", "Billing", "Gateway", "C"]), moduleName: r.bool() ? r.pick(["audit", "billing"]) : undefined, changedFiles: files, includeMemoryGuardScaffold: r.bool(0.3) };
}

// "generated drafts prefer effects unknown over false empty complete summaries"
lawTest("shape.tooling::UpdateDraftsPreferUnknown", "holds", () =>
  property(
    "shape.tooling::UpdateDraftsPreferUnknown",
    { cases: 200, seed: 0xa07401 },
    genInput,
    (input) => {
      const draft = generateShapeUpdateDraft(input);
      const p = parseShapeModule(draft, "draft.shape");
      if (!p.ok) return `draft does not parse: ${p.diagnostics.map((d) => d.message).join("; ")}\n${draft}`;
      if (/effects\s+complete\s*\{\s*\}/.test(draft)) return `draft claims an empty complete summary:\n${draft}`;
      const fns = draft.match(/^\s*fn\s/gm)?.length ?? 0;
      const unknown = draft.match(/^\s*effects unknown\s*$/gm)?.length ?? 0;
      if (fns !== input.changedFiles.length) return `${fns} fns for ${input.changedFiles.length} changed files`;
      if (unknown !== fns) return `${fns - unknown} of ${fns} fns do not say effects unknown`;
      const res = checkShapeModules([{ module: p.module, filePath: "draft.shape", origin: "authored" }], { allowUnknownEffects: true });
      const blocking = res.diagnostics.filter((d) => d.kind === "unknown_effects" && d.severity !== "warning");
      return blocking.length === 0 ? null : `unknown effects block a draft check: ${JSON.stringify(blocking)}`;
    }
  )
);
