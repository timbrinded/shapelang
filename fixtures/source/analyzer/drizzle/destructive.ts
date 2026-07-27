export async function purgeAuditEvents(
  db: {
    delete(table: object): Promise<unknown>;
    execute(query: string): Promise<unknown>;
  },
  tx: { delete(table: object): Promise<unknown> },
  auditEvents: object,
  auditArchive: object
) {
  await db.delete(auditEvents);
  await tx
    .delete(auditArchive);
  await db.execute("TRUNCATE TABLE audit_event_staging");
  await db.execute("DROP TABLE audit_event_archive");
}
