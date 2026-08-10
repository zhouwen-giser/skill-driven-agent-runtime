BEGIN;

-- Strategy B clean cutover. Migration 0142 remains immutable history, but its
-- development-only telemetry product tables are not canonical evidence authority.
DROP TABLE runtime_telemetry_export_outbox;
DROP TABLE runtime_telemetry_export_state;
DROP TABLE runtime_telemetry_export_configuration;

CREATE TABLE evidence_export_configuration (
  export_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object' AND pg_column_size(definition) <= 262144),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  is_lkg boolean NOT NULL DEFAULT false,
  PRIMARY KEY (export_id,revision)
);

CREATE UNIQUE INDEX evidence_export_one_active_idx
  ON evidence_export_configuration ((true)) WHERE is_active;
CREATE UNIQUE INDEX evidence_export_one_lkg_idx
  ON evidence_export_configuration ((true)) WHERE is_lkg;

CREATE TABLE evidence_export_state (
  export_id text NOT NULL,
  source_partition text NOT NULL,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle','exporting','degraded','high_watermark','disabled')),
  last_sent_sequence bigint CHECK (last_sent_sequence IS NULL OR last_sent_sequence >= 0),
  last_acknowledged_sequence bigint
    CHECK (last_acknowledged_sequence IS NULL OR last_acknowledged_sequence >= 0),
  last_acknowledged_at timestamptz,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  last_error_code text,
  last_error_at timestamptz,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (export_id,source_partition),
  CHECK (last_sent_sequence IS NULL OR last_acknowledged_sequence IS NULL
    OR last_acknowledged_sequence <= last_sent_sequence),
  CHECK ((lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE TABLE evidence_outbox (
  sequence bigserial PRIMARY KEY,
  record_id text NOT NULL CHECK (record_id ~ '^evidence_[a-f0-9]{64}$'),
  record_family text NOT NULL
    CHECK (record_family IN ('runtime','skill','mcp_task','capability','experience','replay','artifact','node_control','evidence')),
  record_type text NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  schema_name text NOT NULL CHECK (schema_name ~ '^sdar\.evidence\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  source_system text NOT NULL CHECK (source_system IN ('runtime','node_control')),
  source_table text NOT NULL CHECK (length(btrim(source_table)) > 0),
  source_record_id text NOT NULL CHECK (length(btrim(source_record_id)) > 0),
  source_revision text NOT NULL CHECK (length(btrim(source_revision)) > 0),
  source_partition text NOT NULL CHECK (length(btrim(source_partition)) > 0),
  tenant_id text,
  user_scope_id text,
  project_id text,
  environment text NOT NULL CHECK (length(btrim(environment)) > 0),
  task_id text,
  context_id text,
  episode_id text,
  run_id text,
  goal_id text,
  goal_version integer CHECK (goal_version IS NULL OR goal_version > 0),
  plan_id text,
  plan_version integer CHECK (plan_version IS NULL OR plan_version > 0),
  skill_execution_id text,
  capability_binding_id text,
  remote_task_binding_id text,
  node_id text,
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) > 0),
  causation_id text,
  delivery_guarantee text NOT NULL
    CHECK (delivery_guarantee IN ('transactional','durable_projection','buffered')),
  evaluation_role text NOT NULL CHECK (evaluation_role IN ('required','supporting','diagnostic')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence_refs)='array' AND pg_column_size(evidence_refs) <= 65536),
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(artifact_refs)='array' AND pg_column_size(artifact_refs) <= 65536),
  payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 262144),
  payload_hash char(71) NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  sent_export_id text,
  sent_fencing_token bigint CHECK (sent_fencing_token IS NULL OR sent_fencing_token >= 0),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  last_error_code text,
  UNIQUE (record_id),
  UNIQUE (source_system,source_table,source_record_id,source_revision,schema_name,schema_version),
  CHECK ((sent_export_id IS NULL AND sent_fencing_token IS NULL AND sent_at IS NULL)
    OR (sent_export_id IS NOT NULL AND sent_fencing_token IS NOT NULL AND sent_at IS NOT NULL))
);

CREATE INDEX evidence_outbox_pending_idx
  ON evidence_outbox (source_partition,next_attempt_at,sequence)
  WHERE acknowledged_at IS NULL;
CREATE INDEX evidence_outbox_episode_idx ON evidence_outbox (episode_id,sequence)
  WHERE episode_id IS NOT NULL;

CREATE TABLE evidence_source_checkpoint (
  source_family text NOT NULL CHECK (length(btrim(source_family)) > 0),
  source_partition text NOT NULL CHECK (length(btrim(source_partition)) > 0),
  last_occurred_at timestamptz,
  last_source_record_id text,
  last_source_revision text,
  last_payload_hash char(71) CHECK (last_payload_hash IS NULL OR last_payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  last_projected_at timestamptz,
  projector_version text NOT NULL CHECK (length(btrim(projector_version)) > 0),
  PRIMARY KEY (source_family,source_partition),
  CHECK ((last_source_record_id IS NULL) = (last_source_revision IS NULL)),
  CHECK (last_source_record_id IS NOT NULL OR (last_occurred_at IS NULL AND last_payload_hash IS NULL AND last_projected_at IS NULL))
);

CREATE TABLE evidence_dead_letter (
  dead_letter_id text PRIMARY KEY,
  sequence bigint NOT NULL UNIQUE REFERENCES evidence_outbox(sequence) ON DELETE RESTRICT,
  record_id text NOT NULL REFERENCES evidence_outbox(record_id) ON DELETE RESTRICT,
  issue_code text NOT NULL CHECK (issue_code IN ('schema_invalid','source_identity_missing','source_revision_missing','payload_hash_conflict','reference_unresolved','redaction_rejected','artifact_write_failed','export_rejected','ack_invalid','source_unavailable','projection_bug')),
  attempts integer NOT NULL CHECK (attempts > 0),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail)='object' AND pg_column_size(detail) <= 65536),
  failed_at timestamptz NOT NULL,
  requeued_at timestamptz
);

CREATE TABLE evidence_projection_issue (
  issue_id text PRIMARY KEY,
  issue_code text NOT NULL CHECK (issue_code IN ('schema_invalid','source_identity_missing','source_revision_missing','payload_hash_conflict','reference_unresolved','redaction_rejected','artifact_write_failed','export_rejected','ack_invalid','source_unavailable','projection_bug')),
  severity text NOT NULL CHECK (severity IN ('diagnostic','degraded','blocking')),
  evaluation_role text NOT NULL CHECK (evaluation_role IN ('required','supporting','diagnostic')),
  record_type text,
  record_id text,
  episode_id text,
  source_system text NOT NULL CHECK (source_system IN ('runtime','node_control')),
  source_table text NOT NULL,
  source_record_id text NOT NULL,
  source_partition text NOT NULL,
  projector_version text NOT NULL,
  retryable boolean NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail)='object' AND pg_column_size(detail) <= 65536),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK (evaluation_role <> 'required' OR severity IN ('degraded','blocking'))
);

CREATE INDEX evidence_projection_issue_open_idx
  ON evidence_projection_issue (source_system,source_partition,created_at)
  WHERE resolved_at IS NULL;

CREATE TABLE evidence_quality_issue (
  issue_id text PRIMARY KEY,
  issue_code text NOT NULL CHECK (issue_code IN ('schema_invalid','source_identity_missing','source_revision_missing','payload_hash_conflict','reference_unresolved','redaction_rejected','artifact_write_failed','export_rejected','ack_invalid','source_unavailable','projection_bug')),
  severity text NOT NULL CHECK (severity IN ('diagnostic','degraded','blocking')),
  record_type text,
  record_id text,
  episode_id text,
  source_system text NOT NULL CHECK (source_system IN ('runtime','node_control')),
  source_table text NOT NULL,
  source_record_id text NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail)='object' AND pg_column_size(detail) <= 65536),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX evidence_quality_issue_episode_idx
  ON evidence_quality_issue (episode_id,created_at) WHERE episode_id IS NOT NULL;

CREATE TABLE episode_evidence_manifest (
  manifest_id text PRIMARY KEY,
  episode_id text NOT NULL UNIQUE,
  task_id text NOT NULL,
  terminal_outcome_id text NOT NULL,
  expected_required_records integer NOT NULL CHECK (expected_required_records >= 0),
  projected_required_records integer NOT NULL CHECK (projected_required_records >= 0),
  pending_required_records integer NOT NULL CHECK (pending_required_records >= 0),
  failed_required_records integer NOT NULL CHECK (failed_required_records >= 0),
  expected_families jsonb NOT NULL CHECK (jsonb_typeof(expected_families)='array'),
  completed_families jsonb NOT NULL CHECK (jsonb_typeof(completed_families)='array'),
  missing_families jsonb NOT NULL CHECK (jsonb_typeof(missing_families)='array'),
  source_coverage jsonb NOT NULL CHECK (jsonb_typeof(source_coverage)='object' AND pg_column_size(source_coverage) <= 262144),
  last_evidence_sequence bigint NOT NULL CHECK (last_evidence_sequence >= 0),
  status text NOT NULL CHECK (status IN ('projecting','complete','degraded','incomplete')),
  quality_issue_ids jsonb NOT NULL CHECK (jsonb_typeof(quality_issue_ids)='array'),
  created_at timestamptz NOT NULL,
  sealed_at timestamptz,
  CHECK (projected_required_records + pending_required_records + failed_required_records <= expected_required_records),
  CHECK (status <> 'complete' OR (projected_required_records=expected_required_records AND pending_required_records=0 AND failed_required_records=0 AND jsonb_array_length(missing_families)=0 AND sealed_at IS NOT NULL))
);

INSERT INTO schema_migration(version) VALUES ('0144_v14_canonical_evidence');

COMMIT;
