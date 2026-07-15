BEGIN;

WITH ranked AS (
  SELECT call_id,
         row_number() OVER (
           PARTITION BY parent_instance_id,parent_node_id
           ORDER BY created_at DESC,completed_at DESC,call_id DESC
         ) AS position
  FROM skill_call_workflow
)
DELETE FROM skill_call_workflow AS relation
USING ranked
WHERE relation.call_id=ranked.call_id AND ranked.position > 1;

DROP INDEX IF EXISTS skill_call_workflow_parent_node_history_idx;

ALTER TABLE skill_call_workflow
  DROP CONSTRAINT IF EXISTS skill_call_workflow_pkey;

ALTER TABLE skill_call_workflow
  ADD CONSTRAINT skill_call_workflow_pkey PRIMARY KEY(parent_instance_id,parent_node_id);

ALTER TABLE skill_call_workflow
  DROP COLUMN IF EXISTS call_id;

DELETE FROM schema_migration WHERE version='0054_skill_call_history';

COMMIT;
