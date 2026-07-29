-- 0130_v13_artifact_shadow_governance.up.sql
-- P06: PostgreSQL-authoritative Shadow, Promotion, Approval and Revalidation.
-- Redis/BullMQ may wake these rows but never owns their state or evidence.

BEGIN;

CREATE TABLE artifact_shadow_run (
  shadow_run_id text PRIMARY KEY
    REFERENCES artifact_validation_run(validation_run_id) ON DELETE CASCADE,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  artifact_ref text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id text,
  formal_request_ref text NOT NULL,
  formal_goal_ref text,
  formal_plan_ref text,
  formal_goal_version integer CHECK (formal_goal_version >= 1),
  formal_plan_version integer CHECK (formal_plan_version >= 1),
  shadow_mode text NOT NULL CHECK (
    shadow_mode IN ('decision_only','plan_only','decision_and_plan')
  ),
  policy_snapshot_hash text NOT NULL CHECK (policy_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  capability_catalog_hash text NOT NULL CHECK (
    capability_catalog_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  status text NOT NULL CHECK (
    status IN ('queued','running','completed','discarded_stale','failed','cancelled')
  ),
  work_state text NOT NULL CHECK (
    work_state IN ('pending','leased','retry_wait','completed','discarded_stale','failed','cancelled','dead_letter')
  ),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 5),
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  idempotency_key text NOT NULL,
  last_error_code text,
  last_error_summary text,
  formal_projection jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(formal_projection) = 'object'),
  candidate_projection jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(candidate_projection) = 'object'),
  declared_operations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(declared_operations) = 'array'),
  current_policy_snapshot_hash text NOT NULL CHECK (
    current_policy_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  current_capability_catalog_hash text NOT NULL CHECK (
    current_capability_catalog_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  current_formal_goal_version integer CHECK (current_formal_goal_version >= 1),
  current_formal_plan_version integer CHECK (current_formal_plan_version >= 1),
  formal_outcome_ref text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  UNIQUE (artifact_id, artifact_version, idempotency_key),
  CHECK (expires_at > created_at),
  CHECK (
    (work_state = 'leased') = (
      lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
    )
  )
);
CREATE INDEX artifact_shadow_run_claim_idx
  ON artifact_shadow_run(work_state, available_at, expires_at, shadow_run_id)
  WHERE work_state IN ('pending','retry_wait');
CREATE INDEX artifact_shadow_run_artifact_idx
  ON artifact_shadow_run(artifact_id, artifact_version, created_at DESC);

CREATE TABLE artifact_shadow_result (
  shadow_run_id text PRIMARY KEY
    REFERENCES artifact_shadow_run(shadow_run_id) ON DELETE CASCADE,
  artifact_ref text NOT NULL,
  shadow_decision_ref text,
  shadow_plan_ref text,
  formal_plan_ref text,
  formal_outcome_ref text,
  comparison jsonb NOT NULL CHECK (jsonb_typeof(comparison) = 'object'),
  policy_violation boolean NOT NULL,
  unsafe_attempt boolean NOT NULL,
  stale boolean NOT NULL,
  result_hash text NOT NULL CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  evaluator_version text NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE TABLE artifact_promotion_policy (
  promotion_policy_version text PRIMARY KEY,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);

CREATE TABLE artifact_promotion_package (
  promotion_package_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  artifact_ref text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  validation_summary_ref text NOT NULL,
  validation_summary_hash text NOT NULL CHECK (validation_summary_hash ~ '^sha256:[0-9a-f]{64}$'),
  shadow_summary_ref text NOT NULL,
  shadow_summary_hash text NOT NULL CHECK (shadow_summary_hash ~ '^sha256:[0-9a-f]{64}$'),
  counterexample_summary_ref text NOT NULL,
  counterexample_summary_hash text NOT NULL CHECK (
    counterexample_summary_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  risk_review_ref text NOT NULL,
  risk_review_hash text NOT NULL CHECK (risk_review_hash ~ '^sha256:[0-9a-f]{64}$'),
  dependency_snapshot_ref text NOT NULL,
  dependency_snapshot_hash text NOT NULL CHECK (
    dependency_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  promotion_policy_version text NOT NULL,
  eligibility text NOT NULL CHECK (
    eligibility IN ('eligible_for_review','needs_more_data','ineligible','unsafe')
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  FOREIGN KEY (promotion_policy_version)
    REFERENCES artifact_promotion_policy(promotion_policy_version),
  UNIQUE (artifact_id, artifact_version, content_hash)
);
CREATE INDEX artifact_promotion_package_lookup_idx
  ON artifact_promotion_package(artifact_id, artifact_version, eligibility, created_at DESC);

-- Binds eligibility coverage and the derived P05/P06 evidence hashes to the
-- immutable package. A caller cannot turn a different evidence set into an
-- eligible package by changing only request fields.
CREATE TABLE artifact_promotion_assessment (
  promotion_package_id text PRIMARY KEY
    REFERENCES artifact_promotion_package(promotion_package_id) ON DELETE CASCADE,
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  risk_review_hash text NOT NULL CHECK (risk_review_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);

ALTER TABLE artifact_approval
  ADD COLUMN promotion_package_id text,
  ADD COLUMN promotion_package_hash text,
  ADD COLUMN approval_hash text;
ALTER TABLE artifact_approval
  ADD CONSTRAINT artifact_approval_promotion_package_fk
  FOREIGN KEY (promotion_package_id) REFERENCES artifact_promotion_package(promotion_package_id);
ALTER TABLE artifact_approval
  ADD CONSTRAINT artifact_approval_promotion_hash_check CHECK (
    (promotion_package_id IS NULL AND promotion_package_hash IS NULL AND approval_hash IS NULL)
    OR (
      promotion_package_id IS NOT NULL
      AND promotion_package_hash ~ '^sha256:[0-9a-f]{64}$'
      AND approval_hash ~ '^sha256:[0-9a-f]{64}$'
    )
  );
CREATE UNIQUE INDEX artifact_approval_p06_exact_evidence_uq
  ON artifact_approval(
    artifact_id,artifact_version,approver_id,decision,validation_summary_hash,promotion_package_hash
  ) WHERE promotion_package_hash IS NOT NULL;

CREATE TABLE artifact_activation_record (
  activation_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  artifact_ref text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  approval_id text NOT NULL REFERENCES artifact_approval(approval_id),
  approval_hash text NOT NULL CHECK (approval_hash ~ '^sha256:[0-9a-f]{64}$'),
  previous_active_artifact_ref text,
  active_pointer_version integer NOT NULL CHECK (active_pointer_version >= 1),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version),
  UNIQUE (artifact_id, artifact_version, active_pointer_version)
);

CREATE TABLE artifact_revalidation_trigger (
  trigger_id text PRIMARY KEY,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL CHECK (artifact_version >= 1),
  artifact_ref text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'capability_catalog_changed','skill_changed','policy_changed','task_type_changed','schema_changed',
    'compiler_changed','validator_changed','provider_profile_changed','performance_drift',
    'correction_received','fallback_drift','new_counterexample','safety_incident',
    'long_inactivity','operator_request'
  )),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  severity text NOT NULL CHECK (severity IN ('normal','urgent','critical')),
  validation_run_id text UNIQUE REFERENCES artifact_validation_run(validation_run_id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, artifact_version)
    REFERENCES compiled_artifact(artifact_id, version)
);
CREATE INDEX artifact_revalidation_trigger_lookup_idx
  ON artifact_revalidation_trigger(artifact_id, artifact_version, created_at DESC);

CREATE TABLE artifact_rollback_record (
  rollback_id text PRIMARY KEY,
  artifact_key text NOT NULL,
  from_artifact_id text NOT NULL,
  from_artifact_version integer NOT NULL CHECK (from_artifact_version >= 1),
  to_artifact_id text NOT NULL,
  to_artifact_version integer NOT NULL CHECK (to_artifact_version >= 1),
  approval_id text NOT NULL REFERENCES artifact_approval(approval_id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 4096),
  rolled_back_by text NOT NULL,
  rolled_back_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION sdar_assign_artifact_outbox_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type IN (
    'artifact.validation_started','artifact.validation_completed','artifact.shadow_started',
    'artifact.shadow_completed','artifact.promotion_ready','artifact.approval_recorded',
    'artifact.activated','artifact.revalidating','artifact.deprecated'
  ) OR NEW.payload ? 'dependencyRef' THEN
    PERFORM pg_advisory_xact_lock(53444152,125);
    SELECT COALESCE(MAX(event.outbox_sequence),0)+1 INTO NEW.outbox_sequence
    FROM cognitive_runtime_outbox event;
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE cognitive_runtime_outbox
  DROP CONSTRAINT cognitive_runtime_outbox_artifact_sequence_check;
ALTER TABLE cognitive_runtime_outbox
  ADD CONSTRAINT cognitive_runtime_outbox_artifact_sequence_check CHECK (
    (
      event_type NOT IN (
        'artifact.validation_started','artifact.validation_completed','artifact.shadow_started',
        'artifact.shadow_completed','artifact.promotion_ready','artifact.approval_recorded',
        'artifact.activated','artifact.revalidating','artifact.deprecated'
      ) AND NOT (payload ? 'dependencyRef')
    ) OR outbox_sequence IS NOT NULL
  );

INSERT INTO schema_migration(version)
VALUES ('0130_v13_artifact_shadow_governance');

COMMIT;
