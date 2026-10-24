// Inclusive integer ranges over U32 values: normalize and merge.
export interface Range {
  start: number;
  end: number;
}

export function normalize(range: Range): Range {
  if (range.start > range.end) {
    return { start: range.end, end: range.start };
  }
  return { start: range.start, end: range.end };
}

// Merges overlapping and adjacent ranges into sorted, disjoint, non-adjacent ranges.
export function merge(ranges: readonly Range[]): Range[] {
  const sorted = ranges.map(normalize).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Range[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const range = sorted[i]!;
    const last = out[out.length - 1];
    if (last !== undefined && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      out.push({ start: range.start, end: range.end });
    }
  }
  return out;
}

export function contains(ranges: readonly Range[], value: number): boolean {
  return ranges.some((range) => range.start <= value && value <= range.end);
}
