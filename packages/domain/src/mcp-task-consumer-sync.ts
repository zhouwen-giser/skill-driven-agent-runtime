import { createHash } from 'node:crypto';

import { DomainError } from './errors.js';
import {
  createRuntimeExecutionContext,
  type RuntimeExecutionContext,
} from './runtime-execution.js';

export interface McpLogicalInvocationIdentity {
  readonly schemaVersion: 'sdar.mcp-logical-invocation/v1';
  readonly logicalInvocationId: string;
  readonly identityHash: string;
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowInstanceId: string;
  readonly workflowNodeId: string;
  readonly workflowNodeRunId: string;
  readonly serverId: string;
  readonly providerBindingId?: string;
  readonly providerId?: string;
  readonly operationName: string;
  readonly argumentsHash: string;
  readonly executionContextHash: string;
}

export interface McpLogicalInvocationIdentityInput {
  readonly taskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly workflowInstanceId: string;
  readonly workflowNodeId: string;
  readonly workflowNodeRunId: string;
  readonly serverId: string;
  readonly providerBindingId?: string;
  readonly providerId?: string;
  readonly operationName: string;
  readonly argumentsHash: string;
  readonly executionContext: RuntimeExecutionContext;
}

export type RemoteTaskProviderExecutionLinkProvenance =
  'committed_receipt' | 'reconcile_found_exact';

export interface RemoteTaskProviderExecutionLink {
  readonly schemaVersion: 'sdar.remote-task-provider-execution-link/v1';
  readonly linkId: string;
  readonly bindingId: string;
  readonly logicalInvocationId: string;
  readonly remoteTaskId: string;
  readonly providerId: string;
  readonly runtimeServerId: string;
  readonly providerBindingId?: string;
  readonly providerOriginType?: 'direct' | 'smpp_registry';
  readonly smppSourceId?: string;
  readonly externalServerId?: string;
  readonly operationName: string;
  readonly executionStatus: 'unresolved' | 'exact' | 'conflict';
  readonly externalExecutionId?: string;
  readonly missionStatus: 'unresolved' | 'exact' | 'conflict';
  readonly deviceMissionId?: string;
  readonly provenance: RemoteTaskProviderExecutionLinkProvenance;
  readonly sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1';
  readonly sourceRevision: string;
  readonly observedAt: string;
  readonly contentHash: string;
}

export function createMcpLogicalInvocationIdentity(
  input: McpLogicalInvocationIdentityInput,
): McpLogicalInvocationIdentity {
  const normalized = Object.freeze({
    schemaVersion: 'sdar.mcp-logical-invocation/v1' as const,
    taskId: identifier(input.taskId, 'taskId'),
    contextId: identifier(input.contextId, 'contextId'),
    goalId: identifier(input.goalId, 'goalId'),
    goalVersion: positiveInteger(input.goalVersion, 'goalVersion'),
    workflowPlanId: identifier(input.workflowPlanId, 'workflowPlanId'),
    workflowDefinitionId: identifier(input.workflowDefinitionId, 'workflowDefinitionId'),
    workflowDefinitionVersion: positiveInteger(
      input.workflowDefinitionVersion,
      'workflowDefinitionVersion',
    ),
    workflowInstanceId: identifier(input.workflowInstanceId, 'workflowInstanceId'),
    workflowNodeId: identifier(input.workflowNodeId, 'workflowNodeId'),
    workflowNodeRunId: identifier(input.workflowNodeRunId, 'workflowNodeRunId'),
    serverId: identifier(input.serverId, 'serverId'),
    ...(input.providerBindingId === undefined
      ? {}
      : { providerBindingId: identifier(input.providerBindingId, 'providerBindingId') }),
    ...(input.providerId === undefined
      ? {}
      : { providerId: identifier(input.providerId, 'providerId') }),
    operationName: identifier(input.operationName, 'operationName'),
    argumentsHash: bareSha256(input.argumentsHash, 'argumentsHash'),
    executionContextHash: hashCanonical(createRuntimeExecutionContext(input.executionContext)),
  });
  const identityHash = hashCanonical(normalized);
  const logicalInvocationId = `mcp-logical-${identityHash.slice('sha256:'.length)}`;
  return Object.freeze({
    ...normalized,
    logicalInvocationId,
    identityHash,
    idempotencyKey: logicalInvocationId,
  });
}

export function createRemoteTaskProviderExecutionLink(
  input: Omit<RemoteTaskProviderExecutionLink, 'schemaVersion' | 'linkId' | 'contentHash'>,
): RemoteTaskProviderExecutionLink {
  const executionStatus = input.executionStatus;
  const missionStatus = input.missionStatus;
  if ((executionStatus === 'exact') !== (input.externalExecutionId !== undefined))
    throw invalid('externalExecutionId must exist exactly when executionStatus is exact.');
  if ((missionStatus === 'exact') !== (input.deviceMissionId !== undefined))
    throw invalid('deviceMissionId must exist exactly when missionStatus is exact.');
  if (missionStatus === 'exact' && executionStatus !== 'exact')
    throw invalid('An exact Mission relation requires an exact Provider execution relation.');
  if (
    input.providerOriginType === 'smpp_registry' &&
    (input.providerBindingId === undefined ||
      input.smppSourceId === undefined ||
      input.externalServerId === undefined)
  )
    throw invalid(
      'SMPP Provider execution lineage must include Binding, Source, and external Server.',
    );
  if (
    input.providerOriginType === 'direct' &&
    (input.smppSourceId !== undefined || input.externalServerId !== undefined)
  )
    throw invalid('Direct Provider execution lineage cannot claim SMPP Source identity.');
  const observedAt = timestamp(input.observedAt);
  const normalized = Object.freeze({
    schemaVersion: 'sdar.remote-task-provider-execution-link/v1' as const,
    bindingId: identifier(input.bindingId, 'bindingId'),
    logicalInvocationId: identifier(input.logicalInvocationId, 'logicalInvocationId'),
    remoteTaskId: identifier(input.remoteTaskId, 'remoteTaskId'),
    providerId: identifier(input.providerId, 'providerId'),
    runtimeServerId: identifier(input.runtimeServerId, 'runtimeServerId'),
    ...(input.providerBindingId === undefined
      ? {}
      : { providerBindingId: identifier(input.providerBindingId, 'providerBindingId') }),
    ...(input.providerOriginType === undefined
      ? {}
      : { providerOriginType: input.providerOriginType }),
    ...(input.smppSourceId === undefined
      ? {}
      : { smppSourceId: identifier(input.smppSourceId, 'smppSourceId') }),
    ...(input.externalServerId === undefined
      ? {}
      : { externalServerId: identifier(input.externalServerId, 'externalServerId') }),
    operationName: identifier(input.operationName, 'operationName'),
    executionStatus,
    ...(input.externalExecutionId === undefined
      ? {}
      : { externalExecutionId: identifier(input.externalExecutionId, 'externalExecutionId') }),
    missionStatus,
    ...(input.deviceMissionId === undefined
      ? {}
      : { deviceMissionId: identifier(input.deviceMissionId, 'deviceMissionId') }),
    provenance: input.provenance,
    sourceContract: input.sourceContract,
    sourceRevision: identifier(input.sourceRevision, 'sourceRevision'),
    observedAt,
  });
  const linkId = `remote-provider-link-${hashCanonical({
    bindingId: normalized.bindingId,
    logicalInvocationId: normalized.logicalInvocationId,
    remoteTaskId: normalized.remoteTaskId,
  }).slice('sha256:'.length)}`;
  return Object.freeze({
    ...normalized,
    linkId,
    contentHash: hashCanonical(normalized),
  });
}

function identifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512 || containsControlCharacter(normalized))
    throw invalid(`${field} is invalid.`);
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(`${field} must be positive.`);
  return value;
}

function bareSha256(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw invalid(`${field} must be lowercase SHA-256.`);
  return value;
}

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value)
    throw invalid('observedAt must be a canonical timestamp.');
  return value;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function invalid(message: string): DomainError {
  return new DomainError('MCP_LOGICAL_INVOCATION_INVALID', message);
}
