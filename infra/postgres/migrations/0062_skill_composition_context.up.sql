BEGIN;

ALTER TABLE workflow_plan
  ADD COLUMN IF NOT EXISTS composition_context_json jsonb,
  ADD COLUMN IF NOT EXISTS capability_gap_skill_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE workflow_plan_attempt
  ADD COLUMN IF NOT EXISTS composition_context_json jsonb,
  ADD COLUMN IF NOT EXISTS capability_gap_skill_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE workflow_plan
  DROP CONSTRAINT IF EXISTS workflow_plan_composition_context_object_check,
  DROP CONSTRAINT IF EXISTS workflow_plan_capability_gap_array_check;
ALTER TABLE workflow_plan
  ADD CONSTRAINT workflow_plan_composition_context_object_check CHECK (
    composition_context_json IS NULL OR jsonb_typeof(composition_context_json) = 'object'
  ),
  ADD CONSTRAINT workflow_plan_capability_gap_array_check CHECK (
    jsonb_typeof(capability_gap_skill_ids_json) = 'array'
  );

ALTER TABLE workflow_plan_attempt
  DROP CONSTRAINT IF EXISTS workflow_plan_attempt_composition_context_object_check,
  DROP CONSTRAINT IF EXISTS workflow_plan_attempt_capability_gap_array_check;
ALTER TABLE workflow_plan_attempt
  ADD CONSTRAINT workflow_plan_attempt_composition_context_object_check CHECK (
    composition_context_json IS NULL OR jsonb_typeof(composition_context_json) = 'object'
  ),
  ADD CONSTRAINT workflow_plan_attempt_capability_gap_array_check CHECK (
    jsonb_typeof(capability_gap_skill_ids_json) = 'array'
  );

INSERT INTO schema_migration(version) VALUES('0062_skill_composition_context')
ON CONFLICT(version) DO NOTHING;

COMMIT;
