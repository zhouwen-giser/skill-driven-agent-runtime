BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM skill_package_import_audit)
     OR EXISTS (SELECT 1 FROM skill_version WHERE usage_specification_json IS NOT NULL) THEN
    RAISE EXCEPTION 'MIGRATION_0105_ROLLBACK_REQUIRES_NO_SKILL_USAGE_EVIDENCE';
  END IF;
END $$;

DROP TABLE IF EXISTS skill_package_import_audit;
DROP INDEX IF EXISTS skill_version_usage_default_mode_idx;
DROP INDEX IF EXISTS skill_version_usage_specification_gin;
ALTER TABLE skill_version DROP CONSTRAINT IF EXISTS skill_version_usage_specification_json_check;
ALTER TABLE skill_version DROP COLUMN IF EXISTS usage_specification_json;
DELETE FROM schema_migration WHERE version = '0105_skill_usage_specification';

COMMIT;
