export async function purgeOldEvents(db: { deleteFrom: (table: string) => unknown }) {
  return db.deleteFrom("audit_events");
}
