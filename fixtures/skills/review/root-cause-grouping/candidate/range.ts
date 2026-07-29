export function normalizeRange(start: number, end: number): { start: number; end: number } {
  return { start, end: end - 1 };
}
