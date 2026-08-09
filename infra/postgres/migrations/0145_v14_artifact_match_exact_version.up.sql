BEGIN;

-- Canonical artifact.retrieval Evidence must retain the immutable Artifact version selected by
-- P07. A bare artifact_id is insufficient authority once an Artifact key has more than one
-- version, so this forward migration backfills only from an exact persisted decision reference or
-- a provably unique compiled_artifact row. It deliberately has no MAX/latest fallback.
ALTER TABLE artifact_match_log
  ADD COLUMN artifact_version integer;

CREATE TEMP TABLE artifact_match_version_backfill ON COMMIT DROP AS
WITH exact_decision_version AS (
  SELECT DISTINCT match_row.match_id,artifact_row.version AS artifact_version
  FROM artifact_match_log match_row
  JOIN runtime_candidate_decision decision_row ON decision_row.match_id=match_row.match_id
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=match_row.candidate_artifact_id
   AND decision_row.selected_artifact_ref=
       artifact_row.artifact_id || ':' || artifact_row.version::text
  WHERE decision_row.selected_artifact_ref IS NOT NULL
), unique_artifact_version AS (
  SELECT match_row.match_id,artifact_row.version AS artifact_version
  FROM artifact_match_log match_row
  JOIN compiled_artifact artifact_row
    ON artifact_row.artifact_id=match_row.candidate_artifact_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM runtime_candidate_decision decision_row
    WHERE decision_row.match_id=match_row.match_id
      AND decision_row.selected_artifact_ref IS NOT NULL
  )
    AND NOT EXISTS (
      SELECT 1
      FROM compiled_artifact other_artifact
      WHERE other_artifact.artifact_id=match_row.candidate_artifact_id
        AND other_artifact.version<>artifact_row.version
    )
)
SELECT match_id,artifact_version
FROM exact_decision_version
UNION
SELECT match_id,artifact_version
FROM unique_artifact_version;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM artifact_match_log match_row
    JOIN runtime_candidate_decision decision_row ON decision_row.match_id=match_row.match_id
    WHERE decision_row.selected_artifact_ref IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM compiled_artifact artifact_row
        WHERE artifact_row.artifact_id=match_row.candidate_artifact_id
          AND decision_row.selected_artifact_ref=
              artifact_row.artifact_id || ':' || artifact_row.version::text
      )
  ) THEN
    RAISE EXCEPTION 'ARTIFACT_MATCH_BACKFILL_SELECTED_REF_INVALID'
      USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT match_row.match_id
    FROM artifact_match_log match_row
    LEFT JOIN artifact_match_version_backfill candidate
      ON candidate.match_id=match_row.match_id
    GROUP BY match_row.match_id
    HAVING count(DISTINCT candidate.artifact_version)<>1
  ) THEN
    RAISE EXCEPTION 'ARTIFACT_MATCH_BACKFILL_VERSION_AMBIGUOUS'
      USING ERRCODE='23514';
  END IF;
END
$$;

UPDATE artifact_match_log match_row
SET artifact_version=candidate.artifact_version
FROM artifact_match_version_backfill candidate
WHERE candidate.match_id=match_row.match_id;

ALTER TABLE artifact_match_log
  ALTER COLUMN artifact_version SET NOT NULL,
  ADD CONSTRAINT artifact_match_log_artifact_version_check CHECK (artifact_version>=1),
  DROP CONSTRAINT artifact_match_log_candidate_artifact_id_fkey,
  ADD CONSTRAINT artifact_match_log_candidate_artifact_version_fkey
    FOREIGN KEY (candidate_artifact_id,artifact_version)
    REFERENCES compiled_artifact(artifact_id,version);

CREATE INDEX artifact_match_log_artifact_version_idx
  ON artifact_match_log(candidate_artifact_id,artifact_version,created_at DESC,match_id);

INSERT INTO schema_migration(version)
VALUES ('0145_v14_artifact_match_exact_version');

COMMIT;
