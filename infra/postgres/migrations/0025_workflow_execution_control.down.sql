UPDATE workflow_instance SET status='failed',errors_json=jsonb_set(errors_json,'{rollback}',
  '{"code":"CANCELED_STATUS_ROLLBACK"}'::jsonb,true) WHERE status='canceled';
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','succeeded','failed','invalidated')
);
