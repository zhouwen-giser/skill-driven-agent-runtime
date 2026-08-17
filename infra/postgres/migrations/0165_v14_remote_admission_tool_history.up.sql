BEGIN;

-- Admission intents freeze their server/operation identity and hashes. They are
-- historical dispatch evidence and must not prevent replacement of the mutable
-- current MCP tool catalog.
ALTER TABLE remote_task_admission_intent
  DROP CONSTRAINT remote_task_admission_tool_fk;

INSERT INTO schema_migration(version)
VALUES ('0165_v14_remote_admission_tool_history');

COMMIT;
