import { createHash } from 'node:crypto';

import { z } from 'zod';

export const UGV_B02_REPORT_SCHEMA = 'sdar.ugv-agent-profile-a2a-move/v1' as const;
export const UGV_B02_PREPARED_SCHEMA = 'sdar.ugv-agent-profile-a2a-move-prepared/v1' as const;
export const UGV_B02_EXPOSURE_ID = 'a2a.embodied.move' as const;
export const UGV_B02_RESOURCE_ID = 'vehicle:ugv1' as const;
export const UGV_B02_PROVIDER_ID = 'isr.vehicle.ugv.ugv1' as const;
export const UGV_B02_CONFIRMATION_TEXT =
  'Confirm this exact plan and its single UGV dispatch.' as const;
export const UGV_B02_REQUEST_TEXT =
  'Move the simulation UGV to the explicitly authorized WGS84 point.' as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const UGV_B02_SIMULATION_ID_PATTERN = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BARE_SHA256 = /^[a-f0-9]{64}$/u;
const FORBIDDEN_OPERATION = /(?:fire|weapon|recon|track|gimbal|emergency_stop|area_recon)/iu;
const FORBIDDEN_DEVICE_TOOL = /(?:fire|weapon|recon|track|gimbal|emergency_stop)/iu;

const TimestampSchema = z.iso.datetime({ offset: true });
const PositionSchema = z
  .object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
  })
  .strict();
const TargetSchema = z
  .object({
    x: z.number().min(-180).max(180),
    y: z.number().min(-90).max(90),
    frame: z.literal('WGS84'),
  })
  .strict();

export const UgvB02QualificationReceiptSchema = z
  .object({
    simulationId: z.string().regex(UGV_B02_SIMULATION_ID_PATTERN),
    invocationId: z.string().regex(IDENTIFIER),
    resultHash: z.string().regex(SHA256),
    completedAt: TimestampSchema,
    observedAt: TimestampSchema,
    revision: z.string().regex(BARE_SHA256),
    mqttIngressSequence: z.number().int().positive(),
    serverId: z.string().regex(IDENTIFIER),
    providerBindingId: z.string().regex(IDENTIFIER),
    providerId: z.literal(UGV_B02_PROVIDER_ID),
    operationName: z.literal('vehicle_get_state'),
    resourceId: z.literal(UGV_B02_RESOURCE_ID),
    sourcePosition: PositionSchema,
  })
  .strict();

export type UgvB02QualificationReceipt = z.infer<typeof UgvB02QualificationReceiptSchema>;

const StructuredInputSchema = z
  .object({ resourceId: z.literal(UGV_B02_RESOURCE_ID), target: TargetSchema })
  .strict();

const PreparedMoveUnsignedSchema = z
  .object({
    schemaVersion: z.literal(UGV_B02_PREPARED_SCHEMA),
    preparedAt: TimestampSchema,
    simulationId: z.string().regex(UGV_B02_SIMULATION_ID_PATTERN),
    qualification: UgvB02QualificationReceiptSchema,
    admission: z
      .object({
        messageId: z.string().regex(IDENTIFIER),
        idempotencyKey: z.string().regex(IDENTIFIER),
        exposureId: z.literal(UGV_B02_EXPOSURE_ID),
        structuredInput: StructuredInputSchema,
        submittedAt: TimestampSchema,
        taskId: z.string().regex(IDENTIFIER),
        contextId: z.string().regex(IDENTIFIER),
      })
      .strict(),
    runtime: z
      .object({
        planId: z.string().regex(IDENTIFIER),
        planSha256: z.string().regex(SHA256),
        planDefinitionSha256: z.string().regex(SHA256),
        taskPhase: z.literal('awaiting_plan_confirmation'),
        selectedSkillId: z.literal('embodied.move_to'),
        selectedSkillVersion: z.literal(1),
      })
      .strict(),
    preExecution: z
      .object({
        taskMcpInvocationCount: z.literal(0),
        taskRemoteBindingCount: z.literal(0),
        providerLedgerSha256: z.string().regex(SHA256),
      })
      .strict(),
  })
  .strict();

export const UgvB02PreparedMoveSchema = PreparedMoveUnsignedSchema.extend({
  sealSha256: z.string().regex(SHA256),
}).strict();

export type UgvB02PreparedMove = z.infer<typeof UgvB02PreparedMoveSchema>;

export function createUgvB02PreparedMove(
  input: z.input<typeof PreparedMoveUnsignedSchema>,
): UgvB02PreparedMove {
  const unsigned = PreparedMoveUnsignedSchema.parse(input);
  validateUgvB02Qualification(unsigned.qualification);
  if (
    unsigned.simulationId !== unsigned.qualification.simulationId ||
    Date.parse(unsigned.admission.submittedAt) < Date.parse(unsigned.qualification.completedAt) ||
    Date.parse(unsigned.admission.submittedAt) - Date.parse(unsigned.qualification.completedAt) >
      3_000
  )
    fail('UGV_B02_PREPARED_MOVE_INVALID');
  return Object.freeze({ ...unsigned, sealSha256: sha256(unsigned) });
}

export function validateUgvB02PreparedMove(value: unknown): UgvB02PreparedMove {
  const prepared = UgvB02PreparedMoveSchema.parse(value);
  const { sealSha256, ...unsigned } = prepared;
  if (sealSha256 !== sha256(unsigned)) fail('UGV_B02_PREPARED_MOVE_SEAL_INVALID');
  return createUgvB02PreparedMove(unsigned);
}

export interface UgvB02FormalAdmission {
  readonly message: Readonly<{
    messageId: string;
    role: 'ROLE_USER';
    parts: readonly [
      Readonly<{ text: typeof UGV_B02_REQUEST_TEXT; mediaType: 'text/plain' }>,
      Readonly<{ data: UgvB02StructuredInput; mediaType: 'application/json' }>,
    ];
    metadata: Readonly<{
      user_id: 'uap-p3-b02-requester';
      structured_input: UgvB02StructuredInput;
      idempotency_key: string;
      'io.sdar/requestedCapability': Readonly<{
        exposureId: typeof UGV_B02_EXPOSURE_ID;
        versionConstraint: '2';
        requestId: string;
      }>;
    }>;
  }>;
  readonly configuration: Readonly<{ returnImmediately: false }>;
}

export interface UgvB02StructuredInput {
  readonly resourceId: typeof UGV_B02_RESOURCE_ID;
  readonly target: Readonly<{ x: number; y: number; frame: 'WGS84' }>;
}

export function buildUgvB02FormalAdmission(
  input: Readonly<{
    messageId: string;
    idempotencyKey: string;
    qualification: UgvB02QualificationReceipt;
    target: UgvB02StructuredInput['target'];
  }>,
): UgvB02FormalAdmission {
  identifier(input.messageId, 'UGV_B02_MESSAGE_ID_INVALID');
  identifier(input.idempotencyKey, 'UGV_B02_IDEMPOTENCY_KEY_INVALID');
  validateUgvB02Qualification(input.qualification);
  const target = TargetSchema.parse(input.target);
  const structuredInput: UgvB02StructuredInput = Object.freeze({
    resourceId: UGV_B02_RESOURCE_ID,
    target: Object.freeze({ ...target }),
  });
  const requestedCapability = Object.freeze({
    exposureId: UGV_B02_EXPOSURE_ID,
    versionConstraint: '2' as const,
    requestId: input.idempotencyKey,
  });
  const metadata = Object.freeze({
    user_id: 'uap-p3-b02-requester' as const,
    structured_input: structuredInput,
    idempotency_key: input.idempotencyKey,
    'io.sdar/requestedCapability': requestedCapability,
  });
  const admission: UgvB02FormalAdmission = Object.freeze({
    message: Object.freeze({
      messageId: input.messageId,
      role: 'ROLE_USER' as const,
      parts: Object.freeze([
        Object.freeze({ text: UGV_B02_REQUEST_TEXT, mediaType: 'text/plain' as const }),
        Object.freeze({ data: structuredInput, mediaType: 'application/json' as const }),
      ] as const),
      metadata,
    }),
    configuration: Object.freeze({ returnImmediately: false as const }),
  });
  assertUgvB02FormalAdmission(admission);
  return admission;
}

export function assertUgvB02FormalAdmission(
  value: unknown,
): asserts value is UgvB02FormalAdmission {
  const root = record(value, 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const message = record(root['message'], 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const configuration = record(root['configuration'], 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const parts = array(message['parts'], 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const metadata = record(message['metadata'], 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const requested = record(
    metadata['io.sdar/requestedCapability'],
    'UGV_B02_FORMAL_ADMISSION_INVALID',
  );
  const dataParts = parts.filter(
    (part) => record(part, 'UGV_B02_FORMAL_ADMISSION_INVALID')['data'] !== undefined,
  );
  const textPart = record(parts[0], 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const dataPart = record(parts[1], 'UGV_B02_FORMAL_ADMISSION_INVALID');
  const data = dataPart['data'];
  if (
    !exactKeys(root, ['configuration', 'message']) ||
    !exactKeys(configuration, ['returnImmediately']) ||
    !exactKeys(message, ['messageId', 'role', 'parts', 'metadata']) ||
    !exactKeys(textPart, ['text', 'mediaType']) ||
    !exactKeys(dataPart, ['data', 'mediaType']) ||
    !exactKeys(metadata, [
      'user_id',
      'structured_input',
      'idempotency_key',
      'io.sdar/requestedCapability',
    ]) ||
    !exactKeys(requested, ['exposureId', 'versionConstraint', 'requestId']) ||
    typeof message['messageId'] !== 'string' ||
    !IDENTIFIER.test(message['messageId']) ||
    configuration['returnImmediately'] !== false ||
    message['role'] !== 'ROLE_USER' ||
    parts.length !== 2 ||
    dataParts.length !== 1 ||
    textPart['text'] !== UGV_B02_REQUEST_TEXT ||
    textPart['mediaType'] !== 'text/plain' ||
    dataPart['mediaType'] !== 'application/json' ||
    metadata['user_id'] !== 'uap-p3-b02-requester' ||
    metadata['idempotency_key'] !== requested['requestId'] ||
    typeof metadata['idempotency_key'] !== 'string' ||
    !IDENTIFIER.test(metadata['idempotency_key']) ||
    requested['exposureId'] !== UGV_B02_EXPOSURE_ID ||
    requested['versionConstraint'] !== '2' ||
    !StructuredInputSchema.safeParse(data).success ||
    !StructuredInputSchema.safeParse(metadata['structured_input']).success ||
    canonical(data) !== canonical(metadata['structured_input'])
  )
    fail('UGV_B02_FORMAL_ADMISSION_INVALID');
}

export interface UgvB02PlanConfirmation {
  readonly message: Readonly<{
    messageId: string;
    taskId: string;
    contextId: string;
    role: 'ROLE_USER';
    parts: readonly [Readonly<{ text: typeof UGV_B02_CONFIRMATION_TEXT; mediaType: 'text/plain' }>];
    metadata: Readonly<{ sdar_action: 'confirm_plan' }>;
  }>;
  readonly configuration: Readonly<{ returnImmediately: false }>;
}

export function buildUgvB02PlanConfirmation(
  input: Readonly<{
    messageId: string;
    taskId: string;
    contextId: string;
  }>,
): UgvB02PlanConfirmation {
  identifier(input.messageId, 'UGV_B02_CONFIRMATION_ID_INVALID');
  identifier(input.taskId, 'UGV_B02_TASK_ID_INVALID');
  identifier(input.contextId, 'UGV_B02_CONTEXT_ID_INVALID');
  const confirmation: UgvB02PlanConfirmation = Object.freeze({
    message: Object.freeze({
      messageId: input.messageId,
      taskId: input.taskId,
      contextId: input.contextId,
      role: 'ROLE_USER' as const,
      parts: Object.freeze([
        Object.freeze({ text: UGV_B02_CONFIRMATION_TEXT, mediaType: 'text/plain' as const }),
      ] as const),
      metadata: Object.freeze({ sdar_action: 'confirm_plan' as const }),
    }),
    configuration: Object.freeze({ returnImmediately: false as const }),
  });
  assertUgvB02PlanConfirmation(confirmation, input);
  return confirmation;
}

export function assertUgvB02PlanConfirmation(
  value: unknown,
  expected: Readonly<{ taskId: string; contextId: string }>,
): asserts value is UgvB02PlanConfirmation {
  const root = record(value, 'UGV_B02_CONFIRMATION_INVALID');
  const message = record(root['message'], 'UGV_B02_CONFIRMATION_INVALID');
  const configuration = record(root['configuration'], 'UGV_B02_CONFIRMATION_INVALID');
  const parts = array(message['parts'], 'UGV_B02_CONFIRMATION_INVALID');
  const part = record(parts[0], 'UGV_B02_CONFIRMATION_INVALID');
  const metadata = record(message['metadata'], 'UGV_B02_CONFIRMATION_INVALID');
  if (
    !exactKeys(root, ['message', 'configuration']) ||
    !exactKeys(configuration, ['returnImmediately']) ||
    !exactKeys(message, ['messageId', 'taskId', 'contextId', 'role', 'parts', 'metadata']) ||
    !exactKeys(part, ['text', 'mediaType']) ||
    !exactKeys(metadata, ['sdar_action']) ||
    typeof message['messageId'] !== 'string' ||
    !IDENTIFIER.test(message['messageId']) ||
    message['taskId'] !== expected.taskId ||
    message['contextId'] !== expected.contextId ||
    message['role'] !== 'ROLE_USER' ||
    parts.length !== 1 ||
    part['text'] !== UGV_B02_CONFIRMATION_TEXT ||
    part['mediaType'] !== 'text/plain' ||
    metadata['sdar_action'] !== 'confirm_plan' ||
    configuration['returnImmediately'] !== false
  )
    fail('UGV_B02_CONFIRMATION_INVALID');
}

const LedgerRowBase = z.record(z.string(), z.unknown());
export const UgvB02ProviderLedgerSchema = z
  .object({
    schemaVersion: z.literal('sdar.ugv-agent-profile-provider-ledger/v1'),
    capturedAt: TimestampSchema,
    runtime: z
      .object({
        idempotencyRecords: z.array(LedgerRowBase).max(10_000),
        providerTasks: z.array(LedgerRowBase).max(10_000),
        admissionIntents: z.array(LedgerRowBase).max(10_000),
      })
      .strict(),
    adapter: z
      .object({
        executions: z.array(LedgerRowBase).max(10_000),
        deviceToolCalls: z.array(LedgerRowBase).max(50_000),
        mutationJournal: z.array(LedgerRowBase).max(50_000),
        commandAcks: z.array(LedgerRowBase).max(50_000),
      })
      .strict(),
    sdar: z
      .object({
        modelInvocations: z.array(LedgerRowBase).max(50_000),
        mcpInvocations: z.array(LedgerRowBase).max(50_000),
        stageModelRoutes: z.array(LedgerRowBase).max(1_000),
        modelProviders: z.array(LedgerRowBase).max(1_000),
        initialTaskAdmissions: z.array(LedgerRowBase).max(10_000),
        capabilityAttempts: z.array(LedgerRowBase).max(10_000),
        governedConfirmations: z.array(LedgerRowBase).max(10_000),
        remoteAdmissionIntents: z.array(LedgerRowBase).max(10_000),
        continuationSnapshots: z.array(LedgerRowBase).max(50_000),
        continuationAttempts: z.array(LedgerRowBase).max(50_000),
        terminalOutcomes: z.array(LedgerRowBase).max(10_000),
        workflowNodeEvents: z.array(LedgerRowBase).max(100_000),
        tasks: z.array(LedgerRowBase).max(10_000),
        goals: z.array(LedgerRowBase).max(10_000),
        goalContracts: z.array(LedgerRowBase).max(10_000),
        userGoalPlans: z.array(LedgerRowBase).max(10_000),
        workflowPlans: z.array(LedgerRowBase).max(10_000),
        workflowInstances: z.array(LedgerRowBase).max(50_000),
        skillExecutions: z.array(LedgerRowBase).max(10_000),
        skillExecutionEvents: z.array(LedgerRowBase).max(100_000),
        processedResults: z.array(LedgerRowBase).max(10_000),
      })
      .strict(),
  })
  .strict();

export type UgvB02ProviderLedger = z.infer<typeof UgvB02ProviderLedgerSchema>;

export interface UgvB02ModelRuntimeEvidence {
  readonly configurationLoaded: true;
  readonly invocationCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly workflowPlanningAttemptCount: number;
  readonly invocations: readonly Readonly<{
    invocationId: string;
    stage: string;
    status: 'succeeded' | 'failed';
    providerId: string;
    model: string;
    operation: 'structured_generation' | 'embedding';
    errorCode?: string;
  }>[];
  readonly routeProviderRefs: readonly string[];
}

export interface UgvB02SdarInvocationEvidence {
  readonly invocationCount: 4;
  readonly qualificationInvocationId: string;
  readonly initialStateInvocationId: string;
  readonly navigateInvocationId: string;
  readonly finalStateInvocationId: string;
  readonly capabilityAttemptId: string;
  readonly admissionKeySeparatedFromProviderKey: true;
}

export interface UgvB02DurableLineageEvidence {
  readonly goalId: string;
  readonly goalVersion: number;
  readonly goalContractHash: string;
  readonly userGoalPlanId: string;
  readonly userGoalPlanRevision: number;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowInstanceId: string;
  readonly skillExecutionId: string;
  readonly skillId: 'embodied.move_to';
  readonly skillVersion: 1;
  readonly confirmationId: string;
  readonly continuationId: string;
  readonly continuationSnapshotId: string;
  readonly continuationAttemptId: string;
  readonly terminalOutcomeId: string;
  readonly terminalEvidenceId: string;
  readonly navigateNodeStartedCount: 1;
}

export function compareUgvB02DurableLineage(
  beforeValue: unknown,
  afterValue: unknown,
  expected: Readonly<{
    admissionIdempotencyKey: string;
    taskId: string;
    contextId: string;
    planId: string;
    planDefinitionSha256: string;
    workflowInstanceId: string;
    capabilityAttemptId: string;
    navigateInvocationId: string;
    confirmationId: string;
    providerBindingId: string;
    serverId: string;
    argumentsHash: string;
    dispatchHash: string;
    remoteBindingId: string;
    activeContinuation: Readonly<{
      snapshotId: string;
      continuationId: string;
      stateVersion: number;
    }>;
  }>,
): UgvB02DurableLineageEvidence {
  const before = UgvB02ProviderLedgerSchema.parse(beforeValue);
  const after = UgvB02ProviderLedgerSchema.parse(afterValue);
  const admissions = addedRows(
    before.sdar.initialTaskAdmissions,
    after.sdar.initialTaskAdmissions,
    'idempotencyKey',
  );
  const attempts = addedRows(
    before.sdar.capabilityAttempts,
    after.sdar.capabilityAttempts,
    'attemptId',
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
  const tasks = addedRows(before.sdar.tasks, after.sdar.tasks, 'taskId');
  const goals = addedRows(before.sdar.goals, after.sdar.goals, 'goalId');
  const goalContracts = addedRows(before.sdar.goalContracts, after.sdar.goalContracts, 'rowId');
  const userGoalPlans = addedRows(before.sdar.userGoalPlans, after.sdar.userGoalPlans, 'planId');
  const workflowPlans = addedRows(before.sdar.workflowPlans, after.sdar.workflowPlans, 'planId');
  const workflowInstances = addedRows(
    before.sdar.workflowInstances,
    after.sdar.workflowInstances,
    'instanceId',
  );
  const skillExecutions = addedRows(
    before.sdar.skillExecutions,
    after.sdar.skillExecutions,
    'executionId',
  );
  const processedResults = addedRows(
    before.sdar.processedResults,
    after.sdar.processedResults,
    'resultId',
  );
  const nodeEvents = addedRows(
    before.sdar.workflowNodeEvents,
    after.sdar.workflowNodeEvents,
    'eventId',
  );
  const skillEvents = addedRows(
    before.sdar.skillExecutionEvents,
    after.sdar.skillExecutionEvents,
    'eventId',
  );
  const admission = admissions[0];
  const attempt = attempts[0];
  const confirmation = confirmations[0];
  const remoteIntent = remoteIntents[0];
  const snapshot = snapshots[0];
  const continuationAttempt = continuationAttempts[0];
  const terminalOutcome = terminalOutcomes[0];
  const task = tasks[0];
  const goal = goals[0];
  const goalContract = goalContracts[0];
  const userGoalPlan = userGoalPlans[0];
  const workflowPlan = workflowPlans[0];
  const workflowInstance = workflowInstances[0];
  const skillExecution = skillExecutions[0];
  const processedResult = processedResults[0];
  if (userGoalPlan === undefined) fail('UGV_B02_DURABLE_LINEAGE_INVALID');
  const goalId = goal?.['goalId'];
  const goalVersion = goal?.['goalVersion'];
  const capabilityBindingId = admission?.['capabilityBindingId'];
  const terminalEvidenceId = terminalOutcome?.['resultId'];
  const navigateStarts = nodeEvents.filter(
    (row) =>
      row['instanceId'] === expected.workflowInstanceId &&
      row['nodeId'] === 'ugv_navigate' &&
      row['eventType'] === 'node_started',
  );
  const finalPositionSuccesses = nodeEvents.filter(
    (row) =>
      row['instanceId'] === expected.workflowInstanceId &&
      row['nodeId'] === 'ugv_evidence_final_position' &&
      row['eventType'] === 'node_succeeded',
  );
  const completedSkillEvents = skillEvents.filter(
    (row) =>
      row['executionId'] === skillExecution?.['executionId'] &&
      row['eventType'] === 'skill.execution_completed' &&
      row['statusAfter'] === 'completed',
  );
  const confirmedAt = Date.parse(String(confirmation?.['confirmed_at']));
  const consumedAt = Date.parse(String(confirmation?.['consumedAt']));
  const expiresAt = Date.parse(String(confirmation?.['expires_at']));
  const navigateInvocation = after.sdar.mcpInvocations.find(
    (row) => row['invocationId'] === expected.navigateInvocationId,
  );
  if (
    Date.parse(before.capturedAt) >= Date.parse(after.capturedAt) ||
    admissions.length !== 1 ||
    admission?.['idempotencyKey'] !== expected.admissionIdempotencyKey ||
    admission['taskId'] !== expected.taskId ||
    admission['contextId'] !== expected.contextId ||
    admission['capabilityAttemptId'] !== expected.capabilityAttemptId ||
    admission['created_context'] !== true ||
    typeof admission['requestHash'] !== 'string' ||
    !SHA256.test(admission['requestHash']) ||
    typeof capabilityBindingId !== 'string' ||
    !IDENTIFIER.test(capabilityBindingId) ||
    attempts.length !== 1 ||
    attempt?.['attemptId'] !== expected.capabilityAttemptId ||
    attempt['taskId'] !== expected.taskId ||
    attempt['capabilityBindingId'] !== capabilityBindingId ||
    attempt['attemptNo'] !== 1 ||
    attempt['planId'] !== expected.planId ||
    attempt['reason'] !== 'initial' ||
    attempt['status'] !== 'succeeded' ||
    canonical(attempt['skill_version_refs']) !== canonical(['skill:embodied.move_to:1']) ||
    canonical(attempt['provider_binding_refs']) !== canonical([expected.providerBindingId]) ||
    typeof attempt['started_at'] !== 'string' ||
    typeof attempt['completedAt'] !== 'string' ||
    confirmations.length !== 1 ||
    confirmation?.['confirmationId'] !== expected.confirmationId ||
    confirmation['taskId'] !== expected.taskId ||
    confirmation['capabilityBindingId'] !== capabilityBindingId ||
    confirmation['capabilityAttemptId'] !== expected.capabilityAttemptId ||
    confirmation['capability_id'] !== 'embodied.move' ||
    confirmation['capability_version'] !== 2 ||
    confirmation['planId'] !== expected.planId ||
    confirmation['planHash'] !== expected.planDefinitionSha256.slice('sha256:'.length) ||
    confirmation['skill_id'] !== 'embodied.move_to' ||
    confirmation['skill_version'] !== 1 ||
    confirmation['actor_id'] !== 'uap-p3-b01-human-operator' ||
    confirmation['actor_kind'] !== 'human' ||
    confirmation['authentication_method'] !== 'configured_bearer' ||
    canonical(confirmation['actor_roles_json']) !== canonical(['physical_control_approver']) ||
    confirmation['revoked_at'] !== null ||
    confirmation['revoked_by'] !== null ||
    confirmation['providerBindingId'] !== expected.providerBindingId ||
    confirmation['serverId'] !== expected.serverId ||
    confirmation['toolName'] !== 'vehicle_navigate' ||
    confirmation['argumentsHash'] !== expected.argumentsHash ||
    confirmation['consumedInvocationId'] !== expected.navigateInvocationId ||
    confirmation['consumedDispatchHash'] !== expected.dispatchHash ||
    navigateInvocation?.['controlConfirmationId'] !== expected.confirmationId ||
    navigateInvocation['controlProviderBindingId'] !== expected.providerBindingId ||
    navigateInvocation['capabilityAttemptId'] !== expected.capabilityAttemptId ||
    navigateInvocation['serverId'] !== expected.serverId ||
    navigateInvocation['toolName'] !== 'vehicle_navigate' ||
    navigateInvocation['status'] !== 'succeeded' ||
    navigateInvocation['controlArgumentsHash'] !== expected.argumentsHash ||
    navigateInvocation['controlDispatchHash'] !== expected.dispatchHash ||
    ![confirmedAt, consumedAt, expiresAt].every(Number.isFinite) ||
    confirmedAt > consumedAt ||
    expiresAt <= consumedAt ||
    typeof navigateInvocation['startedAt'] !== 'string' ||
    consumedAt < Date.parse(navigateInvocation['startedAt']) ||
    typeof navigateInvocation['completedAt'] !== 'string' ||
    consumedAt > Date.parse(navigateInvocation['completedAt']) ||
    remoteIntents.length !== 1 ||
    remoteIntent?.['invocationId'] !== expected.navigateInvocationId ||
    remoteIntent['bindingId'] !== expected.remoteBindingId ||
    remoteIntent['taskId'] !== expected.taskId ||
    remoteIntent['capabilityAttemptId'] !== expected.capabilityAttemptId ||
    remoteIntent['contextId'] !== expected.contextId ||
    remoteIntent['serverId'] !== expected.serverId ||
    remoteIntent['operationName'] !== 'vehicle_navigate' ||
    remoteIntent['argumentsHash'] !== expected.argumentsHash ||
    remoteIntent['status'] !== 'materialized' ||
    remoteIntent['recordedInvocationId'] !== expected.navigateInvocationId ||
    remoteIntent['materializedBindingId'] !== expected.remoteBindingId ||
    remoteIntent['materializedSnapshotId'] !== expected.activeContinuation.snapshotId ||
    remoteIntent['reason_code'] !== null ||
    snapshots.length !== 1 ||
    snapshot?.['snapshotId'] !== expected.activeContinuation.snapshotId ||
    snapshot['continuationId'] !== expected.activeContinuation.continuationId ||
    snapshot['stateVersion'] !== expected.activeContinuation.stateVersion ||
    snapshot['predecessorSnapshotId'] !== null ||
    snapshot['lifecycle'] !== 'terminal' ||
    snapshot['taskId'] !== expected.taskId ||
    snapshot['contextId'] !== expected.contextId ||
    snapshot['planId'] !== expected.planId ||
    snapshot['workflowInstanceId'] !== expected.workflowInstanceId ||
    continuationAttempts.length !== 1 ||
    continuationAttempt?.['snapshotId'] !== expected.activeContinuation.snapshotId ||
    continuationAttempt['continuationId'] !== expected.activeContinuation.continuationId ||
    continuationAttempt['snapshotStateVersion'] !== expected.activeContinuation.stateVersion ||
    continuationAttempt['workflowInstanceId'] !== expected.workflowInstanceId ||
    continuationAttempt['status'] !== 'succeeded' ||
    continuationAttempt['errorCode'] !== null ||
    typeof continuationAttempt['completedAt'] !== 'string' ||
    tasks.length !== 1 ||
    task?.['taskId'] !== expected.taskId ||
    task['contextId'] !== expected.contextId ||
    task['phase'] !== 'completed' ||
    task['planId'] !== expected.planId ||
    task['selectedSkillId'] !== 'embodied.move_to' ||
    task['selectedSkillVersion'] !== 1 ||
    typeof goalId !== 'string' ||
    !IDENTIFIER.test(goalId) ||
    typeof goalVersion !== 'number' ||
    !Number.isInteger(goalVersion) ||
    goalVersion < 1 ||
    goal?.['contextId'] !== expected.contextId ||
    goal['status'] !== 'achieved' ||
    goalContracts.length !== 1 ||
    goalContract?.['goalId'] !== goalId ||
    goalContract['goalVersion'] !== goalVersion ||
    typeof goalContract['contractHash'] !== 'string' ||
    !SHA256.test(goalContract['contractHash']) ||
    userGoalPlans.length !== 1 ||
    userGoalPlan['planId'] !== task['userGoalPlanId'] ||
    userGoalPlan['goalId'] !== goalId ||
    userGoalPlan['goalVersion'] !== goalVersion ||
    userGoalPlan['revision'] !== 1 ||
    userGoalPlan['status'] !== 'completed' ||
    userGoalPlan['contractHash'] !== goalContract['contractHash'] ||
    workflowPlans.length !== 1 ||
    workflowPlan?.['planId'] !== expected.planId ||
    workflowPlan['goalId'] !== goalId ||
    workflowPlan['goalVersion'] !== goalVersion ||
    workflowPlan['confirmation_status'] !== 'confirmed' ||
    workflowPlan['attempt_count'] !== 1 ||
    sha256(workflowPlan['definition_json']) !== expected.planDefinitionSha256 ||
    workflowInstances.length !== 1 ||
    workflowInstance?.['instanceId'] !== expected.workflowInstanceId ||
    workflowInstance['planId'] !== expected.planId ||
    workflowInstance['goalId'] !== goalId ||
    workflowInstance['goalVersion'] !== goalVersion ||
    workflowInstance['status'] !== 'succeeded' ||
    typeof workflowInstance['completedAt'] !== 'string' ||
    skillExecutions.length !== 1 ||
    skillExecution?.['taskId'] !== expected.taskId ||
    skillExecution['goalId'] !== goalId ||
    skillExecution['goalVersion'] !== goalVersion ||
    skillExecution['skillId'] !== 'embodied.move_to' ||
    skillExecution['skillVersion'] !== 1 ||
    skillExecution['workflowPlanId'] !== expected.planId ||
    skillExecution['workflowDefinitionId'] !== workflowInstance['workflowDefinitionId'] ||
    skillExecution['workflowDefinitionVersion'] !== workflowInstance['workflowDefinitionVersion'] ||
    completedSkillEvents.length !== 1 ||
    terminalOutcomes.length !== 1 ||
    terminalOutcome?.['taskId'] !== expected.taskId ||
    terminalOutcome['goalId'] !== goalId ||
    terminalOutcome['goalVersion'] !== goalVersion ||
    terminalOutcome['outcome_kind'] !== 'achieved' ||
    terminalOutcome['controlStatus'] !== 'achieved' ||
    terminalOutcome['authority'] !== 'user_goal_plan_controller' ||
    typeof terminalOutcome['summary'] !== 'string' ||
    !terminalOutcome['summary'].includes('final-position evidence') ||
    terminalOutcome['finalInstanceId'] !== expected.workflowInstanceId ||
    terminalOutcome['capability_attempt_id'] !== expected.capabilityAttemptId ||
    typeof terminalEvidenceId !== 'string' ||
    !IDENTIFIER.test(terminalEvidenceId) ||
    processedResults.length !== 1 ||
    processedResult?.['resultId'] !== terminalEvidenceId ||
    processedResult['taskId'] !== expected.taskId ||
    processedResult['skillId'] !== 'embodied.move_to' ||
    processedResult['skillVersion'] !== 1 ||
    navigateStarts.length !== 1 ||
    finalPositionSuccesses.length !== 1 ||
    after.sdar.mcpInvocations.filter((row) => row['taskId'] === expected.taskId).length !== 3
  )
    fail('UGV_B02_DURABLE_LINEAGE_INVALID');
  return Object.freeze({
    goalId,
    goalVersion,
    goalContractHash: goalContract['contractHash'],
    userGoalPlanId: userGoalPlan['planId'] as string,
    userGoalPlanRevision: 1,
    workflowPlanId: expected.planId,
    workflowDefinitionId: workflowInstance['workflowDefinitionId'] as string,
    workflowDefinitionVersion: workflowInstance['workflowDefinitionVersion'] as number,
    workflowInstanceId: expected.workflowInstanceId,
    skillExecutionId: skillExecution['executionId'] as string,
    skillId: 'embodied.move_to',
    skillVersion: 1,
    confirmationId: expected.confirmationId,
    continuationId: expected.activeContinuation.continuationId,
    continuationSnapshotId: expected.activeContinuation.snapshotId,
    continuationAttemptId: continuationAttempt['attemptId'] as string,
    terminalOutcomeId: terminalOutcome['outcomeId'] as string,
    terminalEvidenceId,
    navigateNodeStartedCount: 1,
  });
}

export function compareUgvB02SdarInvocations(
  beforeValue: unknown,
  afterValue: unknown,
  expected: Readonly<{
    simulationId: string;
    taskId: string;
    qualificationInvocationId: string;
    serverId: string;
    providerBindingId: string;
    admissionIdempotencyKey: string;
  }>,
): UgvB02SdarInvocationEvidence {
  const before = UgvB02ProviderLedgerSchema.parse(beforeValue);
  const after = UgvB02ProviderLedgerSchema.parse(afterValue);
  const added = addedRows(before.sdar.mcpInvocations, after.sdar.mcpInvocations, 'invocationId');
  const qualification = added[0];
  const initial = added[1];
  const navigate = added[2];
  const final = added[3];
  const capabilityAttemptId = navigate?.['capabilityAttemptId'];
  if (
    Date.parse(before.capturedAt) >= Date.parse(after.capturedAt) ||
    added.length !== 4 ||
    added.some(
      (row) =>
        row['executionMode'] !== 'simulation' ||
        row['simulationId'] !== expected.simulationId ||
        row['serverId'] !== expected.serverId ||
        row['status'] !== 'succeeded',
    ) ||
    qualification?.['invocationId'] !== expected.qualificationInvocationId ||
    qualification['taskId'] !== null ||
    qualification['capabilityAttemptId'] !== null ||
    qualification['toolName'] !== 'vehicle_get_state' ||
    initial?.['taskId'] !== expected.taskId ||
    initial['toolName'] !== 'vehicle_get_state' ||
    navigate?.['taskId'] !== expected.taskId ||
    navigate['toolName'] !== 'vehicle_navigate' ||
    navigate['controlProviderBindingId'] !== expected.providerBindingId ||
    final?.['taskId'] !== expected.taskId ||
    final['toolName'] !== 'vehicle_get_state' ||
    typeof capabilityAttemptId !== 'string' ||
    !IDENTIFIER.test(capabilityAttemptId) ||
    initial['capabilityAttemptId'] !== capabilityAttemptId ||
    final['capabilityAttemptId'] !== capabilityAttemptId ||
    navigate['invocationId'] === expected.admissionIdempotencyKey
  )
    fail('UGV_B02_SDAR_INVOCATION_LEDGER_INVALID');
  return Object.freeze({
    invocationCount: 4,
    qualificationInvocationId: expected.qualificationInvocationId,
    initialStateInvocationId: initial['invocationId'] as string,
    navigateInvocationId: navigate['invocationId'] as string,
    finalStateInvocationId: final['invocationId'] as string,
    capabilityAttemptId,
    admissionKeySeparatedFromProviderKey: true,
  });
}

export function compareUgvB02ModelRuntime(
  beforeValue: unknown,
  afterValue: unknown,
  taskId: string,
): UgvB02ModelRuntimeEvidence {
  const before = UgvB02ProviderLedgerSchema.parse(beforeValue);
  const after = UgvB02ProviderLedgerSchema.parse(afterValue);
  identifier(taskId, 'UGV_B02_TASK_ID_INVALID');
  const routeChanges = addedRows(
    before.sdar.stageModelRoutes,
    after.sdar.stageModelRoutes,
    'rowId',
  );
  const providerChanges = addedRows(
    before.sdar.modelProviders,
    after.sdar.modelProviders,
    'providerId',
  );
  const invocations = addedRows(
    before.sdar.modelInvocations,
    after.sdar.modelInvocations,
    'invocationId',
  );
  const routes = uniqueRows(after.sdar.stageModelRoutes, 'rowId');
  const providers = uniqueRows(after.sdar.modelProviders, 'providerId');
  const workflowPlanning = invocations.filter((row) => row['stage'] === 'workflow_planning');
  const finalWorkflowPlanning = workflowPlanning.at(-1);
  if (
    Date.parse(before.capturedAt) >= Date.parse(after.capturedAt) ||
    routeChanges.length !== 0 ||
    providerChanges.length !== 0 ||
    invocations.length < 1 ||
    workflowPlanning.length < 1 ||
    workflowPlanning.length > 3 ||
    finalWorkflowPlanning?.['status'] !== 'succeeded' ||
    !invocations.some((row) => row['status'] === 'succeeded') ||
    invocations.some((row) => {
      const route = routes.get(`${String(row['stage'])}:${String(row['operation'])}`);
      const provider = providers.get(String(row['providerId']));
      return (
        row['taskId'] !== taskId ||
        !['succeeded', 'failed'].includes(String(row['status'])) ||
        typeof row['providerId'] !== 'string' ||
        !IDENTIFIER.test(row['providerId']) ||
        typeof row['model'] !== 'string' ||
        row['model'].trim() === '' ||
        !['structured_generation', 'embedding'].includes(String(row['operation'])) ||
        route?.['providerId'] !== row['providerId'] ||
        provider?.['enabled'] !== true ||
        provider['model'] !== row['model'] ||
        (row['status'] === 'failed' &&
          (typeof row['errorCode'] !== 'string' || row['errorCode'].trim() === ''))
      );
    })
  )
    fail('UGV_B02_MODEL_RUNTIME_EVIDENCE_INVALID');
  const projected = invocations.map((row) =>
    Object.freeze({
      invocationId: row['invocationId'] as string,
      stage: row['stage'] as string,
      status: row['status'] as 'succeeded' | 'failed',
      providerId: row['providerId'] as string,
      model: row['model'] as string,
      operation: row['operation'] as 'structured_generation' | 'embedding',
      ...(row['status'] === 'failed' ? { errorCode: row['errorCode'] as string } : {}),
    }),
  );
  return Object.freeze({
    configurationLoaded: true,
    invocationCount: projected.length,
    succeededCount: projected.filter((row) => row.status === 'succeeded').length,
    failedCount: projected.filter((row) => row.status === 'failed').length,
    workflowPlanningAttemptCount: workflowPlanning.length,
    invocations: Object.freeze(projected),
    routeProviderRefs: Object.freeze(
      [...new Set(projected.map((row) => `${row.stage}:${row.providerId}:${row.model}`))].sort(),
    ),
  });
}

export interface UgvB02ProviderLedgerDelta {
  readonly invocationId: string;
  readonly providerTaskId: string;
  readonly externalExecutionId: string;
  readonly externalExecutionIdSha256: string;
  readonly argumentHash: string;
  readonly deviceCallIds: readonly string[];
  readonly deviceCallIdsSha256: string;
  readonly mutationRowIds: readonly string[];
  readonly mutationRowIdsSha256: string;
  readonly externalMissionId: string;
  readonly externalMissionIdSha256: string;
  readonly correlationId: string;
  readonly providerIdentityValidated: true;
  readonly runtimeTaskCount: 1;
  readonly runtimeIdempotencyCount: 1;
  readonly adapterExecutionCount: 1;
  readonly southboundDeviceCallCount: 5;
  readonly southboundStateReadCount: 3;
  readonly southboundMutationCallCount: 2;
  readonly mutationStepCount: 2;
  readonly forbiddenOperationCount: 0;
  readonly uncertainMutationCount: 0;
  readonly beforeSha256: string;
  readonly afterSha256: string;
}

export function assertUgvB02CleanPreLedger(value: unknown): UgvB02ProviderLedger {
  const ledger = UgvB02ProviderLedgerSchema.parse(value);
  const historicalStateReadsAreClosed = ledger.adapter.deviceToolCalls.every(
    (row) =>
      row['toolName'] === 'get_status' &&
      row['outcome'] === 'accepted' &&
      typeof row['taskId'] === 'string' &&
      IDENTIFIER.test(row['taskId']),
  );
  const forbidden = allLedgerRows(ledger).filter((row) => FORBIDDEN_OPERATION.test(canonical(row)));
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
    forbidden.length !== 0
  )
    fail('UGV_B02_PROVIDER_LEDGER_NOT_CLEAN');
  return ledger;
}

export function compareUgvB02ProviderLedger(
  beforeValue: unknown,
  afterValue: unknown,
  expected: Readonly<{
    simulationId: string;
    navigateInvocationId: string;
    remoteTaskId: string;
    resourceId: typeof UGV_B02_RESOURCE_ID;
    expectedProviderId: string;
    target: Readonly<{ x: number; y: number; frame: 'WGS84' }>;
    expectedArgumentHash: string;
    expectedMissionId: string;
  }>,
): UgvB02ProviderLedgerDelta {
  const before = UgvB02ProviderLedgerSchema.parse(beforeValue);
  const after = UgvB02ProviderLedgerSchema.parse(afterValue);
  identifier(expected.navigateInvocationId, 'UGV_B02_NAVIGATE_INVOCATION_ID_INVALID');
  identifier(expected.remoteTaskId, 'UGV_B02_REMOTE_TASK_ID_INVALID');
  identifier(expected.expectedMissionId, 'UGV_B02_MISSION_ID_INVALID');
  if (expected.expectedProviderId !== UGV_B02_PROVIDER_ID) fail('UGV_B02_PROVIDER_ID_INVALID');
  if (!UGV_B02_SIMULATION_ID_PATTERN.test(expected.simulationId))
    fail('UGV_B02_SIMULATION_ID_INVALID');
  const idempotency = addedRows(
    before.runtime.idempotencyRecords,
    after.runtime.idempotencyRecords,
    'rowId',
  );
  const runtimeTasks = addedRows(
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
  const idempotencyRow = idempotency[0];
  const runtimeTask = runtimeTasks[0];
  const admissionIntent = admissionIntents[0];
  const execution = executions[0];
  const stateReads = deviceCalls.filter((row) => row['toolName'] === 'get_status');
  const primaryCalls = deviceCalls.filter((row) => row['toolName'] === 'ugv_path_follow_mission');
  const followupCalls = deviceCalls.filter((row) => row['toolName'] === 'ugv_mission_control');
  const forbidden = [
    ...runtimeTasks,
    ...executions,
    ...deviceCalls,
    ...mutations,
    ...commandAcks,
  ].filter(
    (row) =>
      FORBIDDEN_OPERATION.test(stringValue(row['operationName'])) ||
      FORBIDDEN_DEVICE_TOOL.test(stringValue(row['toolName'])),
  );
  const mutationStates = mutations.map((row) => stringValue(row['state']));
  const idempotencyArgumentHash = idempotencyRow?.['argumentHash'];
  const runtimeArgumentHash = runtimeTask?.['argumentHash'];
  const adapterArgumentHash = execution?.['argumentHash'];
  const admissionArgumentHash = admissionIntent?.['argumentHash'];
  const primaryMutation = mutations.find((row) => row['phase'] === 'PRIMARY');
  const followupMutation = mutations.find((row) => row['phase'] === 'FOLLOWUP');
  const expectedArguments = Object.freeze({
    resourceId: expected.resourceId,
    mission: Object.freeze({
      type: 'point' as const,
      target: Object.freeze({ longitude: expected.target.x, latitude: expected.target.y }),
    }),
    stopOnObstacle: true as const,
  });
  const expectedArgumentHash = sha256(expectedArguments).slice('sha256:'.length);
  const executionContext = record(
    execution?.['execution_context'],
    'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
  );
  const executionPayload = record(execution?.['payload'], 'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID');
  const primaryPayload = record(
    primaryMutation?.['payload'],
    'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
  );
  const followupPayload = record(
    followupMutation?.['payload'],
    'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
  );
  const downstreamMissionIds = array(
    execution?.['downstream_mission_ids'],
    'UGV_B02_PROVIDER_LEDGER_DELTA_INVALID',
  );
  const externalExecutionId = runtimeTask?.['externalExecutionId'];
  const externalMissionId = primaryMutation?.['externalMissionId'];
  const correlationId = executionContext['correlationId'];
  const authorizationContextHash = idempotencyRow?.['authorization_context_hash'];
  if (
    Date.parse(before.capturedAt) >= Date.parse(after.capturedAt) ||
    idempotency.length !== 1 ||
    idempotencyRow?.['operationName'] !== 'vehicle_navigate' ||
    idempotencyRow['idempotencyKey'] !== expected.navigateInvocationId ||
    idempotencyRow['taskId'] !== expected.remoteTaskId ||
    idempotencyRow['executionMode'] !== 'simulation' ||
    idempotencyRow['authorization_context_hash'] !== authorizationContextHash ||
    idempotencyRow['simulation_key'] !== expected.simulationId ||
    idempotencyRow['state'] !== 'COMPLETE' ||
    idempotencyRow['stable_task_id'] !== expected.remoteTaskId ||
    idempotencyRow['lease_owner'] !== null ||
    idempotencyRow['lease_expires_at'] !== null ||
    idempotencyRow['synchronous_result'] !== null ||
    idempotencyRow['claim_attempt'] !== 1 ||
    expected.expectedArgumentHash !== expectedArgumentHash ||
    idempotencyArgumentHash !== expectedArgumentHash ||
    admissionIntents.length !== 1 ||
    admissionIntent?.['taskId'] !== expected.remoteTaskId ||
    admissionIntent['providerId'] !== expected.expectedProviderId ||
    admissionIntent['authorization_context_hash'] !== authorizationContextHash ||
    admissionIntent['operationName'] !== 'vehicle_navigate' ||
    admissionIntent['executionMode'] !== 'simulation' ||
    admissionIntent['simulationId'] !== expected.simulationId ||
    admissionIntent['state'] !== 'PUBLISHED' ||
    canonical(admissionIntent['arguments']) !== canonical(expectedArguments) ||
    runtimeTasks.length !== 1 ||
    runtimeTask?.['taskId'] !== expected.remoteTaskId ||
    runtimeTask['providerId'] !== expected.expectedProviderId ||
    runtimeTask['authorization_context_hash'] !== authorizationContextHash ||
    runtimeTask['operationName'] !== 'vehicle_navigate' ||
    runtimeTask['executionMode'] !== 'simulation' ||
    runtimeTask['simulationId'] !== expected.simulationId ||
    canonical(runtimeTask['arguments']) !== canonical(expectedArguments) ||
    runtimeTask['internalState'] !== 'TERMINAL_COMPLETED' ||
    runtimeTask['mcpStatus'] !== 'completed' ||
    typeof externalExecutionId !== 'string' ||
    !IDENTIFIER.test(externalExecutionId) ||
    executions.length !== 1 ||
    execution?.['taskId'] !== expected.remoteTaskId ||
    execution['operationName'] !== 'vehicle_navigate' ||
    execution['resourceId'] !== expected.resourceId ||
    execution['externalExecutionId'] !== externalExecutionId ||
    executionContext['executionMode'] !== 'SIMULATION' ||
    executionContext['simulationId'] !== expected.simulationId ||
    executionContext['authorizationContextHash'] !== authorizationContextHash ||
    typeof authorizationContextHash !== 'string' ||
    !BARE_SHA256.test(authorizationContextHash) ||
    typeof correlationId !== 'string' ||
    !IDENTIFIER.test(correlationId) ||
    correlationId === expected.navigateInvocationId ||
    canonical(executionPayload['arguments']) !== canonical(expectedArguments) ||
    executionPayload['providerId'] !== expected.expectedProviderId ||
    canonical(executionPayload['executionContext']) !== canonical(executionContext) ||
    execution['state'] !== 'SUCCEEDED' ||
    typeof idempotencyArgumentHash !== 'string' ||
    !BARE_SHA256.test(idempotencyArgumentHash) ||
    runtimeArgumentHash !== idempotencyArgumentHash ||
    adapterArgumentHash !== idempotencyArgumentHash ||
    admissionArgumentHash !== idempotencyArgumentHash ||
    deviceCalls.length !== 5 ||
    deviceCalls.some(
      (row) => typeof row['callId'] !== 'string' || !IDENTIFIER.test(row['callId']),
    ) ||
    deviceCalls.some((row) => row['outcome'] !== 'accepted') ||
    stateReads.length !== 3 ||
    stateReads.some(
      (row) =>
        typeof row['taskId'] !== 'string' ||
        !IDENTIFIER.test(row['taskId']) ||
        row['taskId'] === expected.remoteTaskId,
    ) ||
    new Set(stateReads.map((row) => row['taskId'])).size !== 3 ||
    primaryCalls.length !== 1 ||
    primaryCalls[0]?.['taskId'] !== expected.remoteTaskId ||
    followupCalls.length !== 1 ||
    followupCalls[0]?.['taskId'] !== expected.remoteTaskId ||
    mutations.length !== 2 ||
    mutations.some((row) => typeof row['rowId'] !== 'string' || !IDENTIFIER.test(row['rowId'])) ||
    mutations.some((row) => row['taskId'] !== expected.remoteTaskId) ||
    mutations.filter((row) => row['phase'] === 'PRIMARY').length !== 1 ||
    mutations.filter((row) => row['phase'] === 'FOLLOWUP').length !== 1 ||
    mutationStates.some((state) => state !== 'ACCEPTED') ||
    primaryMutation?.['stepId'] !== 'start:01:primary' ||
    primaryMutation['toolName'] !== 'ugv_path_follow_mission' ||
    followupMutation?.['stepId'] !== 'start:02:followup' ||
    followupMutation['toolName'] !== 'ugv_mission_control' ||
    typeof primaryMutation['externalMissionId'] !== 'string' ||
    primaryMutation['externalMissionId'] === '' ||
    primaryMutation['externalMissionId'] !== expected.expectedMissionId ||
    primaryMutation['externalMissionId'] !== followupMutation['externalMissionId'] ||
    primaryCalls[0]['argumentHash'] !== primaryMutation['argumentHash'] ||
    followupCalls[0]['argumentHash'] !== followupMutation['argumentHash'] ||
    primaryPayload['taskId'] !== expected.remoteTaskId ||
    primaryPayload['stepId'] !== primaryMutation['stepId'] ||
    primaryPayload['toolName'] !== primaryMutation['toolName'] ||
    primaryPayload['argumentHash'] !== primaryMutation['argumentHash'] ||
    primaryPayload['externalMissionId'] !== externalMissionId ||
    followupPayload['taskId'] !== expected.remoteTaskId ||
    followupPayload['stepId'] !== followupMutation['stepId'] ||
    followupPayload['toolName'] !== followupMutation['toolName'] ||
    followupPayload['argumentHash'] !== followupMutation['argumentHash'] ||
    followupPayload['externalMissionId'] !== externalMissionId ||
    downstreamMissionIds.length !== 1 ||
    downstreamMissionIds[0] !== externalMissionId ||
    canonical(executionPayload['downstreamMissionIds']) !== canonical(downstreamMissionIds) ||
    typeof primaryMutation['result_hash'] !== 'string' ||
    !BARE_SHA256.test(primaryMutation['result_hash']) ||
    typeof followupMutation['result_hash'] !== 'string' ||
    !BARE_SHA256.test(followupMutation['result_hash']) ||
    commandAcks.length !== 0 ||
    forbidden.length !== 0
  )
    fail('UGV_B02_PROVIDER_LEDGER_DELTA_INVALID');
  return Object.freeze({
    invocationId: expected.navigateInvocationId,
    providerTaskId: expected.remoteTaskId,
    externalExecutionId,
    externalExecutionIdSha256: sha256(externalExecutionId),
    argumentHash: expectedArgumentHash,
    deviceCallIds: Object.freeze(deviceCalls.map((row) => row['callId'] as string)),
    deviceCallIdsSha256: sha256(deviceCalls.map((row) => row['callId'])),
    mutationRowIds: Object.freeze(mutations.map((row) => row['rowId'] as string)),
    mutationRowIdsSha256: sha256(mutations.map((row) => row['rowId'])),
    externalMissionId: externalMissionId as string,
    externalMissionIdSha256: sha256(externalMissionId),
    correlationId,
    providerIdentityValidated: true,
    runtimeTaskCount: 1,
    runtimeIdempotencyCount: 1,
    adapterExecutionCount: 1,
    southboundDeviceCallCount: 5,
    southboundStateReadCount: 3,
    southboundMutationCallCount: 2,
    mutationStepCount: 2,
    forbiddenOperationCount: 0,
    uncertainMutationCount: 0,
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
  });
}

export function validateUgvB02Qualification(
  value: unknown,
  nowMs?: number,
): UgvB02QualificationReceipt {
  const receipt = UgvB02QualificationReceiptSchema.parse(value);
  const completedAt = Date.parse(receipt.completedAt);
  const observedAt = Date.parse(receipt.observedAt);
  if (
    observedAt > completedAt + 1_000 ||
    (nowMs !== undefined && (nowMs < completedAt - 1_000 || nowMs - completedAt > 3_000))
  )
    fail('UGV_B02_QUALIFICATION_NOT_FRESH');
  return Object.freeze(receipt);
}

export function assertUgvB02CursorLineage(
  input: Readonly<{
    initial: Pick<UgvB02QualificationReceipt, 'observedAt' | 'revision' | 'mqttIngressSequence'>;
    provider: Readonly<{ observedAt: string; revision: string; mqttIngressSequence: number }>;
    final: Readonly<{ observedAt: string; revision: string; mqttIngressSequence: number }>;
  }>,
): void {
  const initialAt = Date.parse(input.initial.observedAt);
  const providerAt = Date.parse(input.provider.observedAt);
  const finalAt = Date.parse(input.final.observedAt);
  if (
    ![initialAt, providerAt, finalAt].every(Number.isFinite) ||
    initialAt >= providerAt ||
    providerAt > finalAt ||
    input.initial.mqttIngressSequence >= input.provider.mqttIngressSequence ||
    input.provider.mqttIngressSequence > input.final.mqttIngressSequence ||
    !BARE_SHA256.test(input.initial.revision) ||
    !BARE_SHA256.test(input.provider.revision) ||
    !BARE_SHA256.test(input.final.revision) ||
    input.initial.revision === input.provider.revision ||
    (input.provider.mqttIngressSequence === input.final.mqttIngressSequence &&
      input.provider.revision !== input.final.revision) ||
    (input.provider.mqttIngressSequence < input.final.mqttIngressSequence &&
      input.provider.revision === input.final.revision)
  )
    fail('UGV_B02_STATE_CURSOR_LINEAGE_INVALID');
}

export function assertUgvB02QualificationToInitial(
  input: Readonly<{
    qualification: Pick<
      UgvB02QualificationReceipt,
      'observedAt' | 'revision' | 'mqttIngressSequence' | 'sourcePosition'
    >;
    initial: Readonly<{
      observedAt: string;
      revision: string;
      mqttIngressSequence: number;
      position: Readonly<{ longitude: number; latitude: number }>;
    }>;
    maximumStationaryDriftM?: number;
  }>,
): void {
  const qualificationAt = Date.parse(input.qualification.observedAt);
  const initialAt = Date.parse(input.initial.observedAt);
  if (
    ![qualificationAt, initialAt].every(Number.isFinite) ||
    qualificationAt > initialAt ||
    input.qualification.mqttIngressSequence > input.initial.mqttIngressSequence ||
    !BARE_SHA256.test(input.qualification.revision) ||
    !BARE_SHA256.test(input.initial.revision) ||
    (input.qualification.mqttIngressSequence === input.initial.mqttIngressSequence &&
      input.qualification.revision !== input.initial.revision) ||
    (input.qualification.mqttIngressSequence < input.initial.mqttIngressSequence &&
      input.qualification.revision === input.initial.revision) ||
    haversineMeters(input.qualification.sourcePosition, input.initial.position) >
      (input.maximumStationaryDriftM ?? 0.25)
  )
    fail('UGV_B02_QUALIFICATION_INITIAL_LINEAGE_INVALID');
}

export function assertUgvB02FinalPosition(
  input: Readonly<{
    source: Readonly<{ longitude: number; latitude: number }>;
    target: Readonly<{ x: number; y: number }>;
    final: Readonly<{ longitude: number; latitude: number }>;
    toleranceM?: number;
    minimumDisplacementM?: number;
  }>,
): Readonly<{ targetErrorM: number; displacementM: number }> {
  const targetErrorM = haversineMeters(input.final, {
    longitude: input.target.x,
    latitude: input.target.y,
  });
  const displacementM = haversineMeters(input.source, input.final);
  if (targetErrorM > (input.toleranceM ?? 2) || displacementM < (input.minimumDisplacementM ?? 0.5))
    fail('UGV_B02_FINAL_POSITION_INVALID');
  return Object.freeze({ targetErrorM, displacementM });
}

export function addedRows(
  before: readonly Readonly<Record<string, unknown>>[],
  after: readonly Readonly<Record<string, unknown>>[],
  key: string,
): readonly Readonly<Record<string, unknown>>[] {
  const beforeById = uniqueRows(before, key);
  const afterById = uniqueRows(after, key);
  for (const [id, row] of beforeById) {
    const current = afterById.get(id);
    if (current === undefined || canonical(current) !== canonical(row))
      fail('UGV_B02_PROVIDER_LEDGER_NON_MONOTONIC');
  }
  return Object.freeze(after.filter((row) => !beforeById.has(String(row[key]))));
}

export function haversineMeters(
  left: Readonly<{ longitude: number; latitude: number }>,
  right: Readonly<{ longitude: number; latitude: number }>,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(right.latitude - left.latitude);
  const dLon = radians(right.longitude - left.longitude);
  const lat1 = radians(left.latitude);
  const lat2 = radians(right.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

export function deriveUgvB02AdmissionIdempotencyKey(simulationId: string): string {
  if (!UGV_B02_SIMULATION_ID_PATTERN.test(simulationId)) fail('UGV_B02_SIMULATION_ID_INVALID');
  return `uap-p3-b02-a2a-${createHash('sha256').update(simulationId).digest('hex')}`;
}

function uniqueRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  key: string,
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const result = new Map<string, Readonly<Record<string, unknown>>>();
  for (const row of rows) {
    const id = row[key];
    if (typeof id !== 'string' || id === '' || result.has(id))
      fail('UGV_B02_PROVIDER_LEDGER_IDENTITY_INVALID');
    result.set(id, row);
  }
  return result;
}

function allLedgerRows(ledger: UgvB02ProviderLedger) {
  return [
    ...ledger.runtime.idempotencyRecords,
    ...ledger.runtime.providerTasks,
    ...ledger.runtime.admissionIntents,
    ...ledger.adapter.executions,
    ...ledger.adapter.deviceToolCalls,
    ...ledger.adapter.mutationJournal,
    ...ledger.adapter.commandAcks,
    ...ledger.sdar.modelInvocations,
    ...ledger.sdar.mcpInvocations,
    ...ledger.sdar.stageModelRoutes,
    ...ledger.sdar.modelProviders,
    ...ledger.sdar.initialTaskAdmissions,
    ...ledger.sdar.capabilityAttempts,
    ...ledger.sdar.governedConfirmations,
    ...ledger.sdar.remoteAdmissionIntents,
    ...ledger.sdar.continuationSnapshots,
    ...ledger.sdar.continuationAttempts,
    ...ledger.sdar.terminalOutcomes,
    ...ledger.sdar.workflowNodeEvents,
    ...ledger.sdar.tasks,
    ...ledger.sdar.goals,
    ...ledger.sdar.goalContracts,
    ...ledger.sdar.userGoalPlans,
    ...ledger.sdar.workflowPlans,
    ...ledger.sdar.workflowInstances,
    ...ledger.sdar.skillExecutions,
    ...ledger.sdar.skillExecutionEvents,
    ...ledger.sdar.processedResults,
  ];
}

function identifier(value: string, code: string): void {
  if (!IDENTIFIER.test(value)) fail(code);
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code);
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, code: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fail(code: string): never {
  throw new UgvB02ContractError(code);
}

export class UgvB02ContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'UgvB02ContractError';
  }
}
