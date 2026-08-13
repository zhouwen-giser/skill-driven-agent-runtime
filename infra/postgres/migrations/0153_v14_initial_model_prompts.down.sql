BEGIN;

-- These immutable baseline Prompt versions may already be referenced by model
-- invocation and evaluation evidence. The rollback deliberately retains them;
-- deleting their authority would destroy or invalidate audit lineage.
DELETE FROM schema_migration
WHERE version = '0153_v14_initial_model_prompts';

COMMIT;
