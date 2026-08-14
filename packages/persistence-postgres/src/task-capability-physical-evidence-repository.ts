import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  TaskCapabilityPhysicalDispatchEvidence,
  TaskCapabilityPhysicalEvidenceSnapshot,
  TaskCapabilityPhysicalEvidenceSource,
  TaskCapabilityPhysicalPlanEvidence,
} from '../../application/src/index.js';

interface PhysicalDispatchEvidenceRow extends QueryResultRow {
  readonly invocation_id: string;
  readonly persisted_invocation_id: string | null;
  readonly capability_attempt_id: string | null;
  readonly confirmation_id: string | null;
  readonly consumed_invocation_id: string | null;
  readonly consumed_dispatch_hash: string | null;
  readonly consumed_at: Date | string | null;
  readonly revoked_at: Date | string | null;
  readonly admission_intent_id: string | null;
  readonly admission_invocation_id: string | null;
  readonly admission_task_id: string | null;
  readonly admission_capability_attempt_id: string | null;
  readonly admission_binding_id: string | null;
  readonly admission_recorded_invocation_id: string | null;
  readonly admission_materialized_binding_id: string | null;
  readonly admission_arguments_hash: string | null;
  readonly admission_dispatch_hash: string | null;
  readonly admission_workflow_plan_id: string | null;
  readonly admission_workflow_node_id: string | null;
  readonly admission_workflow_node_run_id: string | null;
  readonly admission_status: string | null;
  readonly admission_reason_code: string | null;
  readonly binding_id: string | null;
  readonly remote_task_id: string | null;
  readonly mcp_invocation_id: string | null;
  readonly workflow_node_id: string | null;
  readonly workflow_node_run_id: string | null;
  readonly workflow_plan_id: string | null;
  readonly workflow_definition_id: string | null;
  readonly workflow_definition_version: number | null;
  readonly workflow_instance_id: string | null;
  readonly remote_execution_mode: string | null;
  readonly protocol_status: string | null;
  readonly local_state: string | null;
  readonly provider_failure_count: number | null;
  readonly provider_evidence_json: unknown;
  readonly result_is_error: boolean | null;
  readonly last_safe_error_code: string | null;
  readonly invalidated_at: Date | string | null;
  readonly binding_created_at: Date | string | null;
  readonly terminal_at: Date | string | null;
  readonly accepted_observation_count: string | number;
  readonly accepted_observed_at: Date | string | null;
  readonly unsafe_observation_count: string | number;
  readonly failed_protocol_attempt_count: string | number;
  readonly terminal_event_count: string | number;
  readonly processed_completed_event_count: string | number;
  readonly terminal_event_created_at: Date | string | null;
  readonly terminal_event_processed_at: Date | string | null;
  readonly terminal_event_status: string | null;
  readonly terminal_event_error_code: string | null;
  readonly continuation_attempt_count: string | number;
  readonly waiting_external_continuation_count: string | number;
  readonly succeeded_continuation_count: string | number;
}

interface PhysicalPlanRow extends QueryResultRow {
  readonly confirmation_status: string;
  readonly definition_json: unknown;
}

const ProviderEvidenceSchema = z.array(z.unknown()).max(1_024);
const PhysicalPlanDefinitionSchema = z
  .object({
    workflowDefinitionId: z.string().min(1),
    version: z.number().int().positive(),
    entryNodeId: z.string().min(1),
    exitNodeIds: z.array(z.string().min(1)),
    nodes: z.array(
      z
        .object({
          nodeId: z.string().min(1),
          type: z.string().min(1),
          tool: z.object({ serverId: z.string().min(1), toolName: z.string().min(1) }).optional(),
          taskExecution: z
            .object({ protocolMode: z.string().min(1) })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
    edges: z.array(
      z
        .object({
          sourceNodeId: z.string().min(1),
          targetNodeId: z.string().min(1),
          outcome: z.string().min(1).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * One read-only PostgreSQL projection. It includes invocation-less admission intents and never
 * promotes a remote terminal Task state into a claim that the physical resource is stationary.
 */
export class PostgresTaskCapabilityPhysicalEvidenceRepository implements TaskCapabilityPhysicalEvidenceSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async loadPhysicalEvidence(
    input: Readonly<{ taskId: string; capabilityAttemptId: string; planId: string }>,
  ): Promise<TaskCapabilityPhysicalEvidenceSnapshot> {
    const [dispatchResult, planResult] = await Promise.all([
      this.#pool.query<PhysicalDispatchEvidenceRow>(DISPATCH_EVIDENCE_QUERY, [
        input.taskId,
        input.capabilityAttemptId,
      ]),
      this.#pool.query<PhysicalPlanRow>(
        `SELECT confirmation_status,definition_json
           FROM workflow_plan
          WHERE plan_id=$1`,
        [input.planId],
      ),
    ]);
    const planRow = planResult.rows[0];
    return Object.freeze({
      ...(planRow === undefined ? {} : { plan: mapPhysicalPlan(input.planId, planRow) }),
      dispatches: Object.freeze(dispatchResult.rows.map(mapPhysicalDispatchEvidence)),
    });
  }
}

const DISPATCH_EVIDENCE_QUERY = `SELECT
       COALESCE(invocation.invocation_id,admission.invocation_id) AS invocation_id,
       invocation.invocation_id AS persisted_invocation_id,
       COALESCE(invocation.capability_attempt_id,admission.capability_attempt_id)
         AS capability_attempt_id,
       confirmation.confirmation_id,confirmation.consumed_invocation_id,
       confirmation.consumed_dispatch_hash,confirmation.consumed_at,confirmation.revoked_at,
       admission.intent_id AS admission_intent_id,
       admission.invocation_id AS admission_invocation_id,
       admission.task_id AS admission_task_id,
       admission.capability_attempt_id AS admission_capability_attempt_id,
       admission.binding_id AS admission_binding_id,
       admission.recorded_invocation_id AS admission_recorded_invocation_id,
       admission.materialized_binding_id AS admission_materialized_binding_id,
       admission.arguments_hash AS admission_arguments_hash,
       admission.dispatch_hash AS admission_dispatch_hash,
       admission.local_envelope_json->>'workflowPlanId' AS admission_workflow_plan_id,
       admission.local_envelope_json->>'workflowNodeId' AS admission_workflow_node_id,
       admission.local_envelope_json->>'workflowNodeRunId' AS admission_workflow_node_run_id,
       admission.status AS admission_status,admission.reason_code AS admission_reason_code,
       binding.binding_id,binding.remote_task_id,binding.mcp_invocation_id,
       binding.workflow_node_id,binding.workflow_node_run_id,binding.workflow_plan_id,
       binding.workflow_definition_id,binding.workflow_definition_version,
       binding.workflow_instance_id,binding.execution_mode AS remote_execution_mode,
       binding.protocol_status,binding.local_state,binding.provider_failure_count,
       COALESCE(binding.result_snapshot_json->'evidence','[]'::jsonb) AS provider_evidence_json,
       CASE
         WHEN jsonb_typeof(binding.result_snapshot_json->'isError')='boolean'
         THEN (binding.result_snapshot_json->>'isError')::boolean
         ELSE NULL
       END AS result_is_error,
       binding.last_safe_error_code,binding.invalidated_at,
       binding.created_at AS binding_created_at,binding.terminal_at,
       observations.accepted_observation_count,observations.accepted_observed_at,
       observations.unsafe_observation_count,
       protocol.failed_protocol_attempt_count,
       terminal.terminal_event_count,terminal.processed_completed_event_count,
       terminal.terminal_event_created_at,terminal.terminal_event_processed_at,
       terminal.terminal_event_status,terminal.terminal_event_error_code,
       continuation.continuation_attempt_count,
       continuation.waiting_external_continuation_count,
       continuation.succeeded_continuation_count
  FROM mcp_invocation invocation
  FULL OUTER JOIN remote_task_admission_intent admission
    ON admission.invocation_id=invocation.invocation_id
  LEFT JOIN governed_control_confirmation confirmation
    ON confirmation.confirmation_id=invocation.control_confirmation_id
  LEFT JOIN remote_task_binding binding
    ON binding.mcp_invocation_id=COALESCE(
         invocation.invocation_id,admission.recorded_invocation_id
       )
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER(
             WHERE accepted AND observation_type='task.accepted'
           ) AS accepted_observation_count,
           MIN(observed_at) FILTER(
             WHERE accepted AND observation_type='task.accepted'
           ) AS accepted_observed_at,
           COUNT(*) FILTER(
             WHERE observation_type IN ('provider_unreachable','schema_invalid')
           ) AS unsafe_observation_count
      FROM remote_task_observation observation
     WHERE observation.binding_id=binding.binding_id
  ) observations ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER(WHERE status<>'succeeded') AS failed_protocol_attempt_count
      FROM remote_task_protocol_attempt attempt
     WHERE attempt.binding_id=binding.binding_id
  ) protocol ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER(
             WHERE event_type IN ('task.completed','task.failed','task.cancelled')
           ) AS terminal_event_count,
           COUNT(*) FILTER(
             WHERE event_type='task.completed' AND status='processed' AND error_code IS NULL
           ) AS processed_completed_event_count,
           MIN(created_at) FILTER(WHERE event_type='task.completed')
             AS terminal_event_created_at,
           MIN(processed_at) FILTER(WHERE event_type='task.completed')
             AS terminal_event_processed_at,
           MIN(status) FILTER(WHERE event_type='task.completed') AS terminal_event_status,
           MIN(error_code) FILTER(WHERE event_type='task.completed')
             AS terminal_event_error_code
      FROM remote_task_control_event event
     WHERE event.binding_id=binding.binding_id
  ) terminal ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS continuation_attempt_count,
           COUNT(*) FILTER(WHERE attempt.status='waiting_external' AND attempt.error_code IS NULL)
             AS waiting_external_continuation_count,
           COUNT(*) FILTER(WHERE attempt.status='succeeded' AND attempt.error_code IS NULL)
             AS succeeded_continuation_count
      FROM workflow_continuation_attempt attempt
      JOIN remote_task_control_event event ON event.event_id=attempt.event_id
     WHERE event.binding_id=binding.binding_id AND event.event_type='task.completed'
  ) continuation ON true
 WHERE (invocation.task_id=$1 OR admission.task_id=$1)
   AND (
     invocation.capability_attempt_id=$2
     OR admission.capability_attempt_id=$2
   )
 ORDER BY COALESCE(invocation.started_at,admission.created_at),
          COALESCE(invocation.invocation_id,admission.invocation_id)`;

function mapPhysicalDispatchEvidence(
  row: PhysicalDispatchEvidenceRow,
): TaskCapabilityPhysicalDispatchEvidence {
  const confirmation =
    row.confirmation_id === null
      ? undefined
      : Object.freeze({
          confirmationId: row.confirmation_id,
          ...(row.consumed_invocation_id === null
            ? {}
            : { consumedInvocationId: row.consumed_invocation_id }),
          ...(row.consumed_dispatch_hash === null
            ? {}
            : { consumedDispatchHash: row.consumed_dispatch_hash }),
          ...(row.consumed_at === null ? {} : { consumedAt: iso(row.consumed_at) }),
          ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
        });
  const admission = mapAdmission(row);
  const remoteTask = mapRemoteTask(row);
  return Object.freeze({
    invocationId: row.invocation_id,
    invocationPresent: row.persisted_invocation_id !== null,
    ...(row.capability_attempt_id === null
      ? {}
      : { capabilityAttemptId: row.capability_attempt_id }),
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(admission === undefined ? {} : { admission }),
    ...(remoteTask === undefined ? {} : { remoteTask }),
  });
}

function mapAdmission(
  row: PhysicalDispatchEvidenceRow,
): TaskCapabilityPhysicalDispatchEvidence['admission'] {
  if (
    row.admission_intent_id === null ||
    row.admission_invocation_id === null ||
    row.admission_task_id === null ||
    row.admission_binding_id === null ||
    row.admission_arguments_hash === null ||
    row.admission_workflow_plan_id === null ||
    row.admission_workflow_node_id === null ||
    row.admission_workflow_node_run_id === null ||
    row.admission_status === null
  )
    return undefined;
  return Object.freeze({
    intentId: row.admission_intent_id,
    invocationId: row.admission_invocation_id,
    taskId: row.admission_task_id,
    ...(row.admission_capability_attempt_id === null
      ? {}
      : { capabilityAttemptId: row.admission_capability_attempt_id }),
    bindingId: row.admission_binding_id,
    ...(row.admission_recorded_invocation_id === null
      ? {}
      : { recordedInvocationId: row.admission_recorded_invocation_id }),
    ...(row.admission_materialized_binding_id === null
      ? {}
      : { materializedBindingId: row.admission_materialized_binding_id }),
    argumentsHash: row.admission_arguments_hash,
    ...(row.admission_dispatch_hash === null ? {} : { dispatchHash: row.admission_dispatch_hash }),
    workflowPlanId: row.admission_workflow_plan_id,
    workflowNodeId: row.admission_workflow_node_id,
    workflowNodeRunId: row.admission_workflow_node_run_id,
    status: row.admission_status,
    ...(row.admission_reason_code === null ? {} : { reasonCode: row.admission_reason_code }),
  });
}

function mapRemoteTask(
  row: PhysicalDispatchEvidenceRow,
): TaskCapabilityPhysicalDispatchEvidence['remoteTask'] {
  if (
    row.binding_id === null ||
    row.remote_task_id === null ||
    row.mcp_invocation_id === null ||
    row.workflow_node_id === null ||
    row.workflow_node_run_id === null ||
    row.workflow_plan_id === null ||
    row.workflow_definition_id === null ||
    row.workflow_definition_version === null ||
    row.workflow_instance_id === null ||
    row.remote_execution_mode === null ||
    row.protocol_status === null ||
    row.local_state === null ||
    row.provider_failure_count === null ||
    row.binding_created_at === null
  )
    return undefined;
  return Object.freeze({
    bindingId: row.binding_id,
    remoteTaskId: row.remote_task_id,
    mcpInvocationId: row.mcp_invocation_id,
    workflowNodeId: row.workflow_node_id,
    workflowNodeRunId: row.workflow_node_run_id,
    workflowPlanId: row.workflow_plan_id,
    workflowDefinitionId: row.workflow_definition_id,
    workflowDefinitionVersion: row.workflow_definition_version,
    workflowInstanceId: row.workflow_instance_id,
    executionMode: row.remote_execution_mode,
    protocolStatus: row.protocol_status,
    localState: row.local_state,
    providerFailureCount: row.provider_failure_count,
    providerEvidence: Object.freeze(ProviderEvidenceSchema.parse(row.provider_evidence_json)),
    ...(row.result_is_error === null ? {} : { resultIsError: row.result_is_error }),
    ...(row.last_safe_error_code === null ? {} : { lastSafeErrorCode: row.last_safe_error_code }),
    ...(row.invalidated_at === null ? {} : { invalidatedAt: iso(row.invalidated_at) }),
    createdAt: iso(row.binding_created_at),
    ...(row.terminal_at === null ? {} : { terminalAt: iso(row.terminal_at) }),
    acceptedObservationCount: count(row.accepted_observation_count),
    ...(row.accepted_observed_at === null
      ? {}
      : { acceptedObservedAt: iso(row.accepted_observed_at) }),
    unsafeObservationCount: count(row.unsafe_observation_count),
    failedProtocolAttemptCount: count(row.failed_protocol_attempt_count),
    terminalEventCount: count(row.terminal_event_count),
    processedCompletedEventCount: count(row.processed_completed_event_count),
    ...(row.terminal_event_created_at === null
      ? {}
      : { terminalEventCreatedAt: iso(row.terminal_event_created_at) }),
    ...(row.terminal_event_processed_at === null
      ? {}
      : { terminalEventProcessedAt: iso(row.terminal_event_processed_at) }),
    ...(row.terminal_event_status === null
      ? {}
      : { terminalEventStatus: row.terminal_event_status }),
    ...(row.terminal_event_error_code === null
      ? {}
      : { terminalEventErrorCode: row.terminal_event_error_code }),
    continuationAttemptCount: count(row.continuation_attempt_count),
    waitingExternalContinuationCount: count(row.waiting_external_continuation_count),
    succeededContinuationCount: count(row.succeeded_continuation_count),
  });
}

function mapPhysicalPlan(planId: string, row: PhysicalPlanRow): TaskCapabilityPhysicalPlanEvidence {
  const definition = PhysicalPlanDefinitionSchema.parse(row.definition_json);
  return Object.freeze({
    planId,
    confirmationStatus: row.confirmation_status,
    workflowDefinitionId: definition.workflowDefinitionId,
    workflowDefinitionVersion: definition.version,
    entryNodeId: definition.entryNodeId,
    exitNodeIds: Object.freeze([...definition.exitNodeIds]),
    nodes: Object.freeze(
      definition.nodes.map((node, index) =>
        Object.freeze({
          nodeId: node.nodeId,
          ordinal: index + 1,
          type: node.type,
          ...(node.tool === undefined ? {} : node.tool),
          taskRequired:
            node.type === 'mcp_tool' && node.taskExecution?.protocolMode === 'frozen_v1',
        }),
      ),
    ),
    edges: Object.freeze(
      definition.edges.map((edge) =>
        Object.freeze({
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          ...(edge.outcome === undefined ? {} : { outcome: edge.outcome }),
        }),
      ),
    ),
  });
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error('PHYSICAL_DISPATCH_TIMESTAMP_INVALID');
  return date.toISOString();
}

function count(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('PHYSICAL_DISPATCH_COUNT_INVALID');
  return parsed;
}
