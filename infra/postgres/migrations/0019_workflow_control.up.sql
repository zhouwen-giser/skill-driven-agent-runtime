BEGIN;
CREATE TABLE IF NOT EXISTS workflow_control (
  control_id text PRIMARY KEY,
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  goal_id text NOT NULL REFERENCES goal(goal_id),
  goal_version integer NOT NULL CHECK(goal_version > 0),
  task_id text REFERENCES agent_task(task_id),
  status text NOT NULL CHECK(status IN (
    'running','awaiting_confirmation','awaiting_input','capability_gap',
    'achieved','unachievable','failed','replan_budget_exhausted'
  )),
  current_plan_id text NOT NULL REFERENCES workflow_plan(plan_id),
  input_json jsonb NOT NULL,
  skill_ids_json jsonb NOT NULL,
  planning_instruction text NOT NULL,
  round_count integer NOT NULL CHECK(round_count >= 0),
  replan_count integer NOT NULL CHECK(replan_count >= 0),
  final_instance_id text REFERENCES workflow_instance(instance_id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_control_round (
  control_id text NOT NULL REFERENCES workflow_control(control_id) ON DELETE CASCADE,
  round_index integer NOT NULL CHECK(round_index >= 0),
  plan_id text NOT NULL REFERENCES workflow_plan(plan_id),
  instance_id text NOT NULL REFERENCES workflow_instance(instance_id),
  workflow_version integer NOT NULL CHECK(workflow_version > 0),
  evaluation_decision text NOT NULL CHECK(evaluation_decision IN (
    'achieved','request_input','adjust_plan','replace_skill','invoke_additional_skill',
    'capability_gap','unachievable'
  )),
  evaluation_summary text NOT NULL,
  replan_instruction text,
  evaluation_detail_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(control_id, round_index)
);
CREATE INDEX IF NOT EXISTS workflow_control_goal_idx ON workflow_control(goal_id, created_at);
INSERT INTO schema_migration(version) VALUES('0019_workflow_control') ON CONFLICT(version) DO NOTHING;
COMMIT;
