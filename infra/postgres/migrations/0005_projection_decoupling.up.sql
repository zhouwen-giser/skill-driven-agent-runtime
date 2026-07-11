BEGIN;

ALTER TABLE external_task_projection
  DROP CONSTRAINT IF EXISTS external_task_projection_task_id_fkey;
ALTER TABLE external_task_projection
  DROP CONSTRAINT IF EXISTS external_task_projection_context_id_fkey;

INSERT INTO schema_migration (version)
VALUES ('0005_projection_decoupling')
ON CONFLICT (version) DO NOTHING;

COMMIT;
