import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  RuntimeCapabilityResolution,
  TaskCapabilityAcceptanceStore,
} from '../../application/src/index.js';
import {
  createTaskCapabilityBinding,
  createTaskCapabilityExecutionAttempt,
  type TaskCapabilityBinding,
  type TaskCapabilityExecutionAttempt,
} from '../../domain/src/index.js';

interface ResolutionRow extends QueryResultRow {
  exposure_id: string;
  exposure_version: number;
  capability_id: string;
  capability_version: number;
  request_schema: unknown;
  requester_policy: Record<string, unknown> | null;
  evaluation_input: Record<string, unknown>;
  available_implementations: string[];
  catalog_hash: string;
  policy_hash: string;
  snapshot_hash: string;
}

interface BindingRow extends QueryResultRow {
  binding_id: string;
  task_id: string;
  requested_capability_id: string;
  capability_version: number;
  exposure_id: string | null;
  exposure_version: number | null;
  input_snapshot: unknown;
  success_criteria_snapshot: Record<string, unknown>[];
  evidence_requirement_snapshot: Record<string, unknown>[];
  constraint_snapshot: Record<string, unknown>[];
  initial_implementation_refs: string[];
  provider_policy_snapshot: unknown;
  binding_hash: string;
  bound_at: Date;
}

interface AttemptRow extends QueryResultRow {
  attempt_id: string;
  task_id: string;
  capability_binding_id: string;
  attempt_no: number;
  plan_id: string | null;
  plan_template_ref: string | null;
  skill_version_refs: string[];
  provider_binding_refs: string[];
  reason: TaskCapabilityExecutionAttempt['reason'];
  status: TaskCapabilityExecutionAttempt['status'];
  started_at: Date | null;
  completed_at: Date | null;
}

interface SkillPolicyRow extends QueryResultRow {
  tool_policy: unknown;
  runtime_policy: unknown;
}

interface ArtifactPolicyRow extends QueryResultRow {
  dependency_snapshot: unknown;
}

export class PostgresTaskCapabilityRepository implements TaskCapabilityAcceptanceStore {
  readonly #pool: Pool;
  readonly #onTaskStateCommitted:
    ((task: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]['task']) => void) | undefined;

  constructor(
    pool: Pool,
    onTaskStateCommitted?: (
      task: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]['task'],
    ) => void,
  ) {
    this.#pool = pool;
    this.#onTaskStateCommitted = onTaskStateCommitted;
  }

  async resolveExposure(exposureId: string, exposureVersion: number, now: string) {
    const result = await this.#pool.query<ResolutionRow>(
      `SELECT exposure.exposure_id,exposure.exposure_version,exposure.capability_id,
              exposure.capability_version,exposure.request_schema,exposure.requester_policy,
              readiness.evaluation_input,readiness.available_implementations,
              readiness.catalog_hash,readiness.policy_hash,readiness.snapshot_hash
         FROM runtime_agent_card_revision card
         JOIN runtime_agent_card_exposure_snapshot exposure ON exposure.revision=card.revision
         JOIN LATERAL (
           SELECT evaluation_input,available_implementations,catalog_hash,policy_hash,snapshot_hash
             FROM capability_readiness_snapshot
            WHERE capability_id=exposure.capability_id
              AND capability_version=exposure.capability_version
              AND status IN ('available','degraded') AND valid_until>$3
            ORDER BY snapshot_version DESC LIMIT 1
         ) readiness ON true
        WHERE card.status='active' AND exposure.exposure_id=$1 AND exposure.exposure_version=$2`,
      [exposureId, exposureVersion, now],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const policies = await snapshotImplementationPolicies(this.#pool, row);
    return mapResolution(row, policies);
  }

  async accept(input: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `task-capability-accept:${input.task.taskId}`,
      ]);
      await insertTask(client, input.task);
      await client.query(
        `INSERT INTO task_execution_attempt(
           attempt_id,task_id,context_id,reason,status,input_request_id,created_at,
           started_at,completed_at,error_code)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.inputAttempt.attemptId,
          input.inputAttempt.taskId,
          input.inputAttempt.contextId,
          input.inputAttempt.reason,
          input.inputAttempt.status,
          input.inputAttempt.inputRequestId ?? null,
          input.inputAttempt.createdAt,
          input.inputAttempt.startedAt ?? null,
          input.inputAttempt.completedAt ?? null,
          input.inputAttempt.errorCode ?? null,
        ],
      );
      await insertBinding(client, input.binding);
      await insertAttempt(client, input.capabilityAttempt);
      await client.query(
        `INSERT INTO runtime_event(event_id,task_id,context_id,event_type,event_timestamp,summary)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          input.event.eventId,
          input.event.taskId,
          input.event.contextId,
          input.event.eventType,
          input.event.timestamp,
          input.event.summary,
        ],
      );
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at)
         VALUES($1,'node.task.capability_bound','task_capability_binding',$2,1,$3::jsonb,$4::jsonb,$5)
         ON CONFLICT(aggregate_type,aggregate_id,aggregate_version,event_type) DO NOTHING`,
        [
          `node-task-capability-bound:${input.binding.bindingId}`,
          input.binding.bindingId,
          JSON.stringify({ taskId: input.task.taskId, contextId: input.task.contextId }),
          JSON.stringify({
            resourceRef: {
              type: 'task_capability_binding',
              id: input.task.taskId,
              revision: 1,
            },
            changeCode: 'TASK_CAPABILITY_BOUND',
          }),
          input.binding.boundAt,
        ],
      );
      await client.query('COMMIT');
      this.#onTaskStateCommitted?.(input.task);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findBinding(taskId: string) {
    const result = await this.#pool.query<BindingRow>(
      'SELECT * FROM task_capability_binding WHERE task_id=$1',
      [taskId],
    );
    return result.rows[0] === undefined ? undefined : mapBinding(result.rows[0]);
  }

  async listAttempts(taskId: string) {
    const result = await this.#pool.query<AttemptRow>(
      'SELECT * FROM task_capability_execution_attempt WHERE task_id=$1 ORDER BY attempt_no',
      [taskId],
    );
    return Object.freeze(result.rows.map(mapAttempt));
  }

  async appendAttempt(input: Omit<TaskCapabilityExecutionAttempt, 'attemptNo' | 'status'>) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `task-capability-attempt:${input.taskId}`,
      ]);
      await client.query(
        `UPDATE task_capability_execution_attempt
            SET status='superseded',completed_at=clock_timestamp()
          WHERE task_id=$1 AND status IN ('prepared','running','waiting')`,
        [input.taskId],
      );
      const next = await client.query<{ attempt_no: number }>(
        `SELECT COALESCE(MAX(attempt_no),0)+1 AS attempt_no
           FROM task_capability_execution_attempt WHERE task_id=$1`,
        [input.taskId],
      );
      const attempt = createTaskCapabilityExecutionAttempt({
        ...input,
        attemptNo: next.rows[0]?.attempt_no ?? 1,
        status: 'prepared',
      });
      await insertAttempt(client, attempt);
      await client.query('COMMIT');
      return attempt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLatestAttempt(
    taskId: string,
    status: Exclude<TaskCapabilityExecutionAttempt['status'], 'prepared'>,
    timestamp: string,
  ) {
    const result = await this.#pool.query(
      `UPDATE task_capability_execution_attempt
          SET status=$2,
              started_at=CASE WHEN status=$2 THEN started_at
                              WHEN $2='running' THEN $3 ELSE COALESCE(started_at,$3) END,
              completed_at=CASE WHEN status=$2 THEN completed_at
                                WHEN $2 IN ('succeeded','failed','canceled','superseded') THEN $3
                                ELSE NULL END
        WHERE attempt_id=(SELECT attempt_id FROM task_capability_execution_attempt
                           WHERE task_id=$1 ORDER BY attempt_no DESC LIMIT 1)
          AND ((status='prepared' AND $2 IN ('running','waiting','succeeded','failed','canceled'))
            OR (status IN ('running','waiting') AND $2 IN ('waiting','succeeded','failed','canceled','superseded'))
            OR status=$2)`,
      [taskId, status, timestamp],
    );
    if (result.rowCount === 0) throw new Error('TASK_CAPABILITY_ATTEMPT_TRANSITION_INVALID');
  }
}

async function insertTask(
  client: PoolClient,
  task: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]['task'],
) {
  await client.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
       goal_id,goal_version,plan_id,selected_skill_id,selected_skill_version,
       skill_selection_id,skill_input_resolution_id,temporary_skill_id,user_goal_plan_id,
       skill_goal_id,skill_attempt_id,skill_execution_contract_id,output_text,output_structured,
       capability_gap_json,error_code,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23,$24,$25)`,
    [
      task.taskId,
      task.contextId,
      task.userId,
      task.requestText,
      JSON.stringify(task.requestMetadata),
      task.phase,
      task.phaseMessage,
      task.goalId ?? null,
      task.goalVersion ?? null,
      task.planId ?? null,
      task.selectedSkillId ?? null,
      task.selectedSkillVersion ?? null,
      task.skillSelectionId ?? null,
      task.skillInputResolutionId ?? null,
      task.temporarySkillId ?? null,
      task.userGoalPlanId ?? null,
      task.skillGoalId ?? null,
      task.skillAttemptId ?? null,
      task.skillExecutionContractId ?? null,
      task.output?.text ?? null,
      task.output?.structured === undefined ? null : JSON.stringify(task.output.structured),
      task.capabilityGap === undefined ? null : JSON.stringify(task.capabilityGap),
      task.errorCode ?? null,
      task.createdAt,
      task.updatedAt,
    ],
  );
}

function insertBinding(client: PoolClient, binding: TaskCapabilityBinding) {
  return client.query(
    `INSERT INTO task_capability_binding(
       binding_id,task_id,requested_capability_id,capability_version,exposure_id,exposure_version,
       input_snapshot,success_criteria_snapshot,evidence_requirement_snapshot,constraint_snapshot,
       initial_implementation_refs,provider_policy_snapshot,binding_hash,bound_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)`,
    [
      binding.bindingId,
      binding.taskId,
      binding.requestedCapabilityId,
      binding.capabilityVersion,
      binding.exposureId ?? null,
      binding.exposureVersion ?? null,
      JSON.stringify(binding.inputSnapshot),
      JSON.stringify(binding.successCriteriaSnapshot),
      JSON.stringify(binding.evidenceRequirementSnapshot),
      JSON.stringify(binding.constraintSnapshot),
      JSON.stringify(binding.initialImplementationRefs),
      binding.providerPolicySnapshot === undefined
        ? null
        : JSON.stringify(binding.providerPolicySnapshot),
      binding.bindingHash,
      binding.boundAt,
    ],
  );
}

function insertAttempt(client: PoolClient, attempt: TaskCapabilityExecutionAttempt) {
  return client.query(
    `INSERT INTO task_capability_execution_attempt(
       attempt_id,task_id,capability_binding_id,attempt_no,plan_id,plan_template_ref,
       skill_version_refs,provider_binding_refs,reason,status,started_at,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
    [
      attempt.attemptId,
      attempt.taskId,
      attempt.capabilityBindingId,
      attempt.attemptNo,
      attempt.planId ?? null,
      attempt.planTemplateRef ?? null,
      JSON.stringify(attempt.skillVersionRefs),
      JSON.stringify(attempt.providerBindingRefs),
      attempt.reason,
      attempt.status,
      attempt.startedAt ?? null,
      attempt.completedAt ?? null,
    ],
  );
}

function mapResolution(
  row: ResolutionRow,
  policies: Readonly<{
    implementations: readonly Readonly<Record<string, unknown>>[];
    providerBindingRefs: readonly string[];
  }>,
): RuntimeCapabilityResolution {
  const definition = record(row.evaluation_input['definition']);
  const bindings = records(row.evaluation_input['implementations']);
  const available = new Set(row.available_implementations);
  const implementationRefs = bindings
    .filter(
      (binding) => typeof binding['bindingId'] === 'string' && available.has(binding['bindingId']),
    )
    .map((binding) => {
      const type = text(binding['implementationType'], 'implementationType');
      const id = text(binding['implementationId'], 'implementationId');
      const version = text(binding['implementationVersion'], 'implementationVersion');
      return `${type}:${id}:${version}`;
    });
  if (implementationRefs.length === 0) throw new Error('TASK_CAPABILITY_NO_READY_IMPLEMENTATION');
  return Object.freeze({
    exposureId: row.exposure_id,
    exposureVersion: row.exposure_version,
    requestedCapabilityId: row.capability_id,
    capabilityVersion: row.capability_version,
    requestSchema: row.request_schema,
    ...(row.requester_policy === null ? {} : { requesterPolicy: row.requester_policy }),
    successCriteria: records(definition['successCriteria']),
    requiredEvidence: records(definition['requiredEvidence']),
    constraints: records(definition['constraints'] ?? []),
    implementationRefs: Object.freeze(implementationRefs),
    providerBindingRefs: policies.providerBindingRefs,
    providerPolicySnapshot: Object.freeze({
      catalogHash: row.catalog_hash,
      policyHash: row.policy_hash,
      snapshotHash: row.snapshot_hash,
      implementations: policies.implementations,
    }),
  });
}

async function snapshotImplementationPolicies(
  pool: Pool,
  row: ResolutionRow,
): Promise<
  Readonly<{
    implementations: readonly Readonly<Record<string, unknown>>[];
    providerBindingRefs: readonly string[];
  }>
> {
  const available = new Set(row.available_implementations);
  const bindings = records(row.evaluation_input['implementations']).filter(
    (binding) => typeof binding['bindingId'] === 'string' && available.has(binding['bindingId']),
  );
  const implementations: Readonly<Record<string, unknown>>[] = [];
  const providerBindingRefs = new Set<string>();
  for (const binding of bindings) {
    const bindingId = text(binding['bindingId'], 'bindingId');
    const implementationType = text(binding['implementationType'], 'implementationType');
    const implementationId = text(binding['implementationId'], 'implementationId');
    const implementationVersion = text(binding['implementationVersion'], 'implementationVersion');
    const implementationRef = `${implementationType}:${implementationId}:${implementationVersion}`;
    if (implementationType === 'skill') {
      const result = await pool.query<SkillPolicyRow>(
        `SELECT tool_policy_json AS tool_policy,runtime_policy_json AS runtime_policy
           FROM skill_version WHERE skill_id=$1 AND version=$2`,
        [implementationId, Number(implementationVersion)],
      );
      const policy = result.rows[0];
      if (policy === undefined) throw new Error('TASK_CAPABILITY_POLICY_SNAPSHOT_UNAVAILABLE');
      collectProviderBindingRefs(policy.tool_policy, providerBindingRefs);
      implementations.push(
        Object.freeze({
          bindingId,
          implementationRef,
          toolPolicy: structuredClone(policy.tool_policy),
          runtimePolicy: structuredClone(policy.runtime_policy),
        }),
      );
      continue;
    }
    if (implementationType !== 'plan_template')
      throw new Error('TASK_CAPABILITY_IMPLEMENTATION_TYPE_INVALID');
    const result = await pool.query<ArtifactPolicyRow>(
      `SELECT dependency_snapshot FROM compiled_artifact
        WHERE artifact_id=$1 AND version=$2 AND artifact_type='plan_template'`,
      [implementationId, Number(implementationVersion)],
    );
    const policy = result.rows[0];
    if (policy === undefined) throw new Error('TASK_CAPABILITY_POLICY_SNAPSHOT_UNAVAILABLE');
    implementations.push(
      Object.freeze({
        bindingId,
        implementationRef,
        dependencySnapshot: structuredClone(policy.dependency_snapshot),
      }),
    );
  }
  return Object.freeze({
    implementations: Object.freeze(implementations),
    providerBindingRefs: Object.freeze([...providerBindingRefs].sort()),
  });
}

function collectProviderBindingRefs(policy: unknown, target: Set<string>): void {
  const value = record(policy);
  for (const reference of [
    ...records(value['required'] ?? []),
    ...records(value['optional'] ?? []),
  ]) {
    target.add(
      `mcp-tool:${text(reference['serverId'], 'serverId')}:${text(reference['toolName'], 'toolName')}`,
    );
  }
}

function mapBinding(row: BindingRow): TaskCapabilityBinding {
  return createTaskCapabilityBinding({
    bindingId: row.binding_id,
    taskId: row.task_id,
    requestedCapabilityId: row.requested_capability_id,
    capabilityVersion: row.capability_version,
    ...(row.exposure_id === null
      ? {}
      : {
          exposureId: row.exposure_id,
          exposureVersion: row.exposure_version ?? invalidRow('exposure_version'),
        }),
    inputSnapshot: row.input_snapshot,
    successCriteriaSnapshot: row.success_criteria_snapshot,
    evidenceRequirementSnapshot: row.evidence_requirement_snapshot,
    constraintSnapshot: row.constraint_snapshot,
    initialImplementationRefs: row.initial_implementation_refs,
    ...(row.provider_policy_snapshot === null
      ? {}
      : { providerPolicySnapshot: row.provider_policy_snapshot }),
    bindingHash: row.binding_hash.trim(),
    boundAt: row.bound_at.toISOString(),
  });
}

function mapAttempt(row: AttemptRow): TaskCapabilityExecutionAttempt {
  return createTaskCapabilityExecutionAttempt({
    attemptId: row.attempt_id,
    taskId: row.task_id,
    capabilityBindingId: row.capability_binding_id,
    attemptNo: row.attempt_no,
    ...(row.plan_id === null ? {} : { planId: row.plan_id }),
    ...(row.plan_template_ref === null ? {} : { planTemplateRef: row.plan_template_ref }),
    skillVersionRefs: row.skill_version_refs,
    providerBindingRefs: row.provider_binding_refs,
    reason: row.reason,
    status: row.status,
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('TASK_CAPABILITY_RESOLUTION_INVALID');
  return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw new Error('TASK_CAPABILITY_RESOLUTION_INVALID');
  return Object.freeze(value.map(record));
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`TASK_CAPABILITY_RESOLUTION_INVALID:${field}`);
  return value;
}

function invalidRow(field: string): never {
  throw new Error(`TASK_CAPABILITY_ROW_INVALID:${field}`);
}
