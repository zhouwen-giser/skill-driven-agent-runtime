BEGIN;

ALTER TABLE remote_task_binding
  ADD COLUMN authority_snapshot_json jsonb,
  ADD CONSTRAINT remote_task_binding_authority_snapshot_object_check CHECK (
    authority_snapshot_json IS NULL OR ((
      jsonb_typeof(authority_snapshot_json)='object'
      AND authority_snapshot_json->>'schemaVersion'='1.0'
      AND jsonb_typeof(authority_snapshot_json->'runtime')='object'
      AND octet_length(authority_snapshot_json::text) <= 65536
    ) IS TRUE)
  );

-- Existing receipt rows remain readable so startup recovery can quarantine them. New
-- receipt commits must carry the exact pre-dispatch authority snapshot.
ALTER TABLE remote_task_admission_intent
  ADD CONSTRAINT remote_task_admission_receipt_authority_check CHECK (
    status NOT IN ('receipt_recorded','materialized') OR ((
      jsonb_typeof(remote_receipt_json->'authoritySnapshot')='object'
      AND remote_receipt_json->'authoritySnapshot'->>'schemaVersion'='1.0'
      AND jsonb_typeof(remote_receipt_json->'authoritySnapshot'->'runtime')='object'
      AND octet_length((remote_receipt_json->'authoritySnapshot')::text) <= 65536
    ) IS TRUE)
  ) NOT VALID;

INSERT INTO schema_migration(version)
VALUES('0160_v14_remote_task_authority_snapshot');

COMMIT;
