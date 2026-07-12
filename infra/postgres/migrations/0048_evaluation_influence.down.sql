BEGIN;
DROP TABLE IF EXISTS evaluation_influence;
ALTER TABLE workflow_template_occurrence DROP COLUMN IF EXISTS quality_report_id;
DELETE FROM schema_migration WHERE version='0048_evaluation_influence';
COMMIT;
