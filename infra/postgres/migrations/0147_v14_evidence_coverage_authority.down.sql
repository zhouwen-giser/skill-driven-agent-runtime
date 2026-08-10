BEGIN;

DROP INDEX IF EXISTS episode_evidence_manifest_episode_revision_idx;

ALTER TABLE evidence_projection_issue
  DROP CONSTRAINT IF EXISTS evidence_projection_issue_observation_order_ck,
  DROP CONSTRAINT IF EXISTS evidence_projection_issue_revision_ck,
  DROP CONSTRAINT IF EXISTS evidence_projection_issue_rule_id_ck,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS last_observed_at,
  DROP COLUMN IF EXISTS first_observed_at,
  DROP COLUMN IF EXISTS rule_id;

ALTER TABLE evidence_quality_issue
  DROP CONSTRAINT IF EXISTS evidence_quality_issue_observation_order_ck,
  DROP CONSTRAINT IF EXISTS evidence_quality_issue_revision_ck,
  DROP CONSTRAINT IF EXISTS evidence_quality_issue_rule_id_ck,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS last_observed_at,
  DROP COLUMN IF EXISTS first_observed_at,
  DROP COLUMN IF EXISTS rule_id;

ALTER TABLE episode_evidence_manifest
  DROP CONSTRAINT IF EXISTS episode_evidence_manifest_terminal_ck,
  DROP CONSTRAINT IF EXISTS episode_evidence_manifest_recomputed_ck,
  DROP CONSTRAINT IF EXISTS episode_evidence_manifest_snapshot_hash_ck,
  DROP CONSTRAINT IF EXISTS episode_evidence_manifest_policy_version_ck,
  DROP CONSTRAINT IF EXISTS episode_evidence_manifest_revision_ck,
  DROP COLUMN IF EXISTS recomputed_at,
  DROP COLUMN IF EXISTS source_snapshot_hash,
  DROP COLUMN IF EXISTS policy_version,
  DROP COLUMN IF EXISTS revision;

DROP TABLE IF EXISTS evidence_expected_record;

DELETE FROM schema_migration
WHERE version='0147_v14_evidence_coverage_authority';

COMMIT;
