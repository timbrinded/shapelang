export async function retainAuditEvents(prisma: {
  auditEvent: {
    findMany(): Promise<unknown>;
    create(args: object): Promise<unknown>;
    updateMany(args: object): Promise<unknown>;
  };
  $queryRawUnsafe(query: string): Promise<unknown>;
}) {
  await prisma.auditEvent.findMany();
  await prisma.auditEvent.create({ data: { id: 1 } });
  await prisma.auditEvent.updateMany({ data: { reviewed: true } });
  await prisma.$queryRawUnsafe("SELECT * FROM audit_events");
  const documentationExample = "TRUNCATE TABLE audit_event_staging";
  // DROP TABLE audit_event_archive;
  void documentationExample;
}
