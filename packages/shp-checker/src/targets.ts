import type { ShapeTarget } from "./shape-domain.ts";

export function targetsEqual(left: ShapeTarget, right: ShapeTarget): boolean {
  return left.kind === right.kind && left.name === right.name;
}
