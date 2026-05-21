import type { TargetKind } from "./language/generated/ast.ts";

export type ContextKind = "rationale" | "memory";

export type PreludeFinalForbid = {
  effect: string;
  target?: string;
};

export type PreludeTraitDefinition = {
  name: string;
  typeParams: string[];
  finalForbids: PreludeFinalForbid[];
};

export type PreludeContextRequirement = {
  trait: string;
  targetKind: TargetKind;
  contextType: string;
  satisfiedBy: ContextKind[];
  requiresDescription?: boolean;
};

export type RelationCycleTraversal = "none" | "directed_pairs" | "ordered_path";

export type PreludeRelationKindRule = {
  name: string;
  arity: "binary" | "ordered" | "any";
  cycleTraversal: RelationCycleTraversal;
};

export const PRELUDE_TRAITS: PreludeTraitDefinition[] = [
  {
    name: "AppendOnly",
    typeParams: ["T"],
    finalForbids: [
      { effect: "HardDelete", target: "T" },
      { effect: "Truncate", target: "T" },
      { effect: "DropStorage", target: "T" }
    ]
  }
];

export const PRELUDE_CONTEXT_REQUIREMENTS: PreludeContextRequirement[] = [
  {
    trait: "PreserveInline",
    targetKind: "fn",
    contextType: "InlineRationale",
    satisfiedBy: ["rationale"]
  },
  {
    trait: "RequiresDescription",
    targetKind: "fn",
    contextType: "DescriptionRationale",
    satisfiedBy: ["rationale"],
    requiresDescription: true
  },
  {
    trait: "ProtectedCheckOrder",
    targetKind: "fn",
    contextType: "CheckOrderRationale",
    satisfiedBy: ["rationale", "memory"]
  },
  {
    trait: "RefactorSensitive",
    targetKind: "fn",
    contextType: "RefactorConstraint",
    satisfiedBy: ["memory"]
  },
  {
    trait: "NonIdiomatic",
    targetKind: "fn",
    contextType: "DesignRationale",
    satisfiedBy: ["rationale", "memory"]
  },
  {
    trait: "TestOnly",
    targetKind: "fn",
    contextType: "TestOnlyPurpose",
    satisfiedBy: ["rationale"]
  }
];

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

export const PRELUDE_TRAIT_NAMES = [
  ...PRELUDE_TRAITS.map((trait) => trait.name),
  ...PRELUDE_RESOURCE_TRAIT_NAMES,
  ...PRELUDE_CONTEXT_REQUIREMENTS.map((rule) => rule.trait)
];

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
  { name: "calls", arity: "binary", cycleTraversal: "directed_pairs" },
  { name: "callbacks", arity: "binary", cycleTraversal: "directed_pairs" },
  { name: "provides", arity: "binary", cycleTraversal: "directed_pairs" },
  { name: "coordinated_call", arity: "ordered", cycleTraversal: "ordered_path" }
];

export const PRELUDE_RELATION_KIND_NAMES = PRELUDE_RELATION_KIND_RULES.map((rule) => rule.name);

export const PRELUDE_COMPLETION_SYMBOLS = [
  ...PRELUDE_EFFECT_NAMES,
  ...PRELUDE_TRAIT_NAMES,
  ...PRELUDE_COMPONENT_TRAIT_NAMES,
  ...PRELUDE_RELATION_KIND_NAMES
];
