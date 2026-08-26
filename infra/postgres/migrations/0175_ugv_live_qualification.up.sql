CREATE TABLE ugv_live_qualification (
  request_id text PRIMARY KEY CHECK (request_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  invocation_id text NOT NULL UNIQUE,
  execution_context jsonb NOT NULL DEFAULT '{"mode":"live"}'::jsonb
    CHECK (execution_context = '{"mode":"live"}'::jsonb),
  status text NOT NULL CHECK (status IN ('dispatching','completed','uncertain')),
  created_at timestamptz NOT NULL,
  authority_snapshot jsonb,
  dispatch_hash text CHECK (dispatch_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_hash text CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK ((authority_snapshot IS NULL) = (dispatch_hash IS NULL)),
  CHECK (status <> 'completed' OR (authority_snapshot IS NOT NULL AND result_hash IS NOT NULL))
);

CREATE FUNCTION guard_ugv_live_qualification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.request_id,NEW.invocation_id,NEW.execution_context,NEW.created_at)
       IS DISTINCT FROM (OLD.request_id,OLD.invocation_id,OLD.execution_context,OLD.created_at)
     OR OLD.status <> 'dispatching'
     OR (OLD.authority_snapshot IS NOT NULL AND
         (NEW.authority_snapshot,NEW.dispatch_hash) IS DISTINCT FROM
         (OLD.authority_snapshot,OLD.dispatch_hash))
  THEN RAISE EXCEPTION 'UGV_LIVE_QUALIFICATION_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ugv_live_qualification_immutable BEFORE UPDATE ON ugv_live_qualification
FOR EACH ROW EXECUTE FUNCTION guard_ugv_live_qualification();
INSERT INTO schema_migration(version) VALUES ('0175_ugv_live_qualification');
