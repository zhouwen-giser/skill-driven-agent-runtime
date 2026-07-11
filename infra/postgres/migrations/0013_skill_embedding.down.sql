BEGIN;
DROP TABLE IF EXISTS skill_embedding;
DELETE FROM schema_migration WHERE version = '0013_skill_embedding';
COMMIT;
