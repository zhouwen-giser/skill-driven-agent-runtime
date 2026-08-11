import { z } from 'zod';

import type {
  CapabilityAuthorityReader,
  CapabilityAuthoritySnapshot,
  CurrentMcpProviderBindingAuthorityReader,
  CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../runtime-control-application/src/index.js';

const JsonSchema = z.json();
const DefinitionSchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    domain: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    successCriteria: z.array(JsonSchema),
    requiredEvidence: z.array(JsonSchema),
    effects: z.array(JsonSchema),
    artifacts: z.array(JsonSchema),
    constraints: z.array(JsonSchema),
    supportedModes: z.array(JsonSchema),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
    previousVersion: z.number().int().positive().optional(),
    createdBy: z.string().optional(),
    createdAt: z.iso.datetime({ offset: true }).optional(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const BindingSchema = z
  .object({
    bindingId: z.string().min(1),
    revision: z.number().int().positive(),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    implementationType: z.enum(['skill', 'plan_template']),
    implementationId: z.string().min(1),
    implementationVersion: z.string().min(1),
    role: z.enum(['primary', 'alternative', 'supporting', 'validation', 'recovery']),
    priority: z.number().int().nonnegative(),
    activationCondition: JsonSchema.optional(),
    providerPolicyOverride: JsonSchema.optional(),
    status: z.enum(['draft', 'active', 'suspended', 'retired']),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const BindingListSchema = z
  .object({
    items: z.array(BindingSchema),
    totalEstimate: z.number().int().nonnegative(),
    asOf: z.iso.datetime({ offset: true }),
  })
  .strict();

const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const HttpEndpointSchema = z.url().superRefine((value, context) => {
  const endpoint = new URL(value);
  if (
    (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  )
    context.addIssue({
      code: 'custom',
      message: 'Current MCP Binding endpoint must be an HTTP(S) URL without userinfo.',
    });
});
const CurrentMcpProviderBindingAuthoritySchema = z
  .object({
    observedAt: z.iso.datetime({ offset: true }),
    binding: z
      .object({
        bindingId: z.string().min(1),
        revision: z.number().int().positive(),
        localServerId: z.string().min(1),
        originType: z.enum(['direct', 'smpp_registry']),
        providerId: z.string().min(1),
        externalProviderId: z.string().min(1).optional(),
        externalServerId: z.string().min(1).optional(),
        registryRevision: z.number().int().positive().optional(),
        registryChecksum: ChecksumSchema.optional(),
        catalogRevision: z.string().min(1),
        catalogChecksum: ChecksumSchema,
        endpointRef: HttpEndpointSchema,
        availabilityValidUntil: z.iso.datetime({ offset: true }),
        catalogObservedAt: z.iso.datetime({ offset: true }),
        operationCount: z.number().int().nonnegative().max(1024),
      })
      .strict(),
    sourceCandidateLineage: z
      .object({
        smppSourceId: z.string().min(1),
        externalProviderId: z.string().min(1),
        externalServerId: z.string().min(1),
        registryRevision: z.number().int().positive(),
        registryChecksum: ChecksumSchema,
        nativeRevision: z.number().int().positive(),
        nativeChecksum: ChecksumSchema,
        projectionContract: z.literal('sdar-registry-v1'),
        candidateEndpoint: HttpEndpointSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((authority, context) => {
    const smpp = authority.binding.originType === 'smpp_registry';
    const hasAnySmppLineage =
      authority.binding.externalProviderId !== undefined ||
      authority.binding.externalServerId !== undefined ||
      authority.binding.registryRevision !== undefined ||
      authority.binding.registryChecksum !== undefined ||
      authority.sourceCandidateLineage !== undefined;
    const complete =
      authority.binding.externalProviderId !== undefined &&
      authority.binding.externalServerId !== undefined &&
      authority.binding.registryRevision !== undefined &&
      authority.binding.registryChecksum !== undefined &&
      authority.sourceCandidateLineage !== undefined;
    if ((smpp && !complete) || (!smpp && hasAnySmppLineage))
      context.addIssue({
        code: 'custom',
        message: 'Current SMPP Binding authority requires exact source/candidate lineage.',
      });
    const lineage = authority.sourceCandidateLineage;
    if (
      smpp &&
      lineage !== undefined &&
      (authority.binding.providerId !== authority.binding.externalProviderId ||
        lineage.externalProviderId !== authority.binding.externalProviderId ||
        lineage.externalServerId !== authority.binding.externalServerId ||
        lineage.registryRevision !== authority.binding.registryRevision ||
        lineage.registryChecksum !== authority.binding.registryChecksum ||
        lineage.candidateEndpoint !== authority.binding.endpointRef)
    )
      context.addIssue({
        code: 'custom',
        message: 'Current SMPP Binding and source/candidate lineage identities differ.',
      });
    if (Date.parse(authority.binding.availabilityValidUntil) <= Date.parse(authority.observedAt))
      context.addIssue({
        code: 'custom',
        message: 'Current MCP Binding availability has expired.',
      });
  });

export class HttpNodeControlCapabilityEvidenceReader
  implements CapabilityAuthorityReader, CurrentMcpProviderBindingAuthorityReader
{
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(input: Readonly<{ baseUrl: string; serviceToken: string }>) {
    this.#baseUrl = input.baseUrl.replace(/\/+$/u, '');
    this.#serviceToken = input.serviceToken;
  }

  async load(capabilityId: string, version: number): Promise<CapabilityAuthoritySnapshot> {
    const path = `/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/${String(version)}`;
    const [definitionResponse, bindingsResponse] = await Promise.all([
      globalThis.fetch(`${this.#baseUrl}${path}`, { headers: this.#headers() }),
      globalThis.fetch(`${this.#baseUrl}${path}/implementations?pageSize=200`, {
        headers: this.#headers(),
      }),
    ]);
    const definition = DefinitionSchema.parse(await responseJson(definitionResponse));
    const bindings = BindingListSchema.parse(await responseJson(bindingsResponse));
    if (definition.capabilityId !== capabilityId || definition.version !== version)
      throw new Error('NODE_CONTROL_CAPABILITY_IDENTITY_MISMATCH');
    return Object.freeze({
      definition: Object.freeze({
        capability_id: definition.capabilityId,
        version: definition.version,
        domain: definition.domain,
        name: definition.name,
        description: definition.description,
        input_schema: definition.inputSchema,
        output_schema: definition.outputSchema,
        success_criteria: definition.successCriteria,
        required_evidence: definition.requiredEvidence,
        effects: definition.effects,
        artifacts: definition.artifacts,
        constraints: definition.constraints,
        supported_modes: definition.supportedModes,
        risk_level: definition.riskLevel,
        status: definition.status,
        definition_hash: definition.definitionHash,
        previous_version: definition.previousVersion ?? null,
        created_by: definition.createdBy ?? null,
        created_at: definition.createdAt ?? null,
        updated_at: definition.updatedAt,
      }),
      implementationBindings: Object.freeze(
        bindings.items.map((binding) =>
          Object.freeze({
            binding_id: binding.bindingId,
            revision: binding.revision,
            capability_id: binding.capabilityId,
            capability_version: binding.capabilityVersion,
            implementation_type: binding.implementationType,
            implementation_id: binding.implementationId,
            implementation_version: binding.implementationVersion,
            role: binding.role,
            priority: binding.priority,
            activation_condition: binding.activationCondition ?? null,
            provider_policy_override: binding.providerPolicyOverride ?? null,
            status: binding.status,
            created_at: binding.createdAt,
          }),
        ),
      ),
    });
  }

  async loadCurrentMcpProviderBinding(
    input: Readonly<{ bindingId?: string; localServerId: string }>,
  ): Promise<CurrentMcpProviderBindingAuthoritySnapshot> {
    const query = new URLSearchParams({ localServerId: input.localServerId });
    if (input.bindingId !== undefined) query.set('bindingId', input.bindingId);
    const response = await globalThis.fetch(
      `${this.#baseUrl}/internal/v1/mcp-provider-bindings/current?${query.toString()}`,
      { headers: this.#headers() },
    );
    const authority = CurrentMcpProviderBindingAuthoritySchema.parse(await responseJson(response));
    return Object.freeze({
      observedAt: authority.observedAt,
      binding: Object.freeze({
        bindingId: authority.binding.bindingId,
        revision: authority.binding.revision,
        localServerId: authority.binding.localServerId,
        originType: authority.binding.originType,
        providerId: authority.binding.providerId,
        ...(authority.binding.externalProviderId === undefined
          ? {}
          : { externalProviderId: authority.binding.externalProviderId }),
        ...(authority.binding.externalServerId === undefined
          ? {}
          : { externalServerId: authority.binding.externalServerId }),
        ...(authority.binding.registryRevision === undefined
          ? {}
          : { registryRevision: authority.binding.registryRevision }),
        ...(authority.binding.registryChecksum === undefined
          ? {}
          : { registryChecksum: authority.binding.registryChecksum }),
        catalogRevision: authority.binding.catalogRevision,
        catalogChecksum: authority.binding.catalogChecksum,
        endpointRef: authority.binding.endpointRef,
        availabilityValidUntil: authority.binding.availabilityValidUntil,
        catalogObservedAt: authority.binding.catalogObservedAt,
        operationCount: authority.binding.operationCount,
      }),
      ...(authority.sourceCandidateLineage === undefined
        ? {}
        : { sourceCandidateLineage: Object.freeze(authority.sourceCandidateLineage) }),
    });
  }

  #headers(): Readonly<Record<string, string>> {
    return Object.freeze({ authorization: `Bearer ${this.#serviceToken}` });
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok)
    throw Object.assign(new Error('Node Control Capability Evidence read failed.'), {
      code: `NODE_CONTROL_CAPABILITY_HTTP_${String(response.status)}`,
      status: response.status,
    });
  return value;
}
