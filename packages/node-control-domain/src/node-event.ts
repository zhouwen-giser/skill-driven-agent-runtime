import { NodeControlDomainError } from './errors.js';

export const NODE_EVENT_TYPES = Object.freeze([
  'node.profile.changed',
  'node.health.changed',
  'node.configuration.revision_published',
  'node.configuration.revision_applied',
  'node.configuration.revision_rejected',
  'node.llm.provider_changed',
  'node.smpp.source_changed',
  'node.mcp.provider_binding_changed',
  'node.skill.version_changed',
  'node.plan_template.version_changed',
  'node.capability.version_published',
  'node.capability.version_suspended',
  'node.capability.version_deprecated',
  'node.capability.version_retired',
  'node.capability.readiness_changed',
  'node.a2a.exposure_changed',
  'node.agent_card.activated',
  'node.task.capability_bound',
  'node.management_operation.completed',
  'node.telemetry_export.status_changed',
] as const);

export type NodeEventType = (typeof NODE_EVENT_TYPES)[number];
export type NodeEventDataClassification = 'public' | 'internal' | 'restricted';

export interface NodeEventEnvelope {
  readonly eventId: string;
  readonly eventType: NodeEventType;
  readonly occurredAt: string;
  readonly recordedAt?: string;
  readonly nodeId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateRevision: number;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actorId?: string;
  readonly dataClassification?: NodeEventDataClassification;
  readonly payload: Readonly<Record<string, unknown>>;
}

const EVENT_TYPES = new Set<string>(NODE_EVENT_TYPES);
const SECRET_KEY = /(?:password|secret|token|credential|api[_-]?key|private[_-]?key)$/iu;

export function rehydrateNodeEventEnvelope(input: NodeEventEnvelope): NodeEventEnvelope {
  if (!EVENT_TYPES.has(input.eventType)) invalid('eventType is not in the frozen catalog.');
  if (!Number.isSafeInteger(input.aggregateRevision) || input.aggregateRevision < 1)
    invalid('aggregateRevision must be a positive safe integer.');
  timestamp(input.occurredAt, 'occurredAt');
  if (input.recordedAt !== undefined) timestamp(input.recordedAt, 'recordedAt');
  assertSecretFree(input.payload, 'payload', 0);
  return Object.freeze({
    eventId: required(input.eventId, 'eventId', 512),
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    ...(input.recordedAt === undefined ? {} : { recordedAt: input.recordedAt }),
    nodeId: required(input.nodeId, 'nodeId', 128),
    aggregateType: required(input.aggregateType, 'aggregateType', 256),
    aggregateId: required(input.aggregateId, 'aggregateId', 512),
    aggregateRevision: input.aggregateRevision,
    correlationId: required(input.correlationId, 'correlationId', 512),
    ...(input.causationId === undefined
      ? {}
      : { causationId: required(input.causationId, 'causationId', 512) }),
    ...(input.actorId === undefined ? {} : { actorId: required(input.actorId, 'actorId', 512) }),
    ...(input.dataClassification === undefined
      ? {}
      : { dataClassification: input.dataClassification }),
    payload: Object.freeze(structuredClone(input.payload)),
  });
}

function assertSecretFree(value: unknown, path: string, depth: number): void {
  if (depth > 32) invalid(`${path} exceeds the maximum nesting depth.`);
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries())
      assertSecretFree(nested, `${path}[${String(index)}]`, depth + 1);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) invalid(`${path} contains secret-shaped data.`);
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function required(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > maximum) invalid(`${field} is invalid.`);
  return normalized;
}

function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) invalid(`${field} must be an ISO timestamp.`);
}

function invalid(message: string): never {
  throw new NodeControlDomainError('NODE_EVENT_INVALID', message);
}
