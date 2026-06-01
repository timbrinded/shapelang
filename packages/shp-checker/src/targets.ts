import type { ShapeTarget } from "./checker/model.ts";

export function targetsEqual(left: ShapeTarget, right: ShapeTarget): boolean {
  return left.kind === right.kind && left.name === right.name;
}
