BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runtime_capability_summary) THEN
    RAISE EXCEPTION 'MIGRATION_0109_REQUIRES_EMPTY_UNRELEASED_CAPABILITY_SUMMARIES';
  END IF;
END $$;

ALTER TABLE runtime_capability_summary
  DROP CONSTRAINT runtime_capability_summary_catalog_hash_revision_key;
ALTER TABLE runtime_capability_summary
  ADD COLUMN generation_policy_version text NOT NULL
    CHECK (length(generation_policy_version) BETWEEN 1 AND 128);
ALTER TABLE runtime_capability_summary
  ADD CONSTRAINT runtime_capability_summary_catalog_policy_unique
  UNIQUE (catalog_hash, generation_policy_version);

ALTER TABLE runtime_capability_limitation
  ADD CONSTRAINT runtime_capability_limitation_reason_check
  CHECK (reason_code IN (
    'missing_outcome_specification',
    'internal_only',
    'confirmation_required',
    'not_composable',
    'no_enabled_skill'
  ));

INSERT INTO schema_migration(version) VALUES ('0109_v123_capability_summary');

COMMIT;
