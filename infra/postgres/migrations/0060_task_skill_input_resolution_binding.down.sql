BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_task WHERE skill_input_resolution_id IS NOT NULL) THEN
    RAISE EXCEPTION '0060 rollback requires exported and cleared Task Skill input bindings';
  END IF;
END $$;

DROP INDEX agent_task_skill_input_resolution_idx;
ALTER TABLE agent_task DROP CONSTRAINT agent_task_skill_input_resolution_identity_fkey;
ALTER TABLE agent_task DROP COLUMN skill_input_resolution_id;
ALTER TABLE skill_input_resolution DROP CONSTRAINT skill_input_resolution_identity_unique;

DELETE FROM schema_migration WHERE version='0060_task_skill_input_resolution_binding';

COMMIT;
