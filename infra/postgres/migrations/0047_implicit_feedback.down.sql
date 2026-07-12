BEGIN;
DROP TABLE IF EXISTS implicit_feedback;
DELETE FROM schema_migration WHERE version='0047_implicit_feedback';
COMMIT;
