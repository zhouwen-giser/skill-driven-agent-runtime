BEGIN;

CREATE TABLE cognitive_management_action (
  action_id text PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN (
    'goal_session_action',
    'planning_session_action',
    'capability_rebuild',
    'capability_card_rebuild',
    'experience_dead_letter_replay',
    'knowledge_promote',
    'knowledge_reject',
    'knowledge_revalidate',
    'knowledge_deprecate'
  )),
  subject_id text NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  result jsonb,
  error_code text,
  claimed_at timestamptz NOT NULL,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz NOT NULL,
  UNIQUE (operation, subject_id, idempotency_key),
  CHECK (
    (status = 'pending' AND result IS NULL AND error_code IS NULL
      AND completed_at IS NULL AND failed_at IS NULL)
    OR
    (status = 'completed' AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR
    (status = 'failed' AND result IS NULL AND error_code IS NOT NULL
      AND failed_at IS NOT NULL AND completed_at IS NULL)
  )
);

CREATE INDEX cognitive_management_action_status_idx
  ON cognitive_management_action(status, updated_at, action_id);

INSERT INTO schema_migration(version)
VALUES ('0123_v123_cognitive_management_audit');

COMMIT;
