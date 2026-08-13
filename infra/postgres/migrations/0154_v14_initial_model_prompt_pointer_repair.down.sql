BEGIN;

-- Retain the repaired current pointers and immutable Prompt lineage. Reverting
-- them would disable a valid database authority and could orphan evidence.
DELETE FROM schema_migration
WHERE version = '0154_v14_initial_model_prompt_pointer_repair';

COMMIT;
