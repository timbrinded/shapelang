// An append-only log with redact-based retention. Entries live in fixed-size
// segments; ids are assigned sequentially and never reused or removed.
export const SEGMENT_SIZE = 8;

export interface Entry {
  readonly id: number;
  readonly payload: string | null;
}

export interface Log {
  readonly segments: readonly (readonly Entry[])[];
  readonly nextId: number;
}

export function empty(): Log {
  return { segments: [], nextId: 0 };
}

export function append(log: Log, payload: string): Log {
  const segments = log.segments.map((segment) => segment.slice());
  let last = segments[segments.length - 1];
  if (last === undefined || last.length === SEGMENT_SIZE) {
    last = [];
    segments.push(last);
  }
  last.push({ id: log.nextId, payload });
  return { segments, nextId: log.nextId + 1 };
}

export function entries(log: Log): Entry[] {
  return log.segments.flat();
}

export function count(log: Log): number {
  return log.segments.reduce((total, segment) => total + segment.length, 0);
}

export function ids(log: Log): number[] {
  return entries(log).map((entry) => entry.id);
}

export function find(log: Log, id: number): Entry | undefined {
  const segment = log.segments[Math.floor(id / SEGMENT_SIZE)];
  return segment?.[id % SEGMENT_SIZE];
}

export function redact(log: Log, id: number): Log {
  const segmentIndex = Math.floor(id / SEGMENT_SIZE);
  const offset = id % SEGMENT_SIZE;
  const segments = log.segments.map((segment, index) =>
    index === segmentIndex
      ? segment.map((entry, i) => (i === offset ? { id: entry.id, payload: null } : entry))
      : segment
  );
  return { segments, nextId: log.nextId };
}

// Retention never deletes: it redacts every entry except the newest keepLast.
export function retain(log: Log, keepLast: number): Log {
  const cutoff = count(log) - keepLast;
  let position = 0;
  const segments = log.segments.map((segment) =>
    segment.map((entry) => {
      const kept = position < cutoff ? { id: entry.id, payload: null } : entry;
      position++;
      return kept;
    })
  );
  return { segments, nextId: log.nextId };
}
