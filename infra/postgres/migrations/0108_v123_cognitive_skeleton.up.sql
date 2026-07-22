BEGIN;

CREATE TABLE cognitive_runtime_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 128)
);

CREATE TABLE runtime_capability_summary (
  summary_id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 1),
  catalog_hash text NOT NULL CHECK (catalog_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('building', 'active', 'superseded', 'failed')),
  schema_version text NOT NULL CHECK (schema_version = '1.0'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  built_at timestamptz NOT NULL,
  UNIQUE (catalog_hash, revision)
);
CREATE UNIQUE INDEX runtime_capability_summary_one_active
  ON runtime_capability_summary ((status)) WHERE status = 'active';

CREATE TABLE runtime_capability_summary_item (
  summary_id text NOT NULL REFERENCES runtime_capability_summary(summary_id) ON DELETE CASCADE,
  capability_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  PRIMARY KEY (summary_id, capability_id),
  UNIQUE (summary_id, ordinal)
);

CREATE TABLE runtime_capability_limitation (
  summary_id text NOT NULL,
  capability_id text NOT NULL,
  limitation_id text NOT NULL,
  reason_code text NOT NULL,
  detail text NOT NULL CHECK (length(detail) BETWEEN 1 AND 4096),
  PRIMARY KEY (summary_id, capability_id, limitation_id),
  FOREIGN KEY (summary_id, capability_id)
    REFERENCES runtime_capability_summary_item(summary_id, capability_id) ON DELETE CASCADE
);

CREATE TABLE public_capability_card_snapshot (
  snapshot_id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 1),
  summary_id text NOT NULL REFERENCES runtime_capability_summary(summary_id),
  catalog_hash text NOT NULL CHECK (catalog_hash ~ '^sha256:[0-9a-f]{64}$'),
  generation_policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate', 'active', 'superseded', 'failed')),
  card jsonb NOT NULL CHECK (jsonb_typeof(card) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (catalog_hash, generation_policy_version, revision)
);
CREATE UNIQUE INDEX public_capability_card_one_active
  ON public_capability_card_snapshot ((status)) WHERE status = 'active';

CREATE TABLE generic_task_understanding (
  understanding_id text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  disposition text NOT NULL CHECK (disposition IN (
    'clarification_required', 'confirmation_required', 'contract_candidate', 'rejected'
  )),
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 8192),
  policy_version text NOT NULL,
  state_hash text NOT NULL CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (task_id, revision),
  UNIQUE (task_id, state_hash)
);

CREATE TABLE generic_task_understanding_dimension (
  understanding_id text NOT NULL REFERENCES generic_task_understanding(understanding_id) ON DELETE CASCADE,
  dimension_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'target', 'scope', 'time_range', 'criteria', 'artifact', 'evidence', 'side_effect_authorization'
  )),
  severity text NOT NULL CHECK (severity IN ('blocking', 'conditional', 'non_blocking')),
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 2048),
  answered boolean NOT NULL,
  authorization_sensitive boolean NOT NULL,
  PRIMARY KEY (understanding_id, dimension_id)
);

CREATE TABLE interactive_goal_session (
  session_id text PRIMARY KEY,
  task_id text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN (
    'understand', 'goal_review', 'confirmed', 'rejected', 'canceled', 'budget_exhausted'
  )),
  version integer NOT NULL CHECK (version >= 1),
  current_understanding_id text REFERENCES generic_task_understanding(understanding_id),
  current_candidate_id text,
  current_candidate_revision integer CHECK (current_candidate_revision >= 1),
  clarification_rounds integer NOT NULL CHECK (clarification_rounds >= 0),
  revision_count integer NOT NULL CHECK (revision_count >= 0),
  max_clarification_rounds integer NOT NULL CHECK (max_clarification_rounds >= 0),
  max_revisions integer NOT NULL CHECK (max_revisions >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((current_candidate_id IS NULL) = (current_candidate_revision IS NULL)),
  CHECK (clarification_rounds <= max_clarification_rounds),
  CHECK (revision_count <= max_revisions)
);

CREATE TABLE interactive_goal_turn (
  turn_id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES interactive_goal_session(session_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  expected_session_version integer NOT NULL CHECK (expected_session_version >= 1),
  idempotency_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('answer', 'accept', 'patch', 'reject', 'restart_understanding', 'cancel')),
  actor_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, ordinal),
  UNIQUE (session_id, idempotency_key)
);

CREATE TABLE goal_contract_candidate (
  candidate_id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES interactive_goal_session(session_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('candidate', 'confirmed', 'rejected', 'superseded')),
  contract jsonb NOT NULL CHECK (jsonb_typeof(contract) = 'object'),
  contract_hash text NOT NULL CHECK (contract_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, revision)
);

CREATE TABLE interactive_planning_session (
  session_id text PRIMARY KEY,
  task_id text NOT NULL UNIQUE,
  goal_session_id text NOT NULL REFERENCES interactive_goal_session(session_id),
  confirmed_contract_candidate_id text NOT NULL REFERENCES goal_contract_candidate(candidate_id),
  state text NOT NULL CHECK (state IN ('plan_review', 'confirmed', 'rejected', 'canceled', 'budget_exhausted')),
  version integer NOT NULL CHECK (version >= 1),
  current_candidate_id text,
  current_candidate_revision integer CHECK (current_candidate_revision >= 1),
  revision_count integer NOT NULL CHECK (revision_count >= 0),
  max_revisions integer NOT NULL CHECK (max_revisions >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((current_candidate_id IS NULL) = (current_candidate_revision IS NULL)),
  CHECK (revision_count <= max_revisions)
);

CREATE TABLE interactive_planning_turn (
  turn_id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES interactive_planning_session(session_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  expected_session_version integer NOT NULL CHECK (expected_session_version >= 1),
  idempotency_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('accept', 'patch', 'reject', 'cancel')),
  actor_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, ordinal),
  UNIQUE (session_id, idempotency_key)
);

CREATE TABLE user_goal_plan_candidate (
  candidate_id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES interactive_planning_session(session_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('candidate', 'confirmed', 'rejected', 'superseded')),
  base_plan_id text,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  plan_hash text NOT NULL CHECK (plan_hash ~ '^sha256:[0-9a-f]{64}$'),
  validation jsonb NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, revision)
);

CREATE TABLE planning_correction_fact (
  correction_id text PRIMARY KEY,
  task_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('task', 'user', 'tenant', 'global_candidate')),
  tenant_id text,
  user_id text,
  correction_type text NOT NULL,
  before_snapshot jsonb NOT NULL,
  user_instruction text NOT NULL CHECK (length(user_instruction) BETWEEN 1 AND 8192),
  structured_patch jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  validation jsonb NOT NULL,
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (task_id, idempotency_key),
  CHECK (scope <> 'user' OR user_id IS NOT NULL),
  CHECK (scope <> 'tenant' OR tenant_id IS NOT NULL)
);

CREATE TABLE planning_interaction_episode (
  episode_id text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  episode_hash text NOT NULL CHECK (episode_hash ~ '^sha256:[0-9a-f]{64}$'),
  completeness numeric(5,4) NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (task_id, revision),
  UNIQUE (task_id, episode_hash)
);

CREATE TABLE cognitive_runtime_outbox (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 1),
  correlation jsonb NOT NULL CHECK (jsonb_typeof(correlation) = 'object'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (aggregate_type, aggregate_id, aggregate_version, event_type)
);
CREATE INDEX cognitive_runtime_outbox_unpublished
  ON cognitive_runtime_outbox (occurred_at, event_id) WHERE published_at IS NULL;

CREATE TABLE cognitive_runtime_consumer_cursor (
  consumer_name text PRIMARY KEY,
  last_event_id text,
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL
);

CREATE TABLE experience_job (
  job_id text PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('episode', 'observe', 'reflect', 'induce', 'revalidate')),
  subject_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'retry_wait', 'completed', 'dead_letter')),
  attempt integer NOT NULL CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts >= 1),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX experience_job_claimable ON experience_job (status, available_at, job_id);

CREATE TABLE experience_dead_letter (
  dead_letter_id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE REFERENCES experience_job(job_id),
  error_code text NOT NULL,
  error_summary text NOT NULL,
  failed_at timestamptz NOT NULL,
  replayed_at timestamptz,
  replayed_by text
);

CREATE TABLE goal_experience_episode (
  episode_id text PRIMARY KEY,
  goal_id text NOT NULL,
  goal_version integer NOT NULL CHECK (goal_version >= 1),
  revision integer NOT NULL CHECK (revision >= 1),
  episode_hash text NOT NULL CHECK (episode_hash ~ '^sha256:[0-9a-f]{64}$'),
  completeness numeric(5,4) NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  data_classification text NOT NULL CHECK (data_classification IN ('public', 'internal', 'user_scoped', 'restricted')),
  redaction_codes jsonb NOT NULL CHECK (jsonb_typeof(redaction_codes) = 'array'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (goal_id, goal_version, revision),
  UNIQUE (goal_id, goal_version, episode_hash)
);

CREATE TABLE goal_experience_episode_source (
  episode_id text NOT NULL REFERENCES goal_experience_episode(episode_id) ON DELETE CASCADE,
  source_ref_id text NOT NULL,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  source_revision integer NOT NULL CHECK (source_revision >= 1),
  authority text NOT NULL,
  data_classification text NOT NULL,
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^sha256:[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (episode_id, source_ref_id)
);

CREATE TABLE experience_observation (
  observation_id text PRIMARY KEY,
  episode_id text NOT NULL REFERENCES goal_experience_episode(episode_id),
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('pending', 'partial', 'completed', 'failed')),
  model_invocation_id text,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (episode_id, revision)
);

CREATE TABLE experience_observation_fact (
  observation_id text NOT NULL REFERENCES experience_observation(observation_id) ON DELETE CASCADE,
  statement_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fact', 'inference', 'candidate_lesson', 'uncertainty', 'contradiction')),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 4096),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_ref_ids jsonb NOT NULL CHECK (jsonb_typeof(source_ref_ids) = 'array'),
  PRIMARY KEY (observation_id, statement_id)
);

CREATE TABLE experience_extraction (
  extraction_id text PRIMARY KEY,
  observation_id text NOT NULL REFERENCES experience_observation(observation_id) ON DELETE CASCADE,
  extractor_kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'no_op', 'failed')),
  result jsonb NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL,
  UNIQUE (observation_id, extractor_kind)
);

CREATE TABLE experience_reflection (
  reflection_id text PRIMARY KEY,
  observation_id text NOT NULL REFERENCES experience_observation(observation_id),
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('completed', 'no_op', 'failed')),
  delta jsonb NOT NULL,
  model_invocation_id text,
  created_at timestamptz NOT NULL,
  UNIQUE (observation_id, revision)
);

CREATE TABLE planning_heuristic (
  knowledge_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('candidate', 'validating', 'active', 'deprecated', 'rejected')),
  scope text NOT NULL CHECK (scope IN ('task', 'user', 'tenant', 'global_candidate')),
  tenant_id text,
  user_id text,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_id, revision),
  CHECK (scope <> 'user' OR user_id IS NOT NULL),
  CHECK (scope <> 'tenant' OR tenant_id IS NOT NULL)
);

CREATE TABLE planning_heuristic_evidence (
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL,
  evidence_id text NOT NULL,
  polarity text NOT NULL CHECK (polarity IN ('support', 'contradiction')),
  source_ref jsonb NOT NULL CHECK (jsonb_typeof(source_ref) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_id, knowledge_revision, evidence_id),
  FOREIGN KEY (knowledge_id, knowledge_revision) REFERENCES planning_heuristic(knowledge_id, revision) ON DELETE CASCADE
);

CREATE TABLE task_type_definition (
  knowledge_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('candidate', 'validating', 'active', 'deprecated', 'rejected')),
  scope text NOT NULL CHECK (scope IN ('task', 'user', 'tenant', 'global_candidate')),
  tenant_id text,
  user_id text,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_id, revision),
  CHECK (scope <> 'user' OR user_id IS NOT NULL),
  CHECK (scope <> 'tenant' OR tenant_id IS NOT NULL)
);

CREATE TABLE task_type_evidence (
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL,
  evidence_id text NOT NULL,
  polarity text NOT NULL CHECK (polarity IN ('support', 'contradiction')),
  source_ref jsonb NOT NULL CHECK (jsonb_typeof(source_ref) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_id, knowledge_revision, evidence_id),
  FOREIGN KEY (knowledge_id, knowledge_revision) REFERENCES task_type_definition(knowledge_id, revision) ON DELETE CASCADE
);

CREATE TABLE capability_pattern_definition (
  knowledge_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('candidate', 'validating', 'active', 'deprecated', 'rejected')),
  scope text NOT NULL CHECK (scope IN ('task', 'user', 'tenant', 'global_candidate')),
  tenant_id text,
  user_id text,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  catalog_hash text NOT NULL CHECK (catalog_hash ~ '^sha256:[0-9a-f]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_id, revision),
  CHECK (scope <> 'user' OR user_id IS NOT NULL),
  CHECK (scope <> 'tenant' OR tenant_id IS NOT NULL)
);

CREATE TABLE capability_pattern_evidence (
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL,
  evidence_id text NOT NULL,
  polarity text NOT NULL CHECK (polarity IN ('support', 'contradiction')),
  source_ref jsonb NOT NULL CHECK (jsonb_typeof(source_ref) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (knowledge_id, knowledge_revision, evidence_id),
  FOREIGN KEY (knowledge_id, knowledge_revision) REFERENCES capability_pattern_definition(knowledge_id, revision) ON DELETE CASCADE
);

CREATE TABLE capability_experience_evidence (
  evidence_id text PRIMARY KEY,
  capability_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('declared', 'observed', 'validated')),
  exact_skill_version_ref text,
  source_ref jsonb NOT NULL CHECK (jsonb_typeof(source_ref) = 'object'),
  created_at timestamptz NOT NULL
);

CREATE TABLE knowledge_promotion_evaluation (
  evaluation_id text PRIMARY KEY,
  knowledge_kind text NOT NULL CHECK (knowledge_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')),
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL CHECK (knowledge_revision >= 1),
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'rejected', 'incubating')),
  evidence_summary jsonb NOT NULL CHECK (jsonb_typeof(evidence_summary) = 'object'),
  replay_report_ref text,
  shadow_report_ref text,
  human_approved boolean NOT NULL DEFAULT false,
  decided_by text,
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  UNIQUE (knowledge_kind, knowledge_id, knowledge_revision, policy_version)
);

CREATE TABLE knowledge_status_transition (
  transition_id text PRIMARY KEY,
  knowledge_kind text NOT NULL CHECK (knowledge_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')),
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL CHECK (knowledge_revision >= 1),
  expected_version integer NOT NULL CHECK (expected_version >= 1),
  from_status text NOT NULL CHECK (from_status IN ('candidate', 'validating', 'active', 'deprecated', 'rejected')),
  to_status text NOT NULL CHECK (to_status IN ('candidate', 'validating', 'active', 'deprecated', 'rejected')),
  reason text NOT NULL,
  actor_id text NOT NULL,
  human_approved boolean NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (knowledge_kind, knowledge_id, knowledge_revision, expected_version)
);

CREATE TABLE experience_usage_record (
  usage_id text PRIMARY KEY,
  planning_session_id text NOT NULL REFERENCES interactive_planning_session(session_id),
  plan_candidate_id text NOT NULL REFERENCES user_goal_plan_candidate(candidate_id),
  knowledge_kind text NOT NULL CHECK (knowledge_kind IN ('planning_heuristic', 'task_type', 'capability_pattern')),
  knowledge_id text NOT NULL,
  knowledge_revision integer NOT NULL CHECK (knowledge_revision >= 1),
  injection_mode text NOT NULL CHECK (injection_mode IN ('off', 'shadow', 'advisory', 'active_low_risk')),
  influence jsonb NOT NULL CHECK (jsonb_typeof(influence) = 'object'),
  user_action text,
  validator_result jsonb,
  final_outcome_ref text,
  created_at timestamptz NOT NULL,
  UNIQUE (planning_session_id, plan_candidate_id, knowledge_kind, knowledge_id, knowledge_revision)
);

INSERT INTO schema_migration(version) VALUES ('0108_v123_cognitive_skeleton');

COMMIT;
