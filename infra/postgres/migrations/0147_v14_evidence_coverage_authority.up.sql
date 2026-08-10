BEGIN;

CREATE TABLE evidence_expected_record (
  expectation_id text PRIMARY KEY,
  episode_id text,
  task_id text,
  policy_version text NOT NULL CHECK (policy_version='episode-evidence-policy/v1'),
  record_type text NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  record_family text NOT NULL CHECK (record_family IN (
    'runtime','skill','mcp_task','capability','experience','replay','artifact','node_control','evidence'
  )),
  source_system text NOT NULL CHECK (source_system IN ('runtime','node_control')),
  source_table text NOT NULL CHECK (length(source_table) BETWEEN 1 AND 128),
  evaluation_role text NOT NULL CHECK (evaluation_role IN ('required','supporting','diagnostic')),
  requirement_level text NOT NULL CHECK (requirement_level IN ('required','conditional','optional')),
  applicable boolean NOT NULL,
  stage text NOT NULL CHECK (stage IN (
    'source_fact_missing','source_fact_unprojected','projected_pending_export',
    'exported_unacknowledged','acknowledged','projection_failed','schema_invalid','payload_conflict'
  )),
  source_record_id text,
  source_revision text,
  record_id text,
  evidence_sequence bigint REFERENCES evidence_outbox(sequence) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  expected_at timestamptz NOT NULL,
  recomputed_at timestamptz NOT NULL,
  UNIQUE NULLS NOT DISTINCT (episode_id,policy_version,record_type,source_record_id),
  CHECK ((episode_id IS NULL AND task_id IS NULL) OR (episode_id IS NOT NULL AND task_id IS NOT NULL)),
  CHECK (evidence_sequence IS NULL OR evidence_sequence >= 0),
  CHECK (record_id IS NULL OR evidence_sequence IS NOT NULL),
  CHECK (source_revision IS NULL OR length(source_revision) BETWEEN 1 AND 512),
  CHECK (recomputed_at >= expected_at)
);

CREATE INDEX evidence_expected_record_episode_stage_idx
  ON evidence_expected_record (episode_id,applicable,evaluation_role,stage,record_type);

CREATE INDEX evidence_expected_record_global_stage_idx
  ON evidence_expected_record (applicable,evaluation_role,stage,record_type)
  WHERE episode_id IS NULL;

ALTER TABLE episode_evidence_manifest
  ADD COLUMN revision bigint,
  ADD COLUMN policy_version text,
  ADD COLUMN source_snapshot_hash text,
  ADD COLUMN recomputed_at timestamptz;

-- Pre-0147 manifests did not retain their authority snapshot.  Reopen them as
-- projecting and hash the exact legacy row so no terminal claim survives without
-- a fresh authority recomputation.
UPDATE episode_evidence_manifest
SET revision=1,
    policy_version='episode-evidence-policy/v1',
    source_snapshot_hash='sha256:' || encode(sha256(convert_to(
      (to_jsonb(episode_evidence_manifest)
        - 'revision' - 'policy_version' - 'source_snapshot_hash' - 'recomputed_at')::text,
      'UTF8'
    )),'hex'),
    recomputed_at=created_at,
    status='projecting',
    sealed_at=NULL;

ALTER TABLE episode_evidence_manifest
  ALTER COLUMN revision SET NOT NULL,
  ALTER COLUMN policy_version SET NOT NULL,
  ALTER COLUMN source_snapshot_hash SET NOT NULL,
  ALTER COLUMN recomputed_at SET NOT NULL,
  ADD CONSTRAINT episode_evidence_manifest_revision_ck CHECK (revision > 0),
  ADD CONSTRAINT episode_evidence_manifest_policy_version_ck
    CHECK (policy_version='episode-evidence-policy/v1'),
  ADD CONSTRAINT episode_evidence_manifest_snapshot_hash_ck
    CHECK (source_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT episode_evidence_manifest_recomputed_ck
    CHECK (recomputed_at >= created_at),
  ADD CONSTRAINT episode_evidence_manifest_terminal_ck CHECK (
    (status='projecting' AND sealed_at IS NULL)
    OR
    (status='complete' AND sealed_at IS NOT NULL
      AND projected_required_records=expected_required_records
      AND pending_required_records=0 AND failed_required_records=0
      AND jsonb_array_length(missing_families)=0)
    OR
    (status='degraded' AND sealed_at IS NOT NULL
      AND projected_required_records=expected_required_records
      AND pending_required_records=0 AND failed_required_records=0
      AND jsonb_array_length(missing_families)=0)
    OR
    (status='incomplete' AND sealed_at IS NOT NULL
      AND (pending_required_records > 0 OR failed_required_records > 0
        OR jsonb_array_length(missing_families) > 0
        OR jsonb_array_length(quality_issue_ids) > 0))
  ) NOT VALID;

CREATE UNIQUE INDEX episode_evidence_manifest_episode_revision_idx
  ON episode_evidence_manifest (episode_id,revision);

ALTER TABLE evidence_quality_issue
  ADD COLUMN rule_id text,
  ADD COLUMN first_observed_at timestamptz,
  ADD COLUMN last_observed_at timestamptz,
  ADD COLUMN revision bigint;

UPDATE evidence_quality_issue
SET first_observed_at=created_at,
    last_observed_at=GREATEST(created_at,COALESCE(resolved_at,created_at)),
    revision=1;

ALTER TABLE evidence_quality_issue
  ALTER COLUMN first_observed_at SET NOT NULL,
  ALTER COLUMN last_observed_at SET NOT NULL,
  ALTER COLUMN revision SET NOT NULL,
  ADD CONSTRAINT evidence_quality_issue_rule_id_ck CHECK (rule_id IS NULL OR rule_id IN (
    'sequence_gap','orphan_reference','version_gap','missing_verification',
    'remote_task_unclosed','skill_tree_incomplete','experience_missing_fact',
    'node_revision_regression','export_ack_gap','payload_conflict'
  )),
  ADD CONSTRAINT evidence_quality_issue_revision_ck CHECK (revision > 0),
  ADD CONSTRAINT evidence_quality_issue_observation_order_ck
    CHECK (last_observed_at >= first_observed_at) NOT VALID;

ALTER TABLE evidence_projection_issue
  ADD COLUMN rule_id text,
  ADD COLUMN first_observed_at timestamptz,
  ADD COLUMN last_observed_at timestamptz,
  ADD COLUMN revision bigint;

UPDATE evidence_projection_issue
SET first_observed_at=created_at,
    last_observed_at=GREATEST(created_at,COALESCE(resolved_at,created_at)),
    revision=1;

ALTER TABLE evidence_projection_issue
  ALTER COLUMN first_observed_at SET NOT NULL,
  ALTER COLUMN last_observed_at SET NOT NULL,
  ALTER COLUMN revision SET NOT NULL,
  ADD CONSTRAINT evidence_projection_issue_rule_id_ck CHECK (rule_id IS NULL OR rule_id IN (
    'sequence_gap','orphan_reference','version_gap','missing_verification',
    'remote_task_unclosed','skill_tree_incomplete','experience_missing_fact',
    'node_revision_regression','export_ack_gap','payload_conflict'
  )),
  ADD CONSTRAINT evidence_projection_issue_revision_ck CHECK (revision > 0),
  ADD CONSTRAINT evidence_projection_issue_observation_order_ck
    CHECK (last_observed_at >= first_observed_at) NOT VALID;

INSERT INTO schema_migration(version)
VALUES ('0147_v14_evidence_coverage_authority');

COMMIT;
