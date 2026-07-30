import { getLabel } from "./catalog";

export function presentRecord(recordId: string): string {
  const label = getLabel(recordId);
  return label === null ? "not found" : label;
}
