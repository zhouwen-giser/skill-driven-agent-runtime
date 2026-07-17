BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM skill_execution_record) THEN
    RAISE EXCEPTION 'MIGRATION_0106_ROLLBACK_REQUIRES_NO_SKILL_EXECUTION_EVIDENCE';
  END IF;
END $$;

DROP TABLE IF EXISTS skill_execution_reference;
DROP TABLE IF EXISTS skill_execution_event;
DROP TABLE IF EXISTS skill_execution_record;
DELETE FROM schema_migration WHERE version = '0106_skill_execution_record';

COMMIT;
