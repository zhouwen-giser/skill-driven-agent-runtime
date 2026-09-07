BEGIN;
-- Rollback only before any demonstration audit exists; never erase confirmation history.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM development_isolated_demo_audit) THEN
    RAISE EXCEPTION 'SOFTWARE_DEMO_AUDIT_REQUIRES_RETENTION';
  END IF;
END $$;
DROP TABLE development_isolated_demo_audit;
DROP FUNCTION development_isolated_demo_append_only();
DELETE FROM schema_migration WHERE version='0178_v14_development_isolated_demo';
COMMIT;
