import { z } from 'zod';

import type {
  CapabilityAuthorityReader,
  CapabilityAuthoritySnapshot,
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

export class HttpNodeControlCapabilityEvidenceReader implements CapabilityAuthorityReader {
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
