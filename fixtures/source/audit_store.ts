export interface AuditEvent {
  id: string;
}

export class AuditStore {
  repo: { insert: (event: AuditEvent) => unknown };

  constructor(repo: { insert: (event: AuditEvent) => unknown }) {
    this.repo = repo;
  }

  appendEvent(event: AuditEvent) {
    return this.repo.insert(event);
  }
}
