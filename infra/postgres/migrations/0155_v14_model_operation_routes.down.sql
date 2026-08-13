BEGIN;

-- Serialize the precondition check with route writers. Without this lock, an
-- embedding route could be inserted after the check and then be lost when the
-- operation column is dropped.
LOCK TABLE stage_model_route IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM stage_model_route WHERE operation <> 'structured_generation'
  ) THEN
    RAISE EXCEPTION 'MODEL_OPERATION_ROUTE_ROLLBACK_REQUIRES_REVIEW'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE stage_model_route
  DROP CONSTRAINT stage_model_route_pkey;

ALTER TABLE stage_model_route
  DROP COLUMN operation;

ALTER TABLE stage_model_route
  ADD PRIMARY KEY(stage);

DELETE FROM schema_migration
WHERE version = '0155_v14_model_operation_routes';

COMMIT;
