BEGIN;
DROP TABLE IF EXISTS model_invocation;
DROP TABLE IF EXISTS stage_model_route;
DROP TABLE IF EXISTS model_provider;
DELETE FROM schema_migration WHERE version = '0014_model_runtime';
COMMIT;
