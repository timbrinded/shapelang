// @ts-nocheck
// Law-preserving refactors of the code behind Shape's own tested laws (H3 dogfood arm). Each is a
// list of exact, unique text replacements in one file of a materialised tree. `where` says whether
// the edit is inside the law's bound unit (Req), in a function it calls, or file-level only.
export const DOG_REFACTORS = [
  {
    id: "D01-freshness-rename-local",
    where: "unit",
    law: "shape.checker::FreshnessEnforcesOnlyIsoDates",
    at: "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness",
    path: "packages/shp-checker/src/checker/rules/guards.ts",
    note: "local `target` renamed to `subject` in checkFreshness",
    edits: [
      [
        '    const target = info.appliesTo ?? info.target;\n    diagnostics.push({\n      kind: "stale_memory",\n      guardKind: kind,\n      guard: info.name,\n      targetKind: target.kind,\n      target: target.name,',
        '    const subject = info.appliesTo ?? info.target;\n    diagnostics.push({\n      kind: "stale_memory",\n      guardKind: kind,\n      guard: info.name,\n      targetKind: subject.kind,\n      target: subject.name,'
      ]
    ]
  },
  {
    id: "D02-freshness-line-comment",
    where: "unit",
    law: "shape.checker::FreshnessEnforcesOnlyIsoDates",
    at: "ts:packages/shp-checker/src/checker/rules/guards.ts#checkFreshness",
    path: "packages/shp-checker/src/checker/rules/guards.ts",
    note: "line comment added inside checkFreshness (inert)",
    edits: [
      [
        '    const target = info.appliesTo ?? info.target;\n    diagnostics.push({\n      kind: "stale_memory",',
        '    // a memory guard reports against what it applies to, else its own target\n    const target = info.appliesTo ?? info.target;\n    diagnostics.push({\n      kind: "stale_memory",'
      ]
    ]
  },
  {
    id: "D03-sourcepath-rename-locals",
    where: "unit",
    law: "shape.checker::SourcePathRulesShared",
    at: "ts:packages/shp-checker/src/shape-strings.ts#normalizeShapeSourcePath",
    path: "packages/shp-checker/src/shape-strings.ts",
    note: "locals renamed in normalizeShapeSourcePath",
    edits: [
      [
        '  const withoutAnchor = path.split("#", 1)[0] ?? path;\n  const lineMatch = /^(.*):\\d+(?:-\\d+)?$/.exec(withoutAnchor);\n  return normalizeShapePath(lineMatch?.[1] ?? withoutAnchor);',
        '  const pathOnly = path.split("#", 1)[0] ?? path;\n  const located = /^(.*):\\d+(?:-\\d+)?$/.exec(pathOnly);\n  return normalizeShapePath(located?.[1] ?? pathOnly);'
      ]
    ]
  },
  {
    id: "D04-sourcepath-reorder",
    where: "file",
    law: "shape.checker::SourcePathRulesShared",
    at: "ts:packages/shp-checker/src/shape-strings.ts",
    path: "packages/shp-checker/src/shape-strings.ts",
    note: "normalizeShapePath moved above normalizeShapeSourcePath",
    edits: [
      [
        'export function normalizeShapeSourcePath(path: string): string {\n  const withoutAnchor = path.split("#", 1)[0] ?? path;\n  const lineMatch = /^(.*):\\d+(?:-\\d+)?$/.exec(withoutAnchor);\n  return normalizeShapePath(lineMatch?.[1] ?? withoutAnchor);\n}\n\nexport function normalizeShapePath(path: string): string {\n  return path.replaceAll("\\\\", "/").replace(/^\\.\\//, "");\n}\n',
        'export function normalizeShapePath(path: string): string {\n  return path.replaceAll("\\\\", "/").replace(/^\\.\\//, "");\n}\n\nexport function normalizeShapeSourcePath(path: string): string {\n  const withoutAnchor = path.split("#", 1)[0] ?? path;\n  const lineMatch = /^(.*):\\d+(?:-\\d+)?$/.exec(withoutAnchor);\n  return normalizeShapePath(lineMatch?.[1] ?? withoutAnchor);\n}\n'
      ]
    ]
  },
  {
    id: "D05-shortestpath-rename-local",
    where: "unit",
    law: "shape.checker::ForbiddenPathFewestHops",
    at: "ts:packages/shp-checker/src/checker/rules/relations.ts#findShortestPath",
    path: "packages/shp-checker/src/checker/rules/relations.ts",
    note: "local `graph` renamed to `traversal` in findShortestPath",
    edits: [
      [
        "  const graph = buildRelationTraversalGraph(validPathHyperedges(model), kindsFilter);\n  const path = shortestPathBetween(source, target, graph);",
        "  const traversal = buildRelationTraversalGraph(validPathHyperedges(model), kindsFilter);\n  const path = shortestPathBetween(source, target, traversal);"
      ]
    ]
  },
  {
    id: "D06-validpath-rename-locals",
    where: "callee",
    law: "shape.checker::ForbiddenPathFewestHops",
    at: "ts:packages/shp-checker/src/checker/rules/relations.ts#validPathHyperedges",
    path: "packages/shp-checker/src/checker/rules/relations.ts",
    note: "locals renamed in validPathHyperedges (callee of findShortestPath)",
    edits: [
      [
        "    const provider = providesProvider(edge);\n    const target = providesTarget(edge);\n    return (\n      provider !== undefined &&\n      target !== undefined &&\n      model.components.has(provider) &&\n      model.resources.has(target)",
        "    const providerName = providesProvider(edge);\n    const resourceName = providesTarget(edge);\n    return (\n      providerName !== undefined &&\n      resourceName !== undefined &&\n      model.components.has(providerName) &&\n      model.resources.has(resourceName)"
      ]
    ]
  },
  {
    id: "D07-finalforbids-rename-local",
    where: "unit",
    law: "shape.checker::FinalForbidBeatsGrant",
    at: "ts:packages/shp-checker/src/checker/derivations.ts#deriveFinalForbidsForResource",
    path: "packages/shp-checker/src/checker/derivations.ts",
    note: "loop variable `traitName` renamed to `attached` in deriveFinalForbidsForResource",
    edits: [
      [
        "  for (const traitName of resource.traits.keys()) {\n    const trait = model.traits.get(traitName);",
        "  for (const attached of resource.traits.keys()) {\n    const trait = model.traits.get(attached);"
      ],
      [
        "        trait: traitName,\n        provenance: forbid.provenance\n      });\n    }\n  }\n\n  for (const rule of model.rules) {",
        "        trait: attached,\n        provenance: forbid.provenance\n      });\n    }\n  }\n\n  for (const rule of model.rules) {"
      ]
    ]
  },
  {
    id: "D08-isodate-rename-locals",
    where: "callee",
    law: "shape.checker::FreshnessEnforcesOnlyIsoDates",
    at: "ts:packages/shp-checker/src/checker/iso-date.ts#isIsoCalendarDate",
    path: "packages/shp-checker/src/checker/iso-date.ts",
    note: "locals renamed in isIsoCalendarDate (cross-file callee of checkFreshness)",
    edits: [
      [
        "  const year = Number(value.slice(0, 4));\n  const month = Number(value.slice(5, 7));\n  const day = Number(value.slice(8, 10));\n  if (month < 1 || month > 12 || day < 1) {\n    return false;\n  }\n  return day <= daysInMonth(year, month);",
        "  const y = Number(value.slice(0, 4));\n  const m = Number(value.slice(5, 7));\n  const d = Number(value.slice(8, 10));\n  if (m < 1 || m > 12 || d < 1) {\n    return false;\n  }\n  return d <= daysInMonth(y, m);"
      ]
    ]
  },
  {
    id: "D09-codepoint-rename-locals",
    where: "callee",
    law: "shape.checker::InspectionCodepointOrder",
    at: "ts:packages/shp-checker/src/shape-strings.ts#compareCodepointStrings",
    path: "packages/shp-checker/src/shape-strings.ts",
    note: "locals renamed in compareCodepointStrings (cross-file callee of inspectShapeModules)",
    edits: [
      [
        "  const length = Math.min(leftCodepoints.length, rightCodepoints.length);\n  for (let index = 0; index < length; index += 1) {\n    const leftCodepoint = leftCodepoints[index]?.codePointAt(0) ?? 0;\n    const rightCodepoint = rightCodepoints[index]?.codePointAt(0) ?? 0;",
        "  const shared = Math.min(leftCodepoints.length, rightCodepoints.length);\n  for (let i = 0; i < shared; i += 1) {\n    const leftCodepoint = leftCodepoints[i]?.codePointAt(0) ?? 0;\n    const rightCodepoint = rightCodepoints[i]?.codePointAt(0) ?? 0;"
      ]
    ]
  },
  {
    id: "D10-formatter-rename-local",
    where: "unit",
    law: "shape.tooling::FormatterIdempotent",
    at: "ts:packages/shp-checker/src/formatter.ts#formatShapeModule",
    path: "packages/shp-checker/src/formatter.ts",
    note: "local `chunks` renamed to `parts` in formatShapeModule",
    edits: [{ renameIn: "export function formatShapeModule(", from: "chunks", to: "parts" }]
  },
  {
    id: "D11-planchange-rename-local",
    where: "callee",
    law: "shape.checker::ChangePlanStagedInIsolation",
    at: "ts:packages/shp-checker/src/checker/lowering/changes.ts#planChange",
    path: "packages/shp-checker/src/checker/lowering/changes.ts",
    note: "local `transitions` renamed to `steps` in planChange (callee of lowerChange)",
    edits: [{ renameIn: "export function planChange(", from: "transitions", to: "steps" }]
  },
  {
    id: "D12-updatedraft-rename-local",
    where: "unit",
    law: "shape.tooling::UpdateDraftsPreferUnknown",
    at: "ts:packages/shp-checker/src/authoring.ts#generateShapeUpdateDraft",
    path: "packages/shp-checker/src/authoring.ts",
    note: "local `changedFunctions` renamed to `drafted` in generateShapeUpdateDraft",
    edits: [
      {
        renameIn: "export function generateShapeUpdateDraft(",
        from: "changedFunctions",
        to: "drafted"
      }
    ]
  }
];
