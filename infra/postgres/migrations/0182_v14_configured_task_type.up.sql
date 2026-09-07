BEGIN;
ALTER TABLE task_type_definition DROP CONSTRAINT task_type_definition_definition_origin_check;
ALTER TABLE task_type_definition ADD CONSTRAINT task_type_definition_definition_origin_check
  CHECK (definition_origin IN ('reflection_candidate','task_type_induction','fixture','configured'));
ALTER TABLE task_type_definition ADD CONSTRAINT task_type_configured_source_hash_check
  CHECK (definition_origin <> 'configured' OR ((definition ? 'sourceHash') AND (definition ? 'origin') AND definition->>'origin'='configured' AND definition->>'sourceHash' ~ '^sha256:[0-9a-f]{64}$'));
INSERT INTO schema_migration(version) VALUES ('0182_v14_configured_task_type');
COMMIT;
