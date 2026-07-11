BEGIN;

ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS request_text text;
ALTER TABLE agent_task ADD COLUMN IF NOT EXISTS request_metadata jsonb;
UPDATE agent_task SET request_text = '' WHERE request_text IS NULL;
UPDATE agent_task SET request_metadata = '{}'::jsonb WHERE request_metadata IS NULL;
ALTER TABLE agent_task ALTER COLUMN request_text SET NOT NULL;
ALTER TABLE agent_task ALTER COLUMN request_metadata SET NOT NULL;

INSERT INTO schema_migration (version)
VALUES ('0004_task_request')
ON CONFLICT (version) DO NOTHING;

COMMIT;
