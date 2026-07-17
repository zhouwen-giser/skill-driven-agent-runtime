BEGIN;

ALTER TABLE skill_version
  ADD COLUMN IF NOT EXISTS usage_specification_json jsonb;

ALTER TABLE skill_version
  DROP CONSTRAINT IF EXISTS skill_version_usage_specification_json_check;
ALTER TABLE skill_version
  ADD CONSTRAINT skill_version_usage_specification_json_check
  CHECK (usage_specification_json IS NULL OR jsonb_typeof(usage_specification_json) = 'object');

CREATE INDEX IF NOT EXISTS skill_version_usage_specification_gin
  ON skill_version USING gin (usage_specification_json)
  WHERE usage_specification_json IS NOT NULL;
CREATE INDEX IF NOT EXISTS skill_version_usage_default_mode_idx
  ON skill_version ((usage_specification_json->'modes'->>'defaultMode'))
  WHERE usage_specification_json IS NOT NULL;

CREATE TABLE IF NOT EXISTS skill_package_import_audit (
  skill_id text NOT NULL,
  skill_version integer NOT NULL CHECK (skill_version > 0),
  package_checksum text NOT NULL CHECK (package_checksum ~ '^[0-9a-f]{64}$'),
  package_root text NOT NULL CHECK (length(package_root) BETWEEN 1 AND 4096),
  file_checksums_json jsonb NOT NULL CHECK (jsonb_typeof(file_checksums_json) = 'object'),
  validated_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (skill_id, skill_version),
  FOREIGN KEY (skill_id, skill_version) REFERENCES skill_version(skill_id, version)
);
CREATE INDEX IF NOT EXISTS skill_package_import_audit_checksum_idx
  ON skill_package_import_audit (package_checksum, imported_at DESC);

INSERT INTO schema_migration (version)
VALUES ('0105_skill_usage_specification')
ON CONFLICT (version) DO NOTHING;

COMMIT;
