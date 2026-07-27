import type { TargetKind } from "./language/generated/ast.ts";

export type ContextKind = "rationale" | "memory";

export type PreludeFinalForbid = {
  effect: string;
  target?: string;
};

export type TraitTypeParameter = {
  name: string;
  bound?: string;
};

export type PreludeTraitDefinition = {
  name: string;
  typeParams: TraitTypeParameter[];
  finalForbids: PreludeFinalForbid[];
};

export type PreludeContextRequirement = {
  trait: string;
  targetKind: TargetKind;
  contextType: string;
  satisfiedBy: ContextKind[];
  requiresDescription?: boolean;
};

/**
 * A built-in context obligation as compact rule data: one entry per
 * trait/context pair, listing the target kinds it applies to. This is the
 * single source of truth; consumers that need one row per (trait, targetKind)
 * read the flattened `PRELUDE_CONTEXT_REQUIREMENTS` below.
 */
export type PreludeContextRule = {
  trait: string;
  contextType: string;
  satisfiedBy: ContextKind[];
  targetKinds: TargetKind[];
  requiresDescription?: boolean;
};

export type RelationTraversal = "none" | "directed_pairs" | "ordered_path";

export type PreludeRelationKindRule = {
  name: string;
  arity: "binary" | "ordered" | "any";
  traversal: RelationTraversal;
};

export const PRELUDE_TRAITS: PreludeTraitDefinition[] = [
  {
    name: "AppendOnly",
    typeParams: [{ name: "T", bound: "Resource" }],
    finalForbids: [
      { effect: "HardDelete", target: "T" },
      { effect: "Truncate", target: "T" },
      { effect: "DropStorage", target: "T" }
    ]
  }
];

export const PRELUDE_CONTEXT_RULES: PreludeContextRule[] = [
  {
    trait: "PreserveInline",
    contextType: "InlineRationale",
    satisfiedBy: ["rationale"],
    targetKinds: ["fn"]
  },
  {
    trait: "RequiresDescription",
    contextType: "DescriptionRationale",
    satisfiedBy: ["rationale"],
    targetKinds: ["fn"],
    requiresDescription: true
  },
  {
    trait: "ProtectedCheckOrder",
    contextType: "CheckOrderRationale",
    satisfiedBy: ["rationale", "memory"],
    targetKinds: ["fn"]
  },
  {
    trait: "RefactorSensitive",
    contextType: "RefactorConstraint",
    satisfiedBy: ["memory"],
    targetKinds: ["fn", "component", "resource"]
  },
  {
    trait: "NonIdiomatic",
    contextType: "DesignRationale",
    satisfiedBy: ["rationale", "memory"],
    targetKinds: ["fn", "component", "resource"]
  },
  // TestOnly applies to functions and components, but not resources.
  {
    trait: "TestOnly",
    contextType: "TestOnlyPurpose",
    satisfiedBy: ["rationale"],
    targetKinds: ["fn", "component"]
  }
];

export const PRELUDE_CONTEXT_TYPE_NAMES = [
  ...new Set(PRELUDE_CONTEXT_RULES.map((rule) => rule.contextType))
];

// Row-shaped view (one entry per trait/targetKind) for consumers that match on
// a concrete target kind. Flattened target-kind-major to keep a stable order.
const PRELUDE_TARGET_ORDER: TargetKind[] = ["fn", "component", "resource"];
export const PRELUDE_CONTEXT_REQUIREMENTS: PreludeContextRequirement[] =
  PRELUDE_TARGET_ORDER.flatMap((targetKind) =>
    PRELUDE_CONTEXT_RULES.filter((rule) => rule.targetKinds.includes(targetKind)).map((rule) => ({
      trait: rule.trait,
      targetKind,
      contextType: rule.contextType,
      satisfiedBy: rule.satisfiedBy,
      ...(rule.requiresDescription ? { requiresDescription: true } : {})
    }))
  );

const PRELUDE_RESOURCE_TRAIT_NAMES = [
  "Persistent",
  "Ephemeral",
  "PII",
  "Secret",
  "Public",
  "External",
  "Internal"
];

const PRELUDE_COMPONENT_TRAIT_NAMES = ["StorageAdapter", "DataPlane", "ControlPlane"];

/**
 * Names of the standard shape traits that derive context obligations
 * (PreserveInline, RefactorSensitive, ...). Used to tell a guard's protected
 * shape trait apart from a free-form protected-property label.
 */
export const PRELUDE_SHAPE_TRAIT_NAMES = [
  ...new Set(PRELUDE_CONTEXT_REQUIREMENTS.map((rule) => rule.trait))
];

export const PRELUDE_TRAIT_NAMES = [
  ...PRELUDE_TRAITS.map((trait) => trait.name),
  ...PRELUDE_RESOURCE_TRAIT_NAMES,
  ...PRELUDE_SHAPE_TRAIT_NAMES
];

/**
 * Lookup set of prelude trait names. Used by name resolution and lowering to
 * recognize a built-in trait without consulting the declared trait table.
 */
export const KNOWN_PRELUDE_TRAITS = new Set(PRELUDE_TRAIT_NAMES);

export const PRELUDE_EFFECT_NAMES = [
  "Read",
  "Append",
  "Update",
  "Redact",
  "LogicalDelete",
  "HardDelete",
  "Truncate",
  "DropStorage",
  "Export",
  "Import"
];

export const PRELUDE_FINAL_FORBID_EFFECT_NAMES = [
  ...new Set(PRELUDE_TRAITS.flatMap((trait) => trait.finalForbids.map((forbid) => forbid.effect)))
];

export const PRELUDE_RELATION_KIND_RULES: PreludeRelationKindRule[] = [
  { name: "calls", arity: "binary", traversal: "directed_pairs" },
  { name: "callbacks", arity: "binary", traversal: "directed_pairs" },
  { name: "provides", arity: "binary", traversal: "directed_pairs" },
  { name: "coordinated_call", arity: "ordered", traversal: "ordered_path" }
];

export const PRELUDE_RELATION_KIND_NAMES = PRELUDE_RELATION_KIND_RULES.map((rule) => rule.name);

export const PRELUDE_COMPLETION_SYMBOLS = [
  ...PRELUDE_EFFECT_NAMES,
  ...PRELUDE_TRAIT_NAMES,
  ...PRELUDE_COMPONENT_TRAIT_NAMES,
  ...PRELUDE_CONTEXT_TYPE_NAMES,
  ...PRELUDE_RELATION_KIND_NAMES
];

/**
 * Kind registry: every relation kind declares whether its members are
 * traversed as an ordered path, as directed pairs, or not at all for graph
 * rules. This is the single source of truth for directed relation traversal.
 */
export const PRELUDE_RELATION_KINDS = new Map(
  PRELUDE_RELATION_KIND_RULES.map(({ name, ...rule }) => [name, rule])
);
