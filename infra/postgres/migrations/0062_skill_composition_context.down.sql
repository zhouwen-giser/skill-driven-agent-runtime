BEGIN;

ALTER TABLE workflow_plan_attempt
  DROP CONSTRAINT IF EXISTS workflow_plan_attempt_capability_gap_array_check,
  DROP CONSTRAINT IF EXISTS workflow_plan_attempt_composition_context_object_check,
  DROP COLUMN IF EXISTS capability_gap_skill_ids_json,
  DROP COLUMN IF EXISTS composition_context_json;

ALTER TABLE workflow_plan
  DROP CONSTRAINT IF EXISTS workflow_plan_capability_gap_array_check,
  DROP CONSTRAINT IF EXISTS workflow_plan_composition_context_object_check,
  DROP COLUMN IF EXISTS capability_gap_skill_ids_json,
  DROP COLUMN IF EXISTS composition_context_json;

DELETE FROM schema_migration WHERE version='0062_skill_composition_context';

COMMIT;
