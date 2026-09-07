BEGIN;
-- An inert UI state demonstration; deliberately no Task/Provider/Mission foreign keys.
CREATE TABLE development_isolated_demo_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('requested','confirmed')),
  payload jsonb NOT NULL,
  UNIQUE(request_id,phase)
);
CREATE FUNCTION development_isolated_demo_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SOFTWARE_DEMO_AUDIT_APPEND_ONLY';
END;
$$;
CREATE TRIGGER development_isolated_demo_immutable BEFORE UPDATE OR DELETE
ON development_isolated_demo_audit FOR EACH ROW EXECUTE FUNCTION development_isolated_demo_append_only();
INSERT INTO schema_migration(version) VALUES ('0178_v14_development_isolated_demo');
COMMIT;
