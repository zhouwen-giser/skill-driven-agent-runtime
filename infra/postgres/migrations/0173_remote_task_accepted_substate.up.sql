BEGIN;

ALTER TABLE remote_task_binding
  DROP CONSTRAINT remote_task_binding_provider_substate_check;

ALTER TABLE remote_task_binding
  ADD CONSTRAINT remote_task_binding_provider_substate_check CHECK (
    provider_substate IS NULL OR provider_substate IN (
      'accepted','scheduled','queued','running','paused','resuming','stopping'
    )
  );

INSERT INTO schema_migration(version) VALUES ('0173_remote_task_accepted_substate');
COMMIT;
