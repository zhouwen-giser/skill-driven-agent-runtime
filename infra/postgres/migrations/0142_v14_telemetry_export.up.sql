BEGIN;

CREATE TABLE runtime_telemetry_export_configuration (
  export_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  definition jsonb NOT NULL CHECK (pg_column_size(definition) <= 262144),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  is_lkg boolean NOT NULL DEFAULT false,
  PRIMARY KEY (export_id,revision)
);

CREATE UNIQUE INDEX runtime_telemetry_export_one_active_idx
  ON runtime_telemetry_export_configuration ((true)) WHERE is_active;
CREATE UNIQUE INDEX runtime_telemetry_export_one_lkg_idx
  ON runtime_telemetry_export_configuration ((true)) WHERE is_lkg;

CREATE TABLE runtime_telemetry_export_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  export_id text,
  collector_created_at timestamptz,
  collector_event_id text,
  last_acknowledged_sequence bigint CHECK (last_acknowledged_sequence IS NULL OR last_acknowledged_sequence >= 0),
  last_acknowledged_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  probe_healthy boolean,
  observed_at timestamptz NOT NULL
);

CREATE TABLE runtime_telemetry_export_outbox (
  sequence bigserial PRIMARY KEY,
  export_id text NOT NULL,
  source_event_id text NOT NULL UNIQUE REFERENCES runtime_event(event_id),
  family text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 262144),
  captured_at timestamptz NOT NULL,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  next_attempt_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  last_error_code text
);

CREATE INDEX runtime_telemetry_export_pending_idx
  ON runtime_telemetry_export_outbox (next_attempt_at,sequence) WHERE acknowledged_at IS NULL;

INSERT INTO schema_migration(version) VALUES ('0142_v14_telemetry_export');

COMMIT;
