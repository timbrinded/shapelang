import { normalizeRange } from "./range";

export function inclusiveSize(start: number, end: number): number {
  const range = normalizeRange(start, end);
  return range.end - range.start + 1;
}

export function includesValue(start: number, end: number, value: number): boolean {
  const range = normalizeRange(start, end);
  return value >= range.start && value <= range.end;
}
