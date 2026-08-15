BEGIN;

-- The rows repaired here are baseline data owned by 0153. Rolling this repair
-- back must not remove Prompt authority that 0153 remains responsible for.
DELETE FROM schema_migration
WHERE version = '0163_v14_initial_model_prompt_seed_repair';

COMMIT;
