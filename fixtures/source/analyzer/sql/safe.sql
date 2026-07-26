-- DELETE FROM audit_events;
/* TRUNCATE TABLE audit_event_staging;
   DROP TABLE audit_event_archive; */
SELECT 'DELETE FROM audit_events' AS example_text;
SELECT "DROP TABLE audit_event_archive" AS quoted_text;
SELECT `TRUNCATE TABLE audit_event_staging` AS quoted_identifier;
SELECT * FROM audit_events;
INSERT INTO audit_events (id) VALUES (1);
UPDATE audit_events SET reviewed = TRUE WHERE id = 1;
