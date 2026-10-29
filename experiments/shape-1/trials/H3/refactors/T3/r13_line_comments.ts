/**
 * Append-only audit log.
 *
 * Every entry gets a sequential id: the first entry appended to a log has
 * id 0, the next id 1, and so on, so an entry's id is also its position in
 * list(log). Logs are values: every operation returns a new log and leaves
 * the log it was given unchanged.
 *
 * Timestamps, `now` and retention periods are non-negative integers in the
 * same unit (the callers use seconds).
 */

// Entries are immutable; purge builds new ones.
export type Entry = {
  readonly id: number;
  readonly timestamp: number;
  readonly actor: string;
  readonly payload: string;
};

/** What a caller supplies to append; the log assigns the id. */
export type NewEntry = {
  readonly timestamp: number;
  readonly actor: string;
  readonly payload: string;
};

export type AuditLog = {
  /** Entries, oldest first; entries[i].id === i. */
  readonly entries: readonly Entry[];
};

/** The log with no entries. */
export function emptyLog(): AuditLog {
  return { entries: [] };
}

/** Appends one entry; its id is the number of entries before it. */
export function append(log: AuditLog, entry: NewEntry): AuditLog {
  // the id is the entry's position
  const stored: Entry = {
    id: log.entries.length,
    timestamp: entry.timestamp,
    actor: entry.actor,
    payload: entry.payload
  };
  return { entries: [...log.entries, stored] };
}

/** The entry with the given id, or undefined when there is none. */
export function get(log: AuditLog, id: number): Entry | undefined {
  if (!Number.isInteger(id) || id < 0 || id >= log.entries.length) {
    return undefined;
  }
  return log.entries[id];
}

/** Every entry, oldest first. */
export function list(log: AuditLog): Entry[] {
  return [...log.entries]; // a copy: callers cannot change the log
}

/** The payload a purged entry shows in place of its original one. */
export const REDACTED = "[redacted]";

/**
 * Retention purge: redacts, in place, the payload of every entry with
 * timestamp + retention <= now. Every entry stays, with its id, timestamp
 * and actor, so the log remains append-only.
 */
export function purge(log: AuditLog, now: number, retention: number): AuditLog {
  // inclusive boundary: timestamp + retention == now is expired
  return {
    entries: log.entries.map((e) =>
      e.timestamp + retention <= now ? { ...e, payload: REDACTED } : e
    )
  };
}
