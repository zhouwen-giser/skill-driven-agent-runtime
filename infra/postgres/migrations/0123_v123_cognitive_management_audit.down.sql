BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cognitive_management_action LIMIT 1) THEN
    RAISE EXCEPTION
      '0123 rollback refused: cognitive management audit records would be destroyed';
  END IF;
END
$$;

DROP TABLE cognitive_management_action;

DELETE FROM schema_migration
WHERE version = '0123_v123_cognitive_management_audit';

COMMIT;
