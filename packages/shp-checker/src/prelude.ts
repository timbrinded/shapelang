import type { TargetKind } from "./language/generated/ast.ts";
import type { TraitContextRequirement, TraitInfo } from "./checker/model.ts";
import { provenance } from "./checker/provenance.ts";

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

/**
 * Kind registry: every relation kind declares whether its members are
 * traversed as an ordered path, as directed pairs, or not at all for cycle
 * checks. This is the single source of truth for hypercycle traversal.
 */
export const PRELUDE_RELATION_KINDS = new Map(
  PRELUDE_RELATION_KIND_RULES.map(({ name, ...rule }) => [name, rule])
);

export function isPreludeTrait(trait: TraitInfo | undefined): boolean {
  return (
    trait !== undefined &&
    (trait.provenance.filePath === undefined || trait.provenance.filePath === "standard prelude")
  );
}

function preludeTraitInfo(trait: PreludeTraitDefinition): TraitInfo {
  return {
    name: trait.name,
    typeParams: [...trait.typeParams],
    finalForbids: trait.finalForbids.map((forbid) => {
      const target = forbid.target ? `<${forbid.target}>` : "";
      return {
        effect: forbid.effect,
        target: forbid.target,
        targetBinding:
          forbid.target === undefined
            ? "omitted"
            : trait.typeParams.includes(forbid.target)
              ? "generic"
              : "concrete",
        final: true,
        provenance: provenance(
          "standard prelude",
          `trait ${trait.name} forbids final ${forbid.effect}${target}`
        )
      };
    }),
    contextRequirements: [],
    provenance: provenance("standard prelude", `trait ${trait.name}`)
  };
}

/**
 * The initial trait table: prelude `finalForbids` traits plus the prelude
 * context-obligation traits (PreserveInline, RefactorSensitive, ...), seeded
 * with their requirements straight from PRELUDE_CONTEXT_REQUIREMENTS. Seeding
 * built-in obligations through the same trait model that user traits use means
 * `requirementsForTarget` has a single source and same-name user traits shadow
 * built-ins by replacing the entry.
 */
export function preludeTraitSeed(): Map<string, TraitInfo> {
  const traits = new Map<string, TraitInfo>(
    PRELUDE_TRAITS.map((trait) => [trait.name, preludeTraitInfo(trait)])
  );
  for (const rule of PRELUDE_CONTEXT_REQUIREMENTS) {
    const existing = traits.get(rule.trait);
    const requirement: TraitContextRequirement = {
      targetKind: rule.targetKind,
      contextType: rule.contextType,
      satisfiedBy: rule.satisfiedBy,
      requiresDescription: rule.requiresDescription === true,
      provenance: provenance("standard prelude", `${rule.trait} requires ${rule.contextType}`)
    };
    if (existing) {
      existing.contextRequirements.push(requirement);
    } else {
      traits.set(rule.trait, {
        name: rule.trait,
        typeParams: [],
        finalForbids: [],
        contextRequirements: [requirement],
        provenance: provenance("standard prelude", `trait ${rule.trait}`)
      });
    }
  }
  return traits;
}
