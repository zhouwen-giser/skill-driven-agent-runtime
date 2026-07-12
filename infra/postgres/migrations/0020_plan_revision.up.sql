BEGIN;
ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_confirmation_status_check;
ALTER TABLE workflow_plan ADD CONSTRAINT workflow_plan_confirmation_status_check CHECK(
  confirmation_status IN ('awaiting_confirmation','confirmed','failed','superseded','invalidated')
);
ALTER TABLE workflow_plan
  ADD COLUMN IF NOT EXISTS source_plan_id text REFERENCES workflow_plan(plan_id),
  ADD COLUMN IF NOT EXISTS revision_kind text;
ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_revision_kind_check;
ALTER TABLE workflow_plan ADD CONSTRAINT workflow_plan_revision_kind_check CHECK(
  revision_kind IS NULL OR revision_kind IN (
    'auto_correction','natural_language','admin_dsl','admin_dag','replan'
  )
);
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS plan_id text REFERENCES workflow_plan(plan_id);
INSERT INTO schema_migration(version) VALUES('0020_plan_revision') ON CONFLICT(version) DO NOTHING;
COMMIT;
