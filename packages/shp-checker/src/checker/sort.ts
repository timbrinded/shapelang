import { compareCodepointStrings } from "../shape-strings.ts";

export type KindName = {
  kind: string;
  name: string;
};

export function kindNameKey(value: KindName): string {
  return `${value.kind}:${value.name}`;
}

export function compareKindName(left: KindName, right: KindName): number {
  return compareCodepointStrings(kindNameKey(left), kindNameKey(right));
}
