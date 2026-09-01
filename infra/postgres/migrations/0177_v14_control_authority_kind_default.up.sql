BEGIN;

-- Compatibility for Runtime binaries deployed while 0176 was being rolled out. Newer writers
-- persist authority_kind explicitly; the default only preserves the pre-0176 physical-control
-- contract and never grants emergency-stop or weapon authority.
ALTER TABLE governed_control_confirmation
  ALTER COLUMN authority_kind SET DEFAULT 'physical_control';

INSERT INTO schema_migration(version)
VALUES ('0177_v14_control_authority_kind_default');

COMMIT;
