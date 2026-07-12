BEGIN;
CREATE TABLE IF NOT EXISTS memory_status_transition (
  transition_id text PRIMARY KEY,
  memory_id text NOT NULL REFERENCES memory_item(memory_id),
  from_status text NOT NULL CHECK(from_status IN ('active','superseded','invalid')),
  to_status text NOT NULL CHECK(to_status IN ('superseded','invalid')),
  replacement_memory_id text REFERENCES memory_item(memory_id),
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_status_transition_memory_idx
  ON memory_status_transition(memory_id,created_at,transition_id);
INSERT INTO schema_migration(version) VALUES('0044_memory_status_transition') ON CONFLICT(version) DO NOTHING;
COMMIT;
