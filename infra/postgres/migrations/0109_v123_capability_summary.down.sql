BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runtime_capability_summary) THEN
    RAISE EXCEPTION 'MIGRATION_0109_ROLLBACK_REQUIRES_NO_CAPABILITY_SUMMARIES';
  END IF;
END $$;

ALTER TABLE runtime_capability_limitation
  DROP CONSTRAINT runtime_capability_limitation_reason_check;
ALTER TABLE runtime_capability_summary
  DROP CONSTRAINT runtime_capability_summary_catalog_policy_unique;
ALTER TABLE runtime_capability_summary
  DROP COLUMN generation_policy_version;
ALTER TABLE runtime_capability_summary
  ADD CONSTRAINT runtime_capability_summary_catalog_hash_revision_key
  UNIQUE (catalog_hash, revision);

DELETE FROM schema_migration WHERE version = '0109_v123_capability_summary';

COMMIT;
