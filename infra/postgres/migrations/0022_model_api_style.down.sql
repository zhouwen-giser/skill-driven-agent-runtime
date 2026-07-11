BEGIN;
ALTER TABLE model_provider DROP COLUMN IF EXISTS api_style;
DELETE FROM schema_migration WHERE version='0022_model_api_style';
COMMIT;
