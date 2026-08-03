BEGIN;

CREATE TABLE capability_readiness_snapshot (
  capability_id text NOT NULL,
  capability_version integer NOT NULL CHECK (capability_version >= 1),
  snapshot_version integer NOT NULL CHECK (snapshot_version >= 1),
  status text NOT NULL CHECK (status IN ('available','degraded','unavailable','suspended')),
  raw_status text NOT NULL CHECK (raw_status IN ('available','degraded','unavailable','suspended')),
  candidate_status text CHECK (candidate_status IS NULL OR candidate_status IN ('available','degraded','unavailable','suspended')),
  candidate_since timestamptz,
  evaluated_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until > evaluated_at),
  catalog_hash text NOT NULL CHECK (catalog_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons)='array'),
  available_implementations jsonb NOT NULL CHECK (jsonb_typeof(available_implementations)='array'),
  unavailable_implementations jsonb NOT NULL CHECK (jsonb_typeof(unavailable_implementations)='array'),
  evaluation_input jsonb NOT NULL CHECK (jsonb_typeof(evaluation_input)='object'),
  trigger_reason text NOT NULL CHECK (trigger_reason <> ''),
  PRIMARY KEY(capability_id,capability_version,snapshot_version),
  UNIQUE(snapshot_hash),
  CHECK ((candidate_status IS NULL) = (candidate_since IS NULL))
);

CREATE INDEX capability_readiness_latest_idx
  ON capability_readiness_snapshot(capability_id,capability_version,snapshot_version DESC);
CREATE INDEX capability_readiness_expiry_idx
  ON capability_readiness_snapshot(valid_until,capability_id,capability_version,snapshot_version DESC);

CREATE TABLE capability_readiness_command_receipt (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  capability_id text NOT NULL,
  capability_version integer NOT NULL,
  snapshot_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY(capability_id,capability_version,snapshot_version)
    REFERENCES capability_readiness_snapshot(capability_id,capability_version,snapshot_version)
);

CREATE FUNCTION prevent_capability_readiness_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CAPABILITY_READINESS_IMMUTABLE' USING ERRCODE='55000';
END
$$;

CREATE TRIGGER capability_readiness_immutable
BEFORE UPDATE OR DELETE ON capability_readiness_snapshot
FOR EACH ROW EXECUTE FUNCTION prevent_capability_readiness_mutation();

INSERT INTO schema_migration(version)
VALUES ('0137_v14_capability_readiness');

COMMIT;
