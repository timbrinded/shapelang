export async function retainAuditEvents(
  db: {
    select(): Promise<unknown>;
    insert(table: object): Promise<unknown>;
    update(table: object): Promise<unknown>;
  },
  cache: Map<string, string>,
  router: { delete(path: string): void },
  auditEvents: object
) {
  await db.select();
  await db.insert(auditEvents);
  await db.update(auditEvents);
  cache.delete("audit-events");
  router.delete("/audit-events/:id");
}
