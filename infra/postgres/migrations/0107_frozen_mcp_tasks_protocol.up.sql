BEGIN;

CREATE TABLE mcp_protocol_snapshot (
  snapshot_id text PRIMARY KEY CHECK (length(btrim(snapshot_id)) BETWEEN 1 AND 256),
  server_id text NOT NULL REFERENCES mcp_server(server_id) ON DELETE RESTRICT,
  protocol_mode text NOT NULL CHECK (protocol_mode IN ('legacy_v11','frozen_v1')),
  protocol_version text NOT NULL CHECK (length(btrim(protocol_version)) BETWEEN 1 AND 128),
  baseline_sha256 text NOT NULL CHECK (baseline_sha256 ~ '^[0-9a-f]{64}$'),
  supported_versions_json jsonb NOT NULL CHECK (jsonb_typeof(supported_versions_json)='array'),
  capabilities_json jsonb NOT NULL CHECK (jsonb_typeof(capabilities_json)='object'),
  server_info_json jsonb NOT NULL CHECK (jsonb_typeof(server_info_json)='object'),
  task_notifications boolean NOT NULL,
  discovered_at timestamptz NOT NULL,
  valid_until timestamptz,
  tool_revision integer NOT NULL CHECK (tool_revision > 0),
  CHECK (valid_until IS NULL OR valid_until > discovered_at),
  UNIQUE (server_id, tool_revision, protocol_mode)
);

CREATE INDEX mcp_protocol_snapshot_server_discovered_idx
  ON mcp_protocol_snapshot(server_id,discovered_at DESC,snapshot_id);

ALTER TABLE mcp_server
  ADD COLUMN protocol_mode text NOT NULL DEFAULT 'legacy_v11'
    CHECK (protocol_mode IN ('legacy_v11','frozen_v1')),
  ADD COLUMN current_protocol_snapshot_id text;

ALTER TABLE mcp_server
  ADD CONSTRAINT mcp_server_current_protocol_snapshot_fkey
  FOREIGN KEY (current_protocol_snapshot_id)
  REFERENCES mcp_protocol_snapshot(snapshot_id) ON DELETE RESTRICT;

ALTER TABLE mcp_tool ADD COLUMN output_schema_json jsonb;

ALTER TABLE workflow_plan_attempt
  ADD COLUMN mcp_protocol_contract_json jsonb NOT NULL
  DEFAULT '{"mode":"legacy_v11","protocolVersion":"legacy","baselineSha256":"legacy-v11-historical"}'::jsonb
  CHECK (jsonb_typeof(mcp_protocol_contract_json)='object');

ALTER TABLE workflow_plan
  ADD COLUMN mcp_protocol_contract_json jsonb NOT NULL
  DEFAULT '{"mode":"legacy_v11","protocolVersion":"legacy","baselineSha256":"legacy-v11-historical"}'::jsonb
  CHECK (jsonb_typeof(mcp_protocol_contract_json)='object');

ALTER TABLE remote_task_binding
  ADD COLUMN protocol_contract_json jsonb,
  ADD COLUMN task_behavior text CHECK (
    task_behavior IS NULL OR task_behavior IN ('synchronous_only','server_directed','task_required')
  ),
  ADD COLUMN runtime_revision text CHECK (
    runtime_revision IS NULL OR runtime_revision ~ '^(0|[1-9][0-9]*)$'
  ),
  ADD COLUMN provider_revision text,
  ADD COLUMN task_ttl_ms bigint CHECK (task_ttl_ms IS NULL OR task_ttl_ms > 0),
  ADD COLUMN task_expires_at timestamptz;

UPDATE remote_task_binding
SET protocol_contract_json=jsonb_build_object(
  'mode','legacy_v11',
  'protocolVersion',protocol_revision,
  'baselineSha256','legacy-v11-historical'
)
WHERE protocol_contract_json IS NULL;

ALTER TABLE remote_task_binding
  ALTER COLUMN protocol_contract_json SET NOT NULL,
  ADD CONSTRAINT remote_task_binding_protocol_contract_object_check
    CHECK (jsonb_typeof(protocol_contract_json)='object'),
  ADD CONSTRAINT remote_task_binding_frozen_authority_check CHECK (
    protocol_contract_json->>'mode' <> 'frozen_v1'
    OR (task_behavior IS NOT NULL AND runtime_revision IS NOT NULL)
  ),
  ADD CONSTRAINT remote_task_binding_ttl_expiry_check CHECK (
    (task_ttl_ms IS NULL AND task_expires_at IS NULL)
    OR (task_ttl_ms IS NOT NULL AND task_expires_at IS NOT NULL)
  );

ALTER TABLE remote_task_observation
  ADD COLUMN observation_source text NOT NULL DEFAULT 'poll'
    CHECK (observation_source IN ('admission','poll','notification','reconciliation')),
  ADD COLUMN runtime_revision text CHECK (
    runtime_revision IS NULL OR runtime_revision ~ '^(0|[1-9][0-9]*)$'
  ),
  ADD COLUMN provider_revision text,
  ADD COLUMN subscription_id text;

CREATE UNIQUE INDEX remote_task_observation_frozen_revision_idx
  ON remote_task_observation(binding_id,runtime_revision)
  WHERE runtime_revision IS NOT NULL;

ALTER TABLE remote_task_control_event
  ADD COLUMN runtime_revision text CHECK (
    runtime_revision IS NULL OR runtime_revision ~ '^(0|[1-9][0-9]*)$'
  );

CREATE UNIQUE INDEX remote_task_control_frozen_revision_idx
  ON remote_task_control_event(binding_id,event_type,runtime_revision,result_hash)
  WHERE runtime_revision IS NOT NULL;

INSERT INTO schema_migration(version) VALUES('0107_frozen_mcp_tasks_protocol')
ON CONFLICT(version) DO NOTHING;

COMMIT;
