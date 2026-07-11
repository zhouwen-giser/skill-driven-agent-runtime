BEGIN;
DROP TABLE IF EXISTS skill_version;
DROP TABLE IF EXISTS skill;
DELETE FROM schema_migration WHERE version = '0007_skill_registry';
COMMIT;
