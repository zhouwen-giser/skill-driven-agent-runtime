BEGIN;

DO $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM governed_control_confirmation
     WHERE authority_kind <> 'physical_control'
  ) THEN
    RAISE EXCEPTION 'CONTROL_AUTHORITY_KIND_ROLLBACK_REQUIRES_REVIEW' USING ERRCODE='55000';
  END IF;
END $$;

ALTER TABLE governed_control_confirmation
  DROP CONSTRAINT governed_control_confirmation_authority_kind_check,
  DROP COLUMN authority_kind;

DELETE FROM schema_migration
WHERE version='0176_v14_control_authority_kind';

COMMIT;
