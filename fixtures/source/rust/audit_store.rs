pub struct AuditEvent {
    pub id: String,
}

pub struct AuditRepo;

impl AuditRepo {
    pub fn insert(&self, _event: AuditEvent) {}
}

pub struct AuditStore {
    repo: AuditRepo,
}

impl AuditStore {
    pub fn append_event(&self, event: AuditEvent) {
        self.repo.insert(event);
    }
}
