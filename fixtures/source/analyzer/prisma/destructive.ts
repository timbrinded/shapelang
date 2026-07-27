export async function purgeAuditEvents(prisma: {
  auditEvent: {
    delete(args: object): Promise<unknown>;
    deleteMany(args: object): Promise<unknown>;
  };
  $executeRawUnsafe(query: string): Promise<unknown>;
}) {
  await prisma.auditEvent.delete({ where: { id: 1 } });
  await prisma.auditEvent
    .deleteMany({ where: { expired: true } });
  await prisma.$executeRawUnsafe(`
    TRUNCATE
    TABLE audit_event_staging
  `);
  await prisma.$executeRawUnsafe("DROP TABLE audit_event_archive");
}
