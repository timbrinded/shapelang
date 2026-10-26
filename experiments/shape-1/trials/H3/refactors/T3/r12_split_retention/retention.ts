// Retention policy for audit entries. The boundary is inclusive: an entry
// whose timestamp plus the retention period equals `now` has expired.

/** Whether an entry stamped `timestamp` has outlived `retention` at `now`. */
export function hasExpired(timestamp: number, retention: number, now: number): boolean {
  return timestamp + retention <= now;
}

/** The payload a purged entry shows in place of its original one. */
export const PLACEHOLDER = "[redacted]";
