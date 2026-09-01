BEGIN;

ALTER TABLE governed_control_confirmation
  ALTER COLUMN authority_kind DROP DEFAULT;

DELETE FROM schema_migration
WHERE version='0177_v14_control_authority_kind_default';

COMMIT;
