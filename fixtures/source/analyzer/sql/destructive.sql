DELETE FROM audit_events WHERE created_at < CURRENT_TIMESTAMP;
TRUNCATE TABLE audit_event_staging;
DROP TABLE audit_event_archive;
