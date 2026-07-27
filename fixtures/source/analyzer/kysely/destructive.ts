export async function purgeAuditEvents(db: {
  deleteFrom(table: string): { execute(): Promise<unknown> };
  schema: { dropTable(table: string): { execute(): Promise<unknown> } };
  executeQuery(query: string): Promise<unknown>;
}) {
  await db
    .deleteFrom("audit_events").execute();
  await db.schema.dropTable("audit_event_archive").execute();
  await db.executeQuery("TRUNCATE TABLE audit_event_staging");
}
