BEGIN;

CREATE TABLE runtime_configuration_snapshot (
  configuration_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  target_type text NOT NULL,
  target_id text NOT NULL,
  apply_mode text NOT NULL CHECK (apply_mode IN (
    'hot_reload','new_task_only','reconnect_required','restart_required','immutable'
  )),
  content jsonb NOT NULL CHECK (pg_column_size(content) <= 262144),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  is_lkg boolean NOT NULL DEFAULT false,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (configuration_id, revision),
  UNIQUE (target_type, target_id, revision)
);

CREATE UNIQUE INDEX runtime_configuration_one_active_idx
  ON runtime_configuration_snapshot (target_type,target_id) WHERE is_active;
CREATE UNIQUE INDEX runtime_configuration_one_lkg_idx
  ON runtime_configuration_snapshot (target_type,target_id) WHERE is_lkg;

CREATE TABLE runtime_configuration_ack_outbox (
  ack_id text PRIMARY KEY,
  runtime_instance_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN (
    'applied','partially_applied','rejected','restart_required','stale','unavailable'
  )),
  observed_runtime_version text NOT NULL,
  active_checksum char(64) CHECK (active_checksum IS NULL OR active_checksum ~ '^[a-f0-9]{64}$'),
  reason_code text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(detail) <= 65536),
  acknowledged_at timestamptz NOT NULL,
  delivered_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  last_error text,
  UNIQUE (runtime_instance_id,target_type,target_id,revision,status)
);

CREATE INDEX runtime_configuration_ack_pending_idx
  ON runtime_configuration_ack_outbox (acknowledged_at,ack_id) WHERE delivered_at IS NULL;

CREATE TABLE runtime_task_configuration_binding (
  task_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  configuration_id text NOT NULL,
  revision bigint NOT NULL,
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (task_id,target_type,target_id),
  FOREIGN KEY (configuration_id,revision)
    REFERENCES runtime_configuration_snapshot(configuration_id,revision)
);

CREATE OR REPLACE FUNCTION sdar_reject_runtime_configuration_binding_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'RUNTIME_TASK_CONFIGURATION_BINDING_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER runtime_task_configuration_binding_immutable
BEFORE UPDATE OR DELETE ON runtime_task_configuration_binding
FOR EACH ROW EXECUTE FUNCTION sdar_reject_runtime_configuration_binding_mutation();

INSERT INTO schema_migration(version)
VALUES ('0135_v14_runtime_configuration_lkg');

COMMIT;
