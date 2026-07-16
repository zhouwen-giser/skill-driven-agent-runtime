BEGIN;

ALTER TABLE workflow_control DROP CONSTRAINT IF EXISTS workflow_control_status_check;
ALTER TABLE workflow_control ADD CONSTRAINT workflow_control_status_check CHECK(status IN (
  'running','awaiting_confirmation','awaiting_input','capability_gap',
  'achieved','unachievable','canceled','failed','replan_budget_exhausted'
));

CREATE TABLE runtime_terminal_outcome (
  outcome_id text PRIMARY KEY,
  outcome_kind text NOT NULL CHECK(outcome_kind IN ('achieved','unachievable','canceled')),
  task_id text REFERENCES agent_task(task_id) ON DELETE RESTRICT,
  goal_id text NOT NULL REFERENCES goal(goal_id) ON DELETE RESTRICT,
  goal_version integer NOT NULL CHECK(goal_version > 0),
  control_id text NOT NULL REFERENCES workflow_control(control_id) ON DELETE RESTRICT,
  control_status text NOT NULL CHECK(control_status IN (
    'achieved','unachievable','canceled','replan_budget_exhausted'
  )),
  round_index integer CHECK(round_index >= 0),
  final_instance_id text REFERENCES workflow_instance(instance_id) ON DELETE RESTRICT,
  result_id text UNIQUE REFERENCES processed_result(result_id) ON DELETE RESTRICT,
  summary text NOT NULL,
  enhancement_warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  committed_at timestamptz NOT NULL,
  UNIQUE(control_id),
  CHECK(outcome_kind <> 'achieved' OR control_status = 'achieved'),
  CHECK(outcome_kind <> 'unachievable' OR control_status IN ('unachievable','replan_budget_exhausted')),
  CHECK(outcome_kind <> 'canceled' OR control_status = 'canceled'),
  CHECK(outcome_kind = 'canceled' OR (round_index IS NOT NULL AND final_instance_id IS NOT NULL))
);

ALTER TABLE workflow_control
  ADD COLUMN terminal_outcome_id text UNIQUE
    REFERENCES runtime_terminal_outcome(outcome_id) ON DELETE RESTRICT;

ALTER TABLE workflow_control_round
  ADD COLUMN terminal_outcome_id text UNIQUE
    REFERENCES runtime_terminal_outcome(outcome_id) ON DELETE RESTRICT;

CREATE INDEX runtime_terminal_outcome_task_idx
  ON runtime_terminal_outcome(task_id,committed_at DESC)
  WHERE task_id IS NOT NULL;
CREATE INDEX runtime_terminal_outcome_goal_idx
  ON runtime_terminal_outcome(goal_id,goal_version,committed_at DESC);

INSERT INTO schema_migration(version) VALUES('0058_runtime_terminal_outcome')
ON CONFLICT(version) DO NOTHING;

COMMIT;
