BEGIN;

DROP TRIGGER IF EXISTS governed_control_confirmation_immutable
  ON governed_control_confirmation;
DROP FUNCTION IF EXISTS protect_governed_control_confirmation();
DROP TABLE IF EXISTS governed_control_confirmation;
DELETE FROM schema_migration WHERE version='0157_v14_governed_control_confirmation';

COMMIT;
