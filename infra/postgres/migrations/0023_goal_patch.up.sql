BEGIN;
ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_phase_check;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_phase_check CHECK(
  phase IN ('queued','context_loading','goal_deliberation','skill_resolution','planning',
    'awaiting_plan_confirmation','awaiting_user_input','paused','executing','evaluating',
    'capability_gap','completed','canceled','failed','invalidated')
);
ALTER TABLE workflow_plan DROP CONSTRAINT IF EXISTS workflow_plan_confirmation_status_check;
ALTER TABLE workflow_plan ADD CONSTRAINT workflow_plan_confirmation_status_check CHECK(
  confirmation_status IN ('awaiting_confirmation','confirmed','failed','superseded','invalidated')
);
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','succeeded','failed','canceled','invalidated')
);
CREATE TABLE IF NOT EXISTS goal_patch (
  patch_id text PRIMARY KEY,
  goal_id text NOT NULL REFERENCES goal(goal_id),
  from_version integer NOT NULL CHECK(from_version > 0),
  to_version integer NOT NULL CHECK(to_version = from_version + 1),
  instruction text NOT NULL,
  changes_json jsonb NOT NULL,
  decision_summary text NOT NULL,
  compensation_warnings_json jsonb NOT NULL,
  invalidated_plan_ids_json jsonb NOT NULL,
  invalidated_instance_ids_json jsonb NOT NULL,
  new_plan_id text NOT NULL,
  before_goal_json jsonb NOT NULL,
  after_goal_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(goal_id, to_version)
);
INSERT INTO schema_migration(version) VALUES('0023_goal_patch') ON CONFLICT(version) DO NOTHING;
COMMIT;
