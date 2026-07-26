DELETE
/* retention applies to the selected table */
FROM audit_events
WHERE created_at < CURRENT_TIMESTAMP;
TRUNCATE
-- the optional TABLE keyword may start on the next line
TABLE audit_event_staging;
DROP
/* schema operation split across tokens */
TABLE audit_event_archive;
