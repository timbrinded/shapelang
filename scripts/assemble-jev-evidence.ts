import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { Glob } from "bun";
import { isRecord } from "../packages/shp-checker/src/attestations.ts";
import { checkShapeModules } from "../packages/shp-checker/src/checker/api.ts";
import { globMatches } from "../packages/shp-checker/src/checker/globs.ts";
import { lowerShapeModules } from "../packages/shp-checker/src/checker/lowerer.ts";
import { moduleOriginForShapeFile } from "../packages/shp-checker/src/checker/symbols.ts";
import type { CheckModuleInput } from "../packages/shp-checker/src/checker/model.ts";
import {
  isCandidateEffectFunctionDecl,
  isModifyFunctionChange,
  isAddFunctionChange,
  isRemoveFunctionChange,
  isRemoveDeclarationChange,
  isRelationEndpoint,
  isRuleForbidPathDecl,
  isRuleForbidProvidesDecl,
  isRuleWhenHasDecl,
  isSatisfiesDecl,
  isTargetRef,
  isTypeRef,
  type Declaration
} from "../packages/shp-checker/src/language/generated/ast.ts";
import {
  qualifyModuleReference,
  resolveModuleReference
} from "../packages/shp-checker/src/module-resolution.ts";
import { parseShapeModule } from "../packages/shp-checker/src/parser.ts";
import { PRELUDE_TRAITS, PRELUDE_CONTEXT_RULES } from "../packages/shp-checker/src/prelude.ts";
import { normalizeShapeSourcePath } from "../packages/shp-checker/src/shape-strings.ts";
import {
  JevError,
  validateEvidence,
  type EnforcementInputV1
} from "../plugins/shapelang/skills/shape-lang/scripts/jev-enforcement.ts";

type TreeEntry = { mode: string; object: string };
type AuthoredDeclaration = {
  id?: string;
  file: string;
  module: string;
  imports: string[];
  declaration: Declaration;
};

function invalid(message: string): never {
  throw new JevError("invalid_evidence", message);
}

function git(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) invalid(`Cannot read exact Git evidence (${args[0]}).`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  } catch {
    invalid("Git evidence is not valid UTF-8 text.");
  }
}

function tree(repoRoot: string, revision: string): Map<string, TreeEntry> {
  return new Map(
    git(repoRoot, ["ls-tree", "-r", "-z", "--full-tree", revision])
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf("\t");
        const [mode, , object] = entry.slice(0, tab).split(" ");
        if (tab < 0 || !mode || !object) invalid("Malformed Git tree output.");
        return [entry.slice(tab + 1), { mode, object }];
      })
  );
}

function blob(repoRoot: string, entries: Map<string, TreeEntry>, path: string): string | undefined {
  const entry = entries.get(path);
  if (!entry) return undefined;
  if (!["100644", "100755"].includes(entry.mode))
    invalid(`Evidence requires a regular tracked file: ${path}.`);
  const text = git(repoRoot, ["cat-file", "blob", entry.object]);
  if (text.includes("\0")) invalid(`Binary evidence is unsupported: ${path}.`);
  if (Buffer.byteLength(text) > 65536) invalid(`Evidence exceeds 64 KiB: ${path}.`);
  return text;
}

function loadSnapshot(repoRoot: string, revision: string) {
  const entries = tree(repoRoot, revision);
  const modules: CheckModuleInput[] = [];
  const declarations: AuthoredDeclaration[] = [];
  const scope = new Glob("shape/**/*.shape");
  for (const file of [...entries.keys()].sort()) {
    if (!scope.match(file) || file.split("/").some((part) => part.startsWith("."))) continue;
    const parsed = parseShapeModule(blob(repoRoot, entries, file) ?? "", file);
    if (!parsed.ok) invalid(`Cannot parse Shape context at ${revision}:${file}.`);
    const origin = moduleOriginForShapeFile(parsed.module, file, repoRoot);
    modules.push({ module: parsed.module, filePath: file, origin });
    if (origin !== "authored") continue;
    for (const declaration of parsed.module.declarations) {
      const module = parsed.module.name ?? "";
      declarations.push({
        ...("name" in declaration ? { id: qualifyModuleReference(module, declaration.name) } : {}),
        file,
        module,
        imports: parsed.module.imports.map((item) => item.path),
        declaration
      });
    }
  }
  // Unknown effect summaries remain honest uncertainty. Parse, resolution and
  // conformance failures cannot supply an unambiguous architecture baseline.
  const checked = checkShapeModules(modules, {
    repoRoot,
    enforceBindings: false,
    allowUnknownEffects: true
  });
  if (!checked.ok) invalid(`Shape context is invalid or ambiguous at ${revision}.`);
  return { revision, entries, declarations, model: lowerShapeModules(modules) };
}

type Snapshot = ReturnType<typeof loadSnapshot>;

function* astChildren(value: unknown): Generator<Record<string, unknown>> {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("$")) continue;
    for (const item of Array.isArray(child) ? child : [child]) {
      if (!isRecord(item) || typeof item.$type !== "string") continue;
      yield item;
      yield* astChildren(item);
    }
  }
}

function referenceNames(declaration: Declaration): string[] {
  const names: string[] = [];
  for (const node of astChildren(declaration)) {
    if (isTypeRef(node) || isTargetRef(node) || isRelationEndpoint(node) || isSatisfiesDecl(node))
      names.push(node.name);
    else if (isRuleWhenHasDecl(node)) names.push(node.trait);
    else if (isRuleForbidPathDecl(node)) names.push(node.source, node.target);
    else if (isRuleForbidProvidesDecl(node) && node.except) names.push(node.except);
    else if (isCandidateEffectFunctionDecl(node)) names.push(node.function);
    else if (
      isModifyFunctionChange(node) ||
      isAddFunctionChange(node) ||
      isRemoveFunctionChange(node)
    )
      names.push(node.target);
    else if (isRemoveDeclarationChange(node)) names.push(node.name);
  }
  return names;
}

function declarationTarget(name: string): string {
  const start = name.lastIndexOf("::") + 2;
  const dot = name.indexOf(".", start < 2 ? 0 : start);
  return dot < 0 ? name : name.slice(0, dot);
}

function authoredContext(
  snapshot: Snapshot,
  paths: string[]
): { declarations: string[]; anchored: Set<string> } {
  const { model } = snapshot;
  const selected = new Set<AuthoredDeclaration>();
  const anchored = new Set<string>();
  const components = new Set<string>();
  const authoredFiles = new Set(snapshot.declarations.map((item) => item.file));
  const include = (name: string) => {
    const target = declarationTarget(name);
    for (const entry of snapshot.declarations) if (entry.id === target) selected.add(entry);
  };

  for (const component of model.components.values()) {
    for (const fn of component.functions.values()) {
      if (fn.generatedAstCandidate || !authoredFiles.has(fn.provenance.filePath ?? "")) continue;
      const refs = [
        fn.source,
        ...(fn.effects.kind === "complete" ? fn.effects.entries.map((item) => item.evidence) : [])
      ];
      for (const ref of refs) {
        const path = ref && normalizeShapeSourcePath(ref.path);
        if (path && paths.includes(path)) {
          anchored.add(path);
          components.add(component.name);
          include(component.name);
        }
      }
    }
  }
  // Include direct relationships, then close over their endpoint declarations.
  // Do not label any implementation as production/test from its filename.
  for (const relation of model.hypergraph.edges.values())
    if (relation.members.some((member) => components.has(member.endpoint))) include(relation.name);
  for (const implementation of model.implementations)
    if (implementation.paths.some(({ glob }) => paths.some((path) => globMatches(glob, path))))
      include(implementation.name);
  for (const binding of model.bindings.values())
    if (binding.whenChanged.some(({ glob }) => paths.some((path) => globMatches(glob, path))))
      include(binding.name);

  // Global rules, traits and changes can constrain or modify selected claims.
  // Keeping each complete also avoids silently dropping a final forbid.
  for (const entry of snapshot.declarations)
    if (
      ["RuleDecl", "TraitDecl", "PolicyDecl", "RoleDecl", "ChangeDecl"].includes(
        entry.declaration.$type
      )
    )
      selected.add(entry);

  let previous = -1;
  while (selected.size !== previous) {
    previous = selected.size;
    for (const entry of selected) {
      for (const raw of referenceNames(entry.declaration)) {
        const name = declarationTarget(raw);
        const resolved = resolveModuleReference(
          name,
          { moduleName: entry.module, imports: entry.imports },
          (module, local) =>
            snapshot.declarations.some((item) => item.id === qualifyModuleReference(module, local))
        );
        if (resolved.kind === "ambiguous") invalid(`Ambiguous authored context reference: ${raw}.`);
        if (resolved.kind === "resolved") include(resolved.name);
      }
    }
    const includesTarget = (target: string) =>
      [...selected].some((item) => item.id === declarationTarget(target));
    for (const context of [...model.memories.values(), ...model.rationales.values()])
      if (
        includesTarget(context.target.name) ||
        (context.appliesTo && includesTarget(context.appliesTo.name))
      )
        include(context.name);
    for (const reevaluation of model.reevaluations.values())
      if (reevaluation.satisfiesName && includesTarget(reevaluation.satisfiesName))
        include(reevaluation.name);
  }
  return {
    anchored,
    declarations: [...selected].map((entry) => {
      const text = entry.declaration.$cstNode?.text;
      if (!text) invalid(`Missing full declaration text: ${entry.file}.`);
      return `Git ${snapshot.revision}:${entry.file}\n${entry.module ? `module ${entry.module}\n` : ""}${entry.imports.map((name) => `import ${name}\n`).join("")}\n${text}`;
    })
  };
}

/** Assemble bounded, reproducible provider input without asking an agent to choose its evidence. */
export async function assembleEvidence(options: {
  repoRoot: string;
  transition: { base: string; head: string };
  obligation: EnforcementInputV1["obligation"];
  attestation?: EnforcementInputV1["attestation"];
}): Promise<EnforcementInputV1> {
  const { repoRoot, transition, obligation } = options;
  for (const revision of [transition.base, transition.head]) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision))
      invalid("Evidence requires full Git commit IDs.");
    if (
      git(repoRoot, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${revision}^{commit}`
      ]).trim() !== revision
    )
      invalid("Evidence revision must identify a commit.");
  }
  if (git(repoRoot, ["rev-parse", "HEAD"]).trim() !== transition.head)
    invalid("Check out the evidence head before assembling its context.");
  if (obligation.paths.length === 0 || new Set(obligation.paths).size !== obligation.paths.length)
    invalid("Evidence requires unique obligation paths.");
  for (const path of obligation.paths)
    if (
      !path ||
      path.includes("\0") ||
      isAbsolute(path) ||
      path.split("/").some((part) => part === ".." || part === ".")
    )
      invalid("Evidence paths must be literal repository-relative paths.");

  const before = loadSnapshot(repoRoot, transition.base);
  const after = loadSnapshot(repoRoot, transition.head);
  const beforeContext = authoredContext(before, obligation.paths);
  const afterContext = authoredContext(after, obligation.paths);
  for (const path of obligation.paths)
    if (!beforeContext.anchored.has(path) && !afterContext.anchored.has(path))
      invalid(
        `No authored function source/effect anchor for ${path}; context requires human investigation.`
      );
  const files = obligation.paths.map((path) => {
    const oldSource = blob(repoRoot, before.entries, path);
    const newSource = blob(repoRoot, after.entries, path);
    const patch = git(repoRoot, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      transition.base,
      transition.head,
      "--",
      `:(literal)${path}`
    ]);
    if (!patch.trim()) invalid(`Obligation path has no change in the exact transition: ${path}.`);
    return {
      path,
      patch: `${patch}\nFull file before (${transition.base}):\n${oldSource ?? "[absent]"}\nFull file after (${transition.head}):\n${newSource ?? "[absent]"}`
    };
  });
  return validateEvidence({
    version: 1,
    obligation,
    diff: { files },
    shapeContext: {
      declarations: [...beforeContext.declarations, ...afterContext.declarations],
      annotations: [
        `Exact Git transition: ${transition.base} -> ${transition.head}. Working tree contents are not evidence.`,
        "Full source files and source-anchored authored declarations, direct relationships, referenced resources, context guards and global policies are supplied. Generated AST candidates are excluded as architecture authority. Runtime/test roles are not inferred from filenames.",
        `Built-in Shape trait rules: ${JSON.stringify(PRELUDE_TRAITS)}; context rules: ${JSON.stringify(PRELUDE_CONTEXT_RULES)}.`
      ]
    },
    ...(options.attestation ? { attestation: options.attestation } : {})
  });
}
