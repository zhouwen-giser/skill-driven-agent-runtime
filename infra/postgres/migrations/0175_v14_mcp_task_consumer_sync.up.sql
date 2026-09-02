BEGIN;

ALTER TABLE remote_task_admission_intent
  ADD COLUMN logical_invocation_id text UNIQUE,
  ADD COLUMN logical_identity_hash char(71),
  ADD COLUMN reconciliation_contract_json jsonb,
  ADD CONSTRAINT remote_task_admission_logical_identity_check CHECK (
    (logical_invocation_id IS NULL
      AND logical_identity_hash IS NULL
      AND reconciliation_contract_json IS NULL)
    OR
    (logical_invocation_id ~ '^mcp-logical-[a-f0-9]{64}$'
      AND logical_identity_hash ~ '^sha256:[a-f0-9]{64}$'
      AND jsonb_typeof(reconciliation_contract_json)='object'
      AND octet_length(reconciliation_contract_json::text) <= 2097152)
  );

CREATE TABLE remote_task_reconciliation_attempt (
  attempt_id text PRIMARY KEY CHECK (length(btrim(attempt_id)) BETWEEN 1 AND 256),
  intent_id text NOT NULL REFERENCES remote_task_admission_intent(intent_id) ON DELETE RESTRICT,
  logical_invocation_id text NOT NULL,
  expected_intent_version integer NOT NULL CHECK (expected_intent_version > 0),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  source_contract text NOT NULL CHECK (source_contract='sdar.smpp-diagnostics/v1+frozen-mcp-v1'),
  request_hash char(71) NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('found_exact','not_found','conflict','unavailable','deferred')),
  remote_task_id text,
  external_execution_id text,
  identity_validated boolean NOT NULL,
  safe_error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  result_hash char(71) NOT NULL CHECK (result_hash ~ '^sha256:[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version=1),
  UNIQUE(intent_id,attempt_number),
  FOREIGN KEY(logical_invocation_id)
    REFERENCES remote_task_admission_intent(logical_invocation_id) ON DELETE RESTRICT,
  CHECK (completed_at >= started_at),
  CHECK (
    (status='found_exact'
      AND identity_validated
      AND length(btrim(remote_task_id)) > 0
      AND safe_error_code IS NULL)
    OR
    (status<>'found_exact'
      AND NOT identity_validated
      AND remote_task_id IS NULL
      AND external_execution_id IS NULL
      AND safe_error_code IS NOT NULL)
  )
);

CREATE INDEX remote_task_reconciliation_pending_idx
  ON remote_task_admission_intent(updated_at,intent_id)
  WHERE status='uncertain' AND logical_invocation_id IS NOT NULL;
CREATE INDEX remote_task_reconciliation_attempt_intent_idx
  ON remote_task_reconciliation_attempt(intent_id,attempt_number);

CREATE TABLE remote_task_provider_execution_link (
  link_id text PRIMARY KEY CHECK (length(btrim(link_id)) BETWEEN 1 AND 256),
  binding_id text NOT NULL UNIQUE REFERENCES remote_task_binding(binding_id) ON DELETE RESTRICT,
  logical_invocation_id text NOT NULL UNIQUE,
  remote_task_id text NOT NULL,
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) BETWEEN 1 AND 512),
  runtime_server_id text NOT NULL CHECK (length(btrim(runtime_server_id)) BETWEEN 1 AND 512),
  provider_binding_id text,
  provider_origin_type text CHECK (provider_origin_type IN ('direct','smpp_registry')),
  smpp_source_id text,
  external_server_id text,
  operation_name text NOT NULL CHECK (length(btrim(operation_name)) BETWEEN 1 AND 512),
  execution_status text NOT NULL CHECK (execution_status IN ('unresolved','exact','conflict')),
  external_execution_id text,
  mission_status text NOT NULL CHECK (mission_status IN ('unresolved','exact','conflict')),
  device_mission_id text,
  provenance text NOT NULL CHECK (provenance IN ('committed_receipt','reconcile_found_exact')),
  source_contract text NOT NULL CHECK (
    source_contract='sdar.node-control-provider-binding/v1+frozen-mcp-v1'
  ),
  source_revision text NOT NULL CHECK (length(btrim(source_revision)) BETWEEN 1 AND 512),
  observed_at timestamptz NOT NULL,
  content_hash char(71) NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  FOREIGN KEY(logical_invocation_id)
    REFERENCES remote_task_admission_intent(logical_invocation_id) ON DELETE RESTRICT,
  UNIQUE(runtime_server_id,remote_task_id),
  CHECK ((execution_status='exact') = (external_execution_id IS NOT NULL)),
  CHECK ((mission_status='exact') = (device_mission_id IS NOT NULL)),
  CHECK (mission_status<>'exact' OR execution_status='exact'),
  CHECK (
    (provider_origin_type IS NULL AND provider_binding_id IS NULL
      AND smpp_source_id IS NULL AND external_server_id IS NULL)
    OR
    (provider_origin_type='direct' AND provider_binding_id IS NOT NULL
      AND smpp_source_id IS NULL AND external_server_id IS NULL)
    OR
    (provider_origin_type='smpp_registry' AND provider_binding_id IS NOT NULL
      AND smpp_source_id IS NOT NULL AND external_server_id IS NOT NULL)
  )
);

CREATE FUNCTION remote_task_consumer_sync_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REMOTE_TASK_CONSUMER_SYNC_IMMUTABLE';
END;
$$;

CREATE TRIGGER remote_task_reconciliation_attempt_immutable
  BEFORE UPDATE OR DELETE ON remote_task_reconciliation_attempt
  FOR EACH ROW EXECUTE FUNCTION remote_task_consumer_sync_immutable();
CREATE TRIGGER remote_task_provider_execution_link_immutable
  BEFORE UPDATE OR DELETE ON remote_task_provider_execution_link
  FOR EACH ROW EXECUTE FUNCTION remote_task_consumer_sync_immutable();

INSERT INTO schema_migration(version)
VALUES('0175_v14_mcp_task_consumer_sync');

COMMIT;
