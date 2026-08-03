CREATE TABLE sdar_control.configuration_revision (
  configuration_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN (
    'node','llm_provider','model_route','smpp_source','mcp_provider_binding',
    'telemetry_link','runtime_policy'
  )),
  target_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN (
    'draft','validated','published','applying','applied','partially_applied','rejected','rolled_back'
  )),
  apply_mode text NOT NULL CHECK (apply_mode IN (
    'hot_reload','new_task_only','reconnect_required','restart_required','immutable'
  )),
  content jsonb NOT NULL CHECK (pg_column_size(content) <= 262144),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  PRIMARY KEY (configuration_id, revision),
  UNIQUE (target_type, target_id, revision),
  CHECK ((status IN ('published','applying','applied','partially_applied','rejected','rolled_back')) = (published_at IS NOT NULL))
);

CREATE INDEX configuration_revision_target_latest_idx
  ON sdar_control.configuration_revision (target_type, target_id, revision DESC);

CREATE TABLE sdar_control.configuration_application (
  application_id text PRIMARY KEY,
  configuration_id text NOT NULL,
  revision bigint NOT NULL,
  runtime_instance_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending','staging','applied','partially_applied','rejected','restart_required','stale','unavailable'
  )),
  observed_runtime_version text,
  active_checksum char(64) CHECK (active_checksum IS NULL OR active_checksum ~ '^[a-f0-9]{64}$'),
  reason_code text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(detail) <= 65536),
  acknowledged_at timestamptz,
  UNIQUE (configuration_id, revision, runtime_instance_id),
  FOREIGN KEY (configuration_id, revision)
    REFERENCES sdar_control.configuration_revision(configuration_id, revision)
);

CREATE TABLE sdar_control.configuration_target_state (
  target_type text NOT NULL,
  target_id text NOT NULL,
  desired_configuration_id text NOT NULL,
  desired_revision bigint NOT NULL CHECK (desired_revision > 0),
  desired_checksum char(64) NOT NULL CHECK (desired_checksum ~ '^[a-f0-9]{64}$'),
  desired_status text NOT NULL,
  desired_operation_id text NOT NULL REFERENCES sdar_control.management_operation(operation_id),
  observed_configuration_id text,
  observed_revision bigint CHECK (observed_revision IS NULL OR observed_revision > 0),
  observed_checksum char(64) CHECK (observed_checksum IS NULL OR observed_checksum ~ '^[a-f0-9]{64}$'),
  observed_status text NOT NULL DEFAULT 'unavailable',
  observed_runtime_version text,
  observed_at timestamptz,
  convergence_status text NOT NULL CHECK (convergence_status IN (
    'converged','pending','degraded','rejected','restart_required','unavailable'
  )),
  reason_code text,
  detail text,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  PRIMARY KEY (target_type, target_id),
  FOREIGN KEY (desired_configuration_id, desired_revision)
    REFERENCES sdar_control.configuration_revision(configuration_id, revision),
  FOREIGN KEY (observed_configuration_id, observed_revision)
    REFERENCES sdar_control.configuration_revision(configuration_id, revision),
  CHECK (
    (observed_configuration_id IS NULL AND observed_revision IS NULL AND observed_checksum IS NULL)
    OR
    (observed_configuration_id IS NOT NULL AND observed_revision IS NOT NULL AND observed_checksum IS NOT NULL)
  )
);

CREATE TABLE sdar_control.configuration_command_receipt (
  command_scope text NOT NULL,
  idempotency_key_hash char(64) NOT NULL CHECK (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  configuration_id text,
  revision bigint,
  operation_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (command_scope, idempotency_key_hash),
  CHECK (
    (configuration_id IS NOT NULL AND revision IS NOT NULL)
    OR operation_id IS NOT NULL
  )
);

CREATE OR REPLACE FUNCTION sdar_control.protect_published_configuration_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status NOT IN ('draft','validated') AND (
    NEW.configuration_id IS DISTINCT FROM OLD.configuration_id
    OR NEW.target_type IS DISTINCT FROM OLD.target_type
    OR NEW.target_id IS DISTINCT FROM OLD.target_id
    OR NEW.revision IS DISTINCT FROM OLD.revision
    OR NEW.apply_mode IS DISTINCT FROM OLD.apply_mode
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.checksum IS DISTINCT FROM OLD.checksum
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'CONTROL_PUBLISHED_CONFIGURATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER configuration_published_content_immutable
BEFORE UPDATE ON sdar_control.configuration_revision
FOR EACH ROW EXECUTE FUNCTION sdar_control.protect_published_configuration_content();
