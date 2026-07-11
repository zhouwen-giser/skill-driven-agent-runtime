BEGIN;
ALTER TABLE model_invocation DROP CONSTRAINT IF EXISTS model_invocation_prompt_fk;
ALTER TABLE model_invocation DROP COLUMN IF EXISTS prompt_version;
ALTER TABLE model_invocation DROP COLUMN IF EXISTS prompt_id;
DROP TABLE IF EXISTS prompt_version;
DROP TABLE IF EXISTS prompt;
DELETE FROM schema_migration WHERE version='0015_prompt_runtime';
COMMIT;
