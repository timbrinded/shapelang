/**
 * Append-only audit log.
 *
 * Every entry gets a sequential id: the first entry appended to a log has
 * id 0, the next id 1, and so on, so an entry's id is also its position in
 * list(log). Logs are values: every operation returns a new log and leaves
 * the log it was given unchanged.
 */

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

/** The one place a log value is built. */
function withEntries(entries: readonly Entry[]): AuditLog {
  return { entries };
}

/** The log with no entries. */
export function emptyLog(): AuditLog {
  return withEntries([]);
}

/** Appends one entry; its id is the number of entries before it. */
export function append(log: AuditLog, entry: NewEntry): AuditLog {
  const stored: Entry = {
    id: log.entries.length,
    timestamp: entry.timestamp,
    actor: entry.actor,
    payload: entry.payload
  };
  return withEntries([...log.entries, stored]);
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
  return [...log.entries];
}

/** The payload a purged entry shows in place of its original one. */
export const REDACTED = "[redacted]";

/** Retention purge: redacts the payload of every entry with timestamp + retention <= now. */
export function purge(log: AuditLog, now: number, retention: number): AuditLog {
  return withEntries(
    log.entries.map((e) => (e.timestamp + retention <= now ? { ...e, payload: REDACTED } : e))
  );
}
