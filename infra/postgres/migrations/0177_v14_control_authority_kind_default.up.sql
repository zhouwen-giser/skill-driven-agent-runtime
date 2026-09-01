BEGIN;

-- Legacy confirmation writers omit authority_kind; that path always means physical control.
ALTER TABLE governed_control_confirmation
  ALTER COLUMN authority_kind SET DEFAULT 'physical_control';

INSERT INTO schema_migration(version)
VALUES ('0177_v14_control_authority_kind_default');

COMMIT;
