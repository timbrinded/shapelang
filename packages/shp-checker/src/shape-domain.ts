import type { TargetKind } from "./language/generated/ast.ts";

export type Provenance = {
  filePath?: string;
  label: string;
};

export type ShapeTarget = {
  kind: TargetKind;
  name: string;
};

export type ChangeTrigger =
  | { kind: "target_changed"; target: ShapeTarget; provenance: Provenance }
  | { kind: "shape_trait_removed"; target: ShapeTarget; trait: string; provenance: Provenance }
  | { kind: "description_removed"; target: ShapeTarget; provenance: Provenance }
  | { kind: "transform_applied"; target: ShapeTarget; label: string; provenance: Provenance };
