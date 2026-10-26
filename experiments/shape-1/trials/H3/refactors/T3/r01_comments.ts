// Audit log: append-only, with a retention purge that redacts payloads.
// Ids are positions. Every operation returns a new log value.

export type Entry = {
  readonly id: number;
  readonly timestamp: number;
  readonly actor: string;
  readonly payload: string;
};

/** Caller-supplied fields of a new entry. */
export type NewEntry = {
  readonly timestamp: number;
  readonly actor: string;
  readonly payload: string;
};

export type AuditLog = {
  /** oldest first, entries[i].id === i */
  readonly entries: readonly Entry[];
};

export function emptyLog(): AuditLog {
  return { entries: [] };
}

/** id = count before the append */
export function append(log: AuditLog, entry: NewEntry): AuditLog {
  const stored: Entry = {
    id: log.entries.length,
    timestamp: entry.timestamp,
    actor: entry.actor,
    payload: entry.payload,
  };
  return { entries: [...log.entries, stored] };
}

/** Positional lookup; undefined outside [0, count). */
export function get(log: AuditLog, id: number): Entry | undefined {
  if (!Number.isInteger(id) || id < 0 || id >= log.entries.length) {
    return undefined;
  }
  return log.entries[id];
}

export function list(log: AuditLog): Entry[] {
  return [...log.entries];
}

export const REDACTED = "[redacted]";

/** Expired (timestamp + retention <= now) payloads become REDACTED; nothing is removed. */
export function purge(log: AuditLog, now: number, retention: number): AuditLog {
  return {
    entries: log.entries.map((e) =>
      e.timestamp + retention <= now ? { ...e, payload: REDACTED } : e,
    ),
  };
}
