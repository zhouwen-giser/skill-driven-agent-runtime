BEGIN;
DROP TABLE IF EXISTS evolution_trigger;
DROP TABLE IF EXISTS evolution_policy;
DELETE FROM schema_migration WHERE version='0039_evolution_policy';
COMMIT;
