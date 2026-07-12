BEGIN;
DROP TABLE IF EXISTS evolution_experience;
DELETE FROM schema_migration WHERE version='0038_evolution_experience';
COMMIT;
