BEGIN;
-- Removing an incremental origin would silently enqueue retained history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM evidence_export_delivery_origin WHERE delivery_start='from_activation') THEN
    RAISE EXCEPTION 'EVIDENCE_DELIVERY_ORIGIN_REQUIRES_RECONCILIATION';
  END IF;
END $$;
DROP FUNCTION evidence_delivery_start_sequence(text);
DROP TABLE evidence_export_delivery_origin;
DROP FUNCTION evidence_delivery_origin_immutable();
DELETE FROM schema_migration WHERE version='0174_v14_evidence_delivery_origin';
COMMIT;
