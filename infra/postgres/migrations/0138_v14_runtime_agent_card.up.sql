BEGIN;

CREATE TABLE runtime_agent_card_revision (
  revision bigint PRIMARY KEY CHECK(revision > 0),
  node_id text NOT NULL,
  exposure_refs jsonb NOT NULL CHECK(jsonb_typeof(exposure_refs)='array'),
  content_hash char(64) NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
  capability_catalog_hash char(64) NOT NULL CHECK(capability_catalog_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK(status IN ('staged','active','rejected','superseded')),
  card jsonb NOT NULL CHECK(jsonb_typeof(card)='object'),
  generated_at timestamptz NOT NULL,
  activated_at timestamptz,
  UNIQUE(content_hash,capability_catalog_hash)
);

CREATE UNIQUE INDEX runtime_agent_card_single_active_idx
  ON runtime_agent_card_revision((status)) WHERE status='active';

CREATE TABLE runtime_agent_card_command_receipt (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL REFERENCES runtime_agent_card_revision(revision),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(scope,idempotency_key)
);

CREATE FUNCTION prevent_runtime_agent_card_content_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.node_id IS DISTINCT FROM OLD.node_id OR
     NEW.exposure_refs IS DISTINCT FROM OLD.exposure_refs OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
     NEW.capability_catalog_hash IS DISTINCT FROM OLD.capability_catalog_hash OR
     NEW.card IS DISTINCT FROM OLD.card OR NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN
    RAISE EXCEPTION 'RUNTIME_AGENT_CARD_CONTENT_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER runtime_agent_card_content_immutable
BEFORE UPDATE ON runtime_agent_card_revision
FOR EACH ROW EXECUTE FUNCTION prevent_runtime_agent_card_content_mutation();

INSERT INTO schema_migration(version) VALUES ('0138_v14_runtime_agent_card');
COMMIT;
