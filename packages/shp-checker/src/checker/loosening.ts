// Rule loosening: finds edits to the model's rule layer that let the checked
// model pass. The rule layer is what a team decides is allowed: traits, rules,
// design memory, rationale, implementations, bindings, roles, policies, and the
// trait lists on resources, components, and functions. Everything else
// (components, grants, functions, effects, relations, changes, reevaluations,
// attestations) describes the code, and stays as the change wrote it. Each rule
// edit is reverted to its base version on its own and the model is checked
// again; an error that appears only after the revert is one the edit silenced.
import {
  isBindingDecl,
  isComponentDecl,
  isFunctionSummary,
  isImplementationDecl,
  isMemoryDecl,
  isOwnsDecl,
  isPolicyDecl,
  isRationaleDecl,
  isResourceDecl,
  isRoleDecl,
  isRuleDecl,
  isTraitDecl,
  type BindingDecl,
  type ComponentDecl,
  type Declaration,
  type FunctionSummary,
  type ImplementationDecl,
  type MemoryDecl,
  type PolicyDecl,
  type RationaleDecl,
  type ResourceDecl,
  type RoleDecl,
  type RuleDecl,
  type TraitDecl,
  type TypeRef
} from "../language/generated/ast.ts";
import type { CheckModuleInput, SemanticDiagnostic } from "./model.ts";
import { compareCodepointStrings } from "../shape-strings.ts";
import { compareShapeDiagnostics } from "./diagnostics.ts";
import { normalizeRepoPath } from "./globs.ts";

type RuleDeclaration =
  | BindingDecl
  | ImplementationDecl
  | MemoryDecl
  | PolicyDecl
  | RationaleDecl
  | RoleDecl
  | RuleDecl
  | TraitDecl;

const RULE_DECLARATION_KINDS: Record<RuleDeclaration["$type"], string> = {
  BindingDecl: "binding",
  ImplementationDecl: "implementation",
  MemoryDecl: "memory",
  PolicyDecl: "policy",
  RationaleDecl: "rationale",
  RoleDecl: "role",
  RuleDecl: "rule",
  TraitDecl: "trait"
};

/**
 * Diagnostics that mean a rule rejected the model. A revert can also produce
 * name-resolution or validation errors, for example when a restored rule names a
 * component the change renamed; those describe the comparison, not a violation,
 * so they are not reported as silenced. Stale design memory is left out because
 * moving `review_by` forward after a review is how it is meant to be cleared.
 */
const VIOLATION_KINDS: ReadonlySet<SemanticDiagnostic["kind"]> = new Set([
  "final_forbidden_effect",
  "forbidden_hypercycle",
  "forbidden_path",
  "forbidden_provides",
  "guarded_shape_changed",
  "missing_bound_docs_change",
  "missing_grant",
  "missing_required_context",
  "missing_required_description",
  "missing_shape_update",
  "unsafe_effects"
]);

type Entry = { input: CheckModuleInput; declarations: Declaration[] };

type RuleEdit = {
  /** Completes "This change ...". */
  description: string;
  filePath?: string;
  causedBy: string[];
  revert: (entries: Entry[]) => void;
};

export type RuleLooseningInput = {
  head: readonly CheckModuleInput[];
  base: readonly CheckModuleInput[];
  /** The diagnostics of the head model, checked with the options `check` uses. */
  headDiagnostics: readonly SemanticDiagnostic[];
  check: (inputs: CheckModuleInput[]) => SemanticDiagnostic[];
  repoRoot: string;
  /**
   * Every file in the repository. When given, a coverage or binding error about
   * a changed file that no longer exists is not counted: narrowing governed
   * paths away from deleted files is how a move is recorded.
   */
  repositoryFiles?: readonly string[];
};

/**
 * Reports each rule-layer edit in `head`, relative to `base`, whose revert makes
 * `check` report a rule violation that `headDiagnostics` does not contain.
 * Edits that add rules or traits are not reverted, since they can only tighten
 * the model.
 */
export function checkRuleLoosening(input: RuleLooseningInput): SemanticDiagnostic[] {
  const { head, base, headDiagnostics, check, repoRoot } = input;
  const edits = findRuleEdits(head, base, repoRoot);
  if (edits.length === 0) {
    return [];
  }

  const present = input.repositoryFiles === undefined ? undefined : new Set(input.repositoryFiles);
  const counts = (diagnostic: SemanticDiagnostic): boolean =>
    isViolation(diagnostic) && (present === undefined || !aboutDeletedFile(diagnostic, present));
  const before = new Set(headDiagnostics.filter(isViolation).map(diagnosticKey));
  const silencedBy = (reverted: RuleEdit[]): SemanticDiagnostic[] => {
    const found = new Map<string, SemanticDiagnostic>();
    for (const diagnostic of check(compose(head, reverted))) {
      const key = diagnosticKey(diagnostic);
      if (counts(diagnostic) && !before.has(key)) {
        found.set(key, diagnostic);
      }
    }
    return [...found.values()].toSorted(compareShapeDiagnostics);
  };

  const diagnostics: SemanticDiagnostic[] = [];
  const attributed = new Set<string>();
  for (const edit of edits) {
    const silenced = silencedBy([edit]);
    if (silenced.length === 0) {
      continue;
    }
    silenced.forEach((diagnostic) => attributed.add(diagnosticKey(diagnostic)));
    diagnostics.push(looseningDiagnostic(edit.description, silenced, edit.filePath, edit.causedBy));
  }

  // Errors that only return when several edits are reverted together, such as a
  // rule and the trait it applies to both removed.
  if (edits.length > 1) {
    const joint = silencedBy(edits).filter(
      (diagnostic) => !attributed.has(diagnosticKey(diagnostic))
    );
    if (joint.length > 0) {
      diagnostics.push(
        looseningDiagnostic(
          `makes these rule changes together: ${edits.map((edit) => edit.description).join("; ")}`,
          joint,
          edits[0]?.filePath,
          edits.flatMap((edit) => edit.causedBy)
        )
      );
    }
  }
  return diagnostics;
}

function looseningDiagnostic(
  edit: string,
  silenced: SemanticDiagnostic[],
  filePath: string | undefined,
  causedBy: string[]
): SemanticDiagnostic {
  return { kind: "rule_loosening", edit, silenced, filePath, causedBy };
}

function isViolation(diagnostic: SemanticDiagnostic): boolean {
  return VIOLATION_KINDS.has(diagnostic.kind);
}

function aboutDeletedFile(diagnostic: SemanticDiagnostic, present: ReadonlySet<string>): boolean {
  return (
    (diagnostic.kind === "missing_shape_update" ||
      diagnostic.kind === "missing_bound_docs_change") &&
    !present.has(diagnostic.changedFile)
  );
}

/** Identity of a diagnostic apart from where its declarations were written. */
function diagnosticKey(diagnostic: SemanticDiagnostic): string {
  return JSON.stringify({ ...diagnostic, filePath: undefined, causedBy: undefined });
}

function findRuleEdits(
  head: readonly CheckModuleInput[],
  base: readonly CheckModuleInput[],
  repoRoot: string
): RuleEdit[] {
  const baseAuthored = base.filter(isAuthored);
  const headDeclarations = indexDeclarations(head.filter(isAuthored));
  const baseDeclarations = indexDeclarations(baseAuthored);
  const edits: RuleEdit[] = [];

  for (const input of baseAuthored) {
    const basePath = displayPath(input.filePath, repoRoot);
    for (const declaration of input.module.declarations) {
      if (isRuleDeclaration(declaration)) {
        const label = `${RULE_DECLARATION_KINDS[declaration.$type]} ${declaration.name}`;
        const current = headDeclarations.get(declarationKey(input, declaration));
        if (current === undefined) {
          edits.push({
            description: `removes ${label}`,
            filePath: basePath,
            causedBy: [`base ${basePath}: ${label}`],
            revert: (entries) => restoreDeclaration(entries, input, declaration, repoRoot)
          });
        } else if (!sameNode(current.declaration, declaration)) {
          const headPath = displayPath(current.input.filePath, repoRoot);
          edits.push({
            description: `edits ${label}`,
            filePath: headPath,
            causedBy: [`base ${basePath}: ${label}`, `${headPath}: ${label}`],
            revert: (entries) => replaceDeclaration(entries, current.input, declaration)
          });
        }
      } else if (isResourceDecl(declaration) || isComponentDecl(declaration)) {
        const headDeclaration =
          headDeclarations.get(declarationKey(input, declaration)) ??
          (isResourceDecl(declaration)
            ? renamedResource(input, declaration, baseAuthored, headDeclarations, baseDeclarations)
            : undefined);
        if (headDeclaration === undefined) {
          continue;
        }
        const edit = traitListEdit(declaration, headDeclaration, basePath, repoRoot);
        if (edit) {
          edits.push(edit);
        }
        if (isComponentDecl(declaration) && isComponentDecl(headDeclaration.declaration)) {
          edits.push(...functionTraitEdits(declaration, headDeclaration, basePath, repoRoot));
        }
      }
    }
  }
  return edits;
}

function traitListEdit(
  baseDeclaration: ResourceDecl | ComponentDecl,
  current: { input: CheckModuleInput; declaration: Declaration },
  basePath: string,
  repoRoot: string
): RuleEdit | undefined {
  const headDeclaration = current.declaration;
  if (!isResourceDecl(headDeclaration) && !isComponentDecl(headDeclaration)) {
    return undefined;
  }
  const missing = missingTraits(traitsOf(baseDeclaration), traitsOf(headDeclaration));
  if (missing.length === 0) {
    return undefined;
  }
  const kind = isResourceDecl(baseDeclaration) ? "resource" : "component";
  const headPath = displayPath(current.input.filePath, repoRoot);
  const renamed =
    headDeclaration.name === baseDeclaration.name ? "" : ` (renamed ${headDeclaration.name})`;
  return {
    description: `removes ${traitNoun(missing)} ${traitNames(missing)} from ${kind} ${baseDeclaration.name}${renamed}`,
    filePath: headPath,
    causedBy: [
      `base ${basePath}: ${kind} ${baseDeclaration.name} : ${traitNames(traitsOf(baseDeclaration))}`,
      `${headPath}: ${kind} ${headDeclaration.name}${traitSuffix(traitsOf(headDeclaration))}`
    ],
    revert: (entries) =>
      updateDeclaration(entries, current.input, headDeclaration, (declaration) =>
        isResourceDecl(declaration)
          ? { ...declaration, traits: [...declaration.traits, ...missing] }
          : isComponentDecl(declaration)
            ? { ...declaration, classifiers: [...declaration.classifiers, ...missing] }
            : declaration
      )
  };
}

function functionTraitEdits(
  baseComponent: ComponentDecl,
  current: { input: CheckModuleInput; declaration: Declaration },
  basePath: string,
  repoRoot: string
): RuleEdit[] {
  const headComponent = current.declaration;
  if (!isComponentDecl(headComponent)) {
    return [];
  }
  const headPath = displayPath(current.input.filePath, repoRoot);
  const edits: RuleEdit[] = [];
  for (const baseFunction of baseComponent.members.filter(isFunctionSummary)) {
    const headFunction = headComponent.members.find(
      (member) => isFunctionSummary(member) && member.name === baseFunction.name
    );
    if (!isFunctionSummary(headFunction)) {
      continue;
    }
    const baseTraits = baseFunction.shapeTraits?.traits ?? [];
    const missing = missingTraits(baseTraits, headFunction.shapeTraits?.traits ?? []);
    if (missing.length === 0 || baseFunction.shapeTraits === undefined) {
      continue;
    }
    const baseTraitList = baseFunction.shapeTraits;
    const target = `fn ${baseComponent.name}.${baseFunction.name}`;
    edits.push({
      description: `removes ${traitNoun(missing)} ${traitNames(missing)} from ${target}`,
      filePath: headPath,
      causedBy: [
        `base ${basePath}: ${target} : ${traitNames(baseTraits)}`,
        `${headPath}: ${target}${traitSuffix(headFunction.shapeTraits?.traits ?? [])}`
      ],
      revert: (entries) =>
        updateDeclaration(entries, current.input, baseComponent, (declaration) =>
          isComponentDecl(declaration)
            ? {
                ...declaration,
                members: declaration.members.map((member) =>
                  isFunctionSummary(member) && member.name === baseFunction.name
                    ? withTraits(member, baseTraitList, missing)
                    : member
                )
              }
            : declaration
        )
    });
  }
  return edits;
}

function withTraits(
  fn: FunctionSummary,
  baseTraitList: NonNullable<FunctionSummary["shapeTraits"]>,
  missing: TypeRef[]
): FunctionSummary {
  return {
    ...fn,
    shapeTraits: { ...baseTraitList, traits: [...(fn.shapeTraits?.traits ?? []), ...missing] }
  };
}

function compose(head: readonly CheckModuleInput[], reverted: RuleEdit[]): CheckModuleInput[] {
  const entries: Entry[] = head.map((input) => ({
    input,
    declarations: [...input.module.declarations]
  }));
  for (const edit of reverted) {
    edit.revert(entries);
  }
  return entries.map(({ input, declarations }) => ({
    ...input,
    module: { ...input.module, declarations }
  }));
}

/** Puts a declaration the change deleted back into its module. */
function restoreDeclaration(
  entries: Entry[],
  baseInput: CheckModuleInput,
  declaration: Declaration,
  repoRoot: string
): void {
  const moduleName = baseInput.module.name ?? "";
  const basePath = displayPath(baseInput.filePath, repoRoot);
  const sameModule = entries.filter(
    (entry) => isAuthored(entry.input) && (entry.input.module.name ?? "") === moduleName
  );
  const entry =
    sameModule.find((candidate) => displayPath(candidate.input.filePath, repoRoot) === basePath) ??
    sameModule[0];
  if (entry) {
    entry.declarations.push(declaration);
    return;
  }
  // The change deleted the whole module, so the base file comes back with only
  // its restored declarations.
  entries.push({ input: { ...baseInput, origin: "authored" }, declarations: [declaration] });
}

function replaceDeclaration(
  entries: Entry[],
  headInput: CheckModuleInput,
  declaration: Declaration
): void {
  updateDeclaration(entries, headInput, declaration, () => declaration);
}

function updateDeclaration(
  entries: Entry[],
  headInput: CheckModuleInput,
  like: Declaration,
  update: (declaration: Declaration) => Declaration
): void {
  const entry = entries.find((candidate) => candidate.input === headInput);
  const index =
    entry?.declarations.findIndex(
      (declaration) => declaration.$type === like.$type && nameOf(declaration) === nameOf(like)
    ) ?? -1;
  const current = entry?.declarations[index];
  if (entry && current) {
    entry.declarations[index] = update(current);
  }
}

type Located = { input: CheckModuleInput; declaration: Declaration };

/** Every declaration by module, kind, and name, with the input that holds it. */
function indexDeclarations(inputs: readonly CheckModuleInput[]): Map<string, Located> {
  const index = new Map<string, Located>();
  for (const input of inputs) {
    for (const declaration of input.module.declarations) {
      index.set(declarationKey(input, declaration), { input, declaration });
    }
  }
  return index;
}

/**
 * The head resource that a base resource the change removed was renamed to, when
 * exactly one component that owned it at the base now owns exactly one resource
 * that did not exist at the base. Renaming a resource would otherwise drop its
 * traits without a trait edit to restore.
 */
function renamedResource(
  baseInput: CheckModuleInput,
  resource: ResourceDecl,
  baseAuthored: readonly CheckModuleInput[],
  headDeclarations: ReadonlyMap<string, Located>,
  baseDeclarations: ReadonlyMap<string, Located>
): Located | undefined {
  const moduleName = baseInput.module.name ?? "";
  const candidates = new Map<string, Located>();
  for (const input of baseAuthored.filter((item) => (item.module.name ?? "") === moduleName)) {
    for (const owner of input.module.declarations.filter(isComponentDecl)) {
      if (!ownedNames(owner).includes(resource.name)) {
        continue;
      }
      const headOwner = headDeclarations.get(declarationKey(input, owner))?.declaration;
      if (!headOwner || !isComponentDecl(headOwner)) {
        continue;
      }
      for (const name of ownedNames(headOwner)) {
        const key = JSON.stringify([moduleName, "ResourceDecl", name]);
        const added = headDeclarations.get(key);
        if (added && !baseDeclarations.has(key)) {
          candidates.set(key, added);
        }
      }
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

function ownedNames(component: ComponentDecl): string[] {
  return component.members
    .filter(isOwnsDecl)
    .map((owns) => owns.resource.name.split("::").at(-1) ?? owns.resource.name);
}

function isRuleDeclaration(declaration: Declaration): declaration is RuleDeclaration {
  return (
    isBindingDecl(declaration) ||
    isImplementationDecl(declaration) ||
    isMemoryDecl(declaration) ||
    isPolicyDecl(declaration) ||
    isRationaleDecl(declaration) ||
    isRoleDecl(declaration) ||
    isRuleDecl(declaration) ||
    isTraitDecl(declaration)
  );
}

function isAuthored(input: CheckModuleInput): boolean {
  return input.origin !== "generated_ast";
}

function declarationKey(input: CheckModuleInput, declaration: Declaration): string {
  return JSON.stringify([input.module.name ?? "", declaration.$type, nameOf(declaration)]);
}

function nameOf(declaration: Declaration): string | undefined {
  return "name" in declaration ? declaration.name : undefined;
}

function traitsOf(declaration: ResourceDecl | ComponentDecl): TypeRef[] {
  return isResourceDecl(declaration) ? declaration.traits : declaration.classifiers;
}

function missingTraits(baseTraits: readonly TypeRef[], headTraits: readonly TypeRef[]): TypeRef[] {
  const present = new Set(headTraits.map((trait) => trait.name));
  return baseTraits.filter((trait) => !present.has(trait.name));
}

function traitNoun(traits: readonly TypeRef[]): string {
  return traits.length === 1 ? "trait" : "traits";
}

function traitNames(traits: readonly TypeRef[]): string {
  return traits.map((trait) => trait.name).join(", ");
}

function traitSuffix(traits: readonly TypeRef[]): string {
  return traits.length === 0 ? "" : ` : ${traitNames(traits)}`;
}

function displayPath(filePath: string | undefined, repoRoot: string): string {
  return filePath === undefined ? "<memory>" : normalizeRepoPath(filePath, repoRoot);
}

/** Structural equality of two AST nodes, ignoring layout, comments, and positions. */
function sameNode(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, entry]) => (key === "$type" || !key.startsWith("$")) && entry !== undefined)
        .map(([key, entry]): [string, unknown] => [key, canonical(entry)])
        .toSorted(([left], [right]) => compareCodepointStrings(left, right))
    );
  }
  return value;
}
