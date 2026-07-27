-- 0127_v13_artifact_candidate_generation.up.sql
-- P04: Pattern Generalization and Plan Template Candidate Compiler
-- Non-authoritative child tables; compiled_artifact remains the authoritative parent.

CREATE TABLE IF NOT EXISTS generalized_pattern (
    generalized_pattern_id   TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL,
    domain                   TEXT NOT NULL,
    task_type_id             TEXT NOT NULL,
    source_fused_pattern_ref TEXT NOT NULL,
    content                  JSONB NOT NULL,
    content_hash             TEXT NOT NULL,
    generalizer_version      TEXT NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generalized_pattern_lookup
    ON generalized_pattern (tenant_id, task_type_id);

CREATE TABLE IF NOT EXISTS candidate_fingerprint (
    fingerprint    TEXT PRIMARY KEY,
    artifact_type  TEXT NOT NULL,
    domain         TEXT NOT NULL,
    task_type_id   TEXT NOT NULL,
    artifact_ref   TEXT NOT NULL,
    generator_version TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_fingerprint_lookup
    ON candidate_fingerprint (artifact_type, domain, task_type_id);

CREATE TABLE IF NOT EXISTS candidate_static_validation (
    validation_id     TEXT PRIMARY KEY,
    artifact_ref      TEXT NOT NULL,
    schema_valid      BOOLEAN NOT NULL,
    dag_valid         BOOLEAN NOT NULL,
    required_criteria_covered BOOLEAN NOT NULL,
    capability_shape_valid   BOOLEAN NOT NULL,
    parameter_policy_valid  BOOLEAN NOT NULL,
    side_effect_replay_safe BOOLEAN NOT NULL,
    bounds_valid      BOOLEAN NOT NULL,
    duplicate_fingerprint   TEXT,
    errors            JSONB NOT NULL DEFAULT '[]',
    warnings          JSONB NOT NULL DEFAULT '[]',
    validator_version TEXT NOT NULL,
    result            TEXT NOT NULL CHECK (result IN ('passed_static', 'failed_static')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_validation_artifact
    ON candidate_static_validation (artifact_ref);

CREATE TABLE IF NOT EXISTS candidate_generation_run (
    run_id             TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    source_pattern_ref TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    result_artifact_ref TEXT,
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_candidate_generation_run_status
    ON candidate_generation_run (tenant_id, status);

CREATE TABLE IF NOT EXISTS candidate_model_invocation (
    invocation_id TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL REFERENCES candidate_generation_run (run_id) ON DELETE CASCADE,
    model_id      TEXT NOT NULL,
    prompt_hash   TEXT NOT NULL,
    input_hash    TEXT NOT NULL,
    output_hash   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_model_invocation_run
    ON candidate_model_invocation (run_id);

INSERT INTO schema_migration(version) VALUES('0127_v13_artifact_candidate_generation') ON CONFLICT (version) DO NOTHING;
