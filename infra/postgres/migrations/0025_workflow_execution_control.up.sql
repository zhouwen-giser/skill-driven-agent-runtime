ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_status_check;
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_status_check CHECK(
  status IN ('running','paused','succeeded','failed','canceled','invalidated')
);
