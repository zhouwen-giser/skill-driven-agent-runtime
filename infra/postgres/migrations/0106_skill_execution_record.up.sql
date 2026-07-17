BEGIN;

CREATE TABLE IF NOT EXISTS skill_execution_record (
  execution_id text PRIMARY KEY,
  parent_execution_id text REFERENCES skill_execution_record(execution_id),
  task_id text NOT NULL REFERENCES agent_task(task_id),
  goal_id text NOT NULL,
  goal_version integer NOT NULL CHECK (goal_version > 0),
  skill_id text NOT NULL,
  skill_version integer NOT NULL CHECK (skill_version > 0),
  selection_ref text NOT NULL CHECK (length(selection_ref) BETWEEN 1 AND 512),
  applicability_status text NOT NULL CHECK (
    applicability_status IN ('satisfied','partial','unsatisfied','unknown')
  ),
  usage_policy_json jsonb NOT NULL CHECK (jsonb_typeof(usage_policy_json) = 'object'),
  workflow_plan_id text NOT NULL REFERENCES workflow_plan(plan_id),
  workflow_definition_id text NOT NULL,
  workflow_definition_version integer NOT NULL CHECK (workflow_definition_version > 0),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (skill_id, skill_version) REFERENCES skill_version(skill_id, version),
  UNIQUE (task_id, workflow_plan_id, skill_id, skill_version)
);

CREATE INDEX IF NOT EXISTS skill_execution_record_task_created_idx
  ON skill_execution_record(task_id, created_at, execution_id);
CREATE INDEX IF NOT EXISTS skill_execution_record_parent_idx
  ON skill_execution_record(parent_execution_id, created_at, execution_id)
  WHERE parent_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS skill_execution_record_plan_idx
  ON skill_execution_record(workflow_plan_id, execution_id);

CREATE TABLE IF NOT EXISTS skill_execution_event (
  event_id text PRIMARY KEY,
  sequence_number bigint GENERATED ALWAYS AS IDENTITY,
  execution_id text NOT NULL REFERENCES skill_execution_record(execution_id),
  event_type text NOT NULL CHECK (event_type IN (
    'skill.discovered',
    'skill.applicability_assessed',
    'skill.selected',
    'skill.mode_selected',
    'skill.context_missing',
    'skill.context_resolved',
    'skill.composition_started',
    'skill.child_selected',
    'skill.plan_generated',
    'skill.procedure_compiled',
    'skill.plan_compliance_passed',
    'skill.plan_compliance_failed',
    'skill.execution_started',
    'skill.execution_waiting_external',
    'skill.execution_degraded',
    'skill.execution_completed',
    'skill.execution_failed',
    'skill.hard_gate_triggered',
    'skill.human_intervention',
    'skill.patch_candidate_created'
  )),
  status_after text CHECK (status_after IS NULL OR status_after IN (
    'selected','planning','executing','waiting_external',
    'completed','failed','cancelled','degraded'
  )),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 8192),
  details_json jsonb NOT NULL CHECK (jsonb_typeof(details_json) = 'object'),
  occurred_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_execution_event_sequence_idx
  ON skill_execution_event(execution_id, sequence_number);

CREATE INDEX IF NOT EXISTS skill_execution_event_order_idx
  ON skill_execution_event(execution_id, sequence_number);

CREATE TABLE IF NOT EXISTS skill_execution_reference (
  link_id text PRIMARY KEY,
  execution_id text NOT NULL REFERENCES skill_execution_record(execution_id),
  kind text NOT NULL CHECK (kind IN (
    'provider','resource','remote_task_binding','evidence',
    'hard_gate','human_intervention','outcome'
  )),
  reference_id text NOT NULL CHECK (length(reference_id) BETWEEN 1 AND 512),
  reference_type text NOT NULL CHECK (length(reference_type) BETWEEN 1 AND 512),
  source_system text NOT NULL CHECK (length(source_system) BETWEEN 1 AND 512),
  uri text CHECK (uri IS NULL OR length(uri) BETWEEN 1 AND 4096),
  checksum text CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'),
  produced_at timestamptz,
  producer_refs_json jsonb NOT NULL CHECK (jsonb_typeof(producer_refs_json) = 'array'),
  metadata_json jsonb NOT NULL CHECK (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (execution_id, kind, reference_id)
);

CREATE INDEX IF NOT EXISTS skill_execution_reference_lookup_idx
  ON skill_execution_reference(kind, reference_id, execution_id);

INSERT INTO schema_migration(version)
VALUES ('0106_skill_execution_record')
ON CONFLICT(version) DO NOTHING;

COMMIT;
