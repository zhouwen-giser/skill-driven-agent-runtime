import { DomainError } from './errors.js';
import { hashCanonicalEvidenceJson } from './evidence/canonical-evidence.js';
import type { McpTaskExecutionProfile } from './mcp-frozen-protocol.js';
import type { McpToolExecutionSemantics } from './mcp.js';
import type {
  TaskAvailabilityPossibleEffect,
  TaskAvailabilityRiskLevel,
  TaskReservationMode,
} from './mcp-task-availability.js';

export const UGV_MOVE_TASK_ALIAS_REVISION = 'ugv-agent-profile/embodied.move/v1' as const;

export interface SelectedTaskOperation {
  readonly profileId: 'ugv-agent-profile';
  readonly selectedAt: string;
  readonly skill: Readonly<{
    skillId: string;
    version: number;
    packageChecksum: string;
  }>;
  readonly task: Readonly<{
    semanticTaskType: 'embodied.move';
    operationAlias: 'vehicle_navigate';
    aliasRevision: typeof UGV_MOVE_TASK_ALIAS_REVISION;
    semanticBindingId: 'ugv-agent-profile/move-resource';
    skillBindingId: 'move-resource';
    bindingId: string;
  }>;
  readonly providerBinding: Readonly<{
    bindingId: string;
    revision: number;
  }>;
  readonly provider: Readonly<{
    providerId: string;
    providerType: string;
    providerVersion: string;
    manifestHash: string;
  }>;
  readonly server: Readonly<{
    serverId: string;
    protocolMode: 'frozen_v1';
    discoverySnapshotId: string;
    toolRevision: number;
    catalogRevision: string;
    catalogChecksum: string;
  }>;
  readonly resource: Readonly<{
    resourceId: string;
    resourceType: 'vehicle';
  }>;
  readonly operation: Readonly<{
    operationName: 'vehicle_navigate';
    inputSchema: unknown;
    inputSchemaHash: `sha256:${string}`;
    outputSchema: unknown;
    outputSchemaHash: `sha256:${string}`;
    executionSemantics: McpToolExecutionSemantics;
    taskExecutionProfile: McpTaskExecutionProfile;
    taskNotifications: true;
  }>;
  readonly finalStateRead: Readonly<{
    operationName: 'vehicle_get_state';
    serverId: string;
    providerId: string;
    resourceId: string;
    catalogChecksum: string;
    inputSchema: unknown;
    inputSchemaHash: `sha256:${string}`;
    outputSchema: unknown;
    outputSchemaHash: `sha256:${string}`;
    executionSemantics: McpToolExecutionSemantics;
    taskExecutionProfile: McpTaskExecutionProfile;
    resolvedArguments: Readonly<Record<string, unknown>>;
    argumentsHash: `sha256:${string}`;
  }>;
  readonly resolvedArguments: Readonly<Record<string, unknown>>;
  readonly argumentsHash: `sha256:${string}`;
  readonly availability: Readonly<{
    protocolRevision: string;
    schemaRevision: string;
    checkedAt: string;
    validUntil: string;
    disposition: 'ready';
    riskLevel: TaskAvailabilityRiskLevel;
    reservationMode: TaskReservationMode;
    reservationRef?: string;
    possibleEffects: readonly TaskAvailabilityPossibleEffect[];
  }>;
  readonly execution: Readonly<{
    mode: 'live' | 'simulation';
    simulationId?: string;
    confirmation: 'existing_outer_plan_confirmation';
    confirmationRequired: true;
  }>;
  readonly snapshotHash: `sha256:${string}`;
}

export type SelectedTaskOperationDraft = Omit<SelectedTaskOperation, 'snapshotHash'>;

/** Creates one immutable, self-hashed operation selection; profile admission owns exact semantics. */
export function createSelectedTaskOperation(
  input: SelectedTaskOperationDraft,
): SelectedTaskOperation {
  if (
    !exactKeys(input, [
      'profileId',
      'selectedAt',
      'skill',
      'task',
      'providerBinding',
      'provider',
      'server',
      'resource',
      'operation',
      'finalStateRead',
      'resolvedArguments',
      'argumentsHash',
      'availability',
      'execution',
    ])
  )
    invalid('Selected Task operation contains an unexpected top-level field.');
  const selectedAt = timestamp(input.selectedAt);
  const readinessCheckedAt = timestamp(input.availability.checkedAt);
  const readinessValidUntil = timestamp(input.availability.validUntil);
  checksum(input.skill.packageChecksum, false);
  checksum(input.provider.manifestHash, false);
  checksum(input.server.catalogChecksum, false);
  checksum(input.operation.inputSchemaHash, true);
  checksum(input.operation.outputSchemaHash, true);
  checksum(input.finalStateRead.inputSchemaHash, true);
  checksum(input.finalStateRead.outputSchemaHash, true);
  checksum(input.finalStateRead.argumentsHash, true);
  checksum(input.argumentsHash, true);
  const hashesMatch =
    input.operation.inputSchemaHash === hashCanonicalEvidenceJson(input.operation.inputSchema) &&
    input.operation.outputSchemaHash === hashCanonicalEvidenceJson(input.operation.outputSchema) &&
    input.finalStateRead.inputSchemaHash ===
      hashCanonicalEvidenceJson(input.finalStateRead.inputSchema) &&
    input.finalStateRead.outputSchemaHash ===
      hashCanonicalEvidenceJson(input.finalStateRead.outputSchema) &&
    input.finalStateRead.argumentsHash ===
      hashCanonicalEvidenceJson(input.finalStateRead.resolvedArguments) &&
    input.argumentsHash === hashCanonicalEvidenceJson(input.resolvedArguments);
  const reservationRefPresent =
    typeof input.availability.reservationRef === 'string' &&
    input.availability.reservationRef.trim() !== '';
  if (
    different(input.profileId, 'ugv-agent-profile') ||
    input.skill.skillId !== 'embodied.move_to' ||
    input.skill.version !== 1 ||
    different(input.task.semanticTaskType, 'embodied.move') ||
    different(input.task.operationAlias, 'vehicle_navigate') ||
    different(input.task.aliasRevision, UGV_MOVE_TASK_ALIAS_REVISION) ||
    different(input.task.semanticBindingId, 'ugv-agent-profile/move-resource') ||
    different(input.task.skillBindingId, 'move-resource') ||
    input.task.bindingId.trim() === '' ||
    input.task.bindingId !== input.providerBinding.bindingId ||
    input.providerBinding.bindingId.trim() === '' ||
    input.provider.providerId !== 'isr.vehicle.ugv.ugv1' ||
    input.provider.providerType !== 'isr.vehicle.ugv' ||
    input.provider.providerVersion !== '1.0.0' ||
    !/^[0-9a-f]{64}$/u.test(input.provider.manifestHash) ||
    input.server.serverId.trim() === '' ||
    input.server.discoverySnapshotId.trim() === '' ||
    input.server.catalogRevision.trim() === '' ||
    different(input.operation.operationName, 'vehicle_navigate') ||
    input.operation.executionSemantics.effect !== 'side_effecting' ||
    input.operation.executionSemantics.execution !== 'task_required' ||
    input.operation.executionSemantics.cancellation !== 'task_cancel' ||
    input.operation.executionSemantics.idempotency !== 'server_managed' ||
    input.operation.executionSemantics.replay !== 'simulation_only' ||
    input.operation.taskExecutionProfile.taskBehavior !== 'task_required' ||
    input.operation.taskExecutionProfile.availability !== 'dynamic' ||
    !input.operation.taskExecutionProfile.supportsScheduling ||
    !input.operation.taskExecutionProfile.supportsMaxElapsed ||
    input.operation.taskExecutionProfile.supportsCancellation !== true ||
    input.operation.taskExecutionProfile.supportsPauseResume !== true ||
    !input.operation.taskExecutionProfile.supportsObservations ||
    input.operation.taskExecutionProfile.supportsInputRequired ||
    input.operation.taskExecutionProfile.idempotency !== 'server_managed' ||
    different(input.operation.taskNotifications, true) ||
    different(input.finalStateRead.operationName, 'vehicle_get_state') ||
    input.finalStateRead.serverId !== input.server.serverId ||
    input.finalStateRead.providerId !== input.provider.providerId ||
    input.finalStateRead.resourceId !== input.resource.resourceId ||
    input.finalStateRead.catalogChecksum !== input.server.catalogChecksum ||
    input.finalStateRead.executionSemantics.effect !== 'read_only' ||
    input.finalStateRead.executionSemantics.execution !== 'synchronous' ||
    input.finalStateRead.executionSemantics.cancellation !== 'unsupported' ||
    input.finalStateRead.executionSemantics.idempotency !== 'server_managed' ||
    input.finalStateRead.executionSemantics.replay !== 'allowed' ||
    input.finalStateRead.taskExecutionProfile.taskBehavior !== 'synchronous_only' ||
    input.finalStateRead.taskExecutionProfile.availability !== 'dynamic' ||
    input.finalStateRead.taskExecutionProfile.supportsScheduling ||
    input.finalStateRead.taskExecutionProfile.supportsMaxElapsed ||
    input.finalStateRead.taskExecutionProfile.supportsCancellation !== false ||
    input.finalStateRead.taskExecutionProfile.supportsPauseResume !== false ||
    input.finalStateRead.taskExecutionProfile.supportsObservations ||
    input.finalStateRead.taskExecutionProfile.supportsInputRequired ||
    input.finalStateRead.taskExecutionProfile.idempotency !== 'server_managed' ||
    !isExactFinalStateArguments(
      input.finalStateRead.resolvedArguments,
      input.resource.resourceId,
    ) ||
    different(input.resource.resourceType, 'vehicle') ||
    input.resource.resourceId !== 'vehicle:ugv1' ||
    !isExactNavigateArguments(input.resolvedArguments, input.resource.resourceId) ||
    different(input.server.protocolMode, 'frozen_v1') ||
    !['live', 'simulation'].includes(input.execution.mode) ||
    (input.execution.mode === 'live'
      ? 'simulationId' in input.execution
      : typeof input.execution.simulationId !== 'string' ||
        input.execution.simulationId.trim() === '') ||
    different(input.execution.confirmation, 'existing_outer_plan_confirmation') ||
    different(input.execution.confirmationRequired, true) ||
    !hashesMatch ||
    input.availability.protocolRevision.trim() === '' ||
    input.availability.schemaRevision.trim() === '' ||
    different(input.availability.disposition, 'ready') ||
    !['low', 'medium', 'high', 'critical'].includes(input.availability.riskLevel) ||
    !['none', 'best_effort', 'guaranteed'].includes(input.availability.reservationMode) ||
    (input.availability.reservationRef !== undefined && !reservationRefPresent) ||
    (input.availability.reservationMode === 'guaranteed') !== reservationRefPresent ||
    new Set(input.availability.possibleEffects).size !==
      input.availability.possibleEffects.length ||
    input.availability.possibleEffects.some(
      (effect) =>
        ![
          'task_preemption',
          'task_pause',
          'start_rejection',
          'start_window_missed',
          'deadline_reached',
          'partial_completion',
        ].includes(effect),
    ) ||
    !Number.isSafeInteger(input.providerBinding.revision) ||
    input.providerBinding.revision < 1 ||
    !Number.isSafeInteger(input.server.toolRevision) ||
    input.server.toolRevision < 1
  )
    invalid('Selected Task operation violates the exact UGV profile identity.');
  if (
    Date.parse(readinessValidUntil) <= Date.parse(selectedAt) ||
    Date.parse(readinessCheckedAt) > Date.parse(selectedAt)
  )
    invalid('Selected Task operation readiness is stale or time-inconsistent.');
  const draft = snapshotJson({
    ...input,
    selectedAt,
    availability: {
      ...input.availability,
      checkedAt: readinessCheckedAt,
      validUntil: readinessValidUntil,
    },
  }) as SelectedTaskOperationDraft;
  return Object.freeze({
    ...draft,
    snapshotHash: hashCanonicalEvidenceJson(draft),
  });
}

function isExactNavigateArguments(
  value: Readonly<Record<string, unknown>>,
  resourceId: string,
): boolean {
  const mission = plainRecord(value['mission']);
  const target = plainRecord(mission?.['target']);
  return (
    Object.keys(value).length === 3 &&
    value['resourceId'] === resourceId &&
    value['stopOnObstacle'] === true &&
    mission !== undefined &&
    Object.keys(mission).length === 2 &&
    mission['type'] === 'point' &&
    target !== undefined &&
    Object.keys(target).length === 2 &&
    coordinate(target['longitude'], -180, 180) &&
    coordinate(target['latitude'], -90, 90)
  );
}

function isExactFinalStateArguments(
  value: Readonly<Record<string, unknown>>,
  resourceId: string,
): boolean {
  return (
    Object.keys(value).length === 2 &&
    value['resourceId'] === resourceId &&
    Array.isArray(value['include']) &&
    value['include'].length === 2 &&
    value['include'][0] === 'chassis' &&
    value['include'][1] === 'health'
  );
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function coordinate(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function timestamp(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalid('Selected Task operation timestamp is invalid.');
  return new Date(milliseconds).toISOString();
}

function checksum(value: string, prefixed: boolean): void {
  const pattern = prefixed ? /^sha256:[0-9a-f]{64}$/u : /^[0-9a-f]{64}$/u;
  if (!pattern.test(value)) invalid('Selected Task operation checksum is invalid.');
}

function snapshotJson(value: unknown, active = new WeakSet()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object' || active.has(value))
    invalid('Selected Task operation must be finite acyclic JSON data.');
  active.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshotJson(item, active)));
    if (
      Reflect.getPrototypeOf(value) !== Object.prototype &&
      Reflect.getPrototypeOf(value) !== null
    )
      invalid('Selected Task operation must contain plain JSON objects.');
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, snapshotJson(item, active)]),
      ),
    );
  } finally {
    active.delete(value);
  }
}

function different(value: unknown, expected: unknown): boolean {
  return value !== expected;
}

function invalid(message: string): never {
  throw new DomainError('SELECTED_TASK_OPERATION_INVALID', message);
}
