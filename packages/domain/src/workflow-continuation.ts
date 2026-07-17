import { DomainError } from './errors.js';
import {
  createRuntimeExecutionContext,
  type RuntimeExecutionContext,
} from './runtime-execution.js';
import {
  validateWorkflowBudgetLimits,
  type WorkflowBudgetLimits,
  type WorkflowBudgetUsage,
} from './workflow-budget.js';
import type { InternalToolResult } from './mcp-task.js';

export const WORKFLOW_CONTINUATION_SCHEMA_VERSION = '1.0' as const;
export const MAX_WORKFLOW_CONTINUATION_JSON_BYTES = 1_048_576;
export const MAX_WORKFLOW_CONTINUATION_JSON_DEPTH = 64;
export const MAX_WORKFLOW_CONTINUATION_JSON_VALUES = 50_000;

export type WorkflowExternalWaitKind = 'remote_task' | 'child_workflow';
export type WorkflowExternalWaitState = 'waiting' | 'awaiting_input';

export interface WorkflowExternalWaitRef {
  readonly waitId: string;
  readonly kind: WorkflowExternalWaitKind;
  readonly sourceId: string;
  readonly nodeId: string;
  readonly nodeRunId: string;
  readonly state: WorkflowExternalWaitState;
}

export type WorkflowMcpCallOutcome =
  | Readonly<{ kind: 'immediate'; result: InternalToolResult }>
  | Readonly<{ kind: 'waiting_external'; wait: WorkflowExternalWaitRef }>;

export interface WorkflowRunnableFrontierEntry {
  readonly nodeId: string;
  readonly nextRunOrdinal: number;
}

export interface WorkflowParallelJoinArrival {
  readonly predecessorNodeId: string;
  readonly predecessorNodeRunId: string;
}

export interface WorkflowParallelJoinState {
  readonly joinKey: string;
  readonly joinNodeId: string;
  readonly requiredPredecessorNodeIds: readonly string[];
  readonly arrivals: readonly WorkflowParallelJoinArrival[];
}

export type WorkflowContinuationLifecycle =
  'building' | 'active' | 'superseded' | 'invalidated' | 'terminal';

export interface WorkflowContinuationSnapshot {
  readonly schemaVersion: typeof WORKFLOW_CONTINUATION_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly continuationId: string;
  readonly stateVersion: number;
  readonly predecessorSnapshotId?: string;
  readonly lifecycle: WorkflowContinuationLifecycle;
  readonly agentTaskId: string;
  readonly contextId: string;
  readonly workflowControlId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowDefinitionHash: string;
  readonly inputHash: string;
  readonly workflowInstanceId: string;
  readonly input: unknown;
  readonly waitingNodeRuns: readonly WorkflowExternalWaitRef[];
  readonly runnableFrontier: readonly WorkflowRunnableFrontierEntry[];
  readonly completedNodeRunIds: readonly string[];
  readonly nodeRunCounts: Readonly<Record<string, number>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly errors: Readonly<Record<string, unknown>>;
  readonly routes: Readonly<Record<string, unknown>>;
  readonly loopCounts: Readonly<Record<string, number>>;
  readonly recoveryCounts: Readonly<Record<string, number>>;
  readonly parallelJoinState: readonly WorkflowParallelJoinState[];
  readonly result?: unknown;
  readonly failed: boolean;
  readonly executionContext: RuntimeExecutionContext;
  readonly budgetLimits: WorkflowBudgetLimits;
  readonly budgetUsage: WorkflowBudgetUsage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkflowContinuationSnapshotInput = Omit<
  WorkflowContinuationSnapshot,
  'schemaVersion'
> &
  Readonly<{ schemaVersion: string }>;

export type WorkflowRuntimeContinuationState = Pick<
  WorkflowContinuationSnapshot,
  | 'waitingNodeRuns'
  | 'input'
  | 'runnableFrontier'
  | 'completedNodeRunIds'
  | 'nodeRunCounts'
  | 'outputs'
  | 'errors'
  | 'routes'
  | 'loopCounts'
  | 'recoveryCounts'
  | 'parallelJoinState'
  | 'result'
  | 'failed'
  | 'executionContext'
  | 'budgetLimits'
  | 'budgetUsage'
>;

export type WorkflowExternalWaitResolution =
  | Readonly<{
      kind: 'completed';
      waitId: string;
      nodeRunId: string;
      result: unknown;
    }>
  | Readonly<{
      kind: 'failed';
      waitId: string;
      nodeRunId: string;
      error: Readonly<{
        code: string;
        message: string;
        category: 'provider_failed' | 'provider_cancelled' | 'child_failed' | 'child_cancelled';
        data?: unknown;
      }>;
    }>;

export type WorkflowContinuationAttemptStatus =
  'claimed' | 'running' | 'waiting_external' | 'succeeded' | 'failed' | 'canceled' | 'stale';

export interface WorkflowContinuationAttempt {
  readonly attemptId: string;
  readonly eventId: string;
  readonly snapshotId: string;
  readonly continuationId: string;
  readonly workflowInstanceId: string;
  readonly snapshotStateVersion: number;
  readonly claimToken: string;
  readonly status: WorkflowContinuationAttemptStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly errorCode?: string;
}

const snapshotLifecycles = new Set<WorkflowContinuationLifecycle>([
  'building',
  'active',
  'superseded',
  'invalidated',
  'terminal',
]);
const waitKinds = new Set<WorkflowExternalWaitKind>(['remote_task', 'child_workflow']);
const waitStates = new Set<WorkflowExternalWaitState>(['waiting', 'awaiting_input']);
const attemptStatuses = new Set<WorkflowContinuationAttemptStatus>([
  'claimed',
  'running',
  'waiting_external',
  'succeeded',
  'failed',
  'canceled',
  'stale',
]);
const terminalAttemptStatuses = new Set<WorkflowContinuationAttemptStatus>([
  'waiting_external',
  'succeeded',
  'failed',
  'canceled',
  'stale',
]);

export function createWorkflowContinuationSnapshot(
  input: WorkflowContinuationSnapshotInput,
): WorkflowContinuationSnapshot {
  if (input.schemaVersion !== WORKFLOW_CONTINUATION_SCHEMA_VERSION)
    throw continuationError(
      'WORKFLOW_CONTINUATION_VERSION_INVALID',
      'Workflow continuation schema version is unsupported.',
    );
  validateSnapshotIdentity(input);
  validateSnapshotVersion(input);
  if (!snapshotLifecycles.has(input.lifecycle))
    throw continuationError(
      'WORKFLOW_CONTINUATION_STATE_INVALID',
      'Workflow continuation lifecycle is invalid.',
    );

  const waitingNodeRuns = snapshotWaitingNodeRuns(input.waitingNodeRuns);
  const runnableFrontier = snapshotRunnableFrontier(input.runnableFrontier);
  const completedNodeRunIds = uniqueIdentifiers(input.completedNodeRunIds, 'completed node run');
  const completed = new Set(completedNodeRunIds);
  for (const wait of waitingNodeRuns)
    if (completed.has(wait.nodeRunId))
      throw continuationError(
        'WORKFLOW_CONTINUATION_STATE_INVALID',
        'A waiting node run cannot also be completed.',
      );

  const nodeRunCounts = snapshotCountRecord(input.nodeRunCounts, 'node run');
  for (const frontier of runnableFrontier) {
    const completedRuns = nodeRunCounts[frontier.nodeId] ?? 0;
    if (frontier.nextRunOrdinal !== completedRuns + 1)
      throw continuationError(
        'WORKFLOW_CONTINUATION_STATE_INVALID',
        'Runnable frontier ordinals must follow the persisted node run count.',
      );
  }
  const parallelJoinState = snapshotParallelJoins(input.parallelJoinState, completed);
  const persistedInput = snapshotJsonValue(input.input, new Set<object>(), { count: 0 }, 0);
  const persistedResult =
    input.result === undefined
      ? undefined
      : snapshotJsonValue(input.result, new Set<object>(), { count: 0 }, 0);
  if (typeof input.failed !== 'boolean')
    throw continuationError(
      'WORKFLOW_CONTINUATION_STATE_INVALID',
      'Workflow continuation failed state must be boolean.',
    );
  const executionContext = createRuntimeExecutionContext(input.executionContext);
  validateWorkflowBudgetLimits(input.budgetLimits);
  validateBudgetUsage(input.budgetUsage, input.budgetLimits);
  const createdAt = validTimestamp(input.createdAt, 'createdAt');
  const updatedAt = validTimestamp(input.updatedAt, 'updatedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw continuationError(
      'WORKFLOW_CONTINUATION_STATE_INVALID',
      'Workflow continuation updatedAt cannot precede createdAt.',
    );

  const snapshot: WorkflowContinuationSnapshot = {
    ...input,
    schemaVersion: WORKFLOW_CONTINUATION_SCHEMA_VERSION,
    input: persistedInput,
    waitingNodeRuns,
    runnableFrontier,
    completedNodeRunIds,
    nodeRunCounts,
    outputs: snapshotJsonRecord(input.outputs),
    errors: snapshotJsonRecord(input.errors),
    routes: snapshotJsonRecord(input.routes),
    loopCounts: snapshotCountRecord(input.loopCounts, 'loop'),
    recoveryCounts: snapshotCountRecord(input.recoveryCounts, 'recovery'),
    parallelJoinState,
    ...(persistedResult === undefined ? {} : { result: persistedResult }),
    failed: input.failed,
    executionContext,
    budgetLimits: Object.freeze({ ...input.budgetLimits }),
    budgetUsage: Object.freeze({ ...input.budgetUsage }),
    createdAt,
    updatedAt,
  };
  assertBoundedJson(snapshot);
  return Object.freeze(snapshot);
}

export function assertWorkflowContinuationSuccessor(
  previous: WorkflowContinuationSnapshot,
  next: WorkflowContinuationSnapshot,
): void {
  if (
    next.continuationId !== previous.continuationId ||
    next.workflowInstanceId !== previous.workflowInstanceId ||
    next.workflowPlanId !== previous.workflowPlanId ||
    next.goalId !== previous.goalId ||
    next.goalVersion !== previous.goalVersion ||
    next.stateVersion !== previous.stateVersion + 1 ||
    next.predecessorSnapshotId !== previous.snapshotId
  )
    throw continuationError(
      'WORKFLOW_CONTINUATION_VERSION_INVALID',
      'Workflow continuation successor identity or version is invalid.',
    );
}

export function transitionWorkflowContinuationLifecycle(
  snapshot: WorkflowContinuationSnapshot,
  lifecycle: WorkflowContinuationLifecycle,
  updatedAt: string,
): WorkflowContinuationSnapshot {
  const allowed: Readonly<
    Record<WorkflowContinuationLifecycle, readonly WorkflowContinuationLifecycle[]>
  > = {
    building: ['active', 'invalidated'],
    active: ['superseded', 'invalidated', 'terminal'],
    superseded: [],
    invalidated: [],
    terminal: [],
  };
  if (!snapshotLifecycles.has(lifecycle) || !allowed[snapshot.lifecycle].includes(lifecycle))
    throw continuationError(
      'WORKFLOW_CONTINUATION_TRANSITION_INVALID',
      'Workflow continuation lifecycle transition is not allowed.',
    );
  return createWorkflowContinuationSnapshot({ ...snapshot, lifecycle, updatedAt });
}

export function createWorkflowContinuationAttempt(
  input: WorkflowContinuationAttempt,
): WorkflowContinuationAttempt {
  for (const value of [
    input.attemptId,
    input.eventId,
    input.snapshotId,
    input.continuationId,
    input.workflowInstanceId,
    input.claimToken,
  ])
    requireIdentifier(value, 'Workflow continuation attempt identity');
  requirePositiveInteger(input.snapshotStateVersion, 'snapshotStateVersion');
  if (!attemptStatuses.has(input.status))
    throw continuationError(
      'WORKFLOW_CONTINUATION_ATTEMPT_INVALID',
      'Workflow continuation attempt status is invalid.',
    );
  const createdAt = validTimestamp(input.createdAt, 'createdAt');
  const startedAt = optionalTimestamp(input.startedAt, 'startedAt');
  const completedAt = optionalTimestamp(input.completedAt, 'completedAt');
  validateAttemptTimestamps(input.status, createdAt, startedAt, completedAt);
  const errorCode = optionalErrorCode(input.errorCode);
  if (input.status === 'failed' && errorCode === undefined)
    throw continuationError(
      'WORKFLOW_CONTINUATION_ATTEMPT_INVALID',
      'A failed Workflow continuation attempt requires an error code.',
    );
  if (input.status !== 'failed' && errorCode !== undefined)
    throw continuationError(
      'WORKFLOW_CONTINUATION_ATTEMPT_INVALID',
      'Only a failed Workflow continuation attempt may carry an error code.',
    );
  return Object.freeze({
    ...input,
    createdAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

export function transitionWorkflowContinuationAttempt(
  attempt: WorkflowContinuationAttempt,
  status: Exclude<WorkflowContinuationAttemptStatus, 'claimed'>,
  timestamp: string,
  errorCode?: string,
): WorkflowContinuationAttempt {
  const allowed: Readonly<
    Record<WorkflowContinuationAttemptStatus, readonly WorkflowContinuationAttemptStatus[]>
  > = {
    claimed: ['running', 'stale'],
    running: ['waiting_external', 'succeeded', 'failed', 'canceled'],
    waiting_external: [],
    succeeded: [],
    failed: [],
    canceled: [],
    stale: [],
  };
  if (!attemptStatuses.has(status) || !allowed[attempt.status].includes(status))
    throw continuationError(
      'WORKFLOW_CONTINUATION_TRANSITION_INVALID',
      'Workflow continuation attempt transition is not allowed.',
    );
  const next = {
    ...attempt,
    status,
    ...(status === 'running'
      ? { startedAt: timestamp }
      : { completedAt: timestamp, ...(errorCode === undefined ? {} : { errorCode }) }),
  } as WorkflowContinuationAttempt;
  return createWorkflowContinuationAttempt(next);
}

function validateSnapshotIdentity(input: WorkflowContinuationSnapshotInput): void {
  for (const value of [
    input.snapshotId,
    input.continuationId,
    input.agentTaskId,
    input.contextId,
    input.workflowControlId,
    input.goalId,
    input.workflowPlanId,
    input.workflowDefinitionId,
    input.workflowInstanceId,
  ])
    requireIdentifier(value, 'Workflow continuation identity');
  requirePositiveInteger(input.goalVersion, 'goalVersion');
  requirePositiveInteger(input.workflowDefinitionVersion, 'workflowDefinitionVersion');
  requireHash(input.workflowDefinitionHash, 'workflowDefinitionHash');
  requireHash(input.inputHash, 'inputHash');
}

function validateSnapshotVersion(input: WorkflowContinuationSnapshotInput): void {
  requirePositiveInteger(input.stateVersion, 'stateVersion');
  if (input.stateVersion === 1 && input.predecessorSnapshotId !== undefined)
    throw continuationError(
      'WORKFLOW_CONTINUATION_VERSION_INVALID',
      'Initial Workflow continuation snapshot cannot have a predecessor.',
    );
  if (input.stateVersion > 1 && input.predecessorSnapshotId === undefined)
    throw continuationError(
      'WORKFLOW_CONTINUATION_VERSION_INVALID',
      'A versioned Workflow continuation snapshot requires its predecessor.',
    );
  if (input.predecessorSnapshotId !== undefined)
    requireIdentifier(input.predecessorSnapshotId, 'Workflow continuation predecessor');
}

function snapshotWaitingNodeRuns(
  values: readonly WorkflowExternalWaitRef[],
): readonly WorkflowExternalWaitRef[] {
  const waitIds = new Set<string>();
  const nodeRunIds = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      requireIdentifier(value.waitId, 'External wait');
      requireIdentifier(value.sourceId, 'External wait source');
      requireIdentifier(value.nodeId, 'External wait node');
      requireIdentifier(value.nodeRunId, 'External wait node run');
      if (
        !waitKinds.has(value.kind) ||
        !waitStates.has(value.state) ||
        waitIds.has(value.waitId) ||
        nodeRunIds.has(value.nodeRunId)
      )
        throw continuationError(
          'WORKFLOW_CONTINUATION_STATE_INVALID',
          'External waits require valid status and unique wait/node-run identities.',
        );
      waitIds.add(value.waitId);
      nodeRunIds.add(value.nodeRunId);
      return Object.freeze({ ...value });
    }),
  );
}

function snapshotRunnableFrontier(
  values: readonly WorkflowRunnableFrontierEntry[],
): readonly WorkflowRunnableFrontierEntry[] {
  const nodeIds = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      requireIdentifier(value.nodeId, 'Runnable frontier node');
      requirePositiveInteger(value.nextRunOrdinal, 'nextRunOrdinal');
      if (nodeIds.has(value.nodeId))
        throw continuationError(
          'WORKFLOW_CONTINUATION_STATE_INVALID',
          'Runnable frontier node identities must be unique.',
        );
      nodeIds.add(value.nodeId);
      return Object.freeze({ ...value });
    }),
  );
}

function snapshotParallelJoins(
  values: readonly WorkflowParallelJoinState[],
  completedNodeRuns: ReadonlySet<string>,
): readonly WorkflowParallelJoinState[] {
  const joinKeys = new Set<string>();
  return Object.freeze(
    values.map((value) => {
      requireIdentifier(value.joinKey, 'Parallel join');
      requireIdentifier(value.joinNodeId, 'Parallel join node');
      if (joinKeys.has(value.joinKey))
        throw continuationError(
          'WORKFLOW_CONTINUATION_STATE_INVALID',
          'Parallel join keys must be unique.',
        );
      joinKeys.add(value.joinKey);
      const required = uniqueIdentifiers(value.requiredPredecessorNodeIds, 'join predecessor');
      if (required.length === 0)
        throw continuationError(
          'WORKFLOW_CONTINUATION_STATE_INVALID',
          'Parallel joins require at least one predecessor.',
        );
      const requiredSet = new Set(required);
      const arrivedPredecessors = new Set<string>();
      const arrivals = Object.freeze(
        value.arrivals.map((arrival) => {
          requireIdentifier(arrival.predecessorNodeId, 'Join arrival predecessor');
          requireIdentifier(arrival.predecessorNodeRunId, 'Join arrival node run');
          if (
            !requiredSet.has(arrival.predecessorNodeId) ||
            arrivedPredecessors.has(arrival.predecessorNodeId) ||
            !completedNodeRuns.has(arrival.predecessorNodeRunId)
          )
            throw continuationError(
              'WORKFLOW_CONTINUATION_STATE_INVALID',
              'Parallel join arrivals must be unique, required and completed.',
            );
          arrivedPredecessors.add(arrival.predecessorNodeId);
          return Object.freeze({ ...arrival });
        }),
      );
      return Object.freeze({
        joinKey: value.joinKey,
        joinNodeId: value.joinNodeId,
        requiredPredecessorNodeIds: required,
        arrivals,
      });
    }),
  );
}

function snapshotCountRecord(
  value: Readonly<Record<string, number>>,
  label: string,
): Readonly<Record<string, number>> {
  const snapshot: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    requireIdentifier(key, `${label} identity`);
    if (!Number.isSafeInteger(count) || count < 0)
      throw continuationError(
        'WORKFLOW_CONTINUATION_STATE_INVALID',
        `Workflow continuation ${label} counts must be nonnegative safe integers.`,
      );
    snapshot[key] = count;
  }
  return Object.freeze(snapshot);
}

function snapshotJsonRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const snapshot = snapshotJsonValue(value, new Set<object>(), { count: 0 }, 0);
  if (!isPlainRecord(snapshot))
    throw continuationError(
      'WORKFLOW_CONTINUATION_JSON_INVALID',
      'Workflow continuation state must be a JSON object.',
    );
  return snapshot;
}

function snapshotJsonValue(
  value: unknown,
  active: Set<object>,
  budget: { count: number },
  depth: number,
): unknown {
  budget.count += 1;
  if (
    budget.count > MAX_WORKFLOW_CONTINUATION_JSON_VALUES ||
    depth > MAX_WORKFLOW_CONTINUATION_JSON_DEPTH
  )
    throw continuationError(
      'WORKFLOW_CONTINUATION_JSON_TOO_LARGE',
      'Workflow continuation JSON exceeds its structural bound.',
    );
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw continuationError(
        'WORKFLOW_CONTINUATION_JSON_INVALID',
        'Workflow continuation JSON numbers must be finite.',
      );
    return value;
  }
  if (typeof value !== 'object')
    throw continuationError(
      'WORKFLOW_CONTINUATION_JSON_INVALID',
      'Workflow continuation state must contain only JSON values.',
    );
  if (active.has(value))
    throw continuationError(
      'WORKFLOW_CONTINUATION_JSON_INVALID',
      'Workflow continuation JSON cannot contain cycles.',
    );
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotJsonValue(item, active, budget, depth + 1)));
    if (!isPlainRecord(value))
      throw continuationError(
        'WORKFLOW_CONTINUATION_JSON_INVALID',
        'Workflow continuation state must contain only plain JSON objects.',
      );
    const snapshot: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === '')
        throw continuationError(
          'WORKFLOW_CONTINUATION_JSON_INVALID',
          'Workflow continuation JSON object keys must be non-empty.',
        );
      snapshot[key] = snapshotJsonValue(value[key], active, budget, depth + 1);
    }
    return Object.freeze(snapshot);
  } finally {
    active.delete(value);
  }
}

function assertBoundedJson(value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw continuationError(
      'WORKFLOW_CONTINUATION_JSON_INVALID',
      'Workflow continuation snapshot is not serializable JSON.',
    );
  }
  if (new TextEncoder().encode(encoded).byteLength > MAX_WORKFLOW_CONTINUATION_JSON_BYTES)
    throw continuationError(
      'WORKFLOW_CONTINUATION_JSON_TOO_LARGE',
      'Workflow continuation snapshot exceeds the one MiB JSON bound.',
    );
}

function validateBudgetUsage(usage: WorkflowBudgetUsage, limits: WorkflowBudgetLimits): void {
  const integers = [usage.replanCount, usage.durationMs, usage.llmCalls, usage.mcpCalls];
  if (
    integers.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !Number.isFinite(usage.cost) ||
    usage.cost < 0 ||
    usage.replanCount > limits.maxReplans ||
    usage.llmCalls > limits.maxLlmCalls ||
    usage.mcpCalls > limits.maxMcpCalls ||
    usage.cost > limits.maxCost
  )
    throw continuationError(
      'WORKFLOW_CONTINUATION_STATE_INVALID',
      'Workflow continuation budget usage is invalid or exceeds its immutable limits.',
    );
}

function validateAttemptTimestamps(
  status: WorkflowContinuationAttemptStatus,
  createdAt: string,
  startedAt: string | undefined,
  completedAt: string | undefined,
): void {
  if (status === 'claimed' && (startedAt !== undefined || completedAt !== undefined))
    throw invalidAttemptTimestamps();
  if (status === 'running' && (startedAt === undefined || completedAt !== undefined))
    throw invalidAttemptTimestamps();
  if (terminalAttemptStatuses.has(status)) {
    if (completedAt === undefined || (status !== 'stale' && startedAt === undefined))
      throw invalidAttemptTimestamps();
  }
  if (
    (startedAt !== undefined && Date.parse(startedAt) < Date.parse(createdAt)) ||
    (completedAt !== undefined && Date.parse(completedAt) < Date.parse(startedAt ?? createdAt))
  )
    throw invalidAttemptTimestamps();
}

function invalidAttemptTimestamps(): DomainError {
  return continuationError(
    'WORKFLOW_CONTINUATION_ATTEMPT_INVALID',
    'Workflow continuation attempt timestamps do not match its status.',
  );
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1_024)
    throw continuationError(
      'WORKFLOW_CONTINUATION_IDENTITY_INVALID',
      `${label} must be a non-empty bounded identifier.`,
    );
  return value;
}

function uniqueIdentifiers(values: readonly string[], label: string): readonly string[] {
  const seen = new Set<string>();
  const snapshot = values.map((value) => {
    requireIdentifier(value, label);
    if (seen.has(value))
      throw continuationError(
        'WORKFLOW_CONTINUATION_STATE_INVALID',
        `Workflow continuation ${label} identities must be unique.`,
      );
    seen.add(value);
    return value;
  });
  return Object.freeze(snapshot);
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw continuationError(
      'WORKFLOW_CONTINUATION_VERSION_INVALID',
      `Workflow continuation ${label} must be a positive safe integer.`,
    );
}

function requireHash(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value))
    throw continuationError(
      'WORKFLOW_CONTINUATION_HASH_INVALID',
      `Workflow continuation ${label} must be a lowercase SHA-256 hash.`,
    );
}

function validTimestamp(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Date.parse(value)))
    throw continuationError(
      'WORKFLOW_CONTINUATION_STATE_INVALID',
      `Workflow continuation ${label} must be a valid timestamp.`,
    );
  return value;
}

function optionalTimestamp(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : validTimestamp(value, label);
}

function optionalErrorCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(value))
    throw continuationError(
      'WORKFLOW_CONTINUATION_ATTEMPT_INVALID',
      'Workflow continuation attempt error code is invalid.',
    );
  return value;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function continuationError(
  code: Extract<
    DomainError['code'],
    | 'WORKFLOW_CONTINUATION_ATTEMPT_INVALID'
    | 'WORKFLOW_CONTINUATION_HASH_INVALID'
    | 'WORKFLOW_CONTINUATION_IDENTITY_INVALID'
    | 'WORKFLOW_CONTINUATION_JSON_INVALID'
    | 'WORKFLOW_CONTINUATION_JSON_TOO_LARGE'
    | 'WORKFLOW_CONTINUATION_STATE_INVALID'
    | 'WORKFLOW_CONTINUATION_TRANSITION_INVALID'
    | 'WORKFLOW_CONTINUATION_VERSION_INVALID'
  >,
  message: string,
): DomainError {
  return new DomainError(code, message);
}
