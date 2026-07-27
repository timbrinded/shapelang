export async function retainAuditEvents(db: {
  deleteFrom(table: string): { execute(): Promise<unknown> };
  selectFrom(table: string): { execute(): Promise<unknown> };
  insertInto(table: string): { execute(): Promise<unknown> };
  updateTable(table: string): { execute(): Promise<unknown> };
  schema: { createTable(table: string): { execute(): Promise<unknown> } };
}) {
  await db.selectFrom("audit_events").execute();
  await db.insertInto("audit_events").execute();
  await db.updateTable("audit_events").execute();
  await db.schema.createTable("audit_event_archive").execute();
  const documentationExample = `
    DELETE FROM audit_events;
    DROP TABLE audit_event_archive;
  `;
  void documentationExample;
}
