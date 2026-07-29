BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compilation_run LIMIT 1)
    OR EXISTS (SELECT 1 FROM experience_trace_source LIMIT 1)
    OR EXISTS (SELECT 1 FROM pattern_candidate_support LIMIT 1)
  THEN
    RAISE EXCEPTION
      '0126 rollback refused: Experience compilation evidence would be destroyed';
  END IF;
END
$$;

DROP TRIGGER pattern_candidate_support_immutability ON pattern_candidate_support;
DROP TRIGGER pattern_candidate_immutability ON pattern_candidate;
DROP TRIGGER experience_trace_source_immutability ON experience_trace_source;
DROP TRIGGER experience_trace_immutability ON experience_trace;
DROP FUNCTION sdar_reject_experience_compilation_mutation();

DROP TABLE compilation_run;
DROP TABLE pattern_candidate_support;
DROP TABLE experience_trace_source;

DELETE FROM schema_migration
WHERE version = '0126_v13_experience_compilation';

COMMIT;
