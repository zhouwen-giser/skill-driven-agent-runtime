BEGIN;
LOCK TABLE task_type_definition IN ACCESS EXCLUSIVE MODE;
-- Read-only preflight: SELECT knowledge_id,revision,status FROM task_type_definition WHERE definition_origin='configured';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM task_type_definition WHERE definition_origin='configured') THEN
    RAISE EXCEPTION 'CONFIGURED_TASK_TYPE_DOWNGRADE_REFERENCES';
  END IF;
END $$;
ALTER TABLE task_type_definition DROP CONSTRAINT task_type_configured_source_hash_check;
ALTER TABLE task_type_definition DROP CONSTRAINT task_type_definition_definition_origin_check;
ALTER TABLE task_type_definition ADD CONSTRAINT task_type_definition_definition_origin_check
  CHECK (definition_origin IN ('reflection_candidate','task_type_induction','fixture'));
DELETE FROM schema_migration WHERE version='0182_v14_configured_task_type';
COMMIT;
