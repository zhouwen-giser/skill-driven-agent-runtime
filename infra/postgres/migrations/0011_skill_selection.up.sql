BEGIN;

CREATE TABLE IF NOT EXISTS skill_performance_metrics (
  skill_id text PRIMARY KEY REFERENCES skill(skill_id) ON DELETE CASCADE,
  sample_count integer NOT NULL CHECK (sample_count >= 0),
  success_rate double precision NOT NULL CHECK (success_rate BETWEEN 0 AND 1),
  average_duration_ms double precision NOT NULL CHECK (average_duration_ms >= 0),
  average_cost double precision NOT NULL CHECK (average_cost >= 0),
  failure_count integer NOT NULL CHECK (failure_count >= 0),
  stability_score double precision NOT NULL CHECK (stability_score BETWEEN 0 AND 1),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_selection_record (
  selection_id text PRIMARY KEY,
  goal_description text NOT NULL,
  candidates_json jsonb NOT NULL,
  selected_skill_id text NOT NULL,
  selected_skill_version integer NOT NULL,
  decision_summary text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_replacement_plan (
  replacement_plan_id text PRIMARY KEY,
  selection_id text NOT NULL REFERENCES skill_selection_record(selection_id),
  failed_skill_id text NOT NULL,
  candidates_json jsonb NOT NULL,
  replacement_skill_id text NOT NULL,
  replacement_skill_version integer NOT NULL,
  decision_summary text NOT NULL,
  status text NOT NULL CHECK (status = 'awaiting_confirmation'),
  created_at timestamptz NOT NULL
);

COMMIT;
