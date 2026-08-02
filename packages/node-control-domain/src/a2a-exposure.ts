import { createHash } from 'node:crypto';

import type { JsonObject } from './configuration-revision.js';
import { NodeControlDomainError } from './errors.js';

export type A2aExposureVisibility = 'organization' | 'public';
export type A2aReadinessPublicationPolicy =
  'publish_when_available' | 'publish_degraded' | 'always_publish_with_status';
export type A2aExposureStatus = 'draft' | 'published' | 'suspended' | 'retired';
export type AgentCardRevisionStatus = 'candidate' | 'staged' | 'active' | 'rejected' | 'superseded';

export interface A2aExposureVersion {
  readonly exposureId: string;
  readonly version: number;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly agentSkillId: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly examples?: readonly string[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
  readonly requestSchema: JsonObject;
  readonly resultSchema: JsonObject;
  readonly visibility: A2aExposureVisibility;
  readonly requesterPolicy?: JsonObject;
  readonly readinessPublicationPolicy?: A2aReadinessPublicationPolicy;
  readonly status: A2aExposureStatus;
  readonly exposureHash: string;
}

export interface AgentCardRevision {
  readonly revision: number;
  readonly nodeId: string;
  readonly exposureRefs?: readonly string[];
  readonly contentHash: string;
  readonly capabilityCatalogHash: string;
  readonly status: AgentCardRevisionStatus;
  readonly generatedAt: string;
  readonly activatedAt?: string;
  readonly rejectionCode?: string;
}

export interface RuntimeAgentCardCandidate {
  readonly revision: AgentCardRevision;
  readonly card: JsonObject;
  readonly exposureSnapshots?: readonly A2aExposureVersion[];
}

const exposureStatuses = new Set<A2aExposureStatus>(['draft', 'published', 'suspended', 'retired']);
const readinessPolicies = new Set<A2aReadinessPublicationPolicy>([
  'publish_when_available',
  'publish_degraded',
  'always_publish_with_status',
]);
const sensitivePolicyKey = /(?:secret|credential|token|password|api.?key|authorization|cookie)/iu;

export function createA2aExposureVersion(
  input: Omit<A2aExposureVersion, 'exposureHash'> & Readonly<{ exposureHash?: string }>,
): A2aExposureVersion {
  const normalized = Object.freeze({
    exposureId: required(input.exposureId, 'exposureId'),
    version: positive(input.version, 'version'),
    capabilityId: required(input.capabilityId, 'capabilityId'),
    capabilityVersion: positive(input.capabilityVersion, 'capabilityVersion'),
    agentSkillId: required(input.agentSkillId, 'agentSkillId'),
    name: bounded(input.name, 256, 'name'),
    description: bounded(input.description, 2_048, 'description'),
    ...(input.tags === undefined ? {} : { tags: uniqueStrings(input.tags, 'tags') }),
    ...(input.examples === undefined ? {} : { examples: strings(input.examples, 'examples') }),
    ...(input.inputModes === undefined
      ? {}
      : { inputModes: uniqueStrings(input.inputModes, 'inputModes') }),
    ...(input.outputModes === undefined
      ? {}
      : { outputModes: uniqueStrings(input.outputModes, 'outputModes') }),
    requestSchema: freezeObject(input.requestSchema),
    resultSchema: freezeObject(input.resultSchema),
    visibility: input.visibility,
    ...(input.requesterPolicy === undefined
      ? {}
      : { requesterPolicy: safePolicy(input.requesterPolicy) }),
    ...(input.readinessPublicationPolicy === undefined
      ? {}
      : { readinessPublicationPolicy: readinessPolicy(input.readinessPublicationPolicy) }),
    status: exposureStatus(input.status),
  });
  const exposureHash = hashA2aExposure(normalized);
  if (input.exposureHash !== undefined && input.exposureHash !== exposureHash)
    invalid('exposureHash does not match canonical exposure content.');
  return Object.freeze({ ...normalized, exposureHash });
}

export function hashA2aExposure(
  input: Omit<A2aExposureVersion, 'exposureHash' | 'status'> &
    Partial<Pick<A2aExposureVersion, 'status'>>,
): string {
  return createHash('sha256')
    .update(
      canonical({
        exposureId: input.exposureId,
        version: input.version,
        capabilityId: input.capabilityId,
        capabilityVersion: input.capabilityVersion,
        agentSkillId: input.agentSkillId,
        name: input.name,
        description: input.description,
        tags: input.tags ?? [],
        examples: input.examples ?? [],
        inputModes: input.inputModes ?? [],
        outputModes: input.outputModes ?? [],
        requestSchema: input.requestSchema,
        resultSchema: input.resultSchema,
        visibility: input.visibility,
        requesterPolicy: input.requesterPolicy ?? {},
        readinessPublicationPolicy: input.readinessPublicationPolicy ?? 'publish_when_available',
      }),
    )
    .digest('hex');
}

export function a2aExposureEtag(exposure: A2aExposureVersion): string {
  return `"a2a-exposure:${exposure.exposureId}:${String(exposure.version)}:${exposure.status}:${exposure.exposureHash}"`;
}

export function assertA2aExposureTransition(
  prior: A2aExposureVersion,
  nextStatus: A2aExposureStatus,
): void {
  const allowed =
    (prior.status === 'draft' && nextStatus === 'published') ||
    (prior.status === 'published' && (nextStatus === 'suspended' || nextStatus === 'retired')) ||
    (prior.status === 'suspended' && (nextStatus === 'published' || nextStatus === 'retired'));
  if (!allowed) invalid(`Exposure transition ${prior.status} -> ${nextStatus} is invalid.`);
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512) invalid(`${field} is invalid.`);
  return normalized;
}

function bounded(value: string, maximum: number, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) invalid(`${field} is invalid.`);
  return normalized;
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${field} must be a positive integer.`);
  return value;
}

function strings(values: readonly string[], field: string): readonly string[] {
  if (values.length > 100) invalid(`${field} has too many values.`);
  return Object.freeze(values.map((value) => bounded(value, 512, field)));
}

function uniqueStrings(values: readonly string[], field: string): readonly string[] {
  const normalized = strings(values, field);
  if (new Set(normalized).size !== normalized.length) invalid(`${field} must be unique.`);
  return normalized;
}

function readinessPolicy(value: A2aReadinessPublicationPolicy): A2aReadinessPublicationPolicy {
  if (!readinessPolicies.has(value)) invalid('readinessPublicationPolicy is invalid.');
  return value;
}

function exposureStatus(value: A2aExposureStatus): A2aExposureStatus {
  if (!exposureStatuses.has(value)) invalid('status is invalid.');
  return value;
}

function safePolicy(value: JsonObject): JsonObject {
  for (const key of Object.keys(value)) {
    if (sensitivePolicyKey.test(key)) invalid('requesterPolicy contains a sensitive key.');
  }
  return freezeObject(value);
}

function freezeObject(value: JsonObject): JsonObject {
  return Object.freeze(structuredClone(value));
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}

function invalid(message: string): never {
  throw new NodeControlDomainError('A2A_EXPOSURE_INVALID', message);
}
