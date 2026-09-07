BEGIN;
CREATE TABLE capability_admission_receipt (
  task_id text PRIMARY KEY REFERENCES agent_task(task_id),
  request_id text NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
  version integer NOT NULL CHECK(version>0),
  clarification jsonb NOT NULL CHECK(jsonb_typeof(clarification)='object'),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, bound_at timestamptz
);
INSERT INTO schema_migration(version) VALUES ('0183_v14_capability_admission_receipt');
COMMIT;
