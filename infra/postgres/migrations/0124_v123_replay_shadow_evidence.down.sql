BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM promotion_provenance_report LIMIT 1) THEN
    RAISE EXCEPTION
      '0124 rollback refused: Replay/Shadow Promotion provenance would be destroyed';
  END IF;
END
$$;

DROP TABLE promotion_provenance_report;

DELETE FROM schema_migration
WHERE version = '0124_v123_replay_shadow_evidence';

COMMIT;
