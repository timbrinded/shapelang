import type { Revision } from "./history.js";

export function latestRevision(revisions: readonly Revision[]): Revision | undefined {
  return revisions.at(-1);
}
