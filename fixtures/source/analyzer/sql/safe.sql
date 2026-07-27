SELECT * FROM audit_events;
INSERT INTO audit_events (id) VALUES (1);
UPDATE audit_events SET reviewed = TRUE WHERE id = 1;
