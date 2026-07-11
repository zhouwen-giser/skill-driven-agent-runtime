BEGIN;

CREATE TABLE IF NOT EXISTS conversation_context (
  context_id text PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS goal (
  goal_id text PRIMARY KEY,
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  description text NOT NULL,
  constraints_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('active', 'achieved', 'canceled', 'unachievable', 'superseded')),
  previous_goal_id text REFERENCES goal(goal_id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (goal_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS goal_one_active_per_context
  ON goal (context_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS agent_task (
  task_id text PRIMARY KEY,
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  user_id text NOT NULL,
  phase text NOT NULL CHECK (
    phase IN (
      'queued', 'context_loading', 'goal_deliberation', 'skill_resolution', 'planning',
      'awaiting_plan_confirmation', 'awaiting_user_input', 'paused', 'executing',
      'evaluating', 'capability_gap', 'completed', 'canceled', 'failed'
    )
  ),
  phase_message text NOT NULL,
  goal_id text REFERENCES goal(goal_id),
  goal_version integer,
  output_text text,
  output_structured jsonb,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((goal_id IS NULL AND goal_version IS NULL) OR (goal_id IS NOT NULL AND goal_version IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS agent_task_context_created
  ON agent_task (context_id, created_at, task_id);

CREATE TABLE IF NOT EXISTS runtime_event (
  event_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES agent_task(task_id),
  context_id text NOT NULL REFERENCES conversation_context(context_id),
  event_type text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS runtime_event_task_timestamp
  ON runtime_event (task_id, event_timestamp, event_id);

INSERT INTO schema_migration (version)
VALUES ('0002_protocol_domain')
ON CONFLICT (version) DO NOTHING;

COMMIT;
