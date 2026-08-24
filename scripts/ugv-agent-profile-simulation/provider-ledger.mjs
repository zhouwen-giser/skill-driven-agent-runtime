#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

import { sha256CanonicalJson } from './evidence-files.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SMPP_ROOT = resolve(REPOSITORY_ROOT, '../sdar-mcp-provider-platform');
const DEPLOY_ROOT = resolve(REPOSITORY_ROOT, 'deploy/ugv-agent-profile-simulation');
const PROJECT = 'sdar-uap-p3-b01-smpp';
const SDAR_PROJECT = 'sdar-uap-p3-b01-sdar';
const ZERO_DISPATCH_COLLECTION_PATHS = Object.freeze([
  ['runtimeIdempotencyRecords', 'runtime', 'idempotencyRecords'],
  ['runtimeProviderTasks', 'runtime', 'providerTasks'],
  ['runtimeAdmissionIntents', 'runtime', 'admissionIntents'],
  ['adapterExecutions', 'adapter', 'executions'],
  ['adapterDeviceToolCalls', 'adapter', 'deviceToolCalls'],
  ['adapterMutationJournal', 'adapter', 'mutationJournal'],
  ['adapterCommandAcks', 'adapter', 'commandAcks'],
  ['sdarModelInvocations', 'sdar', 'modelInvocations'],
  ['sdarMcpInvocations', 'sdar', 'mcpInvocations'],
  ['sdarStageModelRoutes', 'sdar', 'stageModelRoutes'],
  ['sdarModelProviders', 'sdar', 'modelProviders'],
  ['sdarInitialTaskAdmissions', 'sdar', 'initialTaskAdmissions'],
  ['sdarCapabilityAttempts', 'sdar', 'capabilityAttempts'],
  ['sdarGovernedConfirmations', 'sdar', 'governedConfirmations'],
  ['sdarRemoteAdmissionIntents', 'sdar', 'remoteAdmissionIntents'],
  ['sdarContinuationSnapshots', 'sdar', 'continuationSnapshots'],
  ['sdarContinuationAttempts', 'sdar', 'continuationAttempts'],
  ['sdarTerminalOutcomes', 'sdar', 'terminalOutcomes'],
  ['sdarWorkflowNodeEvents', 'sdar', 'workflowNodeEvents'],
  ['sdarTasks', 'sdar', 'tasks'],
  ['sdarGoals', 'sdar', 'goals'],
  ['sdarGoalContracts', 'sdar', 'goalContracts'],
  ['sdarUserGoalPlans', 'sdar', 'userGoalPlans'],
  ['sdarWorkflowPlans', 'sdar', 'workflowPlans'],
  ['sdarWorkflowInstances', 'sdar', 'workflowInstances'],
  ['sdarSkillExecutions', 'sdar', 'skillExecutions'],
  ['sdarSkillExecutionEvents', 'sdar', 'skillExecutionEvents'],
  ['sdarProcessedResults', 'sdar', 'processedResults'],
]);
const PRECONFIRMATION_STRUCTURAL_DELTA_NAMES = new Set([
  'sdarInitialTaskAdmissions',
  'sdarCapabilityAttempts',
  'sdarTasks',
  'sdarGoals',
  'sdarGoalContracts',
  'sdarUserGoalPlans',
]);
const PRECONFIRMATION_PLANNED_DELTA_NAMES = new Set([
  'sdarWorkflowPlans',
  'sdarSkillExecutions',
  'sdarSkillExecutionEvents',
]);
const CONFIRMED_PRETRANSPORT_FAILURE_DELTAS = Object.freeze({
  adapterDeviceToolCalls: 2,
  sdarModelInvocations: 1,
  sdarMcpInvocations: 2,
  sdarInitialTaskAdmissions: 1,
  sdarCapabilityAttempts: 1,
  sdarGovernedConfirmations: 1,
  sdarRemoteAdmissionIntents: 1,
  sdarTasks: 1,
  sdarGoals: 1,
  sdarGoalContracts: 1,
  sdarUserGoalPlans: 1,
  sdarWorkflowPlans: 1,
  sdarWorkflowInstances: 1,
  sdarSkillExecutions: 1,
  sdarSkillExecutionEvents: 13,
});
const TERMINAL_PROVIDER_SAFE_FAILURE_DELTAS = Object.freeze({
  runtimeIdempotencyRecords: 1,
  runtimeProviderTasks: 1,
  runtimeAdmissionIntents: 1,
  adapterExecutions: 1,
  adapterDeviceToolCalls: 4,
  adapterMutationJournal: 2,
  adapterCommandAcks: 0,
  sdarModelInvocations: 1,
  sdarMcpInvocations: 3,
  sdarStageModelRoutes: 0,
  sdarModelProviders: 0,
  sdarInitialTaskAdmissions: 1,
  sdarCapabilityAttempts: 1,
  sdarGovernedConfirmations: 1,
  sdarRemoteAdmissionIntents: 1,
  sdarContinuationSnapshots: 0,
  sdarContinuationAttempts: 0,
  sdarTerminalOutcomes: 0,
  sdarWorkflowNodeEvents: 0,
  sdarTasks: 1,
  sdarGoals: 1,
  sdarGoalContracts: 1,
  sdarUserGoalPlans: 1,
  sdarWorkflowPlans: 1,
  sdarWorkflowInstances: 1,
  sdarSkillExecutions: 1,
  sdarSkillExecutionEvents: 13,
  sdarProcessedResults: 0,
});
export const UGV_B02_ZERO_DISPATCH_DELTA_KEYS = Object.freeze(
  ZERO_DISPATCH_COLLECTION_PATHS.map(([name]) => name),
);

const RUNTIME_QUERY = String.raw`SELECT json_build_object(
  'idempotencyRecords', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'rowId', authorization_context_hash || ':' || operation_name || ':' || idempotency_key || ':' || execution_mode || ':' || simulation_key,
    'operationName', operation_name, 'idempotencyKey', idempotency_key,
    'argumentHash', argument_hash, 'executionMode', execution_mode,
    'taskId', task_id::text, 'createdAt', created_at) ORDER BY created_at,operation_name,idempotency_key)
    FROM idempotency_record t), '[]'::json),
  'providerTasks', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'taskId', task_id::text, 'providerId', provider_id, 'operationName', operation_name,
    'executionMode', execution_mode, 'simulationId', simulation_id,
    'argumentHash', argument_hash, 'externalExecutionId', external_execution_id,
    'internalState', internal_state, 'mcpStatus', mcp_status, 'version', version,
    'acceptedAt', accepted_at, 'updatedAt', updated_at) ORDER BY created_at,task_id)
    FROM provider_task t), '[]'::json),
  'admissionIntents', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'taskId', task_id::text, 'providerId', provider_id, 'operationName', operation_name,
    'executionMode', execution_mode, 'simulationId', simulation_id,
    'argumentHash', argument_hash, 'state', state, 'updatedAt', updated_at)
    ORDER BY created_at,task_id) FROM admission_intent t), '[]'::json)
)::text`;

const ADAPTER_QUERY = String.raw`SELECT json_build_object(
  'executions', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'taskId', task_id, 'externalExecutionId', external_execution_id,
    'operationName', operation_name, 'argumentHash', argument_hash, 'resourceId', resource_id,
    'state', state, 'revision', revision, 'reasonCode', reason_code,
    'createdAt', created_at, 'updatedAt', updated_at, 'terminalAt', terminal_at)
    ORDER BY created_at,task_id) FROM ugv_execution t), '[]'::json),
  'deviceToolCalls', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'callId', call_id, 'taskId', task_id, 'toolName', tool_name,
    'argumentHash', argument_hash, 'outcome', outcome, 'occurredAt', occurred_at)
    ORDER BY occurred_at,call_id) FROM ugv_device_tool_call t), '[]'::json),
  'mutationJournal', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'rowId', task_id || ':' || step_id, 'taskId', task_id, 'stepId', step_id,
    'phase', phase, 'toolName', tool_name, 'argumentHash', argument_hash,
    'state', state, 'externalMissionId', external_mission_id,
    'intentPersistedAt', intent_persisted_at, 'dispatchedAt', dispatched_at,
    'completedAt', completed_at) ORDER BY intent_persisted_at,task_id,step_id)
    FROM ugv_mutation_journal t), '[]'::json),
  'commandAcks', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
    'rowId', task_id || ':' || command || ':' || command_sequence::text,
    'taskId', task_id, 'command', command, 'commandSequence', command_sequence,
    'createdAt', created_at) ORDER BY created_at,task_id,command,command_sequence)
    FROM ugv_execution_command_ack t), '[]'::json)
)::text`;

const SDAR_MODEL_QUERY = String.raw`SELECT json_build_object(
  'modelInvocations', coalesce((SELECT json_agg(json_build_object(
    'invocationId', invocation_id, 'taskId', task_id, 'stage', stage,
    'providerId', provider_id, 'model', model, 'operation', operation,
    'status', status, 'errorCode', error_code, 'durationMs', duration_ms,
    'createdAt', created_at) ORDER BY created_at,invocation_id)
    FROM model_invocation), '[]'::json),
  'mcpInvocations', coalesce((SELECT json_agg(to_jsonb(invocation) || jsonb_build_object(
    'invocationId', invocation_id, 'taskId', task_id,
    'capabilityAttemptId', capability_attempt_id, 'serverId', server_id,
    'toolName', tool_name, 'executionMode', execution_mode,
    'simulationId', simulation_id, 'arguments', arguments_json,
    'controlConfirmationId', control_confirmation_id,
    'controlProviderBindingId', control_provider_binding_id,
    'controlArgumentsHash', control_arguments_hash,
    'controlDispatchHash', control_dispatch_hash,
    'startedAt', started_at, 'completedAt', completed_at)
    ORDER BY started_at,invocation_id) FROM mcp_invocation invocation), '[]'::json),
  'stageModelRoutes', coalesce((SELECT json_agg(to_jsonb(route) || jsonb_build_object(
    'rowId', route.stage || ':' || route.operation, 'providerId', route.provider_id,
    'updatedAt', route.updated_at)
    ORDER BY route.stage,route.operation) FROM stage_model_route route), '[]'::json)
  ,
  'modelProviders', coalesce((SELECT json_agg(json_build_object(
    'providerId', provider.provider_id, 'name', provider.name, 'kind', provider.kind,
    'model', provider.model, 'enabled', provider.enabled, 'updatedAt', provider.updated_at)
    ORDER BY provider.provider_id) FROM model_provider provider), '[]'::json),
  'initialTaskAdmissions', coalesce((SELECT json_agg(to_jsonb(admission) || jsonb_build_object(
    'idempotencyKey', admission.idempotency_key, 'requestHash', admission.request_hash,
    'taskId', admission.task_id, 'contextId', admission.context_id,
    'capabilityBindingId', admission.capability_binding_id,
    'capabilityAttemptId', admission.capability_attempt_id, 'acceptedAt', admission.accepted_at)
    ORDER BY admission.accepted_at,admission.idempotency_key)
    FROM initial_task_admission admission), '[]'::json),
  'capabilityAttempts', coalesce((SELECT json_agg(to_jsonb(attempt) || jsonb_build_object(
    'attemptId', attempt.attempt_id, 'taskId', attempt.task_id,
    'capabilityBindingId', attempt.capability_binding_id, 'attemptNo', attempt.attempt_no,
    'planId', attempt.plan_id, 'completedAt', attempt.completed_at)
    ORDER BY attempt.task_id,attempt.attempt_no,attempt.attempt_id)
    FROM task_capability_execution_attempt attempt), '[]'::json),
  'governedConfirmations', coalesce((SELECT json_agg(to_jsonb(confirmation) || jsonb_build_object(
    'confirmationId', confirmation.confirmation_id, 'taskId', confirmation.task_id,
    'capabilityBindingId', confirmation.capability_binding_id,
    'capabilityAttemptId', confirmation.capability_attempt_id,
    'planId', confirmation.plan_id, 'planHash', confirmation.plan_hash,
    'providerBindingId', confirmation.provider_binding_id, 'serverId', confirmation.server_id,
    'toolName', confirmation.tool_name, 'argumentsHash', confirmation.arguments_hash,
    'consumedInvocationId', confirmation.consumed_invocation_id,
    'consumedDispatchHash', confirmation.consumed_dispatch_hash,
    'consumedAt', confirmation.consumed_at)
    ORDER BY confirmation.confirmed_at,confirmation.confirmation_id)
    FROM governed_control_confirmation confirmation), '[]'::json),
  'remoteAdmissionIntents', coalesce((SELECT json_agg(to_jsonb(intent) || jsonb_build_object(
    'intentId', intent.intent_id, 'invocationId', intent.invocation_id,
    'bindingId', intent.binding_id, 'taskId', intent.task_id,
    'capabilityAttemptId', intent.capability_attempt_id, 'contextId', intent.context_id,
    'serverId', intent.server_id, 'operationName', intent.operation_name,
    'argumentsHash', intent.arguments_hash, 'recordedInvocationId', intent.recorded_invocation_id,
    'materializedBindingId', intent.materialized_binding_id,
    'materializedSnapshotId', intent.materialized_snapshot_id,
    'materializedAt', intent.materialized_at, 'closedAt', intent.closed_at)
    ORDER BY intent.created_at,intent.intent_id)
    FROM remote_task_admission_intent intent), '[]'::json),
  'continuationSnapshots', coalesce((SELECT json_agg(to_jsonb(snapshot) || jsonb_build_object(
    'snapshotId', snapshot.snapshot_id, 'continuationId', snapshot.continuation_id,
    'stateVersion', snapshot.state_version, 'predecessorSnapshotId', snapshot.predecessor_snapshot_id,
    'taskId', snapshot.agent_task_id, 'contextId', snapshot.context_id,
    'planId', snapshot.workflow_plan_id, 'workflowInstanceId', snapshot.workflow_instance_id)
    ORDER BY snapshot.created_at,snapshot.snapshot_id)
    FROM workflow_continuation_snapshot snapshot), '[]'::json),
  'continuationAttempts', coalesce((SELECT json_agg(to_jsonb(attempt) || jsonb_build_object(
    'attemptId', attempt.attempt_id, 'eventId', attempt.event_id,
    'snapshotId', attempt.snapshot_id, 'continuationId', attempt.continuation_id,
    'workflowInstanceId', attempt.workflow_instance_id,
    'snapshotStateVersion', attempt.snapshot_state_version,
    'completedAt', attempt.completed_at, 'errorCode', attempt.error_code)
    ORDER BY attempt.created_at,attempt.attempt_id)
    FROM workflow_continuation_attempt attempt), '[]'::json),
  'terminalOutcomes', coalesce((SELECT json_agg(to_jsonb(outcome) || jsonb_build_object(
    'outcomeId', outcome.outcome_id, 'taskId', outcome.task_id,
    'goalId', outcome.goal_id, 'goalVersion', outcome.goal_version,
    'controlId', outcome.control_id, 'controlStatus', outcome.control_status,
    'finalInstanceId', outcome.final_instance_id, 'resultId', outcome.result_id,
    'committedAt', outcome.committed_at)
    ORDER BY outcome.committed_at,outcome.outcome_id)
    FROM runtime_terminal_outcome outcome), '[]'::json),
  'workflowNodeEvents', coalesce((SELECT json_agg(to_jsonb(event) || jsonb_build_object(
    'eventId', event.event_id, 'instanceId', event.instance_id,
    'nodeId', event.node_id, 'eventType', event.event_type,
    'eventTimestamp', event.event_timestamp)
    ORDER BY event.instance_id,event.sequence,event.event_id)
    FROM workflow_node_event event), '[]'::json),
  'tasks', coalesce((SELECT json_agg(to_jsonb(task) || jsonb_build_object(
    'taskId', task.task_id, 'contextId', task.context_id,
    'goalId', task.goal_id, 'goalVersion', task.goal_version,
    'planId', task.plan_id, 'userGoalPlanId', task.user_goal_plan_id,
    'skillGoalId', task.skill_goal_id, 'skillAttemptId', task.skill_attempt_id,
    'skillExecutionContractId', task.skill_execution_contract_id,
    'selectedSkillId', task.selected_skill_id, 'selectedSkillVersion', task.selected_skill_version)
    ORDER BY task.created_at,task.task_id) FROM agent_task task), '[]'::json),
  'goals', coalesce((SELECT json_agg(to_jsonb(goal) || jsonb_build_object(
    'goalId', goal.goal_id, 'contextId', goal.context_id,
    'goalVersion', goal.version, 'updatedAt', goal.updated_at)
    ORDER BY goal.created_at,goal.goal_id) FROM goal), '[]'::json),
  'goalContracts', coalesce((SELECT json_agg(to_jsonb(contract) || jsonb_build_object(
    'rowId', contract.goal_id || ':' || contract.goal_version::text,
    'goalId', contract.goal_id, 'goalVersion', contract.goal_version,
    'contractHash', contract.contract_hash, 'createdAt', contract.created_at)
    ORDER BY contract.created_at,contract.goal_id,contract.goal_version)
    FROM user_goal_contract contract), '[]'::json),
  'userGoalPlans', coalesce((SELECT json_agg(to_jsonb(plan) || jsonb_build_object(
    'planId', plan.plan_id, 'goalId', plan.goal_id, 'goalVersion', plan.goal_version,
    'contractHash', plan.contract_hash, 'contentHash', plan.content_hash,
    'updatedAt', plan.updated_at)
    ORDER BY plan.created_at,plan.plan_id) FROM user_goal_plan plan), '[]'::json),
  'workflowPlans', coalesce((SELECT json_agg(to_jsonb(plan) || jsonb_build_object(
    'planId', plan.plan_id, 'goalId', plan.goal_id, 'goalVersion', plan.goal_version,
    'sourceConfirmedPlanId', plan.source_confirmed_plan_id, 'createdAt', plan.created_at)
    ORDER BY plan.created_at,plan.plan_id) FROM workflow_plan plan), '[]'::json),
  'workflowInstances', coalesce((SELECT json_agg(to_jsonb(instance) || jsonb_build_object(
    'instanceId', instance.instance_id, 'planId', instance.plan_id,
    'workflowDefinitionId', instance.workflow_definition_id,
    'workflowDefinitionVersion', instance.workflow_version,
    'goalId', instance.goal_id, 'goalVersion', instance.goal_version,
    'completedAt', instance.completed_at)
    ORDER BY instance.started_at,instance.instance_id) FROM workflow_instance instance), '[]'::json),
  'skillExecutions', coalesce((SELECT json_agg(to_jsonb(execution) || jsonb_build_object(
    'executionId', execution.execution_id, 'taskId', execution.task_id,
    'goalId', execution.goal_id, 'goalVersion', execution.goal_version,
    'skillId', execution.skill_id, 'skillVersion', execution.skill_version,
    'workflowPlanId', execution.workflow_plan_id,
    'workflowDefinitionId', execution.workflow_definition_id,
    'workflowDefinitionVersion', execution.workflow_definition_version)
    ORDER BY execution.created_at,execution.execution_id)
    FROM skill_execution_record execution), '[]'::json),
  'skillExecutionEvents', coalesce((SELECT json_agg(to_jsonb(event) || jsonb_build_object(
    'eventId', event.event_id, 'executionId', event.execution_id,
    'sequenceNumber', event.sequence_number, 'eventType', event.event_type,
    'statusAfter', event.status_after, 'occurredAt', event.occurred_at)
    ORDER BY event.execution_id,event.sequence_number,event.event_id)
    FROM skill_execution_event event), '[]'::json),
  'processedResults', coalesce((SELECT json_agg(to_jsonb(result) || jsonb_build_object(
    'resultId', result.result_id, 'taskId', result.task_id,
    'skillId', result.skill_id, 'skillVersion', result.skill_version,
    'createdAt', result.created_at)
    ORDER BY result.created_at,result.result_id) FROM processed_result result), '[]'::json)
)::text`;

export function captureUgvB02ProviderLedger({
  execute = execFileSync,
  now = () => new Date().toISOString(),
} = {}) {
  const runtime = queryPostgres(
    execute,
    'ugv-agent-profile-runtime-postgres',
    'ugv_profile_runtime',
    'ugv_profile_runtime',
    RUNTIME_QUERY,
  );
  const adapter = queryPostgres(
    execute,
    'ugv-agent-profile-adapter-postgres',
    'ugv_profile_adapter',
    'ugv_profile_adapter',
    ADAPTER_QUERY,
  );
  const sdar = querySdarPostgres(execute, SDAR_MODEL_QUERY);
  return validateUgvB02ProviderLedger({
    schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1',
    capturedAt: now(),
    runtime: normalizeRuntime(runtime),
    adapter: normalizeAdapter(adapter),
    sdar: normalizeSdar(sdar),
  });
}

export function validateUgvB02ProviderLedger(value) {
  const root = object(value);
  if (
    !exactKeys(root, ['adapter', 'capturedAt', 'runtime', 'schemaVersion', 'sdar']) ||
    root.schemaVersion !== 'sdar.ugv-agent-profile-provider-ledger/v1' ||
    typeof root.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(root.capturedAt))
  )
    throw new Error('UAP_B02_PROVIDER_LEDGER_SHAPE_INVALID');
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1',
    capturedAt: root.capturedAt,
    runtime: normalizeRuntime(root.runtime),
    adapter: normalizeAdapter(root.adapter),
    sdar: normalizeSdar(root.sdar),
  });
}

export function assessUgvB02ZeroDispatchWindow(beforeValue, afterValue, options = {}) {
  const before = assertUgvB02CleanProviderLedger(beforeValue);
  const after = validateUgvB02ProviderLedger(afterValue);
  if (Date.parse(before.capturedAt) >= Date.parse(after.capturedAt))
    throw new Error('UAP_B02_RECOVERY_LEDGER_WINDOW_INVALID');
  const deltas = Object.fromEntries(
    ZERO_DISPATCH_COLLECTION_PATHS.map(([name, group, collection]) => {
      const beforeRows = before[group][collection];
      const afterRows = after[group][collection];
      if (!hasCanonicalPrefix(beforeRows, afterRows))
        throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
      return [name, afterRows.length - beforeRows.length];
    }),
  );
  if (matchesConfirmedPretransportFailureSignature(deltas)) {
    validateConfirmedPretransportFailureDelta(before, after, options);
  } else {
    const readOnlyQualificationCount = validateReadOnlyQualificationDelta(before, after, options);
    const preconfirmationStructuralDeltas = validatePreconfirmationStructuralDelta(
      before,
      after,
      options,
    );
    if (
      Object.entries(deltas).some(([name, count]) =>
        name === 'adapterDeviceToolCalls' || name === 'sdarMcpInvocations'
          ? count !== readOnlyQualificationCount
          : PRECONFIRMATION_STRUCTURAL_DELTA_NAMES.has(name) ||
              PRECONFIRMATION_PLANNED_DELTA_NAMES.has(name)
            ? count !== preconfirmationStructuralDeltas[name]
            : count !== 0,
      )
    )
      throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  }
  return Object.freeze({
    classification: 'zero_dispatch',
    resultCode: 'UAP_B02_RECOVERY_ZERO_DISPATCH_VERIFIED',
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    beforeLedgerSha256: `sha256:${sha256CanonicalJson(before)}`,
    afterLedgerSha256: `sha256:${sha256CanonicalJson(after)}`,
    deltas: Object.freeze(deltas),
  });
}

export function assessUgvB02TerminalProviderSafeWindow(beforeValue, afterValue, options = {}) {
  const before = assertUgvB02CleanProviderLedger(beforeValue);
  const after = validateUgvB02ProviderLedger(afterValue);
  if (
    typeof options.simulationId !== 'string' ||
    !/^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u.test(options.simulationId) ||
    Date.parse(before.capturedAt) >= Date.parse(after.capturedAt)
  )
    throw new Error('UAP_B02_RECOVERY_LEDGER_WINDOW_INVALID');
  const deltas = Object.fromEntries(
    ZERO_DISPATCH_COLLECTION_PATHS.map(([name, group, collection]) => {
      const beforeRows = before[group][collection];
      const afterRows = after[group][collection];
      if (!hasCanonicalPrefix(beforeRows, afterRows))
        throw new Error('UAP_B02_RECOVERY_TERMINAL_SAFETY_INVALID');
      return [name, afterRows.length - beforeRows.length];
    }),
  );
  if (
    Object.entries(TERMINAL_PROVIDER_SAFE_FAILURE_DELTAS).some(
      ([name, count]) => deltas[name] !== count,
    )
  )
    throw new Error('UAP_B02_RECOVERY_TERMINAL_SAFETY_INVALID');

  const added = (group, collection) =>
    after[group][collection].slice(before[group][collection].length);
  const idempotency = added('runtime', 'idempotencyRecords')[0];
  const providerTask = added('runtime', 'providerTasks')[0];
  const admission = added('runtime', 'admissionIntents')[0];
  const execution = added('adapter', 'executions')[0];
  const deviceCalls = added('adapter', 'deviceToolCalls');
  const mutations = added('adapter', 'mutationJournal');
  const mcp = added('sdar', 'mcpInvocations');
  const confirmation = added('sdar', 'governedConfirmations')[0];
  const intent = added('sdar', 'remoteAdmissionIntents')[0];
  const task = added('sdar', 'tasks')[0];
  const capabilityAttempt = added('sdar', 'capabilityAttempts')[0];
  const workflow = added('sdar', 'workflowInstances')[0];
  const model = added('sdar', 'modelInvocations')[0];
  const providerTaskId = providerTask?.taskId;
  const taskId = task?.taskId;
  const attemptId = capabilityAttempt?.attemptId;
  const navigate = mcp[2];
  const navigateInvocationId = navigate?.invocationId;
  const argumentHash = navigate?.controlArgumentsHash;
  const target = task?.request_metadata?.structured_input?.target;
  const expectedArguments = {
    resourceId: 'vehicle:ugv1',
    mission: { type: 'point', target: { longitude: target?.x, latitude: target?.y } },
    stopOnObstacle: true,
  };
  const result = providerTask?.result?.structuredContent;
  const executionContext = execution?.execution_context;
  const primary = mutations.find((row) => row?.phase === 'PRIMARY');
  const followup = mutations.find((row) => row?.phase === 'FOLLOWUP');
  const stateReads = deviceCalls.filter((row) => row?.toolName === 'get_status');
  const mutationCalls = deviceCalls.filter((row) => row?.toolName !== 'get_status');
  const forbidden = [...deviceCalls, ...mutations].some((row) =>
    /(?:fire|weapon|recon|track|gimbal|emergency_stop|area_recon)/iu.test(JSON.stringify(row)),
  );

  validateStateReadPair(stateReads[0], mcp[0], options, null, null);
  validateStateReadPair(stateReads[1], mcp[1], options, taskId, attemptId);
  if (
    typeof providerTaskId !== 'string' ||
    providerTaskId !== idempotency?.taskId ||
    providerTaskId !== admission?.taskId ||
    providerTaskId !== execution?.taskId ||
    providerTask?.providerId !== 'isr.vehicle.ugv.ugv1' ||
    providerTask?.operationName !== 'vehicle_navigate' ||
    providerTask?.executionMode !== 'simulation' ||
    providerTask?.simulationId !== options.simulationId ||
    providerTask?.internalState !== 'TERMINAL_COMPLETED' ||
    providerTask?.mcpStatus !== 'completed' ||
    providerTask?.substate !== null ||
    providerTask?.error !== null ||
    !Number.isFinite(Date.parse(providerTask?.terminal_at)) ||
    result?.status !== 'completed' ||
    result?.resourceId !== 'vehicle:ugv1' ||
    result?.correlationStrength !== 'STRICT_CORRELATED' ||
    result?.stationaryAtCompletion !== true ||
    !Number.isFinite(result?.endPosition?.longitude) ||
    !Number.isFinite(result?.endPosition?.latitude) ||
    result?.endPosition?.crs !== 'EPSG:4326' ||
    typeof result?.missionId !== 'string' ||
    result.missionId === '' ||
    idempotency?.state !== 'COMPLETE' ||
    idempotency?.operationName !== 'vehicle_navigate' ||
    idempotency?.idempotencyKey !== navigateInvocationId ||
    idempotency?.stable_task_id !== providerTaskId ||
    idempotency?.simulation_key !== options.simulationId ||
    idempotency?.lease_owner !== null ||
    idempotency?.lease_expires_at !== null ||
    idempotency?.synchronous_result !== null ||
    admission?.state !== 'PUBLISHED' ||
    admission?.operationName !== 'vehicle_navigate' ||
    admission?.simulationId !== options.simulationId ||
    sha256CanonicalJson(admission?.arguments) !== sha256CanonicalJson(expectedArguments) ||
    execution?.state !== 'SUCCEEDED' ||
    execution?.operationName !== 'vehicle_navigate' ||
    execution?.resourceId !== 'vehicle:ugv1' ||
    execution?.externalExecutionId !== providerTask?.externalExecutionId ||
    executionContext?.simulationId !== options.simulationId ||
    executionContext?.executionMode !== 'SIMULATION' ||
    execution?.argumentHash !== argumentHash ||
    providerTask?.argumentHash !== argumentHash ||
    idempotency?.argumentHash !== argumentHash ||
    admission?.argumentHash !== argumentHash ||
    stateReads.length !== 2 ||
    mutationCalls.length !== 2 ||
    mutationCalls.some((row) => row?.taskId !== providerTaskId || row?.outcome !== 'accepted') ||
    mutations.some((row) => row?.taskId !== providerTaskId || row?.state !== 'ACCEPTED') ||
    primary?.toolName !== 'ugv_path_follow_mission' ||
    primary?.stepId !== 'start:01:primary' ||
    followup?.toolName !== 'ugv_mission_control' ||
    followup?.stepId !== 'start:02:followup' ||
    primary?.externalMissionId !== result.missionId ||
    followup?.externalMissionId !== result.missionId ||
    forbidden ||
    mcp[0]?.toolName !== 'vehicle_get_state' ||
    mcp[1]?.toolName !== 'vehicle_get_state' ||
    navigate?.toolName !== 'vehicle_navigate' ||
    navigate?.status !== 'failed' ||
    navigate?.error_code !== 'FROZEN_CREATE_TASK_RESULT_INVALID' ||
    navigate?.result_json !== null ||
    navigate?.taskId !== taskId ||
    navigate?.capabilityAttemptId !== attemptId ||
    navigate?.simulationId !== options.simulationId ||
    sha256CanonicalJson(navigate?.arguments) !== sha256CanonicalJson(expectedArguments) ||
    confirmation?.taskId !== taskId ||
    confirmation?.capabilityAttemptId !== attemptId ||
    confirmation?.consumedInvocationId !== navigateInvocationId ||
    confirmation?.argumentsHash !== argumentHash ||
    !Number.isFinite(Date.parse(confirmation?.consumedAt)) ||
    intent?.taskId !== taskId ||
    intent?.capabilityAttemptId !== attemptId ||
    intent?.invocationId !== navigateInvocationId ||
    intent?.status !== 'uncertain' ||
    intent?.reason_code !== 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN' ||
    intent?.recordedInvocationId !== null ||
    intent?.materializedAt !== null ||
    intent?.remote_receipt_json !== null ||
    intent?.local_envelope_json?.executionContext?.simulationId !== options.simulationId ||
    task?.phase !== 'failed' ||
    task?.error_code !== 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' ||
    capabilityAttempt?.status !== 'failed' ||
    workflow?.status !== 'failed' ||
    workflow?.errors_json?.runtime?.code !== 'FROZEN_CREATE_TASK_RESULT_INVALID' ||
    workflow?.result_json !== null ||
    model?.stage !== 'result_processing' ||
    model?.status !== 'succeeded'
  )
    throw new Error('UAP_B02_RECOVERY_TERMINAL_SAFETY_INVALID');

  return Object.freeze({
    classification: 'terminal_provider_safe',
    resultCode: 'UAP_B02_RECOVERY_TERMINAL_PROVIDER_SAFE_VERIFIED',
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    beforeLedgerSha256: `sha256:${sha256CanonicalJson(before)}`,
    afterLedgerSha256: `sha256:${sha256CanonicalJson(after)}`,
    deltas: Object.freeze(deltas),
  });
}

function validatePreconfirmationStructuralDelta(before, after, options) {
  const admissions = appended(before.sdar.initialTaskAdmissions, after.sdar.initialTaskAdmissions);
  const attempts = appended(before.sdar.capabilityAttempts, after.sdar.capabilityAttempts);
  const tasks = appended(before.sdar.tasks, after.sdar.tasks);
  const goals = appended(before.sdar.goals, after.sdar.goals);
  const contracts = appended(before.sdar.goalContracts, after.sdar.goalContracts);
  const plans = appended(before.sdar.userGoalPlans, after.sdar.userGoalPlans);
  const workflowPlans = appended(before.sdar.workflowPlans, after.sdar.workflowPlans);
  const skillExecutions = appended(before.sdar.skillExecutions, after.sdar.skillExecutions);
  const skillExecutionEvents = appended(
    before.sdar.skillExecutionEvents,
    after.sdar.skillExecutionEvents,
  );
  const baseCollections = [admissions, attempts, tasks, goals, contracts, plans];
  const emptyDeltas = Object.freeze({
    sdarInitialTaskAdmissions: 0,
    sdarCapabilityAttempts: 0,
    sdarTasks: 0,
    sdarGoals: 0,
    sdarGoalContracts: 0,
    sdarUserGoalPlans: 0,
    sdarWorkflowPlans: 0,
    sdarSkillExecutions: 0,
    sdarSkillExecutionEvents: 0,
  });
  if (
    [...baseCollections, workflowPlans, skillExecutions, skillExecutionEvents].every(
      (rows) => rows.length === 0,
    )
  )
    return emptyDeltas;
  if (
    baseCollections.some((rows) => rows.length !== 1) ||
    typeof options.simulationId !== 'string' ||
    !/^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u.test(options.simulationId)
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');

  const admission = admissions[0];
  const attempt = attempts[0];
  const task = tasks[0];
  const goal = goals[0];
  const contract = contracts[0];
  const plan = plans[0];
  const metadata = task?.request_metadata;
  const requestedCapability = metadata?.['io.sdar/requestedCapability'];
  const structuredInput = metadata?.structured_input;
  const target = structuredInput?.target;
  const expectedIdempotencyKey = `uap-p3-b02-a2a-${createHash('sha256')
    .update(options.simulationId)
    .digest('hex')}`;
  const taskId = task?.taskId;
  const contextId = task?.contextId;
  const goalId = task?.goalId;
  const bindingId = admission?.capabilityBindingId;
  if (
    typeof taskId !== 'string' ||
    taskId !== task?.task_id ||
    typeof contextId !== 'string' ||
    contextId !== task?.context_id ||
    typeof goalId !== 'string' ||
    goalId !== task?.goal_id ||
    task?.user_id !== 'uap-p3-b02-requester' ||
    metadata?.user_id !== 'uap-p3-b02-requester' ||
    metadata?.idempotency_key !== expectedIdempotencyKey ||
    requestedCapability?.exposureId !== 'a2a.embodied.move' ||
    requestedCapability?.versionConstraint !== '2' ||
    requestedCapability?.requestId !== expectedIdempotencyKey ||
    structuredInput?.resourceId !== 'vehicle:ugv1' ||
    target?.frame !== 'WGS84' ||
    !Number.isFinite(target?.x) ||
    target.x < -180 ||
    target.x > 180 ||
    !Number.isFinite(target?.y) ||
    target.y < -90 ||
    target.y > 90 ||
    Object.keys(target).sort().join(',') !== 'frame,x,y' ||
    admission?.taskId !== taskId ||
    admission?.task_id !== taskId ||
    admission?.contextId !== contextId ||
    admission?.context_id !== contextId ||
    admission?.idempotencyKey !== expectedIdempotencyKey ||
    admission?.idempotency_key !== expectedIdempotencyKey ||
    typeof admission?.capabilityAttemptId !== 'string' ||
    admission.capabilityAttemptId !== attempt?.attemptId ||
    typeof bindingId !== 'string' ||
    bindingId !== admission?.capability_binding_id ||
    bindingId !== attempt?.capabilityBindingId ||
    attempt?.taskId !== taskId ||
    attempt?.task_id !== taskId ||
    attempt?.attemptNo !== 1 ||
    attempt?.attempt_no !== 1 ||
    attempt?.reason !== 'initial' ||
    JSON.stringify(attempt?.skill_version_refs) !== JSON.stringify(['skill:embodied.move_to:1']) ||
    !Array.isArray(attempt?.provider_binding_refs) ||
    attempt.provider_binding_refs.length !== 1 ||
    goal?.goalId !== goalId ||
    goal?.goal_id !== goalId ||
    goal?.contextId !== contextId ||
    goal?.context_id !== contextId ||
    goal?.version !== 1 ||
    goal?.goalVersion !== 1 ||
    goal?.status !== 'active' ||
    contract?.goalId !== goalId ||
    contract?.goal_id !== goalId ||
    contract?.goalVersion !== 1 ||
    contract?.goal_version !== 1 ||
    plan?.goalId !== goalId ||
    plan?.goal_id !== goalId ||
    plan?.goalVersion !== 1 ||
    plan?.goal_version !== 1 ||
    plan?.revision !== 1 ||
    plan?.status !== 'active'
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');

  const baseDeltas = {
    sdarInitialTaskAdmissions: 1,
    sdarCapabilityAttempts: 1,
    sdarTasks: 1,
    sdarGoals: 1,
    sdarGoalContracts: 1,
    sdarUserGoalPlans: 1,
  };
  if (
    task?.phase === 'failed' &&
    task?.planId === null &&
    task?.plan_id === null &&
    task?.selectedSkillId === null &&
    task?.selected_skill_id === null &&
    typeof task?.phase_message === 'string' &&
    task.phase_message.startsWith('Task preparation failed with ') &&
    attempt?.status === 'failed' &&
    attempt?.planId === null &&
    attempt?.plan_id === null &&
    workflowPlans.length === 0 &&
    skillExecutions.length === 0 &&
    skillExecutionEvents.length === 0
  )
    return Object.freeze({
      ...baseDeltas,
      sdarWorkflowPlans: 0,
      sdarSkillExecutions: 0,
      sdarSkillExecutionEvents: 0,
    });

  validateAwaitingConfirmationPlanningDelta({
    task,
    attempt,
    goalId,
    taskId,
    target,
    workflowPlans,
    skillExecutions,
    skillExecutionEvents,
  });
  return Object.freeze({
    ...baseDeltas,
    sdarWorkflowPlans: 1,
    sdarSkillExecutions: 1,
    sdarSkillExecutionEvents: 11,
  });
}

function validateAwaitingConfirmationPlanningDelta({
  task,
  attempt,
  goalId,
  taskId,
  target,
  workflowPlans,
  skillExecutions,
  skillExecutionEvents,
  boundary = 'awaiting_confirmation',
}) {
  const confirmedPretransportFailure = boundary === 'confirmed_pretransport_failure';
  if (
    workflowPlans.length !== 1 ||
    skillExecutions.length !== 1 ||
    skillExecutionEvents.length !== (confirmedPretransportFailure ? 13 : 11)
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  const workflowPlan = workflowPlans[0];
  const skillExecution = skillExecutions[0];
  const planId = workflowPlan?.planId;
  const executionId = skillExecution?.executionId;
  const expectedEventTypes = [
    'skill.discovered',
    'skill.applicability_assessed',
    'skill.selected',
    'skill.mode_selected',
    'skill.context_resolved',
    'skill.composition_started',
    'skill.plan_generated',
    'skill.procedure_compiled',
    'skill.plan_compliance_passed',
    'skill.hard_gate_triggered',
    'skill.human_intervention',
    ...(confirmedPretransportFailure ? ['skill.execution_started', 'skill.execution_failed'] : []),
  ];
  const nodes = workflowPlan?.definition_json?.nodes;
  const expectedNodes = [
    ['ugv_initial_state', 'mcp_tool', 'vehicle_get_state'],
    ['ugv_context_current_position', 'condition', undefined],
    ['ugv_context_resource_state', 'condition', undefined],
    ['ugv_context_permission', 'condition', undefined],
    ['ugv_navigate', 'mcp_tool', 'vehicle_navigate'],
    ['ugv_final_state', 'mcp_tool', 'vehicle_get_state'],
    ['ugv_evidence_final_position', 'condition', undefined],
    ['ugv_success', 'result', undefined],
    ['ugv_failure', 'result', undefined],
  ];
  const navigate = Array.isArray(nodes) ? nodes[4] : undefined;
  if (
    typeof planId !== 'string' ||
    planId !== workflowPlan?.plan_id ||
    workflowPlan?.goalId !== goalId ||
    workflowPlan?.goal_id !== goalId ||
    workflowPlan?.goalVersion !== 1 ||
    workflowPlan?.goal_version !== 1 ||
    (confirmedPretransportFailure
      ? workflowPlan?.confirmation_status !== 'confirmed' ||
        !Number.isFinite(Date.parse(workflowPlan?.confirmed_at))
      : workflowPlan?.confirmation_status !== 'awaiting_confirmation' ||
        workflowPlan?.confirmed_at !== null) ||
    workflowPlan?.attempt_count !== 1 ||
    (confirmedPretransportFailure
      ? task?.phase !== 'failed' ||
        task?.phase_message !==
          'Confirmed Task execution failed with TASK_CAPABILITY_TERMINAL_GUARD_FAILED.' ||
        task?.error_code !== 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED'
      : task?.phase !== 'awaiting_plan_confirmation' ||
        task?.phase_message !== 'Plan confirmation required.') ||
    task?.planId !== planId ||
    task?.plan_id !== planId ||
    task?.selectedSkillId !== 'embodied.move_to' ||
    task?.selected_skill_id !== 'embodied.move_to' ||
    task?.selectedSkillVersion !== 1 ||
    task?.selected_skill_version !== 1 ||
    attempt?.status !== (confirmedPretransportFailure ? 'failed' : 'prepared') ||
    attempt?.planId !== planId ||
    attempt?.plan_id !== planId ||
    (confirmedPretransportFailure
      ? !Number.isFinite(Date.parse(attempt?.started_at)) ||
        !Number.isFinite(Date.parse(attempt?.completedAt)) ||
        attempt?.completedAt !== attempt?.completed_at
      : attempt?.started_at !== null ||
        attempt?.completedAt !== null ||
        attempt?.completed_at !== null) ||
    skillExecution?.taskId !== taskId ||
    skillExecution?.task_id !== taskId ||
    skillExecution?.goalId !== goalId ||
    skillExecution?.goal_id !== goalId ||
    skillExecution?.skillId !== 'embodied.move_to' ||
    skillExecution?.skill_id !== 'embodied.move_to' ||
    skillExecution?.skillVersion !== 1 ||
    skillExecution?.skill_version !== 1 ||
    skillExecution?.workflowPlanId !== planId ||
    skillExecution?.workflow_plan_id !== planId ||
    skillExecution?.applicability_status !== 'satisfied' ||
    typeof executionId !== 'string' ||
    executionId !== skillExecution?.execution_id ||
    !Array.isArray(nodes) ||
    nodes.length !== expectedNodes.length ||
    expectedNodes.some(
      ([nodeId, type, toolName], index) =>
        nodes[index]?.nodeId !== nodeId ||
        nodes[index]?.type !== type ||
        (toolName !== undefined && nodes[index]?.tool?.toolName !== toolName),
    ) ||
    sha256CanonicalJson(navigate?.arguments) !==
      sha256CanonicalJson({
        resourceId: 'vehicle:ugv1',
        mission: {
          type: 'point',
          target: { longitude: target.x, latitude: target.y },
        },
        stopOnObstacle: true,
      }) ||
    skillExecutionEvents.some(
      (event, index) =>
        event?.executionId !== executionId ||
        event?.execution_id !== executionId ||
        event?.sequenceNumber !== index + 1 ||
        event?.sequence_number !== index + 1 ||
        event?.eventType !== expectedEventTypes[index] ||
        event?.event_type !== expectedEventTypes[index],
    )
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
}

function matchesConfirmedPretransportFailureSignature(deltas) {
  return Object.entries(deltas).every(
    ([name, count]) => count === (CONFIRMED_PRETRANSPORT_FAILURE_DELTAS[name] ?? 0),
  );
}

function validateConfirmedPretransportFailureDelta(before, after, options) {
  if (
    typeof options.simulationId !== 'string' ||
    !/^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u.test(options.simulationId)
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  const tasks = appended(before.sdar.tasks, after.sdar.tasks);
  const attempts = appended(before.sdar.capabilityAttempts, after.sdar.capabilityAttempts);
  const workflowPlans = appended(before.sdar.workflowPlans, after.sdar.workflowPlans);
  const skillExecutions = appended(before.sdar.skillExecutions, after.sdar.skillExecutions);
  const skillExecutionEvents = appended(
    before.sdar.skillExecutionEvents,
    after.sdar.skillExecutionEvents,
  );
  const task = tasks[0];
  const attempt = attempts[0];
  const target = task?.request_metadata?.structured_input?.target;
  validateAwaitingConfirmationPlanningDelta({
    task,
    attempt,
    goalId: task?.goalId,
    taskId: task?.taskId,
    target,
    workflowPlans,
    skillExecutions,
    skillExecutionEvents,
    boundary: 'confirmed_pretransport_failure',
  });

  const deviceRows = appended(before.adapter.deviceToolCalls, after.adapter.deviceToolCalls);
  const invocationRows = appended(before.sdar.mcpInvocations, after.sdar.mcpInvocations);
  const model = appended(before.sdar.modelInvocations, after.sdar.modelInvocations)[0];
  const confirmation = appended(
    before.sdar.governedConfirmations,
    after.sdar.governedConfirmations,
  )[0];
  const intent = appended(before.sdar.remoteAdmissionIntents, after.sdar.remoteAdmissionIntents)[0];
  const workflow = appended(before.sdar.workflowInstances, after.sdar.workflowInstances)[0];
  const taskId = task?.taskId;
  const contextId = task?.contextId;
  const attemptId = attempt?.attemptId;
  const planId = workflowPlans[0]?.planId;
  const navigateArguments = workflowPlans[0]?.definition_json?.nodes?.[4]?.arguments;
  const argumentsHash = sha256CanonicalJson(navigateArguments);

  validateStateReadPair(deviceRows[0], invocationRows[0], options, null, null);
  validateStateReadPair(deviceRows[1], invocationRows[1], options, taskId, attemptId);
  if (
    model?.stage !== 'result_processing' ||
    model?.operation !== 'structured_generation' ||
    model?.status !== 'succeeded' ||
    model?.taskId !== null ||
    model?.errorCode !== null ||
    !Number.isFinite(Date.parse(model?.createdAt)) ||
    confirmation?.taskId !== taskId ||
    confirmation?.task_id !== taskId ||
    confirmation?.planId !== planId ||
    confirmation?.plan_id !== planId ||
    confirmation?.capabilityAttemptId !== attemptId ||
    confirmation?.toolName !== 'vehicle_navigate' ||
    confirmation?.tool_name !== 'vehicle_navigate' ||
    confirmation?.argumentsHash !== argumentsHash ||
    confirmation?.arguments_hash !== argumentsHash ||
    confirmation?.consumedAt !== null ||
    confirmation?.consumed_at !== null ||
    confirmation?.consumedInvocationId !== null ||
    confirmation?.consumedDispatchHash !== null ||
    confirmation?.revoked_at !== null ||
    !Number.isFinite(Date.parse(confirmation?.confirmed_at)) ||
    !Number.isFinite(Date.parse(confirmation?.expires_at)) ||
    intent?.taskId !== taskId ||
    intent?.task_id !== taskId ||
    intent?.contextId !== contextId ||
    intent?.context_id !== contextId ||
    intent?.capabilityAttemptId !== attemptId ||
    intent?.operationName !== 'vehicle_navigate' ||
    intent?.operation_name !== 'vehicle_navigate' ||
    intent?.argumentsHash !== argumentsHash ||
    intent?.arguments_hash !== argumentsHash ||
    intent?.status !== 'closed' ||
    intent?.reason_code !== 'UGV_GOVERNED_CONTROL_READINESS_STALE' ||
    intent?.dispatch_hash !== null ||
    intent?.dispatched_at !== null ||
    intent?.materializedAt !== null ||
    intent?.materialized_at !== null ||
    intent?.recordedInvocationId !== null ||
    intent?.recorded_invocation_id !== null ||
    intent?.remote_receipt_json !== null ||
    intent?.local_envelope_json?.executionContext?.simulationId !== options.simulationId ||
    intent?.local_envelope_json?.workflowPlanId !== planId ||
    intent?.local_envelope_json?.agentTaskId !== taskId ||
    workflow?.status !== 'failed' ||
    workflow?.task_id === taskId ||
    workflow?.planId !== planId ||
    workflow?.plan_id !== planId ||
    workflow?.goalId !== task?.goalId ||
    workflow?.errors_json?.runtime?.code !== 'UGV_GOVERNED_CONTROL_READINESS_STALE' ||
    workflow?.result_json !== null ||
    !Number.isFinite(Date.parse(workflow?.completedAt)) ||
    workflow?.input_json?.skillInput?.resourceId !== 'vehicle:ugv1' ||
    sha256CanonicalJson(workflow?.input_json?.skillInput?.target) !== sha256CanonicalJson(target) ||
    skillExecutionEvents[11]?.eventType !== 'skill.execution_started' ||
    skillExecutionEvents[11]?.statusAfter !== 'executing' ||
    skillExecutionEvents[12]?.eventType !== 'skill.execution_failed' ||
    skillExecutionEvents[12]?.statusAfter !== 'failed' ||
    skillExecutionEvents[12]?.details_json?.errorCode !== 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED'
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
}

function appended(beforeRows, afterRows) {
  return afterRows.slice(beforeRows.length);
}

function validateReadOnlyQualificationDelta(before, after, options) {
  const deviceRows = after.adapter.deviceToolCalls.slice(before.adapter.deviceToolCalls.length);
  const invocationRows = after.sdar.mcpInvocations.slice(before.sdar.mcpInvocations.length);
  if (deviceRows.length === 0 && invocationRows.length === 0) return 0;
  if (
    deviceRows.length !== 1 ||
    invocationRows.length !== 1 ||
    typeof options.simulationId !== 'string' ||
    !/^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u.test(options.simulationId)
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
  validateStateReadPair(deviceRows[0], invocationRows[0], options, null, null);
  return 1;
}

function validateStateReadPair(device, invocation, options, expectedTaskId, expectedAttemptId) {
  const taskId = device?.taskId;
  const evidence = invocation?.result_json?.evidence;
  const subjectRef = Array.isArray(evidence) ? evidence[0]?.subjectRef : undefined;
  if (
    device?.toolName !== 'get_status' ||
    device?.tool_name !== 'get_status' ||
    device?.outcome !== 'accepted' ||
    typeof taskId !== 'string' ||
    taskId !== device?.task_id ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(taskId) ||
    typeof device?.callId !== 'string' ||
    device.callId !== device?.call_id ||
    typeof device?.argumentHash !== 'string' ||
    device.argumentHash !== device?.argument_hash ||
    !/^[a-f0-9]{64}$/u.test(device.argumentHash) ||
    !Number.isFinite(Date.parse(device?.occurredAt)) ||
    invocation?.status !== 'succeeded' ||
    invocation?.taskId !== expectedTaskId ||
    invocation?.task_id !== expectedTaskId ||
    invocation?.capabilityAttemptId !== expectedAttemptId ||
    invocation?.controlConfirmationId !== null ||
    invocation?.controlProviderBindingId !== null ||
    invocation?.controlArgumentsHash !== null ||
    invocation?.controlDispatchHash !== null ||
    invocation?.toolName !== 'vehicle_get_state' ||
    invocation?.tool_name !== 'vehicle_get_state' ||
    invocation?.executionMode !== 'simulation' ||
    invocation?.simulationId !== options.simulationId ||
    invocation?.simulation_id !== options.simulationId ||
    sha256CanonicalJson(invocation?.arguments) !==
      sha256CanonicalJson({ resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] }) ||
    invocation?.error_code !== null ||
    invocation?.error_message !== null ||
    invocation?.result_json?.isError !== false ||
    invocation?.result_json?.structuredContent?.identity?.resourceId !== 'vehicle:ugv1' ||
    invocation?.result_json?.structuredContent?.identity?.executionMode !== 'simulation' ||
    invocation?.execution_semantics_json?.effect !== 'read_only' ||
    invocation?.execution_semantics_json?.execution !== 'synchronous' ||
    invocation?.execution_semantics_json?.replay !== 'allowed' ||
    typeof subjectRef !== 'string' ||
    !subjectRef.endsWith(`:${taskId}`) ||
    !Number.isFinite(Date.parse(invocation?.startedAt)) ||
    !Number.isFinite(Date.parse(invocation?.completedAt)) ||
    Date.parse(invocation.startedAt) > Date.parse(device.occurredAt) ||
    Date.parse(device.occurredAt) > Date.parse(invocation.completedAt)
  )
    throw new Error('UAP_B02_RECOVERY_NONZERO_DISPATCH');
}

function hasCanonicalPrefix(beforeRows, afterRows) {
  return (
    afterRows.length >= beforeRows.length &&
    sha256CanonicalJson(beforeRows) === sha256CanonicalJson(afterRows.slice(0, beforeRows.length))
  );
}

export function assertUgvB02CleanProviderLedger(value) {
  const ledger = validateUgvB02ProviderLedger(value);
  const historicalStateReadsAreClosed = ledger.adapter.deviceToolCalls.every(
    (row) =>
      row.toolName === 'get_status' &&
      row.outcome === 'accepted' &&
      typeof row.taskId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(row.taskId),
  );
  const forbidden = allLedgerRows(ledger).some((row) =>
    /(?:fire|weapon|recon|track|gimbal|emergency_stop|area_recon)/iu.test(JSON.stringify(row)),
  );
  if (
    ledger.runtime.providerTasks.length !== 0 ||
    ledger.runtime.admissionIntents.length !== 0 ||
    ledger.runtime.idempotencyRecords.length !== 0 ||
    ledger.adapter.executions.length !== 0 ||
    ledger.adapter.mutationJournal.length !== 0 ||
    ledger.adapter.commandAcks.length !== 0 ||
    ledger.sdar.modelInvocations.length !== 0 ||
    ledger.sdar.mcpInvocations.length !== 0 ||
    ledger.sdar.initialTaskAdmissions.length !== 0 ||
    ledger.sdar.capabilityAttempts.length !== 0 ||
    ledger.sdar.governedConfirmations.length !== 0 ||
    ledger.sdar.remoteAdmissionIntents.length !== 0 ||
    ledger.sdar.continuationSnapshots.length !== 0 ||
    ledger.sdar.continuationAttempts.length !== 0 ||
    ledger.sdar.terminalOutcomes.length !== 0 ||
    ledger.sdar.workflowNodeEvents.length !== 0 ||
    ledger.sdar.tasks.length !== 0 ||
    ledger.sdar.goals.length !== 0 ||
    ledger.sdar.goalContracts.length !== 0 ||
    ledger.sdar.userGoalPlans.length !== 0 ||
    ledger.sdar.workflowPlans.length !== 0 ||
    ledger.sdar.workflowInstances.length !== 0 ||
    ledger.sdar.skillExecutions.length !== 0 ||
    ledger.sdar.skillExecutionEvents.length !== 0 ||
    ledger.sdar.processedResults.length !== 0 ||
    !historicalStateReadsAreClosed ||
    forbidden
  )
    throw new Error('UAP_B02_PROVIDER_LEDGER_NOT_CLEAN');
  return ledger;
}

function querySdarPostgres(execute, query) {
  let output;
  try {
    output = execute(
      'docker',
      [
        'compose',
        '--env-file',
        '/dev/null',
        '--project-directory',
        REPOSITORY_ROOT,
        '--project-name',
        SDAR_PROJECT,
        '-f',
        resolve(DEPLOY_ROOT, 'compose.sdar.yaml'),
        'exec',
        '-T',
        'uap-sdar-postgres',
        'psql',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'sdar_uap',
        '-d',
        'sdar_uap',
        '-A',
        '-t',
        '-c',
        query,
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
        env: composeEnvironment(),
      },
    ).trim();
  } catch {
    throw new Error('UAP_B02_SDAR_MODEL_LEDGER_READ_FAILED');
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('UAP_B02_SDAR_MODEL_LEDGER_JSON_INVALID');
  }
}

export async function writePrivateLedger(path, ledger) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = `${absolute}.tmp-${String(process.pid)}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(ledger)}\n`, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, absolute);
    await unlink(temporary);
    await chmod(absolute, 0o600);
    const directory = await open(parent, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function queryPostgres(execute, service, user, database, query) {
  let output;
  try {
    output = execute(
      'docker',
      [
        'compose',
        '--env-file',
        '/dev/null',
        '--project-directory',
        SMPP_ROOT,
        '--project-name',
        PROJECT,
        '-f',
        resolve(SMPP_ROOT, 'compose.yaml'),
        '-f',
        resolve(SMPP_ROOT, 'compose.ugv-agent-profile-simulation.yaml'),
        '-f',
        resolve(DEPLOY_ROOT, 'compose.smpp-pms.yaml'),
        '--profile',
        'ugv-agent-profile-simulation',
        'exec',
        '-T',
        service,
        'psql',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        user,
        '-d',
        database,
        '-A',
        '-t',
        '-c',
        query,
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
        env: composeEnvironment(),
      },
    ).trim();
  } catch {
    throw new Error('UAP_B02_PROVIDER_LEDGER_READ_FAILED');
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('UAP_B02_PROVIDER_LEDGER_JSON_INVALID');
  }
}

function composeEnvironment() {
  return Object.freeze({
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    TERM: process.env.TERM,
    TZ: process.env.TZ,
    UAP_PMS_STATE_ROOT: `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}/pms`,
    UGV_AGENT_PROFILE_ADAPTER_PORT: '17031',
    UGV_AGENT_PROFILE_RUNTIME_PORT: '19131',
    UGV_AGENT_PROFILE_IMAGE_TAG: 'uap-p3-b01',
  });
}

function normalizeRuntime(value) {
  const root = object(value);
  if (!exactKeys(root, ['admissionIntents', 'idempotencyRecords', 'providerTasks']))
    throw new Error('UAP_B02_PROVIDER_LEDGER_SHAPE_INVALID');
  return Object.freeze({
    idempotencyRecords: records(root.idempotencyRecords),
    providerTasks: records(root.providerTasks),
    admissionIntents: records(root.admissionIntents),
  });
}

function normalizeAdapter(value) {
  const root = object(value);
  if (!exactKeys(root, ['commandAcks', 'deviceToolCalls', 'executions', 'mutationJournal']))
    throw new Error('UAP_B02_PROVIDER_LEDGER_SHAPE_INVALID');
  return Object.freeze({
    executions: records(root.executions),
    deviceToolCalls: records(root.deviceToolCalls),
    mutationJournal: records(root.mutationJournal),
    commandAcks: records(root.commandAcks),
  });
}

function normalizeSdar(value) {
  const root = object(value);
  if (
    !exactKeys(root, [
      'capabilityAttempts',
      'continuationAttempts',
      'continuationSnapshots',
      'goalContracts',
      'goals',
      'governedConfirmations',
      'initialTaskAdmissions',
      'mcpInvocations',
      'modelInvocations',
      'modelProviders',
      'processedResults',
      'remoteAdmissionIntents',
      'skillExecutionEvents',
      'skillExecutions',
      'stageModelRoutes',
      'tasks',
      'terminalOutcomes',
      'userGoalPlans',
      'workflowInstances',
      'workflowNodeEvents',
      'workflowPlans',
    ])
  )
    throw new Error('UAP_B02_PROVIDER_LEDGER_SHAPE_INVALID');
  return Object.freeze({
    modelInvocations: records(root.modelInvocations),
    mcpInvocations: records(root.mcpInvocations),
    stageModelRoutes: records(root.stageModelRoutes),
    modelProviders: records(root.modelProviders),
    initialTaskAdmissions: records(root.initialTaskAdmissions),
    capabilityAttempts: records(root.capabilityAttempts),
    governedConfirmations: records(root.governedConfirmations),
    remoteAdmissionIntents: records(root.remoteAdmissionIntents),
    continuationSnapshots: records(root.continuationSnapshots),
    continuationAttempts: records(root.continuationAttempts),
    terminalOutcomes: records(root.terminalOutcomes),
    workflowNodeEvents: records(root.workflowNodeEvents),
    tasks: records(root.tasks),
    goals: records(root.goals),
    goalContracts: records(root.goalContracts),
    userGoalPlans: records(root.userGoalPlans),
    workflowPlans: records(root.workflowPlans),
    workflowInstances: records(root.workflowInstances),
    skillExecutions: records(root.skillExecutions),
    skillExecutionEvents: records(root.skillExecutionEvents),
    processedResults: records(root.processedResults),
  });
}

function object(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('UAP_B02_PROVIDER_LEDGER_SHAPE_INVALID');
  return value;
}

function records(value) {
  if (!Array.isArray(value)) throw new Error('UAP_B02_PROVIDER_LEDGER_SHAPE_INVALID');
  return Object.freeze(value.map((row) => Object.freeze({ ...object(row) })));
}

function allLedgerRows(ledger) {
  return [
    ...Object.values(ledger.runtime),
    ...Object.values(ledger.adapter),
    ...Object.values(ledger.sdar),
  ].flatMap((value) => (Array.isArray(value) ? value : []));
}

function exactKeys(value, keys) {
  return Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== 'capture')
    throw new Error('Usage: provider-ledger.mjs capture <private-output-file>');
  const ledger = captureUgvB02ProviderLedger();
  await writePrivateLedger(process.argv[3], ledger);
  process.stdout.write(
    `${JSON.stringify({ status: 'captured', schemaVersion: ledger.schemaVersion, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'UAP_B02_PROVIDER_LEDGER_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
