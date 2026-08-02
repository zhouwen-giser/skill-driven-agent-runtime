import { createHash } from 'node:crypto';

import { NodeControlDomainError } from './errors.js';
import type { JsonObject, JsonValue } from './configuration-revision.js';

export type NodeCapabilityStatus =
  'draft' | 'validating' | 'published' | 'suspended' | 'deprecated' | 'retired';
export type CapabilityImplementationType = 'skill' | 'plan_template';
export type CapabilityImplementationRole =
  'primary' | 'alternative' | 'supporting' | 'validation' | 'recovery';
export type CapabilityImplementationStatus = 'draft' | 'active' | 'suspended' | 'retired';

export interface NodeCapabilityDefinitionVersion {
  readonly capabilityId: string;
  readonly version: number;
  readonly domain: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly successCriteria: readonly JsonObject[];
  readonly requiredEvidence: readonly JsonObject[];
  readonly effects?: readonly string[];
  readonly artifacts?: readonly string[];
  readonly constraints?: readonly JsonObject[];
  readonly supportedModes?: readonly string[];
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
  readonly status: NodeCapabilityStatus;
  readonly definitionHash: string;
  readonly previousVersion?: number;
  readonly createdBy?: string;
  readonly createdAt?: string;
}

export interface CapabilityImplementationBinding {
  readonly bindingId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly implementationType: CapabilityImplementationType;
  readonly implementationId: string;
  readonly implementationVersion: string;
  readonly role: CapabilityImplementationRole;
  readonly priority: number;
  readonly activationCondition?: JsonValue;
  readonly providerPolicyOverride?: JsonValue;
  readonly status: CapabilityImplementationStatus;
  readonly revision: number;
}

const risks = new Set(['low', 'medium', 'high', 'critical']);
const capabilityStatuses = new Set<NodeCapabilityStatus>([
  'draft',
  'validating',
  'published',
  'suspended',
  'deprecated',
  'retired',
]);
const implementationTypes = new Set<CapabilityImplementationType>(['skill', 'plan_template']);
const roles = new Set<CapabilityImplementationRole>([
  'primary',
  'alternative',
  'supporting',
  'validation',
  'recovery',
]);
const implementationStatuses = new Set<CapabilityImplementationStatus>([
  'draft',
  'active',
  'suspended',
  'retired',
]);

export function createNodeCapabilityDefinition(
  input: Omit<NodeCapabilityDefinitionVersion, 'definitionHash'> &
    Readonly<{ definitionHash?: string }>,
): NodeCapabilityDefinitionVersion {
  const definition = normalizeDefinition(input);
  const definitionHash = hashNodeCapabilityDefinition(definition);
  if (input.definitionHash !== undefined && input.definitionHash !== definitionHash)
    invalid('definitionHash does not match canonical business promises.');
  return Object.freeze({ ...definition, definitionHash });
}

export function hashNodeCapabilityDefinition(
  input: Omit<NodeCapabilityDefinitionVersion, 'definitionHash' | 'status'> &
    Partial<Pick<NodeCapabilityDefinitionVersion, 'status'>>,
): string {
  const authoritative = {
    capabilityId: input.capabilityId,
    version: input.version,
    domain: input.domain,
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    successCriteria: input.successCriteria,
    requiredEvidence: input.requiredEvidence,
    effects: input.effects ?? [],
    artifacts: input.artifacts ?? [],
    constraints: input.constraints ?? [],
    supportedModes: input.supportedModes ?? [],
    riskLevel: input.riskLevel,
    previousVersion: input.previousVersion ?? null,
  };
  return createHash('sha256').update(canonical(authoritative)).digest('hex');
}

export function createCapabilityImplementationBinding(
  input: CapabilityImplementationBinding,
): CapabilityImplementationBinding {
  const bindingId = required(input.bindingId, 'bindingId');
  const capabilityId = required(input.capabilityId, 'capabilityId');
  positive(input.capabilityVersion, 'capabilityVersion');
  if (!implementationTypes.has(input.implementationType))
    invalid('implementationType must be skill or plan_template.');
  const implementationId = required(input.implementationId, 'implementationId');
  const implementationVersion = required(input.implementationVersion, 'implementationVersion');
  if (!roles.has(input.role)) invalid('role is unsupported.');
  if (!implementationStatuses.has(input.status)) invalid('implementation status is unsupported.');
  if (!Number.isSafeInteger(input.priority) || input.priority < 0)
    invalid('priority must be a non-negative safe integer.');
  positive(input.revision, 'revision');
  return Object.freeze({
    bindingId,
    capabilityId,
    capabilityVersion: input.capabilityVersion,
    implementationType: input.implementationType,
    implementationId,
    implementationVersion,
    role: input.role,
    priority: input.priority,
    ...(input.activationCondition === undefined
      ? {}
      : { activationCondition: freezeJson(input.activationCondition) }),
    ...(input.providerPolicyOverride === undefined
      ? {}
      : { providerPolicyOverride: freezeJson(input.providerPolicyOverride) }),
    status: input.status,
    revision: input.revision,
  });
}

export function assertNodeCapabilityPublishable(
  capability: NodeCapabilityDefinitionVersion,
  implementations: readonly CapabilityImplementationBinding[],
): void {
  const normalized = createNodeCapabilityDefinition(capability);
  if (normalized.status !== 'validating')
    invalid('Only a validating Capability Version can be published.');
  if (normalized.successCriteria.length === 0) invalid('successCriteria must not be empty.');
  if (normalized.requiredEvidence.length === 0) invalid('requiredEvidence must not be empty.');
  if (
    !implementations.some(
      (binding) =>
        binding.status === 'active' &&
        (binding.role === 'primary' || binding.role === 'alternative'),
    )
  )
    invalid('At least one active primary or alternative implementation is required.');
}

function normalizeDefinition(
  input: Omit<NodeCapabilityDefinitionVersion, 'definitionHash'> &
    Readonly<{ definitionHash?: string }>,
): Omit<NodeCapabilityDefinitionVersion, 'definitionHash'> {
  const capabilityId = required(input.capabilityId, 'capabilityId');
  positive(input.version, 'version');
  if (!risks.has(input.riskLevel)) invalid('riskLevel is unsupported.');
  if (!capabilityStatuses.has(input.status)) invalid('status is unsupported.');
  if (input.previousVersion !== undefined) {
    positive(input.previousVersion, 'previousVersion');
    if (input.previousVersion >= input.version) invalid('previousVersion must precede version.');
  }
  if (input.createdAt !== undefined && !Number.isFinite(Date.parse(input.createdAt)))
    invalid('createdAt must be an ISO 8601 timestamp.');
  return Object.freeze({
    capabilityId,
    version: input.version,
    domain: required(input.domain, 'domain'),
    name: required(input.name, 'name'),
    description: required(input.description, 'description'),
    inputSchema: object(input.inputSchema),
    outputSchema: object(input.outputSchema),
    successCriteria: objects(input.successCriteria),
    requiredEvidence: objects(input.requiredEvidence),
    ...(input.effects === undefined ? {} : { effects: strings(input.effects, 'effects') }),
    ...(input.artifacts === undefined ? {} : { artifacts: strings(input.artifacts, 'artifacts') }),
    ...(input.constraints === undefined ? {} : { constraints: objects(input.constraints) }),
    ...(input.supportedModes === undefined
      ? {}
      : { supportedModes: strings(input.supportedModes, 'supportedModes') }),
    riskLevel: input.riskLevel,
    status: input.status,
    ...(input.previousVersion === undefined ? {} : { previousVersion: input.previousVersion }),
    ...(input.createdBy === undefined ? {} : { createdBy: required(input.createdBy, 'createdBy') }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

function object(value: JsonObject): JsonObject {
  return freezeJson(value) as JsonObject;
}

function objects(values: readonly JsonObject[]): readonly JsonObject[] {
  return Object.freeze(
    values.map((value) => {
      if (Object.keys(value).length === 0) invalid('Business promise objects must not be empty.');
      return object(value);
    }),
  );
}

function strings(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value) => required(value, field));
  if (new Set(normalized).size !== normalized.length)
    invalid(`${field} must contain unique values.`);
  return Object.freeze(normalized);
}

function freezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeJson(item)])),
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 512)
    invalid(`${field} must contain between 1 and 512 characters.`);
  return normalized;
}

function positive(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    invalid(`${field} must be a positive safe integer.`);
}

function invalid(message: string): never {
  throw new NodeControlDomainError('NODE_CAPABILITY_INVALID', message);
}
