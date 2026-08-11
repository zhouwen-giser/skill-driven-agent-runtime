BEGIN;

ALTER TABLE cognitive_management_action
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN lease_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN lease_token text,
  ADD COLUMN execution_phase text,
  ADD COLUMN provider_dispatch_id text,
  ADD COLUMN provider_dispatch_hash text;

-- Migrations are applied while the Runtime is quiesced. A pre-0150 pending row
-- is deliberately made immediately recoverable; it must be reconciled from
-- durable domain evidence before any action is allowed to run again.
UPDATE cognitive_management_action
SET lease_owner = 'legacy-pre-0150',
    lease_expires_at = clock_timestamp(),
    lease_attempt = 1,
    lease_token = 'legacy-pre-0150:' || action_id,
    execution_phase = 'claimed'
WHERE status = 'pending';

UPDATE cognitive_management_action
SET execution_phase = 'terminal'
WHERE status IN ('completed', 'failed');

ALTER TABLE cognitive_management_action
  ALTER COLUMN execution_phase SET NOT NULL;

ALTER TABLE cognitive_management_action
  ADD CONSTRAINT cognitive_management_action_lease_state_check CHECK (
    (
      status = 'pending'
      AND lease_owner IS NOT NULL AND btrim(lease_owner) <> ''
      AND lease_expires_at IS NOT NULL
      AND lease_attempt >= 1
      AND lease_token IS NOT NULL AND btrim(lease_token) <> ''
      AND execution_phase IN ('claimed', 'execution_started', 'provider_dispatch')
      AND (
        (execution_phase IN ('claimed', 'execution_started')
          AND provider_dispatch_id IS NULL AND provider_dispatch_hash IS NULL)
        OR
        (execution_phase = 'provider_dispatch'
          AND provider_dispatch_id IS NOT NULL AND btrim(provider_dispatch_id) <> ''
          AND provider_dispatch_hash ~ '^sha256:[0-9a-f]{64}$')
      )
    )
    OR
    (
      status IN ('completed', 'failed')
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND lease_attempt >= 0
      AND lease_token IS NULL
      AND execution_phase = 'terminal'
      AND (
        (provider_dispatch_id IS NULL AND provider_dispatch_hash IS NULL)
        OR
        (provider_dispatch_id IS NOT NULL AND btrim(provider_dispatch_id) <> ''
          AND provider_dispatch_hash ~ '^sha256:[0-9a-f]{64}$')
      )
    )
  );

CREATE INDEX cognitive_management_action_pending_lease_idx
  ON cognitive_management_action(lease_expires_at, action_id)
  WHERE status = 'pending';

INSERT INTO schema_migration(version)
VALUES ('0150_v14_cognitive_management_action_lease_recovery');

COMMIT;
