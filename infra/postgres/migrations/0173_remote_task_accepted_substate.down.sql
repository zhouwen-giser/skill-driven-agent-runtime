BEGIN;

ALTER TABLE remote_task_binding
  DROP CONSTRAINT remote_task_binding_provider_substate_check;

ALTER TABLE remote_task_binding
  ADD CONSTRAINT remote_task_binding_provider_substate_check CHECK (
    provider_substate IS NULL OR provider_substate IN (
      'scheduled','queued','running','paused','resuming','stopping'
    )
  );

DELETE FROM schema_migration WHERE version='0173_remote_task_accepted_substate';
COMMIT;
