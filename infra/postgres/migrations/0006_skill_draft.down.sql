BEGIN;
DROP TABLE IF EXISTS skill_draft;
DELETE FROM schema_migration WHERE version = '0006_skill_draft';
COMMIT;
