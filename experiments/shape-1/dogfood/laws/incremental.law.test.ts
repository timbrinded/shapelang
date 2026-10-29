// Laws of memory IncrementalInvalidationContract on unit
// shape.checker.incremental::ShapeIncrementalChecker.check.
import {
  IncrementalShapeChecker,
  checkShapeModules,
  compareCodepointStrings,
  parseShapeModule,
  requireIsoCalendarDate,
  type CheckModuleInput,
  type CheckOptions,
  type IncrementalShapeDocument
} from "../../../../packages/shp-checker/src/index.ts";
import { type Rng, lawTest, property, stable } from "./lawkit.ts";

type Doc = IncrementalShapeDocument;

function resourcesDoc(path: string, names: string[]): Doc {
  return {
    filePath: path,
    source: ["module resources", ...names.map((n) => `resource ${n}`)].join("\n\n")
  };
}

function componentDoc(
  path: string,
  mod: string,
  comp: string,
  res: string,
  effect: string,
  extra: string
): Doc {
  return {
    filePath: path,
    source: [
      `module ${mod}`,
      "import resources",
      [
        `component ${comp} {`,
        `  grants ${effect}<${res}>`,
        `  fn act : RefactorSensitive`,
        "    effects complete {",
        `      ${effect}<${res}>`,
        "    }",
        "}"
      ].join("\n"),
      [
        `memory ${comp}Memory : RefactorConstraint<fn ${comp}.act> {`,
        `  applies_to fn ${comp}.act`,
        "  status Explained",
        "  confidence High",
        `  summary ${JSON.stringify(extra)}`,
        "  who {",
        "    owner Team",
        "  }",
        "  when {",
        '    review_by "2026-06-01"',
        "  }",
        "}"
      ].join("\n")
    ].join("\n\n")
  };
}

function initialDocs(r: Rng): Doc[] {
  const res = ["Ledger", "Catalog", "Vault"].slice(0, r.int(1, 3));
  const docs: Doc[] = [resourcesDoc("shape/resources.shape", res)];
  for (let i = 0; i < r.int(1, 3); i += 1)
    docs.push(
      componentDoc(
        `shape/c${i}.shape`,
        `mod${i}`,
        `Comp${i}`,
        r.pick(res),
        r.pick(["Read", "Append", "HardDelete"]),
        "initial"
      )
    );
  return docs;
}

function options(r: Rng): CheckOptions {
  return {
    includeFacts: r.bool(),
    ...(r.bool()
      ? {
          freshnessDate: requireIsoCalendarDate(r.pick(["2026-01-01", "2026-07-01", "2027-01-01"]))
        }
      : {}),
    ...(r.bool(0.3) ? { allowUnknownEffects: true } : {})
  };
}

/** One random document mutation: edit, add, remove or flip a module's origin. */
function mutate(r: Rng, docs: Doc[]): Doc[] {
  const out = docs.map((d) => ({ ...d }));
  const comps = out.filter((d) => d.filePath !== "shape/resources.shape");
  const op = r.pick(["edit", "edit", "add", "remove", "origin"] as const);
  if (op === "edit" || comps.length === 0) {
    const d = r.pick(out);
    d.source =
      d.filePath === "shape/resources.shape"
        ? `${d.source}\n\nresource Extra${r.int(0, 999)}`
        : d.source.replace(/summary "[^"]*"/, `summary "edit ${r.int(0, 9999)}"`);
  } else if (op === "add") {
    const i = 10 + r.int(0, 50);
    if (!out.some((d) => d.filePath === `shape/c${i}.shape`))
      out.push(componentDoc(`shape/c${i}.shape`, `mod${i}`, `Comp${i}`, "Ledger", "Read", "added"));
    if (!out[0]?.source.includes("resource Ledger") && out[0])
      out[0].source = `${out[0].source}\n\nresource Ledger`;
  } else if (op === "remove" && comps.length > 1) {
    const victim = r.pick(comps).filePath;
    return out.filter((d) => d.filePath !== victim);
  } else {
    const d = r.pick(comps.length > 0 ? comps : out);
    d.origin = d.origin === "generated_ast" ? "authored" : "generated_ast";
  }
  return out;
}

function fullCheck(docs: readonly Doc[], opts: CheckOptions) {
  const modules: CheckModuleInput[] = docs
    .toSorted((a, b) => compareCodepointStrings(a.filePath, b.filePath))
    .map((d) => {
      const p = parseShapeModule(d.source, d.filePath);
      if (!p.ok) throw new Error(`does not parse: ${d.filePath}`);
      return { module: p.module, filePath: d.filePath, origin: d.origin };
    });
  return checkShapeModules(modules, opts);
}

type Step = { kind: "documents" | "options" | "noop"; docs: Doc[]; opts: CheckOptions };

function genSession(r: Rng): Step[] {
  let docs = initialDocs(r);
  let opts = options(r);
  const steps: Step[] = [{ kind: "documents", docs, opts }];
  for (let i = 0; i < r.int(5, 10); i += 1) {
    const kind = r.pick(["documents", "options", "noop"] as const);
    if (kind === "documents") docs = mutate(r, docs);
    if (kind === "options") {
      let next = options(r);
      for (let k = 0; k < 5 && stable(next) === stable(opts); k += 1) next = options(r);
      if (stable(next) === stable(opts)) next = { ...opts, includeFacts: !opts.includeFacts };
      opts = next;
    }
    steps.push({ kind, docs, opts });
  }
  return steps;
}

/** Replays a session, checking `law` at every step of the given kind. */
function replay(
  steps: Step[],
  onStep: (
    s: Step,
    res: ReturnType<IncrementalShapeChecker["check"]>,
    prev: ReturnType<IncrementalShapeChecker["check"]> | null
  ) => string | null
): string | null {
  const checker = new IncrementalShapeChecker();
  let prev: ReturnType<IncrementalShapeChecker["check"]> | null = null;
  for (const [i, s] of steps.entries()) {
    const res = checker.check(s.docs, s.opts);
    const bad = onStep(s, res, prev);
    if (bad) return `step ${i} (${s.kind}): ${bad}`;
    prev = res;
  }
  return null;
}

// "document mutations and implicit generated-AST origin changes rebuild the complete two-pass
// model and facts"
lawTest("shape.checker.incremental::IncrementalRebuildsOnDocumentChange", "holds", () =>
  property(
    "shape.checker.incremental::IncrementalRebuildsOnDocumentChange",
    { cases: 60, seed: 0x1c1101 },
    genSession,
    (steps) =>
      replay(steps, (s, res) => {
        if (s.kind !== "documents") return null;
        if (stable(res.result) !== stable(fullCheck(s.docs, s.opts)))
          return "result differs from a fresh full check";
        const docsChanged =
          res.invalidation.reparsedDocuments.length > 0 ||
          res.invalidation.removedDocuments.length > 0 ||
          res.invalidation.causes.includes("initial_check");
        if (docsChanged && res.invalidation.derivedFacts !== "rebuilt")
          return `documents changed but derivedFacts=${res.invalidation.derivedFacts}`;
        if (docsChanged && res.invalidation.diagnostics !== "recomputed")
          return `documents changed but diagnostics=${res.invalidation.diagnostics}`;
        return null;
      })
  )
);

// "option-only checks may reuse the model when origins stay stable"
lawTest("shape.checker.incremental::IncrementalReusesModelOnOptionChange", "holds", () =>
  property(
    "shape.checker.incremental::IncrementalReusesModelOnOptionChange",
    { cases: 60, seed: 0x1c1102 },
    genSession,
    (steps) =>
      replay(steps, (s, res) => {
        if (s.kind !== "options") return null;
        if (stable(res.result) !== stable(fullCheck(s.docs, s.opts)))
          return "option-only result differs from a fresh full check";
        if (res.invalidation.reparsedDocuments.length > 0)
          return "an option-only check reparsed documents";
        if (res.invalidation.derivedFacts !== "reused")
          return `option-only check rebuilt the model (derivedFacts=${res.invalidation.derivedFacts})`;
        if (res.invalidation.diagnostics !== "recomputed")
          return "option-only check did not recompute diagnostics";
        return null;
      })
  )
);

// "exact no-ops may reuse diagnostics"
lawTest("shape.checker.incremental::IncrementalReusesDiagnosticsOnNoop", "holds", () =>
  property(
    "shape.checker.incremental::IncrementalReusesDiagnosticsOnNoop",
    { cases: 60, seed: 0x1c1103 },
    genSession,
    (steps) =>
      replay(steps, (s, res, prev) => {
        if (s.kind !== "noop" || !prev) return null;
        if (stable(res.result) !== stable(prev.result)) return "a no-op changed the result";
        if (stable(res.result) !== stable(fullCheck(s.docs, s.opts)))
          return "a no-op result differs from a fresh full check";
        if (res.invalidation.diagnostics !== "reused" || res.invalidation.derivedFacts !== "reused")
          return `no-op recomputed: ${JSON.stringify(res.invalidation)}`;
        return null;
      })
  )
);
