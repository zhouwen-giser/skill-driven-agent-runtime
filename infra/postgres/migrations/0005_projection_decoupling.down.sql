BEGIN;

DELETE FROM external_task_projection projection
WHERE NOT EXISTS (SELECT 1 FROM agent_task task WHERE task.task_id = projection.task_id);

ALTER TABLE external_task_projection
  ADD CONSTRAINT external_task_projection_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES agent_task(task_id) ON DELETE CASCADE;
ALTER TABLE external_task_projection
  ADD CONSTRAINT external_task_projection_context_id_fkey
  FOREIGN KEY (context_id) REFERENCES conversation_context(context_id);

DELETE FROM schema_migration WHERE version = '0005_projection_decoupling';

COMMIT;
