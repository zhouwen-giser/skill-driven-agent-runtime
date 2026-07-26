BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experience_usage_record) THEN
    RAISE EXCEPTION 'ROLLBACK_0121_REFUSED_USAGE_RECORD_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM knowledge_relation) THEN
    RAISE EXCEPTION 'ROLLBACK_0121_REFUSED_KNOWLEDGE_RELATION_EXISTS';
  END IF;
END $$;

DROP INDEX capability_pattern_definition_active_fts_idx;
DROP INDEX task_type_definition_active_fts_idx;
DROP INDEX planning_heuristic_active_fts_idx;
DROP INDEX knowledge_relation_target_idx;
DROP INDEX knowledge_relation_source_idx;
DROP TABLE knowledge_relation;
DROP INDEX experience_usage_record_query_replay_idx;
DROP INDEX experience_usage_record_session_knowledge_idx;

ALTER TABLE experience_usage_record
  DROP COLUMN retrieval_rank,
  DROP COLUMN query_fingerprint,
  DROP COLUMN authoritative_ref;

DELETE FROM schema_migration
WHERE version = '0121_v123_knowledge_usage';

COMMIT;
