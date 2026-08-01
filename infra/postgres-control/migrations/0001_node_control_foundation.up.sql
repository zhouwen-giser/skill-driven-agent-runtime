CREATE SCHEMA IF NOT EXISTS sdar_control;

CREATE TABLE IF NOT EXISTS sdar_control.node_profile (
  node_id text PRIMARY KEY,
  node_type text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  environment text NOT NULL,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  authority_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_endpoint_ref text NOT NULL,
  telemetry_source_id text,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'maintenance', 'retired')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sdar_control.management_operation (
  operation_id text PRIMARY KEY,
  operation_type text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  target_version text,
  target_revision bigint CHECK (target_revision IS NULL OR target_revision > 0),
  status text NOT NULL CHECK (status IN ('accepted', 'running', 'succeeded', 'failed', 'canceled')),
  idempotency_key_hash char(64) NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  reason text NOT NULL,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (operation_type, idempotency_key_hash),
  CHECK ((status = 'failed' AND error_code IS NOT NULL) OR status <> 'failed')
);

CREATE INDEX IF NOT EXISTS management_operation_created_idx
  ON sdar_control.management_operation (created_at DESC, operation_id DESC);

CREATE TABLE IF NOT EXISTS sdar_control.control_audit_event (
  audit_id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  expected_revision bigint,
  result_revision bigint,
  reason text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_code text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS control_audit_event_created_idx
  ON sdar_control.control_audit_event (created_at DESC, audit_id DESC);

CREATE OR REPLACE FUNCTION sdar_control.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CONTROL_AUDIT_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS control_audit_event_immutable ON sdar_control.control_audit_event;
CREATE TRIGGER control_audit_event_immutable
BEFORE UPDATE OR DELETE ON sdar_control.control_audit_event
FOR EACH ROW EXECUTE FUNCTION sdar_control.reject_audit_mutation();
