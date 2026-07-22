BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM mcp_server WHERE protocol_mode='frozen_v1')
     OR EXISTS (
       SELECT 1 FROM remote_task_binding
       WHERE protocol_contract_json->>'mode'='frozen_v1'
     ) THEN
    RAISE EXCEPTION 'FROZEN_MCP_TASKS_UNSAFE_ROLLBACK';
  END IF;
END $$;

DROP INDEX IF EXISTS remote_task_control_frozen_revision_idx;
ALTER TABLE remote_task_control_event DROP COLUMN IF EXISTS runtime_revision;

DROP INDEX IF EXISTS remote_task_observation_frozen_revision_idx;
ALTER TABLE remote_task_observation
  DROP COLUMN IF EXISTS subscription_id,
  DROP COLUMN IF EXISTS provider_revision,
  DROP COLUMN IF EXISTS runtime_revision,
  DROP COLUMN IF EXISTS observation_source;

ALTER TABLE remote_task_binding
  DROP CONSTRAINT IF EXISTS remote_task_binding_ttl_expiry_check,
  DROP CONSTRAINT IF EXISTS remote_task_binding_frozen_authority_check,
  DROP CONSTRAINT IF EXISTS remote_task_binding_protocol_contract_object_check,
  DROP COLUMN IF EXISTS task_expires_at,
  DROP COLUMN IF EXISTS task_ttl_ms,
  DROP COLUMN IF EXISTS provider_revision,
  DROP COLUMN IF EXISTS runtime_revision,
  DROP COLUMN IF EXISTS task_behavior,
  DROP COLUMN IF EXISTS protocol_contract_json;

ALTER TABLE workflow_plan DROP COLUMN IF EXISTS mcp_protocol_contract_json;
ALTER TABLE workflow_plan_attempt DROP COLUMN IF EXISTS mcp_protocol_contract_json;
ALTER TABLE mcp_tool DROP COLUMN IF EXISTS output_schema_json;

ALTER TABLE mcp_server
  DROP CONSTRAINT IF EXISTS mcp_server_current_protocol_snapshot_fkey,
  DROP COLUMN IF EXISTS current_protocol_snapshot_id,
  DROP COLUMN IF EXISTS protocol_mode;

DROP TABLE IF EXISTS mcp_protocol_snapshot;
DELETE FROM schema_migration WHERE version='0107_frozen_mcp_tasks_protocol';

COMMIT;
