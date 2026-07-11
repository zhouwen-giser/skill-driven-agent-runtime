BEGIN;
CREATE TABLE IF NOT EXISTS workflow_plan (
  plan_id text PRIMARY KEY, goal_id text NOT NULL, goal_version integer NOT NULL,
  definition_json jsonb, source_confirmed_plan_id text REFERENCES workflow_plan(plan_id),
  confirmation_status text NOT NULL CHECK(confirmation_status IN ('awaiting_confirmation','confirmed','failed')),
  attempt_count integer NOT NULL CHECK(attempt_count > 0), created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_plan_attempt (
  plan_id text NOT NULL, attempt integer NOT NULL CHECK(attempt > 0), candidate_json jsonb NOT NULL,
  validation_errors_json jsonb NOT NULL, valid boolean NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(plan_id,attempt)
);
INSERT INTO schema_migration(version) VALUES('0016_workflow_planning') ON CONFLICT(version) DO NOTHING;
COMMIT;
