import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { SendMessageRequest, Task, TaskState } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import { z } from 'zod';

import {
  UGV_B02_EXPOSURE_ID,
  UGV_B02_PROVIDER_ID,
  UGV_B02_REPORT_SCHEMA,
  UGV_B02_RESOURCE_ID,
  UGV_B02_SIMULATION_ID_PATTERN,
  UgvB02ProviderLedgerSchema,
  addedRows,
  assertUgvB02CleanPreLedger,
  assertUgvB02CursorLineage,
  assertUgvB02FinalPosition,
  assertUgvB02QualificationToInitial,
  buildUgvB02FormalAdmission,
  buildUgvB02PlanConfirmation,
  canonical,
  compareUgvB02DurableLineage,
  compareUgvB02ModelRuntime,
  compareUgvB02ProviderLedger,
  compareUgvB02SdarInvocations,
  createUgvB02PreparedMove,
  deriveUgvB02AdmissionIdempotencyKey,
  sha256,
  validateUgvB02PreparedMove,
  validateUgvB02Qualification,
  type UgvB02PreparedMove,
  type UgvB02ProviderLedger,
} from './ugv-agent-profile-a2a-move-contract.js';
import {
  UgvB02AuthorityGateError,
  createUgvB02AuthorityGatePrivateReport,
  waitForUgvB02AuthorityRunway,
} from './ugv-agent-profile-b02-authority-gate.js';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const EXPECTED_A2A_BASE_URL = 'http://127.0.0.1:10999';
const EXPECTED_RUNTIME_MANAGEMENT_BASE_URL = 'http://127.0.0.1:10998';
const EXPECTED_NODE_CONTROL_BASE_URL = 'http://127.0.0.1:10091';
export const UGV_B02_TERMINAL_SUMMARY =
  'UGV movement completed with durable final-position evidence under the exact simulation authority.';
const PROVIDER_LEDGER_SCRIPT = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/provider-ledger.mjs',
);
const TERMINAL_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
const EXPECTED_PLAN_NODES = Object.freeze([
  Object.freeze({ nodeId: 'ugv_initial_state', type: 'mcp_tool', toolName: 'vehicle_get_state' }),
  Object.freeze({ nodeId: 'ugv_context_current_position', type: 'condition' }),
  Object.freeze({ nodeId: 'ugv_context_resource_state', type: 'condition' }),
  Object.freeze({ nodeId: 'ugv_context_permission', type: 'condition' }),
  Object.freeze({ nodeId: 'ugv_navigate', type: 'mcp_tool', toolName: 'vehicle_navigate' }),
  Object.freeze({ nodeId: 'ugv_final_state', type: 'mcp_tool', toolName: 'vehicle_get_state' }),
  Object.freeze({ nodeId: 'ugv_evidence_final_position', type: 'condition' }),
  Object.freeze({ nodeId: 'ugv_success', type: 'result' }),
  Object.freeze({ nodeId: 'ugv_failure', type: 'result' }),
] as const);

export type UgvB02A2AClient = Pick<Client, 'sendMessage' | 'getTask'>;

export interface UgvB02MoveConfiguration {
  readonly simulationId: string;
  readonly admissionIdempotencyKey: string;
  readonly target: Readonly<{ x: number; y: number; frame: 'WGS84' }>;
  readonly a2aBaseUrl: string;
  readonly runtimeManagementBaseUrl: string;
  readonly nodeControlBaseUrl: string;
  readonly runtimeControlBearerToken: string;
  readonly governedControlBearerToken: string;
  readonly nodeControlBearerToken: string;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly requestTimeoutMs?: number;
  readonly writeRequestTimeoutMs?: number;
  readonly ledgerReconciliationMaxPolls?: number;
}

export interface UgvB02MoveDependencies {
  readonly fetch?: typeof fetch;
  readonly createA2AClient?: (baseUrl: string) => Promise<UgvB02A2AClient>;
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly pause?: (milliseconds: number) => Promise<void>;
  readonly captureProviderLedger?: (attempt?: number) => Promise<UgvB02ProviderLedger>;
}

interface ValidatedConfiguration extends UgvB02MoveConfiguration {
  readonly pollIntervalMs: number;
  readonly maxPolls: number;
  readonly requestTimeoutMs: number;
  readonly writeRequestTimeoutMs: number;
  readonly ledgerReconciliationMaxPolls: number;
}

interface RuntimeTask {
  readonly taskId: string;
  readonly contextId: string;
  readonly phase: string;
  readonly planId: string;
  readonly selectedSkillId: string;
  readonly selectedSkillVersion: number;
  readonly output?: unknown;
}

export interface UgvB02MoveReport {
  readonly schemaVersion: typeof UGV_B02_REPORT_SCHEMA;
  readonly status: 'passed';
  readonly evidenceClass: 'external_simulation';
  readonly productionEligible: false;
  readonly physicalVehicleQualified: false;
  readonly observationClass: 'external_runtime_and_postgresql';
  readonly generatedAt: string;
  readonly simulationId: string;
  readonly qualification: UgvB02PreparedMove['qualification'];
  readonly admission: Readonly<{
    taskId: string;
    contextId: string;
    messageId: string;
    idempotencyKey: string;
    exposureId: typeof UGV_B02_EXPOSURE_ID;
    initialRequestCount: 1;
    confirmationRequestCount: 1;
  }>;
  readonly execution: Readonly<{
    planId: string;
    workflowInstanceId: string;
    waitingExternalObserved: true;
    activeContinuationObserved: true;
    terminalContinuationObserved: true;
    a2aTerminalState: 'TASK_STATE_COMPLETED';
    taskPhase: 'completed';
  }>;
  readonly lineage: ReturnType<typeof compareUgvB02DurableLineage> &
    Readonly<{
      taskId: string;
      capabilityAttemptId: string;
      navigateInvocationId: string;
      remoteBindingId: string;
      remoteTaskId: string;
      providerIdempotencyKey: string;
      providerLedgerTaskId: string;
      providerExternalExecutionId: string;
      providerDeviceCallIds: readonly string[];
      providerMutationRowIds: readonly string[];
      providerExternalMissionId: string;
      providerMissionCorrelationId: string;
      providerIdentityValidated: true;
    }>;
  readonly calls: Readonly<{
    initialStateReads: 1;
    navigateInvocations: 1;
    finalStateReads: 1;
    forbiddenInvocations: 0;
  }>;
  readonly state: Readonly<{
    initial: Readonly<{ observedAt: string; revision: string; mqttIngressSequence: number }>;
    provider: Readonly<{
      observedAt: string;
      revision: string;
      mqttIngressSequence: number;
      cursorSha256: string;
      field: string;
      topic: string;
    }>;
    final: Readonly<{ observedAt: string; revision: string; mqttIngressSequence: number }>;
    sourcePosition: Readonly<{ longitude: number; latitude: number }>;
    target: Readonly<{ x: number; y: number; frame: 'WGS84' }>;
    providerPosition: Readonly<{ longitude: number; latitude: number }>;
    finalPosition: Readonly<{ longitude: number; latitude: number }>;
    targetErrorM: number;
    displacementM: number;
  }>;
  readonly providerLedger: ReturnType<typeof compareUgvB02ProviderLedger>;
  readonly sdarInvocations: ReturnType<typeof compareUgvB02SdarInvocations>;
  readonly modelRuntime: ReturnType<typeof compareUgvB02ModelRuntime>;
  readonly safety: Readonly<{
    outerPlanConfirmations: 1;
    secondConfirmations: 0;
    automaticWriteRetries: 0;
    navigationDispatches: 1;
    forbiddenOperations: 0;
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    downstreamDeviceIdsIncluded: true;
    modelRouteIdentitiesIncluded: true;
    modelEndpointsIncluded: false;
    modelCredentialsIncluded: false;
  }>;
}

const RuntimeTaskSchema = z
  .object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    phase: z.string().min(1),
    planId: z.string().min(1),
    selectedSkillId: z.string().min(1),
    selectedSkillVersion: z.number().int().positive(),
    output: z.unknown().optional(),
  })
  .loose();
const CollectionSchema = z.object({ items: z.array(z.unknown()) }).loose();
const QualificationProblemSchema = z
  .object({
    status: z.number().int().min(400).max(599),
    code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  })
  .loose();
const MAX_QUALIFICATION_PROBLEM_BYTES = 8 * 1024;

export async function prepareUgvB02Move(
  input: UgvB02MoveConfiguration & Readonly<{ preLedger: unknown }>,
  dependencies: UgvB02MoveDependencies = {},
): Promise<UgvB02PreparedMove> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const randomId = dependencies.randomId ?? randomUUID;
  const pause = dependencies.pause ?? delay;
  const preLedger = assertUgvB02CleanPreLedger(input.preLedger);

  // Agent Card resolution and Exposure authority checks deliberately precede the three-second
  // qualification window. Neither performs a Tool call or changes Runtime state.
  const client = await createClient(configuration.a2aBaseUrl, dependencies.createA2AClient);
  await assertMoveExposure(configuration, request);
  const qualification = validateUgvB02Qualification(
    await qualificationRequest(
      `${configuration.runtimeManagementBaseUrl}/internal/v1/ugv-agent-profile/qualification-state`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${configuration.runtimeControlBearerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ simulationId: configuration.simulationId }),
        signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      },
      request,
    ),
    Date.parse(now()),
  );
  if (qualification.simulationId !== configuration.simulationId)
    fail('UGV_B02_QUALIFICATION_ID_MISMATCH');
  const admission = buildUgvB02FormalAdmission({
    messageId: `uap-p3-b02-initial-${randomId()}`,
    idempotencyKey: configuration.admissionIdempotencyKey,
    qualification,
    target: configuration.target,
  });
  const submittedAt = now();
  validateUgvB02Qualification(qualification, Date.parse(submittedAt));
  let submitted: Task;
  try {
    const result = await client.sendMessage(
      SendMessageRequest.fromJSON(admission),
      authenticatedRequestOptions(configuration, configuration.writeRequestTimeoutMs),
    );
    if (!('id' in result)) fail('UGV_B02_A2A_TASK_REQUIRED');
    submitted = result;
  } catch (error: unknown) {
    throw new UgvB02MoveError(
      'UGV_B02_INITIAL_ADMISSION_AMBIGUOUS_BLOCKED',
      'The unique initial A2A request did not return a determinate receipt and must not be retried.',
      { cause: error, ambiguous: true },
    );
  }
  const plannedTask = await pollA2aInputBoundary(client, submitted, configuration, pause);
  const runtimeTask = await pollRuntimePhase(
    configuration,
    plannedTask.id,
    'awaiting_plan_confirmation',
    request,
    pause,
  );
  if (
    plannedTask.contextId !== runtimeTask.contextId ||
    runtimeTask.selectedSkillId !== 'embodied.move_to' ||
    runtimeTask.selectedSkillVersion !== 1
  )
    fail('UGV_B02_PREPARED_TASK_AUTHORITY_INVALID');
  const plan = await runtimeGet(
    configuration,
    `/api/v1/workflows/plans/${encodeURIComponent(runtimeTask.planId)}`,
    request,
  );
  assertExactUgvMovePlan(plan, configuration.target);
  await assertZeroTaskDispatch(configuration, plannedTask.id, request);
  return createUgvB02PreparedMove({
    schemaVersion: 'sdar.ugv-agent-profile-a2a-move-prepared/v1',
    preparedAt: now(),
    simulationId: configuration.simulationId,
    qualification,
    admission: {
      messageId: admission.message.messageId,
      idempotencyKey: configuration.admissionIdempotencyKey,
      exposureId: UGV_B02_EXPOSURE_ID,
      structuredInput: admission.message.metadata.structured_input,
      submittedAt,
      taskId: plannedTask.id,
      contextId: plannedTask.contextId,
    },
    runtime: {
      planId: runtimeTask.planId,
      planSha256: sha256(plan),
      planDefinitionSha256: sha256(record(plan, 'UGV_B02_PLAN_INVALID')['definition']),
      taskPhase: 'awaiting_plan_confirmation',
      selectedSkillId: 'embodied.move_to',
      selectedSkillVersion: 1,
    },
    preExecution: {
      taskMcpInvocationCount: 0,
      taskRemoteBindingCount: 0,
      providerLedgerSha256: sha256(preLedger),
    },
  });
}

export async function observeUgvB02Move(
  input: UgvB02MoveConfiguration &
    Readonly<{ prepared: unknown; preLedger: unknown; captureLedgerFile?: string }>,
  dependencies: UgvB02MoveDependencies = {},
): Promise<UgvB02MoveReport> {
  const configuration = validateConfiguration(input);
  const prepared = validateUgvB02PreparedMove(input.prepared);
  const preLedger = assertUgvB02CleanPreLedger(input.preLedger);
  if (
    prepared.simulationId !== configuration.simulationId ||
    prepared.admission.idempotencyKey !== configuration.admissionIdempotencyKey ||
    canonical(prepared.admission.structuredInput.target) !== canonical(configuration.target) ||
    prepared.preExecution.providerLedgerSha256 !== sha256(preLedger)
  )
    fail('UGV_B02_FROZEN_PREPARATION_MISMATCH');
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pause = dependencies.pause ?? delay;
  const randomId = dependencies.randomId ?? randomUUID;
  const client = await createClient(configuration.a2aBaseUrl, dependencies.createA2AClient);

  const a2aBefore = await client.getTask(
    { tenant: '', id: prepared.admission.taskId },
    authenticatedReadOptions(configuration, configuration.requestTimeoutMs),
  );
  const runtimeBefore = await runtimeTask(configuration, prepared.admission.taskId, request);
  if (
    a2aBefore.id !== prepared.admission.taskId ||
    a2aBefore.contextId !== prepared.admission.contextId ||
    a2aBefore.status?.state !== TaskState.TASK_STATE_INPUT_REQUIRED ||
    runtimeBefore.contextId !== prepared.admission.contextId ||
    runtimeBefore.planId !== prepared.runtime.planId ||
    runtimeBefore.phase !== 'awaiting_plan_confirmation'
  )
    fail('UGV_B02_FROZEN_TASK_STATE_MISMATCH');
  const plan = await runtimeGet(
    configuration,
    `/api/v1/workflows/plans/${encodeURIComponent(prepared.runtime.planId)}`,
    request,
  );
  if (sha256(plan) !== prepared.runtime.planSha256) fail('UGV_B02_FROZEN_PLAN_DRIFT');
  if (
    sha256(record(plan, 'UGV_B02_PLAN_INVALID')['definition']) !==
    prepared.runtime.planDefinitionSha256
  )
    fail('UGV_B02_FROZEN_PLAN_DEFINITION_DRIFT');
  assertExactUgvMovePlan(plan, prepared.admission.structuredInput.target);
  await assertZeroTaskDispatch(configuration, prepared.admission.taskId, request);

  const confirmation = buildUgvB02PlanConfirmation({
    messageId: `uap-p3-b02-confirm-${randomId()}`,
    taskId: prepared.admission.taskId,
    contextId: prepared.admission.contextId,
  });
  // Start the read-only observer before the unique confirmation write. A non-immediate A2A
  // response may arrive only after terminal completion, so starting afterwards can miss the
  // durable waiting_external/active-continuation boundary entirely.
  const observationPromise = pollMoveTerminal(
    configuration,
    prepared,
    client,
    a2aBefore,
    request,
    pause,
  ).then(
    (value) => Object.freeze({ ok: true as const, value }),
    (error: unknown) => Object.freeze({ ok: false as const, error }),
  );
  let confirmationResponseAccepted = false;
  let confirmationProtocolError: UgvB02MoveError | undefined;
  let ambiguousReconciliationError: unknown;
  try {
    const result = await client.sendMessage(
      SendMessageRequest.fromJSON(confirmation),
      authenticatedRequestOptions(configuration, configuration.writeRequestTimeoutMs),
    );
    confirmationResponseAccepted = true;
    if (!('id' in result) || result.id !== prepared.admission.taskId) {
      confirmationProtocolError = new UgvB02MoveError(
        'UGV_B02_CONFIRMATION_TASK_MISMATCH',
        'The confirmation response did not identify the frozen Task.',
      );
    }
  } catch (error: unknown) {
    try {
      await reconcileAmbiguousConfirmation(
        configuration,
        prepared.admission.taskId,
        client,
        request,
        pause,
        error,
      );
    } catch (reconciliationError: unknown) {
      ambiguousReconciliationError = reconciliationError;
    }
  }
  const observed = await observationPromise;
  if (!observed.ok) {
    const reconciliation = await reconcileUgvB02ProviderSafety({
      preLedger,
      prepared,
      confirmationResponseAccepted,
      maxPolls: configuration.ledgerReconciliationMaxPolls,
      pause,
      pollIntervalMs: configuration.pollIntervalMs,
      captureProviderLedger:
        dependencies.captureProviderLedger ??
        ((attempt) =>
          captureProviderLedger(reconciliationLedgerFile(input.captureLedgerFile, attempt))),
    });
    if (confirmationProtocolError !== undefined)
      throw new UgvB02MoveError(confirmationProtocolError.code, confirmationProtocolError.message, {
        cause: observed.error,
        reconciliation,
      });
    throw new UgvB02MoveError(
      'UGV_B02_EXECUTION_AMBIGUOUS_BLOCKED',
      'The unique confirmation was sent, but the complete A2A/Runtime terminal lineage could not be proven. Read-only Provider reconciliation was recorded and no write was retried.',
      {
        cause: ambiguousReconciliationError ?? observed.error,
        ambiguous: true,
        reconciliation,
      },
    );
  }
  const observation = observed.value;
  const postLedger =
    dependencies.captureProviderLedger === undefined
      ? await captureProviderLedger(input.captureLedgerFile)
      : await dependencies.captureProviderLedger();
  const evidence = collectTerminalEvidence(prepared, observation, preLedger, postLedger);
  if (confirmationProtocolError !== undefined) throw confirmationProtocolError;
  const report: UgvB02MoveReport = Object.freeze({
    schemaVersion: UGV_B02_REPORT_SCHEMA,
    status: 'passed',
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    observationClass: 'external_runtime_and_postgresql',
    generatedAt: now(),
    simulationId: configuration.simulationId,
    qualification: prepared.qualification,
    admission: Object.freeze({
      taskId: prepared.admission.taskId,
      contextId: prepared.admission.contextId,
      messageId: prepared.admission.messageId,
      idempotencyKey: prepared.admission.idempotencyKey,
      exposureId: UGV_B02_EXPOSURE_ID,
      initialRequestCount: 1,
      confirmationRequestCount: 1,
    }),
    execution: evidence.execution,
    lineage: evidence.lineage,
    calls: evidence.calls,
    state: evidence.state,
    providerLedger: evidence.providerLedger,
    sdarInvocations: evidence.sdarInvocations,
    modelRuntime: evidence.modelRuntime,
    safety: Object.freeze({
      outerPlanConfirmations: 1,
      secondConfirmations: 0,
      automaticWriteRetries: 0,
      navigationDispatches: 1,
      forbiddenOperations: 0,
    }),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: true,
      modelRouteIdentitiesIncluded: true,
      modelEndpointsIncluded: false,
      modelCredentialsIncluded: false,
    }),
  });
  assertUgvB02ReportStringSafety(report);
  return report;
}

export function assertUgvB02ReportStringSafety(value: unknown): void {
  const strings: string[] = [];
  collectStringValues(value, strings);
  if (
    strings.some((entry) =>
      /(?:Bearer\s|https?:\/\/|password\s*[=:]|credential\s*[=:]|api[_-]?key\s*[=:])/iu.test(entry),
    )
  )
    fail('UGV_B02_REPORT_REDACTION_INVALID');
}

function collectStringValues(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
    return;
  }
  if (typeof value === 'object' && value !== null)
    for (const item of Object.values(value)) collectStringValues(item, output);
}

export interface UgvB02TerminalObservation {
  readonly a2a: Task;
  readonly runtimeTask: RuntimeTask;
  readonly trace: Readonly<Record<string, unknown>>;
  readonly invocations: readonly Readonly<Record<string, unknown>>[];
  readonly remote: Readonly<Record<string, unknown>>;
  readonly waitingExternalObserved: boolean;
  readonly activeContinuation: Readonly<{
    snapshotId: string;
    continuationId: string;
    stateVersion: number;
  }>;
}

export type UgvB02ProviderSafetyReconciliation = Readonly<{
  classification: 'zero_dispatch' | 'terminal_provider_safe' | 'manual_unknown';
  attemptCount: number;
  writesRetried: 0;
  providerLedgerSha256?: string;
  navigateInvocationId?: string;
  remoteTaskId?: string;
  reason:
    | 'confirmation_not_durably_consumed'
    | 'provider_and_adapter_terminal'
    | 'capture_unreadable'
    | 'active_or_incomplete'
    | 'ledger_invalid';
}>;

async function pollMoveTerminal(
  configuration: ValidatedConfiguration,
  prepared: UgvB02PreparedMove,
  client: UgvB02A2AClient,
  initial: Task,
  request: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
): Promise<UgvB02TerminalObservation> {
  let a2a = initial;
  let waitingExternalObserved = false;
  let activeContinuation:
    Readonly<{ snapshotId: string; continuationId: string; stateVersion: number }> | undefined;
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    const reads = await Promise.allSettled([
      runtimeTask(configuration, prepared.admission.taskId, request),
      optionalRuntimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(prepared.runtime.planId)}/trace`,
        request,
      ),
      runtimeGet(
        configuration,
        `/api/v1/mcp/invocations?taskId=${encodeURIComponent(prepared.admission.taskId)}`,
        request,
      ),
      runtimeGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(prepared.admission.taskId)}/remote-task-lifecycle`,
        request,
      ),
    ]);
    if (reads.some((result) => result.status === 'rejected')) {
      await pause(configuration.pollIntervalMs);
      continue;
    }
    const [task, traceValue, invocationsValue, remoteValue] = reads.map(
      (result) => (result as PromiseFulfilledResult<unknown>).value,
    ) as [RuntimeTask, unknown, unknown, unknown];
    const trace = record(traceValue ?? {}, 'UGV_B02_WORKFLOW_TRACE_INVALID');
    const instance = optionalRecord(trace['instance']);
    const remote = record(remoteValue, 'UGV_B02_REMOTE_LIFECYCLE_INVALID');
    const remoteItems = records(remote['items']);
    const activeItem = remoteItems[0];
    const activeBinding = optionalRecord(activeItem?.['binding']);
    const activeContinuations = records(activeItem?.['continuations']);
    const candidate = activeContinuations[0];
    const hasActiveContinuation =
      remoteItems.length === 1 &&
      activeBinding?.['agentTaskId'] === prepared.admission.taskId &&
      activeBinding['workflowPlanId'] === prepared.runtime.planId &&
      activeBinding['workflowNodeId'] === 'ugv_navigate' &&
      activeBinding['operationName'] === 'vehicle_navigate' &&
      activeContinuations.length === 1 &&
      candidate?.['lifecycle'] === 'active' &&
      candidate['nodeId'] === 'ugv_navigate' &&
      candidate['waitState'] === 'waiting' &&
      typeof candidate['snapshotId'] === 'string' &&
      typeof candidate['continuationId'] === 'string' &&
      typeof candidate['stateVersion'] === 'number' &&
      Number.isInteger(candidate['stateVersion']) &&
      candidate['stateVersion'] > 0;
    if (
      task.phase === 'executing' &&
      instance?.['status'] === 'waiting_external' &&
      hasActiveContinuation
    ) {
      waitingExternalObserved = true;
      const frozen = Object.freeze({
        snapshotId: candidate['snapshotId'] as string,
        continuationId: candidate['continuationId'] as string,
        stateVersion: candidate['stateVersion'] as number,
      });
      if (activeContinuation !== undefined && canonical(activeContinuation) !== canonical(frozen))
        fail('UGV_B02_ACTIVE_CONTINUATION_IDENTITY_DRIFT');
      activeContinuation = frozen;
    }
    if (task.phase === 'failed' || instance?.['status'] === 'failed')
      fail('UGV_B02_RUNTIME_TERMINAL_FAILED');
    if (!TERMINAL_STATES.has(a2a.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED)) {
      try {
        a2a = await client.getTask(
          { tenant: '', id: prepared.admission.taskId },
          authenticatedReadOptions(configuration, configuration.requestTimeoutMs),
        );
      } catch {
        await pause(configuration.pollIntervalMs);
        continue;
      }
    }
    if (
      task.phase === 'completed' &&
      a2a.status?.state === TaskState.TASK_STATE_COMPLETED &&
      instance?.['status'] === 'succeeded'
    ) {
      if (activeContinuation === undefined) fail('UGV_B02_ACTIVE_CONTINUATION_NOT_OBSERVED');
      const invocations = records(CollectionSchema.parse(invocationsValue).items);
      return Object.freeze({
        a2a,
        runtimeTask: task,
        trace,
        invocations,
        remote,
        waitingExternalObserved,
        activeContinuation,
      });
    }
    await pause(configuration.pollIntervalMs);
  }
  fail('UGV_B02_EXECUTION_AMBIGUOUS_BLOCKED');
}

export async function observeUgvB02TerminalBoundary(
  input: Readonly<{
    configuration: UgvB02MoveConfiguration;
    prepared: unknown;
    client: UgvB02A2AClient;
    initial: Task;
    fetch: typeof fetch;
    pause?: (milliseconds: number) => Promise<void>;
  }>,
): Promise<UgvB02TerminalObservation> {
  return pollMoveTerminal(
    validateConfiguration(input.configuration),
    validateUgvB02PreparedMove(input.prepared),
    input.client,
    input.initial,
    input.fetch,
    input.pause ?? delay,
  );
}

export async function reconcileUgvB02ProviderSafety(
  input: Readonly<{
    preLedger: unknown;
    prepared: unknown;
    confirmationResponseAccepted: boolean;
    maxPolls: number;
    pollIntervalMs: number;
    captureProviderLedger: (attempt: number) => Promise<UgvB02ProviderLedger>;
    pause?: (milliseconds: number) => Promise<void>;
  }>,
): Promise<UgvB02ProviderSafetyReconciliation> {
  const preLedger = assertUgvB02CleanPreLedger(input.preLedger);
  const prepared = validateUgvB02PreparedMove(input.prepared);
  const maxPolls = boundedInteger(input.maxPolls, 1, 10_000);
  const pollIntervalMs = boundedInteger(input.pollIntervalMs, 10, 5_000);
  const pause = input.pause ?? delay;
  let zeroDispatchWindow = !input.confirmationResponseAccepted;
  let successfulCaptureCount = 0;
  let lastLedgerSha256: string | undefined;
  let lastReason: UgvB02ProviderSafetyReconciliation['reason'] = 'capture_unreadable';

  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    let after: UgvB02ProviderLedger;
    try {
      after = UgvB02ProviderLedgerSchema.parse(await input.captureProviderLedger(attempt));
    } catch {
      zeroDispatchWindow = false;
      lastReason = 'capture_unreadable';
      if (attempt < maxPolls) await pause(pollIntervalMs);
      continue;
    }
    successfulCaptureCount += 1;
    lastLedgerSha256 = sha256(after);
    try {
      const assessment = assessUgvB02ProviderSafety(preLedger, after, prepared);
      if (assessment.classification === 'terminal_provider_safe') {
        return Object.freeze({
          classification: assessment.classification,
          attemptCount: attempt,
          writesRetried: 0 as const,
          providerLedgerSha256: lastLedgerSha256,
          navigateInvocationId: assessment.navigateInvocationId,
          remoteTaskId: assessment.remoteTaskId,
          reason: 'provider_and_adapter_terminal' as const,
        });
      }
      if (assessment.classification !== 'zero_dispatch') {
        zeroDispatchWindow = false;
        lastReason = assessment.reason;
      }
    } catch {
      zeroDispatchWindow = false;
      lastReason = 'ledger_invalid';
    }
    if (attempt < maxPolls) await pause(pollIntervalMs);
  }

  if (zeroDispatchWindow && successfulCaptureCount === maxPolls) {
    return Object.freeze({
      classification: 'zero_dispatch' as const,
      attemptCount: maxPolls,
      writesRetried: 0 as const,
      ...(lastLedgerSha256 === undefined ? {} : { providerLedgerSha256: lastLedgerSha256 }),
      reason: 'confirmation_not_durably_consumed' as const,
    });
  }
  return Object.freeze({
    classification: 'manual_unknown' as const,
    attemptCount: maxPolls,
    writesRetried: 0 as const,
    ...(lastLedgerSha256 === undefined ? {} : { providerLedgerSha256: lastLedgerSha256 }),
    reason: lastReason,
  });
}

type ProviderSafetyAssessment =
  | Readonly<{ classification: 'zero_dispatch' }>
  | Readonly<{
      classification: 'terminal_provider_safe';
      navigateInvocationId: string;
      remoteTaskId: string;
    }>
  | Readonly<{
      classification: 'incomplete';
      reason: 'active_or_incomplete' | 'ledger_invalid';
    }>;

function assessUgvB02ProviderSafety(
  before: UgvB02ProviderLedger,
  after: UgvB02ProviderLedger,
  prepared: UgvB02PreparedMove,
): ProviderSafetyAssessment {
  if (Date.parse(before.capturedAt) >= Date.parse(after.capturedAt))
    return Object.freeze({ classification: 'incomplete', reason: 'ledger_invalid' });
  const idempotency = addedRows(
    before.runtime.idempotencyRecords,
    after.runtime.idempotencyRecords,
    'rowId',
  );
  const providerTasks = addedRows(
    before.runtime.providerTasks,
    after.runtime.providerTasks,
    'taskId',
  );
  const admissionIntents = addedRows(
    before.runtime.admissionIntents,
    after.runtime.admissionIntents,
    'taskId',
  );
  const executions = addedRows(before.adapter.executions, after.adapter.executions, 'taskId');
  const deviceCalls = addedRows(
    before.adapter.deviceToolCalls,
    after.adapter.deviceToolCalls,
    'callId',
  );
  const mutations = addedRows(
    before.adapter.mutationJournal,
    after.adapter.mutationJournal,
    'rowId',
  );
  const commandAcks = addedRows(before.adapter.commandAcks, after.adapter.commandAcks, 'rowId');
  const mcpInvocations = addedRows(
    before.sdar.mcpInvocations,
    after.sdar.mcpInvocations,
    'invocationId',
  );
  const tasks = addedRows(before.sdar.tasks, after.sdar.tasks, 'taskId');
  const initialAdmissions = addedRows(
    before.sdar.initialTaskAdmissions,
    after.sdar.initialTaskAdmissions,
    'idempotencyKey',
  );
  const confirmations = addedRows(
    before.sdar.governedConfirmations,
    after.sdar.governedConfirmations,
    'confirmationId',
  );
  const remoteIntents = addedRows(
    before.sdar.remoteAdmissionIntents,
    after.sdar.remoteAdmissionIntents,
    'intentId',
  );
  const snapshots = addedRows(
    before.sdar.continuationSnapshots,
    after.sdar.continuationSnapshots,
    'snapshotId',
  );
  const continuationAttempts = addedRows(
    before.sdar.continuationAttempts,
    after.sdar.continuationAttempts,
    'attemptId',
  );
  const terminalOutcomes = addedRows(
    before.sdar.terminalOutcomes,
    after.sdar.terminalOutcomes,
    'outcomeId',
  );
  const navigateInvocations = mcpInvocations.filter(
    (row) => row['toolName'] === 'vehicle_navigate',
  );
  const navigate = navigateInvocations[0];
  const navigateInvocationId = navigate?.['invocationId'];
  const remoteTaskId = idempotency[0]?.['taskId'];
  const missionIds = new Set(
    mutations
      .map((row) => row['externalMissionId'])
      .filter((value): value is string => typeof value === 'string' && value !== ''),
  );
  const expectedMissionId = [...missionIds][0];
  const qualificationInvocation = mcpInvocations.find(
    (row) => row['invocationId'] === prepared.qualification.invocationId,
  );
  const taskStateReads = mcpInvocations.filter(
    (row) =>
      row['taskId'] === prepared.admission.taskId &&
      row['toolName'] === 'vehicle_get_state' &&
      row['status'] === 'succeeded' &&
      row['serverId'] === prepared.qualification.serverId &&
      row['simulationId'] === prepared.simulationId,
  );
  if (
    navigateInvocations.length === 1 &&
    idempotency.length === 1 &&
    idempotency[0]?.['state'] === 'COMPLETE' &&
    providerTasks.length === 1 &&
    providerTasks[0]?.['internalState'] === 'TERMINAL_COMPLETED' &&
    providerTasks[0]['mcpStatus'] === 'completed' &&
    admissionIntents.length === 1 &&
    admissionIntents[0]?.['state'] === 'PUBLISHED' &&
    executions.length === 1 &&
    executions[0]?.['state'] === 'SUCCEEDED' &&
    mutations.length === 2 &&
    mutations.every((row) => row['state'] === 'ACCEPTED') &&
    typeof navigateInvocationId === 'string' &&
    navigateInvocationId !== prepared.admission.idempotencyKey &&
    navigate?.['taskId'] === prepared.admission.taskId &&
    navigate['status'] === 'succeeded' &&
    navigate['executionMode'] === 'simulation' &&
    navigate['simulationId'] === prepared.simulationId &&
    navigate['serverId'] === prepared.qualification.serverId &&
    navigate['controlProviderBindingId'] === prepared.qualification.providerBindingId &&
    typeof navigate['controlArgumentsHash'] === 'string' &&
    qualificationInvocation?.['taskId'] === null &&
    qualificationInvocation['toolName'] === 'vehicle_get_state' &&
    qualificationInvocation['status'] === 'succeeded' &&
    qualificationInvocation['serverId'] === prepared.qualification.serverId &&
    qualificationInvocation['simulationId'] === prepared.simulationId &&
    taskStateReads.length >= 1 &&
    taskStateReads.length <= 2 &&
    mcpInvocations.length === taskStateReads.length + 2 &&
    typeof remoteTaskId === 'string' &&
    expectedMissionId !== undefined
  ) {
    compareUgvB02ProviderLedger(before, after, {
      simulationId: prepared.simulationId,
      navigateInvocationId,
      remoteTaskId,
      resourceId: UGV_B02_RESOURCE_ID,
      expectedProviderId: UGV_B02_PROVIDER_ID,
      target: prepared.admission.structuredInput.target,
      expectedArgumentHash: navigate['controlArgumentsHash'],
      expectedMissionId,
    });
    return Object.freeze({
      classification: 'terminal_provider_safe',
      navigateInvocationId,
      remoteTaskId,
    });
  }

  const task = tasks.find((row) => row['taskId'] === prepared.admission.taskId);
  const initialAdmission = initialAdmissions.find(
    (row) => row['idempotencyKey'] === prepared.admission.idempotencyKey,
  );
  const qualificationReads = mcpInvocations.filter(
    (row) =>
      row['invocationId'] === prepared.qualification.invocationId &&
      row['taskId'] === null &&
      row['toolName'] === 'vehicle_get_state' &&
      row['status'] === 'succeeded' &&
      row['serverId'] === prepared.qualification.serverId &&
      row['simulationId'] === prepared.simulationId,
  );
  const initialReads = mcpInvocations.filter(
    (row) =>
      row['taskId'] === prepared.admission.taskId &&
      row['toolName'] === 'vehicle_get_state' &&
      row['status'] === 'succeeded' &&
      row['serverId'] === prepared.qualification.serverId &&
      row['simulationId'] === prepared.simulationId,
  );
  const zeroDispatch =
    idempotency.length === 0 &&
    providerTasks.length === 0 &&
    admissionIntents.length === 0 &&
    executions.length === 0 &&
    mutations.length === 0 &&
    commandAcks.length === 0 &&
    deviceCalls.length === 1 &&
    deviceCalls.every(
      (row) =>
        row['toolName'] === 'get_status' &&
        row['outcome'] === 'accepted' &&
        typeof row['taskId'] === 'string' &&
        row['taskId'] !== '',
    ) &&
    mcpInvocations.length === 1 &&
    qualificationReads.length === 1 &&
    initialReads.length === 0 &&
    navigateInvocations.length === 0 &&
    confirmations.length === 0 &&
    remoteIntents.length === 0 &&
    snapshots.length === 0 &&
    continuationAttempts.length === 0 &&
    terminalOutcomes.length === 0 &&
    tasks.length === 1 &&
    task?.['phase'] === 'awaiting_plan_confirmation' &&
    initialAdmissions.length === 1 &&
    initialAdmission?.['taskId'] === prepared.admission.taskId &&
    initialAdmission['contextId'] === prepared.admission.contextId;
  return zeroDispatch
    ? Object.freeze({ classification: 'zero_dispatch' })
    : Object.freeze({ classification: 'incomplete', reason: 'active_or_incomplete' });
}

function collectTerminalEvidence(
  prepared: UgvB02PreparedMove,
  observation: UgvB02TerminalObservation,
  preLedger: UgvB02ProviderLedger,
  postLedger: UgvB02ProviderLedger,
) {
  if (!observation.waitingExternalObserved) fail('UGV_B02_WAITING_EXTERNAL_NOT_OBSERVED');
  const instance = record(observation.trace['instance'], 'UGV_B02_WORKFLOW_TRACE_INVALID');
  const workflowInstanceId = text(instance['instanceId'], 'UGV_B02_WORKFLOW_INSTANCE_ID_MISSING');
  if (instance['planId'] !== prepared.runtime.planId || instance['status'] !== 'succeeded')
    fail('UGV_B02_WORKFLOW_TRACE_INVALID');
  const invocations = observation.invocations;
  if (
    invocations.length !== 3 ||
    invocations[0]?.['toolName'] !== 'vehicle_get_state' ||
    invocations[1]?.['toolName'] !== 'vehicle_navigate' ||
    invocations[2]?.['toolName'] !== 'vehicle_get_state' ||
    invocations.some(
      (invocation) =>
        invocation['taskId'] !== prepared.admission.taskId ||
        invocation['status'] !== 'succeeded' ||
        invocation['executionMode'] !== 'simulation' ||
        invocation['simulationId'] !== prepared.simulationId,
    )
  )
    fail('UGV_B02_MCP_INVOCATION_CHAIN_INVALID');
  const initial = stateFromInvocation(invocations[0]);
  const navigate = invocations[1];
  const final = stateFromInvocation(invocations[2]);
  const navigateInvocationId = text(
    navigate['invocationId'],
    'UGV_B02_NAVIGATE_INVOCATION_ID_MISSING',
  );
  const capabilityAttemptId = text(
    navigate['capabilityAttemptId'],
    'UGV_B02_CAPABILITY_ATTEMPT_ID_MISSING',
  );
  if (
    invocations.some((invocation) => invocation['capabilityAttemptId'] !== capabilityAttemptId) ||
    typeof navigate['controlConfirmationId'] !== 'string' ||
    navigate['controlProviderBindingId'] !== prepared.qualification.providerBindingId ||
    navigate['serverId'] !== prepared.qualification.serverId ||
    typeof navigate['controlArgumentsHash'] !== 'string' ||
    typeof navigate['controlDispatchHash'] !== 'string'
  )
    fail('UGV_B02_GOVERNED_CONFIRMATION_LINEAGE_INVALID');
  const remoteItems = records(observation.remote['items']);
  const remoteItem = remoteItems[0];
  const binding = record(remoteItem?.['binding'], 'UGV_B02_REMOTE_BINDING_INVALID');
  const finalOutcome = record(remoteItem?.['finalOutcome'], 'UGV_B02_REMOTE_OUTCOME_INVALID');
  const continuations = records(remoteItem?.['continuations']);
  if (
    remoteItems.length !== 1 ||
    binding['agentTaskId'] !== prepared.admission.taskId ||
    binding['workflowPlanId'] !== prepared.runtime.planId ||
    binding['workflowInstanceId'] !== workflowInstanceId ||
    binding['workflowNodeId'] !== 'ugv_navigate' ||
    binding['mcpInvocationId'] !== navigateInvocationId ||
    binding['operationName'] !== 'vehicle_navigate' ||
    binding['protocolStatus'] !== 'completed' ||
    binding['localState'] !== 'reentered' ||
    finalOutcome['providerStatus'] !== 'completed' ||
    finalOutcome['authoritative'] !== true ||
    continuations.length !== 1 ||
    continuations[0]?.['lifecycle'] !== 'terminal' ||
    continuations[0]['snapshotId'] !== observation.activeContinuation.snapshotId ||
    continuations[0]['continuationId'] !== observation.activeContinuation.continuationId ||
    continuations[0]['stateVersion'] !== observation.activeContinuation.stateVersion
  )
    fail('UGV_B02_REMOTE_CONTINUATION_LINEAGE_INVALID');
  const remoteTaskId = text(binding['remoteTaskId'], 'UGV_B02_REMOTE_TASK_ID_MISSING');
  const provider = providerStateFromRemote(finalOutcome);
  assertUgvB02CursorLineage({
    initial: {
      observedAt: initial.observedAt,
      revision: initial.revision,
      mqttIngressSequence: initial.mqttIngressSequence,
    },
    provider,
    final: {
      observedAt: final.observedAt,
      revision: final.revision,
      mqttIngressSequence: final.mqttIngressSequence,
    },
  });
  assertUgvB02QualificationToInitial({
    qualification: prepared.qualification,
    initial,
    maximumStationaryDriftM: 0.25,
  });
  const position = assertUgvB02FinalPosition({
    source: prepared.qualification.sourcePosition,
    target: prepared.admission.structuredInput.target,
    final: final.position,
    toleranceM: 2,
    minimumDisplacementM: 0.5,
  });
  assertUgvB02FinalPosition({
    source: prepared.qualification.sourcePosition,
    target: prepared.admission.structuredInput.target,
    final: provider.position,
    toleranceM: 2,
    minimumDisplacementM: 0.5,
  });
  const expectedTerminalResult = Object.freeze({
    resourceId: UGV_B02_RESOURCE_ID,
    status: 'completed' as const,
    finalPosition: Object.freeze({
      x: final.position.longitude,
      y: final.position.latitude,
      frame: 'EPSG:4326' as const,
    }),
  });
  assertUgvB02TerminalProjection({
    a2aTask: observation.a2a,
    runtimeTask: observation.runtimeTask,
    workflowResult: instance['result'],
    expectedResult: expectedTerminalResult,
    taskId: prepared.admission.taskId,
    contextId: prepared.admission.contextId,
  });
  const providerLedger = compareUgvB02ProviderLedger(preLedger, postLedger, {
    simulationId: prepared.simulationId,
    navigateInvocationId,
    remoteTaskId,
    resourceId: UGV_B02_RESOURCE_ID,
    expectedProviderId: UGV_B02_PROVIDER_ID,
    target: prepared.admission.structuredInput.target,
    expectedArgumentHash: navigate['controlArgumentsHash'],
    expectedMissionId: provider.missionId,
  });
  const modelRuntime = compareUgvB02ModelRuntime(preLedger, postLedger, prepared.admission.taskId);
  const sdarInvocations = compareUgvB02SdarInvocations(preLedger, postLedger, {
    simulationId: prepared.simulationId,
    taskId: prepared.admission.taskId,
    qualificationInvocationId: prepared.qualification.invocationId,
    serverId: prepared.qualification.serverId,
    providerBindingId: prepared.qualification.providerBindingId,
    admissionIdempotencyKey: prepared.admission.idempotencyKey,
  });
  if (
    sdarInvocations.navigateInvocationId !== navigateInvocationId ||
    sdarInvocations.capabilityAttemptId !== capabilityAttemptId ||
    providerLedger.argumentHash !== navigate['controlArgumentsHash']
  )
    fail('UGV_B02_SDAR_RUNTIME_LINEAGE_MISMATCH');
  const durableLineage = compareUgvB02DurableLineage(preLedger, postLedger, {
    admissionIdempotencyKey: prepared.admission.idempotencyKey,
    taskId: prepared.admission.taskId,
    contextId: prepared.admission.contextId,
    planId: prepared.runtime.planId,
    planDefinitionSha256: prepared.runtime.planDefinitionSha256,
    workflowInstanceId,
    capabilityAttemptId,
    navigateInvocationId,
    confirmationId: navigate['controlConfirmationId'],
    providerBindingId: prepared.qualification.providerBindingId,
    serverId: prepared.qualification.serverId,
    argumentsHash: navigate['controlArgumentsHash'],
    dispatchHash: navigate['controlDispatchHash'],
    remoteBindingId: text(binding['bindingId'], 'UGV_B02_REMOTE_BINDING_ID_MISSING'),
    activeContinuation: observation.activeContinuation,
  });
  return Object.freeze({
    execution: Object.freeze({
      planId: prepared.runtime.planId,
      workflowInstanceId,
      waitingExternalObserved: true as const,
      activeContinuationObserved: true as const,
      terminalContinuationObserved: true as const,
      a2aTerminalState: 'TASK_STATE_COMPLETED' as const,
      taskPhase: 'completed' as const,
    }),
    lineage: Object.freeze({
      ...durableLineage,
      taskId: prepared.admission.taskId,
      capabilityAttemptId,
      navigateInvocationId,
      remoteBindingId: text(binding['bindingId'], 'UGV_B02_REMOTE_BINDING_ID_MISSING'),
      remoteTaskId,
      providerIdempotencyKey: navigateInvocationId,
      providerLedgerTaskId: remoteTaskId,
      providerExternalExecutionId: providerLedger.externalExecutionId,
      providerDeviceCallIds: providerLedger.deviceCallIds,
      providerMutationRowIds: providerLedger.mutationRowIds,
      providerExternalMissionId: providerLedger.externalMissionId,
      providerMissionCorrelationId: providerLedger.correlationId,
      providerIdentityValidated: true,
    }),
    calls: Object.freeze({
      initialStateReads: 1 as const,
      navigateInvocations: 1 as const,
      finalStateReads: 1 as const,
      forbiddenInvocations: 0 as const,
    }),
    state: Object.freeze({
      initial: Object.freeze({
        observedAt: initial.observedAt,
        revision: initial.revision,
        mqttIngressSequence: initial.mqttIngressSequence,
      }),
      provider: Object.freeze({
        observedAt: provider.observedAt,
        revision: provider.revision,
        mqttIngressSequence: provider.mqttIngressSequence,
        cursorSha256: provider.cursorSha256,
        field: provider.field,
        topic: provider.topic,
      }),
      final: Object.freeze({
        observedAt: final.observedAt,
        revision: final.revision,
        mqttIngressSequence: final.mqttIngressSequence,
      }),
      sourcePosition: prepared.qualification.sourcePosition,
      target: prepared.admission.structuredInput.target,
      providerPosition: provider.position,
      finalPosition: final.position,
      ...position,
    }),
    providerLedger,
    sdarInvocations,
    modelRuntime,
  });
}

function stateFromInvocation(invocation: Readonly<Record<string, unknown>> | undefined) {
  const result = record(invocation?.['result'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const state = record(result['structuredContent'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const chassis = record(state['chassis'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const position = record(chassis['position'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const observedAt = timestamp(state['observedAt'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const revision = text(state['revision'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const mqttIngressSequence = integer(
    state['mqttIngressSequence'],
    'UGV_B02_STATE_INVOCATION_RESULT_INVALID',
  );
  const longitude = finite(position['longitude'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  const latitude = finite(position['latitude'], 'UGV_B02_STATE_INVOCATION_RESULT_INVALID');
  return Object.freeze({
    observedAt,
    revision,
    mqttIngressSequence,
    position: Object.freeze({ longitude, latitude }),
  });
}

export function assertUgvB02TerminalProjection(
  input: Readonly<{
    a2aTask: Task;
    runtimeTask: unknown;
    workflowResult: unknown;
    expectedResult: Readonly<Record<string, unknown>>;
    taskId: string;
    contextId: string;
  }>,
): void {
  const serializedTask = record(
    Task.toJSON(input.a2aTask),
    'UGV_B02_A2A_TERMINAL_ARTIFACT_INVALID',
  );
  const artifacts = records(serializedTask['artifacts']);
  const artifact = record(artifacts[0], 'UGV_B02_A2A_TERMINAL_ARTIFACT_INVALID');
  const parts = records(artifact['parts']);
  const textPart = parts[0];
  const dataPart = parts[1];
  const runtimeTask = record(input.runtimeTask, 'UGV_B02_TERMINAL_RESULT_INVALID');
  const taskOutput = record(runtimeTask['output'], 'UGV_B02_TERMINAL_RESULT_INVALID');
  if (
    input.a2aTask.id !== input.taskId ||
    input.a2aTask.contextId !== input.contextId ||
    input.a2aTask.status?.state !== TaskState.TASK_STATE_COMPLETED ||
    artifacts.length !== 1 ||
    artifact['artifactId'] !== `${input.taskId}:result` ||
    artifact['name'] !== 'result' ||
    artifact['description'] !== 'Natural-language and structured task result.' ||
    parts.length !== 2 ||
    textPart?.['mediaType'] !== 'text/plain' ||
    textPart['text'] !== UGV_B02_TERMINAL_SUMMARY ||
    dataPart?.['mediaType'] !== 'application/json' ||
    canonical(dataPart['data']) !== canonical(input.expectedResult) ||
    runtimeTask['taskId'] !== input.taskId ||
    runtimeTask['contextId'] !== input.contextId ||
    taskOutput['text'] !== UGV_B02_TERMINAL_SUMMARY ||
    canonical(taskOutput['structured']) !== canonical(input.expectedResult) ||
    canonical(record(input.workflowResult, 'UGV_B02_WORKFLOW_RESULT_INVALID')) !==
      canonical(input.expectedResult)
  )
    fail('UGV_B02_TERMINAL_RESULT_INVALID');
}

function providerStateFromRemote(finalOutcome: Readonly<Record<string, unknown>>) {
  const result = record(finalOutcome['result'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  const structured = record(result['structuredContent'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  const authority = record(structured['positionAuthority'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  timestamp(structured['observedAt'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  const observedAt = timestamp(authority['observedAt'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  const revision = text(structured['snapshotRevision'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  const cursor = providerCursorSequence(authority, observedAt);
  const missionId = text(structured['missionId'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  if (missionId.length > 256) fail('UGV_B02_PROVIDER_RESULT_INVALID');
  if (
    structured['status'] !== 'completed' ||
    structured['resourceId'] !== UGV_B02_RESOURCE_ID ||
    structured['observationAuthority'] !== 'post_dispatch' ||
    structured['correlationStrength'] !== 'STRICT_CORRELATED' ||
    !/^[a-f0-9]{64}$/u.test(revision) ||
    !['chassis.position.geodetic', 'chassis.position.local'].includes(String(authority['field'])) ||
    (authority['field'] === 'chassis.position.geodetic' && authority['topic'] !== '/ugv/gnss') ||
    (authority['field'] === 'chassis.position.local' && authority['topic'] !== '/ugv/nav_state') ||
    !['source', 'ingest'].includes(String(authority['timeAuthority']))
  )
    fail('UGV_B02_PROVIDER_RESULT_INVALID');
  const endPosition = record(structured['endPosition'], 'UGV_B02_PROVIDER_RESULT_INVALID');
  if (endPosition['type'] !== 'geodetic') fail('UGV_B02_PROVIDER_RESULT_INVALID');
  const position = Object.freeze({
    longitude: finite(endPosition['longitude'], 'UGV_B02_PROVIDER_RESULT_INVALID'),
    latitude: finite(endPosition['latitude'], 'UGV_B02_PROVIDER_RESULT_INVALID'),
  });
  return Object.freeze({
    observedAt,
    revision,
    mqttIngressSequence: cursor.sequence,
    cursorSha256: cursor.cursorSha256,
    field: cursor.field,
    topic: cursor.topic,
    position,
    missionId,
  });
}

function providerCursorSequence(authority: Readonly<Record<string, unknown>>, observedAt: string) {
  const value = text(authority['cursor'], 'UGV_B02_PROVIDER_CURSOR_INVALID');
  if (!value.startsWith('oc1.') || value.length > 4_096) fail('UGV_B02_PROVIDER_CURSOR_INVALID');
  const encoded = value.slice(4);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) fail('UGV_B02_PROVIDER_CURSOR_INVALID');
  let decoded: Readonly<Record<string, unknown>>;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) fail('UGV_B02_PROVIDER_CURSOR_INVALID');
    decoded = record(JSON.parse(bytes.toString('utf8')), 'UGV_B02_PROVIDER_CURSOR_INVALID');
  } catch (error: unknown) {
    if (error instanceof UgvB02MoveError) throw error;
    fail('UGV_B02_PROVIDER_CURSOR_INVALID');
  }
  if (
    decoded['version'] !== 1 ||
    decoded['kind'] !== 'field' ||
    decoded['observedAt'] !== observedAt ||
    decoded['field'] !== authority['field'] ||
    decoded['topic'] !== authority['topic'] ||
    decoded['timeAuthority'] !== authority['timeAuthority']
  )
    fail('UGV_B02_PROVIDER_CURSOR_INVALID');
  const sequence = integer(decoded['ingestSequence'], 'UGV_B02_PROVIDER_CURSOR_INVALID');
  const field = text(decoded['field'], 'UGV_B02_PROVIDER_CURSOR_INVALID');
  const topic = text(decoded['topic'], 'UGV_B02_PROVIDER_CURSOR_INVALID');
  if (field.length > 512 || topic.length > 2_048) fail('UGV_B02_PROVIDER_CURSOR_INVALID');
  return Object.freeze({ sequence, cursorSha256: sha256(value), field, topic });
}

async function assertMoveExposure(
  configuration: ValidatedConfiguration,
  request: typeof fetch,
): Promise<void> {
  const exposure = record(
    await jsonRequest(
      `${configuration.nodeControlBaseUrl}/api/v1/a2a-exposures/${encodeURIComponent(UGV_B02_EXPOSURE_ID)}/versions/2`,
      {
        headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
        signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      },
      request,
      200,
      'UGV_B02_EXPOSURE_AUTHORITY_UNAVAILABLE',
    ),
    'UGV_B02_EXPOSURE_AUTHORITY_INVALID',
  );
  if (
    exposure['exposureId'] !== UGV_B02_EXPOSURE_ID ||
    exposure['version'] !== 2 ||
    exposure['capabilityId'] !== 'embodied.move' ||
    exposure['capabilityVersion'] !== 2 ||
    exposure['agentSkillId'] !== 'embodied.move_to' ||
    exposure['status'] !== 'published'
  )
    fail('UGV_B02_EXPOSURE_AUTHORITY_INVALID');
}

function assertExactUgvMovePlan(
  value: unknown,
  target: UgvB02PreparedMove['admission']['structuredInput']['target'],
) {
  const plan = record(value, 'UGV_B02_PLAN_INVALID');
  const definition = record(plan['definition'], 'UGV_B02_PLAN_INVALID');
  const nodes = records(definition['nodes']);
  if (
    nodes.length !== EXPECTED_PLAN_NODES.length ||
    nodes.some((node) =>
      ['human_confirmation', 'llm', 'skill_call', 'subworkflow', 'loop', 'parallel'].includes(
        String(node['type']),
      ),
    )
  )
    fail('UGV_B02_PLAN_INVALID');
  for (let index = 0; index < EXPECTED_PLAN_NODES.length; index += 1) {
    const expected = EXPECTED_PLAN_NODES[index];
    const actual = nodes[index];
    if (expected === undefined || actual === undefined) fail('UGV_B02_PLAN_INVALID');
    if (actual['nodeId'] !== expected.nodeId || actual['type'] !== expected.type)
      fail('UGV_B02_PLAN_INVALID');
    if ('toolName' in expected) {
      const tool = record(actual['tool'], 'UGV_B02_PLAN_INVALID');
      if (tool['toolName'] !== expected.toolName) fail('UGV_B02_PLAN_INVALID');
    }
  }
  const navigate = nodes[4];
  const argumentsValue = record(navigate?.['arguments'], 'UGV_B02_PLAN_INVALID');
  const expectedArguments = {
    resourceId: UGV_B02_RESOURCE_ID,
    mission: { type: 'point', target: { longitude: target.x, latitude: target.y } },
    stopOnObstacle: true,
  };
  if (canonical(argumentsValue) !== canonical(expectedArguments)) fail('UGV_B02_PLAN_INVALID');
}

async function assertZeroTaskDispatch(
  configuration: ValidatedConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<void> {
  const [invocations, remote] = await Promise.all([
    runtimeGet(
      configuration,
      `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/remote-task-lifecycle`,
      request,
    ),
  ]);
  if (
    CollectionSchema.parse(invocations).items.length !== 0 ||
    records(record(remote, 'UGV_B02_REMOTE_LIFECYCLE_INVALID')['items']).length !== 0
  )
    fail('UGV_B02_DISPATCH_BEFORE_CONFIRMATION');
}

async function pollA2aInputBoundary(
  client: UgvB02A2AClient,
  initial: Task,
  configuration: ValidatedConfiguration,
  pause: (milliseconds: number) => Promise<void>,
): Promise<Task> {
  let task = initial;
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    if (task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED) return task;
    if (task.status?.state !== undefined && TERMINAL_STATES.has(task.status.state))
      fail('UGV_B02_TASK_TERMINAL_BEFORE_PLAN_CONFIRMATION');
    await pause(configuration.pollIntervalMs);
    task = await client.getTask(
      { tenant: '', id: task.id },
      authenticatedReadOptions(configuration, configuration.requestTimeoutMs),
    );
  }
  fail('UGV_B02_PLAN_BOUNDARY_TIMEOUT');
}

async function pollRuntimePhase(
  configuration: ValidatedConfiguration,
  taskId: string,
  phase: string,
  request: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
): Promise<RuntimeTask> {
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    const task = await runtimeTask(configuration, taskId, request);
    if (task.phase === phase) return task;
    if (['failed', 'canceled', 'completed'].includes(task.phase))
      fail('UGV_B02_RUNTIME_TASK_UNEXPECTED_TERMINAL');
    await pause(configuration.pollIntervalMs);
  }
  fail('UGV_B02_RUNTIME_PHASE_TIMEOUT');
}

async function reconcileAmbiguousConfirmation(
  configuration: ValidatedConfiguration,
  taskId: string,
  client: UgvB02A2AClient,
  request: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
  cause: unknown,
): Promise<Task> {
  let lastReconciliation: unknown;
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    const values = await Promise.allSettled([
      client.getTask(
        { tenant: '', id: taskId },
        authenticatedReadOptions(configuration, configuration.requestTimeoutMs),
      ),
      runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(taskId)}`, request),
      runtimeGet(
        configuration,
        `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
        request,
      ),
      runtimeGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(taskId)}/remote-task-lifecycle`,
        request,
      ),
    ]);
    const a2a = values[0].status === 'fulfilled' ? values[0].value : undefined;
    const runtime = values[1].status === 'fulfilled' ? optionalRecord(values[1].value) : undefined;
    const invocations =
      values[2].status === 'fulfilled'
        ? CollectionSchema.safeParse(values[2].value).data?.items
        : undefined;
    const remote = values[3].status === 'fulfilled' ? optionalRecord(values[3].value) : undefined;
    const remoteItems = remote === undefined ? undefined : records(remote['items']);
    const progressed =
      runtime !== undefined &&
      (runtime['phase'] !== 'awaiting_plan_confirmation' ||
        (invocations?.length ?? 0) > 0 ||
        (remoteItems?.length ?? 0) > 0);
    lastReconciliation = Object.freeze({
      a2aTaskRead: a2a !== undefined,
      runtimeTaskRead: runtime !== undefined,
      invocationLedgerRead: invocations !== undefined,
      remoteLifecycleRead: remoteItems !== undefined,
      taskPhase: typeof runtime?.['phase'] === 'string' ? runtime['phase'] : 'unknown',
      taskInvocationCount: invocations?.length ?? -1,
      remoteBindingCount: remoteItems?.length ?? -1,
      writesRetried: 0,
    });
    if (progressed && a2a !== undefined) return a2a;
    await pause(configuration.pollIntervalMs);
  }
  throw new UgvB02MoveError(
    'UGV_B02_CONFIRMATION_AMBIGUOUS_BLOCKED',
    'The exactly-once plan confirmation remained ambiguous after read-only safety reconciliation.',
    { cause, ambiguous: true, reconciliation: lastReconciliation },
  );
}

async function captureProviderLedger(outputFile?: string): Promise<UgvB02ProviderLedger> {
  if (outputFile === undefined) fail('UGV_B02_POST_LEDGER_FILE_REQUIRED');
  try {
    execFileSync(process.execPath, [PROVIDER_LEDGER_SCRIPT, 'capture', outputFile], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    fail('UGV_B02_POST_LEDGER_CAPTURE_FAILED');
  }
  return z
    .unknown()
    .transform((value) => value as UgvB02ProviderLedger)
    .parse(await readPrivateJson(outputFile));
}

function reconciliationLedgerFile(outputFile: string | undefined, attempt: number): string {
  if (outputFile === undefined) fail('UGV_B02_POST_LEDGER_FILE_REQUIRED');
  return `${resolve(outputFile)}.reconcile-${String(attempt).padStart(4, '0')}.json`;
}

async function runtimeTask(
  configuration: ValidatedConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<RuntimeTask> {
  return RuntimeTaskSchema.parse(
    await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(taskId)}`, request),
  );
}

async function runtimeGet(
  configuration: ValidatedConfiguration,
  path: string,
  request: typeof fetch,
) {
  return jsonRequest(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    { signal: AbortSignal.timeout(configuration.requestTimeoutMs) },
    request,
    200,
    'UGV_B02_RUNTIME_READ_FAILED',
  );
}

async function optionalRuntimeGet(
  configuration: ValidatedConfiguration,
  path: string,
  request: typeof fetch,
) {
  const response = await request(`${configuration.runtimeManagementBaseUrl}${path}`, {
    signal: AbortSignal.timeout(configuration.requestTimeoutMs),
    redirect: 'manual',
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  return responseJson(response, 200, 'UGV_B02_RUNTIME_READ_FAILED');
}

async function jsonRequest(
  url: string,
  init: RequestInit,
  request: typeof fetch,
  status: number,
  code: string,
) {
  return responseJson(await request(url, { ...init, redirect: 'manual' }), status, code);
}

async function qualificationRequest(url: string, init: RequestInit, request: typeof fetch) {
  let response: Response;
  try {
    response = await request(url, { ...init, redirect: 'manual' });
  } catch (error: unknown) {
    throw new UgvB02MoveError(
      'UGV_B02_QUALIFICATION_FAILED',
      'The read-only qualification authority request failed.',
      { cause: error },
    );
  }
  if (response.status === 200) return responseJson(response, 200, 'UGV_B02_QUALIFICATION_FAILED');
  const details = await safeQualificationProblem(response);
  throw new UgvB02MoveError(
    'UGV_B02_QUALIFICATION_FAILED',
    'The read-only qualification authority rejected the request.',
    details === undefined ? undefined : { details },
  );
}

async function safeQualificationProblem(
  response: Response,
): Promise<UgvB02SafeErrorDetails | undefined> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    response.redirected ||
    !response.headers.get('content-type')?.toLowerCase().startsWith('application/problem+json') ||
    (Number.isFinite(declaredLength) && declaredLength > MAX_QUALIFICATION_PROBLEM_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_QUALIFICATION_PROBLEM_BYTES) return undefined;
  try {
    const parsed = QualificationProblemSchema.parse(JSON.parse(body) as unknown);
    if (parsed.status !== response.status) return undefined;
    return Object.freeze({ status: parsed.status, code: parsed.code });
  } catch {
    return undefined;
  }
}

async function responseJson(response: Response, status: number, code: string) {
  const textValue = await response.text();
  if (response.status !== status || textValue.length > 8 * 1024 * 1024) fail(code);
  try {
    return JSON.parse(textValue) as unknown;
  } catch {
    fail(code);
  }
}

function authenticatedRequestOptions(configuration: ValidatedConfiguration, timeoutMs: number) {
  return {
    signal: AbortSignal.timeout(timeoutMs),
    serviceParameters: { Authorization: `Bearer ${configuration.governedControlBearerToken}` },
  };
}

function authenticatedReadOptions(configuration: ValidatedConfiguration, timeoutMs: number) {
  return authenticatedRequestOptions(configuration, timeoutMs);
}

async function createClient(
  baseUrl: string,
  factory: UgvB02MoveDependencies['createA2AClient'],
): Promise<UgvB02A2AClient> {
  return factory === undefined ? new ClientFactory().createFromUrl(baseUrl) : factory(baseUrl);
}

function validateConfiguration(input: UgvB02MoveConfiguration): ValidatedConfiguration {
  for (const value of [
    input.runtimeControlBearerToken,
    input.governedControlBearerToken,
    input.nodeControlBearerToken,
  ])
    if (value.trim() === '') fail('UGV_B02_TOKEN_REQUIRED');
  if (
    !UGV_B02_SIMULATION_ID_PATTERN.test(input.simulationId) ||
    input.admissionIdempotencyKey !== deriveUgvB02AdmissionIdempotencyKey(input.simulationId) ||
    !Number.isFinite(input.target.x) ||
    input.target.x < -180 ||
    input.target.x > 180 ||
    !Number.isFinite(input.target.y) ||
    input.target.y < -90 ||
    input.target.y > 90
  )
    fail('UGV_B02_RUN_IDENTITY_INVALID');
  return Object.freeze({
    ...input,
    simulationId: input.simulationId,
    target: Object.freeze({ ...input.target }),
    admissionIdempotencyKey: stable(
      input.admissionIdempotencyKey,
      'UGV_B02_IDEMPOTENCY_KEY_INVALID',
    ),
    a2aBaseUrl: exactBaseUrl(
      input.a2aBaseUrl,
      EXPECTED_A2A_BASE_URL,
      'UGV_B02_A2A_BASE_URL_INVALID',
    ),
    runtimeManagementBaseUrl: exactBaseUrl(
      input.runtimeManagementBaseUrl,
      EXPECTED_RUNTIME_MANAGEMENT_BASE_URL,
      'UGV_B02_RUNTIME_BASE_URL_INVALID',
    ),
    nodeControlBaseUrl: exactBaseUrl(
      input.nodeControlBaseUrl,
      EXPECTED_NODE_CONTROL_BASE_URL,
      'UGV_B02_NODE_CONTROL_BASE_URL_INVALID',
    ),
    pollIntervalMs: boundedInteger(input.pollIntervalMs ?? 250, 10, 5_000),
    maxPolls: boundedInteger(input.maxPolls ?? 1_200, 1, 10_000),
    requestTimeoutMs: boundedInteger(input.requestTimeoutMs ?? 10_000, 100, 60_000),
    writeRequestTimeoutMs: boundedInteger(input.writeRequestTimeoutMs ?? 60_000, 1_000, 60_000),
    ledgerReconciliationMaxPolls: boundedInteger(
      input.ledgerReconciliationMaxPolls ?? 1_200,
      1,
      10_000,
    ),
  });
}

function exactBaseUrl(value: string, expected: string, code: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(code);
  }
  if (
    value !== expected ||
    url.origin !== expected ||
    url.pathname !== '/' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  )
    fail(code);
  return expected;
}

function stable(value: string, code: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) fail(code);
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('UGV_B02_CONFIGURATION_INVALID');
  return value;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) fail('UGV_B02_COLLECTION_INVALID');
  return value.map((entry) => record(entry, 'UGV_B02_COLLECTION_INVALID'));
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code);
  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function text(value: unknown, code: string) {
  if (typeof value !== 'string' || value.trim() === '') fail(code);
  return value;
}

function timestamp(value: unknown, code: string) {
  const result = text(value, code);
  if (!Number.isFinite(Date.parse(result))) fail(code);
  return result;
}

function integer(value: unknown, code: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function finite(value: unknown, code: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(code);
  return value;
}

function fail(code: string): never {
  throw new UgvB02MoveError(code, code);
}

export class UgvB02MoveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions &
      Readonly<{
        ambiguous?: boolean;
        reconciliation?: unknown;
        details?: UgvB02SafeErrorDetails;
      }>,
  ) {
    super(message, options);
    this.name = 'UgvB02MoveError';
    this.ambiguous = options?.ambiguous ?? false;
    this.reconciliation = options?.reconciliation;
    if (options?.details !== undefined) this.details = options.details;
  }

  readonly ambiguous: boolean;
  readonly reconciliation?: unknown;
  readonly details?: UgvB02SafeErrorDetails;
}

export interface UgvB02SafeErrorDetails {
  readonly status: number;
  readonly code: string;
}

async function readToken(path: string) {
  const target = resolve(path);
  const before = await lstat(target);
  const uid = process.getuid?.();
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (uid !== undefined && before.uid !== uid) ||
    (before.mode & 0o777) !== 0o600 ||
    before.size < 16 ||
    before.size > 4_096
  )
    fail('UGV_B02_TOKEN_FILE_UNSAFE');
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      (uid !== undefined && after.uid !== uid) ||
      (after.mode & 0o777) !== 0o600 ||
      after.size < 16 ||
      after.size > 4_096
    )
      fail('UGV_B02_TOKEN_FILE_UNSAFE');
    const value = (await handle.readFile({ encoding: 'utf8' })).trim();
    if (value.length < 16 || value.length > 4_096) fail('UGV_B02_TOKEN_FILE_INVALID');
    return value;
  } finally {
    await handle?.close();
  }
}

async function writePrivateJson(path: string, value: unknown) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = `${absolute}.tmp-${String(process.pid)}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
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

async function cli() {
  const mode = process.argv[2];
  if (
    !['authority-gate', 'preflight', 'prepare', 'observe'].includes(mode ?? '') ||
    process.argv.length !== 3
  )
    fail('UGV_B02_DRIVER_USAGE_INVALID');
  const simulationId = requiredEnvironment('UGV_SIMULATION_RUN_ID');
  const admissionIdempotencyKey = requiredEnvironment('UGV_B02_A2A_IDEMPOTENCY_KEY');
  if (
    !UGV_B02_SIMULATION_ID_PATTERN.test(simulationId) ||
    admissionIdempotencyKey !== deriveUgvB02AdmissionIdempotencyKey(simulationId)
  )
    fail('UGV_B02_RUN_IDENTITY_INVALID');
  const nodeControlBaseUrl = requiredEnvironment('SDAR_NODE_CONTROL_BASE_URL');
  const runtimeManagementBaseUrl = requiredEnvironment('SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL');
  const runtimeControlBearerToken = await readToken(
    requiredEnvironment('SDAR_RUNTIME_CONTROL_SERVICE_TOKEN_FILE'),
  );
  const nodeControlBearerToken = await readToken(
    requiredEnvironment('SDAR_CONTROL_API_TOKEN_FILE'),
  );
  if (mode === 'authority-gate') {
    const result = await waitForUgvB02AuthorityRunway({
      nodeControlBaseUrl,
      runtimeManagementBaseUrl,
      nodeControlBearerToken,
      runtimeControlBearerToken,
    });
    process.stdout.write(
      `${JSON.stringify(
        createUgvB02AuthorityGatePrivateReport(simulationId, admissionIdempotencyKey, result),
      )}\n`,
    );
    return;
  }
  const preLedgerFile = requiredEnvironment('UGV_B02_PRE_LEDGER_FILE');
  const preLedger = await readPrivateJson(preLedgerFile);
  if (mode === 'preflight') {
    assertUgvB02CleanPreLedger(preLedger);
    process.stdout.write(
      `${JSON.stringify({ status: 'ready', simulationId, secretsIncluded: false })}\n`,
    );
    return;
  }
  const configuration: UgvB02MoveConfiguration = {
    simulationId,
    admissionIdempotencyKey,
    target: Object.freeze({
      x: Number(requiredEnvironment('UGV_B02_TARGET_LONGITUDE')),
      y: Number(requiredEnvironment('UGV_B02_TARGET_LATITUDE')),
      frame: 'WGS84' as const,
    }),
    a2aBaseUrl: requiredEnvironment('SDAR_UAP_PROFILE_A2A_BASE_URL'),
    runtimeManagementBaseUrl,
    nodeControlBaseUrl,
    runtimeControlBearerToken,
    governedControlBearerToken: await readToken(
      requiredEnvironment('SDAR_GOVERNED_CONTROL_BEARER_TOKEN_FILE'),
    ),
    nodeControlBearerToken,
  };
  const preparedFile = requiredEnvironment('UGV_B02_PREPARED_FILE');
  if (mode === 'prepare') {
    const prepared = await prepareUgvB02Move({ ...configuration, preLedger });
    await writePrivateJson(preparedFile, prepared);
    process.stdout.write(
      `${JSON.stringify({ status: 'prepared', taskId: prepared.admission.taskId, secretsIncluded: false })}\n`,
    );
    return;
  }
  const prepared = await readPrivateJson(preparedFile);
  const report = await observeUgvB02Move({
    ...configuration,
    prepared,
    preLedger,
    captureLedgerFile: requiredEnvironment('UGV_B02_POST_LEDGER_FILE'),
  });
  await writePrivateJson(requiredEnvironment('UGV_B02_PRIVATE_REPORT_FILE'), report);
  process.stdout.write(
    `${JSON.stringify({ status: report.status, taskId: report.admission.taskId, secretsIncluded: false })}\n`,
  );
}

async function readPrivateJson(path: string): Promise<unknown> {
  const target = resolve(path);
  const status = await lstat(target);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && status.uid !== process.getuid()) ||
    status.size < 2 ||
    status.size > 32 * 1024 * 1024
  )
    fail('UGV_B02_PRIVATE_INPUT_UNSAFE');
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.dev !== status.dev || opened.ino !== status.ino)
      fail('UGV_B02_PRIVATE_INPUT_UNSAFE');
    return JSON.parse(await handle.readFile({ encoding: 'utf8' })) as unknown;
  } catch (error: unknown) {
    if (error instanceof UgvB02MoveError) throw error;
    return fail('UGV_B02_PRIVATE_INPUT_INVALID');
  } finally {
    await handle?.close();
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') fail(`UGV_B02_ENV_${name}_REQUIRED`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli().catch((error: unknown) => {
    const code =
      error instanceof UgvB02MoveError || error instanceof UgvB02AuthorityGateError
        ? error.code
        : 'UGV_B02_DRIVER_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
