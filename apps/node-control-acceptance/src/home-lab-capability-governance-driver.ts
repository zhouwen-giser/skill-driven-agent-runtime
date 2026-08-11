import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  createNodeCapabilityDefinition,
  nodeCapabilityEtag,
  type CapabilityImplementationBinding,
  type JsonObject,
  type NodeCapabilityDefinitionVersion,
} from '../../../packages/node-control-domain/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const CREATED_AT = '2026-08-10T00:00:00.000Z';
const CAPABILITY_VERSION = 1;
const SKILL_VERSION = 1;
const MAIN_LIGHT_RESOURCE_ID = 'living-room-main-light';
const AUX_LIGHT_RESOURCE_ID = 'living-room-aux-light';
const CLIMATE_RESOURCE_ID = 'living-room-air-conditioner';
const COMPOSITE_CAPABILITY_ID = 'home.living-room.read-state';
const COMPOSITE_SKILL_ID = 'home.living-room.get-state';
const COMPOSITE_TASK_TYPE = 'living_room_read_state';

const PROVIDERS = Object.freeze({
  light: Object.freeze({
    bindingId: 'mcp-binding-ha-light-lab',
    tools: Object.freeze({
      light_get_state: 'synchronous_only',
      light_set_power: 'task_required',
    }),
  }),
  climate: Object.freeze({
    bindingId: 'mcp-binding-ha-climate-lab',
    tools: Object.freeze({
      climate_get_state: 'synchronous_only',
      climate_set_hvac_mode: 'task_required',
      climate_set_temperature: 'task_required',
    }),
  }),
});

const GOVERNANCE_SPECS = Object.freeze([
  Object.freeze({
    provider: 'light' as const,
    capabilityId: 'home.light.read-state',
    skillId: 'home.light.get-state',
    toolName: 'light_get_state',
    name: 'Read home light state',
    summary: 'Read the current state of an allowlisted home light.',
    riskLevel: 'low' as const,
    sideEffecting: false,
    effect: 'effect.home.light.state_read',
    evidence: Object.freeze(['light.state.observation']),
  }),
  Object.freeze({
    provider: 'light' as const,
    capabilityId: 'home.light.set-power',
    skillId: 'home.light.set-power',
    toolName: 'light_set_power',
    name: 'Set home light power',
    summary: 'Set power for an allowlisted home light with confirmation and restoration evidence.',
    riskLevel: 'high' as const,
    sideEffecting: true,
    effect: 'effect.home.light.power_changed',
    evidence: Object.freeze(['light.state.observation']),
  }),
  Object.freeze({
    provider: 'climate' as const,
    capabilityId: 'home.climate.read-state',
    skillId: 'home.climate.get-state',
    toolName: 'climate_get_state',
    name: 'Read home climate state',
    summary: 'Read the current state of the allowlisted home climate resource.',
    riskLevel: 'low' as const,
    sideEffecting: false,
    effect: 'effect.home.climate.state_read',
    evidence: Object.freeze(['climate.state.observation']),
  }),
  Object.freeze({
    provider: 'climate' as const,
    capabilityId: 'home.climate.set-hvac-mode',
    skillId: 'home.climate.set-hvac-mode',
    toolName: 'climate_set_hvac_mode',
    name: 'Set home climate HVAC mode',
    summary:
      'Set HVAC mode for the allowlisted climate resource with confirmation and restoration evidence.',
    riskLevel: 'high' as const,
    sideEffecting: true,
    effect: 'effect.home.climate.hvac_mode_changed',
    evidence: Object.freeze(['climate.hvac_mode.observation']),
  }),
  Object.freeze({
    provider: 'climate' as const,
    capabilityId: 'home.climate.set-temperature',
    skillId: 'home.climate.set-temperature',
    toolName: 'climate_set_temperature',
    name: 'Set home climate temperature',
    summary:
      'Set temperature for the allowlisted climate resource with confirmation and restoration evidence.',
    riskLevel: 'high' as const,
    sideEffecting: true,
    effect: 'effect.home.climate.temperature_changed',
    evidence: Object.freeze(['climate.target_temperature.observation']),
  }),
]);

const COMPOSITE_SPEC = Object.freeze({
  capabilityId: COMPOSITE_CAPABILITY_ID,
  skillId: COMPOSITE_SKILL_ID,
  name: 'Read living-room light and climate state',
  summary: 'Read the allowlisted living-room main light and climate state in one bounded Skill.',
  riskLevel: 'low' as const,
  sideEffecting: false,
  effect: 'effect.home.living-room.state_read',
  evidence: Object.freeze(['light.state.observation', 'climate.state.observation']),
});

type ProviderKind = keyof typeof PROVIDERS;
type GovernanceSpec = (typeof GOVERNANCE_SPECS)[number];

export interface HomeLabCapabilityGovernanceConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly packageWorkspaceRoot: string;
  readonly preflightReportFile: string;
  readonly preflightMaximumAgeMs?: number;
  readonly runId: string;
}

export interface HomeLabCapabilityGovernanceReport {
  readonly schemaVersion: 'sdar.home-lab-capability-governance/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly capabilityGovernanceReady: true;
  readonly runtimeCapabilityReadiness: 'available';
  readonly resourcePolicy: Readonly<{
    identifierAuthority: 'public_resource_id';
    auxiliaryLightIncluded: boolean;
    allowedResourceIds: readonly string[];
    physicalResourceBindings: 0;
  }>;
  readonly skills: readonly Readonly<{
    skillId: string;
    skillVersion: 1;
    taskType: string;
    mcpToolName?: string;
    mcpProviderBindingId?: string;
    localServerId?: string;
    mcpTools: readonly Readonly<{
      mcpToolName: string;
      mcpProviderBindingId: string;
      localServerId: string;
    }>[];
    maxMcpCalls: 1 | 2;
    packageChecksum: string;
    action: 'imported' | 'reconciled';
    status: 'published';
  }>[];
  readonly capabilities: readonly Readonly<{
    capabilityId: string;
    capabilityVersion: 1;
    definitionHash: string;
    implementationBindingId: string;
    skillId: string;
    skillVersion: 1;
    mcpProviderBindingId?: string;
    providerBindings: readonly Readonly<{
      mcpProviderBindingId: string;
      localServerId: string;
      mcpToolName: string;
    }>[];
    allowedResourceIds: readonly string[];
    riskLevel: 'low' | 'high';
    confirmation: 'not_required' | 'required';
    readiness: 'available';
    readinessValidUntil: string;
  }>[];
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

export class HomeLabCapabilityGovernanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HomeLabCapabilityGovernanceError';
    this.code = code;
  }
}

const BindingSchema = z
  .object({
    bindingId: z.string().min(1),
    localServerId: z.string().min(1),
    originType: z.literal('smpp_registry'),
    status: z.literal('active'),
    availabilityStatus: z.literal('available'),
    availabilityValidUntil: z.iso.datetime(),
    registryRevision: z.number().int().positive(),
    registryChecksum: z.string().regex(CHECKSUM),
    catalogRevision: z.string().min(1),
    catalogChecksum: z.string().regex(CHECKSUM),
  })
  .loose();

const JsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const ToolSchema = z
  .object({
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    protocolMode: z.literal('frozen_v1'),
    taskExecutionProfile: z
      .object({
        taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
      })
      .loose(),
  })
  .loose();

const RuntimeSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().min(1),
    capabilities: z.array(z.string()),
    workflowGuidance: z.string(),
    outputInstruction: z.string(),
    inputSchema: JsonSchema,
    outputSchema: JsonSchema,
    toolPolicy: z.record(z.string(), z.unknown()),
    runtimePolicy: z.record(z.string(), z.unknown()),
    status: z.string().min(1),
    sourceKind: z.string().min(1),
    validationPassed: z.boolean(),
    usageSpecification: z.record(z.string(), z.unknown()),
    outcomeSpecification: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .loose();

const GovernedSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.string().min(1), z.number().int().positive()]),
    status: z.literal('published'),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()),
    outcomeSpecification: z.record(z.string(), z.unknown()),
    providerPolicy: z.record(z.string(), z.unknown()),
    evidencePolicy: z.record(z.string(), z.unknown()),
  })
  .loose();

const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    domain: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    successCriteria: z.array(z.record(z.string(), z.unknown())),
    requiredEvidence: z.array(z.record(z.string(), z.unknown())),
    effects: z.array(z.string()).optional(),
    artifacts: z.array(z.string()).optional(),
    constraints: z.array(z.record(z.string(), z.unknown())).optional(),
    supportedModes: z.array(z.string()).optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string().regex(CHECKSUM),
    createdBy: z.string().optional(),
    createdAt: z.iso.datetime().optional(),
  })
  .strict();

const ImplementationSchema = z
  .object({
    bindingId: z.string().min(1),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    implementationType: z.literal('skill'),
    implementationId: z.string().min(1),
    implementationVersion: z.string().min(1),
    role: z.literal('primary'),
    priority: z.number().int().nonnegative(),
    providerPolicyOverride: z.unknown().optional(),
    status: z.literal('active'),
    revision: z.number().int().positive(),
  })
  .strict();

const OperationSchema = z
  .object({
    status: z.literal('succeeded'),
    errorCode: z.string().optional(),
    result: z.unknown().optional(),
  })
  .loose();

const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    status: z.enum(['available', 'degraded', 'unavailable', 'suspended']),
    validUntil: z.iso.datetime(),
    availableImplementations: z.array(z.string()),
    unavailableImplementations: z.array(z.string()),
    reasons: z
      .array(
        z
          .object({
            code: z.string().min(1),
            severity: z.enum(['info', 'warning', 'blocking']),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

type Binding = z.infer<typeof BindingSchema>;
type Tool = z.infer<typeof ToolSchema>;

interface HomeLabPreflightPolicy {
  readonly auxiliaryLightAvailable: boolean;
  readonly lightResourceIds: readonly string[];
  readonly climateResourceIds: readonly string[];
  readonly allResourceIds: readonly string[];
}

interface PreparedSingleGovernance {
  readonly kind: 'single';
  readonly spec: GovernanceSpec;
  readonly binding: Binding;
  readonly tool: Tool;
  readonly allowedResourceIds: readonly string[];
  readonly skill: Readonly<Record<string, unknown>>;
  readonly usage: Readonly<Record<string, unknown>>;
  readonly capability: NodeCapabilityDefinitionVersion;
  readonly implementation: CapabilityImplementationBinding;
  readonly existingRuntimeSkill?: z.infer<typeof RuntimeSkillSchema>;
  readonly existingCapability?: NodeCapabilityDefinitionVersion;
  readonly existingImplementation?: CapabilityImplementationBinding;
}

interface PreparedCompositeGovernance {
  readonly kind: 'composite';
  readonly spec: typeof COMPOSITE_SPEC;
  readonly bindings: readonly [Binding, Binding];
  readonly tools: readonly [Tool, Tool];
  readonly allowedResourceIds: readonly [typeof MAIN_LIGHT_RESOURCE_ID, typeof CLIMATE_RESOURCE_ID];
  readonly skill: Readonly<Record<string, unknown>>;
  readonly usage: Readonly<Record<string, unknown>>;
  readonly capability: NodeCapabilityDefinitionVersion;
  readonly implementation: CapabilityImplementationBinding;
  readonly existingRuntimeSkill?: z.infer<typeof RuntimeSkillSchema>;
  readonly existingCapability?: NodeCapabilityDefinitionVersion;
  readonly existingImplementation?: CapabilityImplementationBinding;
}

type PreparedGovernance = PreparedSingleGovernance | PreparedCompositeGovernance;

export async function governHomeLabCapabilities(
  input: HomeLabCapabilityGovernanceConfiguration,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
    delay?: (milliseconds: number) => Promise<void>;
  }> = {},
): Promise<HomeLabCapabilityGovernanceReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pause = dependencies.delay ?? delay;
  const observedAt = validTimestamp(now(), 'DRIVER_CLOCK_INVALID');
  const preflight = await loadPreflightPolicy(configuration, observedAt);
  const bindings = await loadBindings(configuration, observedAt, request);
  const tools = await loadTools(configuration, bindings, request);
  const prepared: PreparedGovernance[] = [];

  // Complete every drift and dependency check before the first authoritative API mutation.
  for (const spec of GOVERNANCE_SPECS) {
    const binding = bindings.get(spec.provider);
    const tool = tools.get(`${spec.provider}:${spec.toolName}`);
    if (binding === undefined || tool === undefined)
      fail('GOVERNANCE_DEPENDENCY_MISSING', 'A required governance dependency is missing.');
    const allowedResourceIds = resourcesFor(spec.provider, preflight);
    const skillContract = buildSkillContract(spec, binding, tool, allowedResourceIds);
    const capability = buildCapability(spec, binding, tool, allowedResourceIds);
    const implementation = buildImplementation(spec, binding, allowedResourceIds);
    assertSafeGovernanceJson({ skillContract, capability, implementation });
    const existingRuntimeSkill = await runtimeGetSkill(configuration, spec.skillId, request);
    if (existingRuntimeSkill !== undefined)
      assertRuntimeSkillExact(existingRuntimeSkill, skillContract);
    const existingCapability = await controlGetCapability(
      configuration,
      spec.capabilityId,
      request,
    );
    let existingImplementation: CapabilityImplementationBinding | undefined;
    if (existingCapability !== undefined) {
      assertCapabilityExact(existingCapability, capability);
      const implementations = await controlGetImplementations(
        configuration,
        spec.capabilityId,
        request,
      );
      if (implementations.length > 1)
        fail(
          'CAPABILITY_IMPLEMENTATION_AUTHORITY_AMBIGUOUS',
          'A governed Capability has more than one implementation binding.',
        );
      existingImplementation = implementations[0];
      if (existingImplementation !== undefined)
        assertImplementationExact(existingImplementation, implementation);
      if (existingCapability.status === 'published' && existingImplementation === undefined)
        fail(
          'CAPABILITY_IMPLEMENTATION_MISSING',
          'A published Capability is missing its exact Skill implementation.',
        );
    }
    prepared.push(
      Object.freeze({
        kind: 'single' as const,
        spec,
        binding,
        tool,
        allowedResourceIds,
        skill: skillContract.skill,
        usage: skillContract.usage,
        capability,
        implementation,
        ...(existingRuntimeSkill === undefined ? {} : { existingRuntimeSkill }),
        ...(existingCapability === undefined ? {} : { existingCapability }),
        ...(existingImplementation === undefined ? {} : { existingImplementation }),
      }),
    );
  }

  const lightBinding = bindings.get('light');
  const climateBinding = bindings.get('climate');
  const lightTool = tools.get('light:light_get_state');
  const climateTool = tools.get('climate:climate_get_state');
  if (
    lightBinding === undefined ||
    climateBinding === undefined ||
    lightTool === undefined ||
    climateTool === undefined
  )
    fail('GOVERNANCE_DEPENDENCY_MISSING', 'A composite governance dependency is missing.');
  const compositeSkillContract = buildCompositeSkillContract(
    lightBinding,
    climateBinding,
    lightTool,
    climateTool,
  );
  const compositeCapability = buildCompositeCapability(
    lightBinding,
    climateBinding,
    lightTool,
    climateTool,
  );
  const compositeImplementation = buildCompositeImplementation(
    lightBinding,
    climateBinding,
    lightTool,
    climateTool,
  );
  assertSafeGovernanceJson({
    skillContract: compositeSkillContract,
    capability: compositeCapability,
    implementation: compositeImplementation,
  });
  const existingCompositeRuntimeSkill = await runtimeGetSkill(
    configuration,
    COMPOSITE_SPEC.skillId,
    request,
  );
  if (existingCompositeRuntimeSkill !== undefined)
    assertRuntimeSkillExact(existingCompositeRuntimeSkill, compositeSkillContract);
  const existingCompositeCapability = await controlGetCapability(
    configuration,
    COMPOSITE_SPEC.capabilityId,
    request,
  );
  let existingCompositeImplementation: CapabilityImplementationBinding | undefined;
  if (existingCompositeCapability !== undefined) {
    assertCapabilityExact(existingCompositeCapability, compositeCapability);
    const implementations = await controlGetImplementations(
      configuration,
      COMPOSITE_SPEC.capabilityId,
      request,
    );
    if (implementations.length > 1)
      fail(
        'CAPABILITY_IMPLEMENTATION_AUTHORITY_AMBIGUOUS',
        'The composite Capability has more than one implementation binding.',
      );
    existingCompositeImplementation = implementations[0];
    if (existingCompositeImplementation !== undefined)
      assertImplementationExact(existingCompositeImplementation, compositeImplementation);
    if (
      existingCompositeCapability.status === 'published' &&
      existingCompositeImplementation === undefined
    )
      fail(
        'CAPABILITY_IMPLEMENTATION_MISSING',
        'The published composite Capability is missing its exact Skill implementation.',
      );
  }
  const compositeBindings: PreparedCompositeGovernance['bindings'] = Object.freeze([
    lightBinding,
    climateBinding,
  ]);
  const compositeTools: PreparedCompositeGovernance['tools'] = Object.freeze([
    lightTool,
    climateTool,
  ]);
  const compositeAllowedResourceIds: PreparedCompositeGovernance['allowedResourceIds'] =
    Object.freeze([MAIN_LIGHT_RESOURCE_ID, CLIMATE_RESOURCE_ID]);
  prepared.push(
    Object.freeze({
      kind: 'composite' as const,
      spec: COMPOSITE_SPEC,
      bindings: compositeBindings,
      tools: compositeTools,
      allowedResourceIds: compositeAllowedResourceIds,
      skill: compositeSkillContract.skill,
      usage: compositeSkillContract.usage,
      capability: compositeCapability,
      implementation: compositeImplementation,
      ...(existingCompositeRuntimeSkill === undefined
        ? {}
        : { existingRuntimeSkill: existingCompositeRuntimeSkill }),
      ...(existingCompositeCapability === undefined
        ? {}
        : { existingCapability: existingCompositeCapability }),
      ...(existingCompositeImplementation === undefined
        ? {}
        : { existingImplementation: existingCompositeImplementation }),
    }),
  );

  const skillReports: HomeLabCapabilityGovernanceReport['skills'][number][] = [];
  for (const item of prepared) {
    const packageResult = await materializeSkillPackage(
      configuration.packageWorkspaceRoot,
      item.spec,
      item.skill,
      item.usage,
    );
    const action = item.existingRuntimeSkill === undefined ? 'imported' : 'reconciled';
    if (item.existingRuntimeSkill === undefined) {
      OperationSchema.parse(
        await controlCommand(
          configuration,
          '/api/v1/skills/import',
          stableKey('skill-import', item.spec.skillId),
          {
            reason: `Import the exact governed ${item.spec.skillId}@1 Skill Package.`,
            payload: { packageRoot: packageResult.packageRoot },
          },
          request,
        ),
      );
    }
    OperationSchema.parse(
      await controlCommand(
        configuration,
        `/api/v1/skills/${encodeURIComponent(item.spec.skillId)}/versions/1/publish`,
        stableKey('skill-publish', item.spec.skillId),
        {
          reason: `Publish the exact governed ${item.spec.skillId}@1 Skill version.`,
          expectedRevision: 0,
        },
        request,
      ),
    );
    const runtimeSkill = await runtimeGetSkill(configuration, item.spec.skillId, request);
    if (runtimeSkill === undefined)
      fail('SKILL_MISSING_AFTER_GOVERNANCE', 'Runtime did not expose the exact Skill version.');
    assertRuntimeSkillExact(runtimeSkill, { skill: item.skill, usage: item.usage });
    const governed = GovernedSkillSchema.parse(
      await controlGet(
        configuration,
        `/api/v1/skills/${encodeURIComponent(item.spec.skillId)}/versions/1`,
        request,
      ),
    );
    assertGovernedSkillExact(governed, item.skill, item.usage);
    skillReports.push(
      item.kind === 'single'
        ? Object.freeze({
            skillId: item.spec.skillId,
            skillVersion: 1,
            taskType: item.spec.toolName,
            mcpToolName: item.spec.toolName,
            mcpProviderBindingId: item.binding.bindingId,
            localServerId: item.binding.localServerId,
            mcpTools: Object.freeze([
              Object.freeze({
                mcpToolName: item.spec.toolName,
                mcpProviderBindingId: item.binding.bindingId,
                localServerId: item.binding.localServerId,
              }),
            ]),
            maxMcpCalls: 1,
            packageChecksum: packageResult.packageChecksum,
            action,
            status: 'published',
          })
        : Object.freeze({
            skillId: item.spec.skillId,
            skillVersion: 1,
            taskType: COMPOSITE_TASK_TYPE,
            mcpTools: Object.freeze(
              item.tools.map((tool, index) =>
                Object.freeze({
                  mcpToolName: tool.toolName,
                  mcpProviderBindingId: item.bindings[index]?.bindingId ?? '',
                  localServerId: tool.serverId,
                }),
              ),
            ),
            maxMcpCalls: 2,
            packageChecksum: packageResult.packageChecksum,
            action,
            status: 'published',
          }),
    );
  }

  const readinessTargets: PreparedGovernance[] = [];
  for (const item of prepared) {
    let capability = item.existingCapability;
    capability ??= CapabilitySchema.parse(
      await controlCreate(
        configuration,
        '/api/v1/node-capabilities',
        stableKey('capability-create', item.spec.capabilityId),
        item.capability,
        request,
      ),
    ) as NodeCapabilityDefinitionVersion;
    if (item.existingImplementation === undefined) {
      await controlCreate(
        configuration,
        `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/1/implementations`,
        stableKey('capability-implementation', item.spec.capabilityId),
        item.implementation,
        request,
      );
    }
    if (capability.status === 'draft') {
      capability = CapabilitySchema.parse(
        await controlMutation(
          configuration,
          `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/1/validate`,
          stableKey('capability-validate', item.spec.capabilityId),
          { reason: `Validate the exact governed ${item.spec.capabilityId}@1 Capability.` },
          nodeCapabilityEtag(capability),
          200,
          request,
        ),
      ) as NodeCapabilityDefinitionVersion;
    }
    if (capability.status === 'validating') {
      OperationSchema.parse(
        await controlMutation(
          configuration,
          `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/1/publish`,
          stableKey('capability-publish', item.spec.capabilityId),
          { reason: `Publish the exact governed ${item.spec.capabilityId}@1 Capability.` },
          nodeCapabilityEtag(capability),
          202,
          request,
        ),
      );
    } else if (capability.status !== 'published') {
      fail('CAPABILITY_LIFECYCLE_INVALID', 'Capability lifecycle is not publishable.');
    }
    const published = await controlGetCapability(configuration, item.spec.capabilityId, request);
    if (published?.status !== 'published')
      fail('CAPABILITY_NOT_PUBLISHED', 'Capability publication was not observable.');
    assertCapabilityExact(published, item.capability);
    readinessTargets.push(item);
  }

  const readinessByCapability = await evaluateCapabilityReadiness(
    readinessTargets,
    configuration,
    request,
    pause,
  );
  const capabilityReports = readinessTargets.map((item) => {
    const readiness = readinessByCapability.get(item.spec.capabilityId);
    if (readiness === undefined)
      return fail('CAPABILITY_READINESS_MISSING', 'Capability readiness was not recorded.');
    requireFresh(
      readiness.validUntil,
      validTimestamp(now(), 'DRIVER_CLOCK_INVALID'),
      'CAPABILITY_READINESS_EXPIRED',
    );
    return Object.freeze({
      capabilityId: item.spec.capabilityId,
      capabilityVersion: 1,
      definitionHash: item.capability.definitionHash,
      implementationBindingId: item.implementation.bindingId,
      skillId: item.spec.skillId,
      skillVersion: 1,
      ...(item.kind === 'single' ? { mcpProviderBindingId: item.binding.bindingId } : {}),
      providerBindings: Object.freeze(
        item.kind === 'single'
          ? [
              Object.freeze({
                mcpProviderBindingId: item.binding.bindingId,
                localServerId: item.binding.localServerId,
                mcpToolName: item.spec.toolName,
              }),
            ]
          : item.tools.map((tool, index) =>
              Object.freeze({
                mcpProviderBindingId: item.bindings[index]?.bindingId ?? '',
                localServerId: tool.serverId,
                mcpToolName: tool.toolName,
              }),
            ),
      ),
      allowedResourceIds: item.allowedResourceIds,
      riskLevel: item.spec.riskLevel,
      confirmation: item.spec.sideEffecting ? 'required' : 'not_required',
      readiness: 'available',
      readinessValidUntil: readiness.validUntil,
    });
  });

  const report: HomeLabCapabilityGovernanceReport = Object.freeze({
    schemaVersion: 'sdar.home-lab-capability-governance/v1',
    status: 'passed',
    observedAt,
    capabilityGovernanceReady: true,
    runtimeCapabilityReadiness: 'available',
    resourcePolicy: Object.freeze({
      identifierAuthority: 'public_resource_id',
      auxiliaryLightIncluded: preflight.auxiliaryLightAvailable,
      allowedResourceIds: preflight.allResourceIds,
      physicalResourceBindings: 0,
    }),
    skills: Object.freeze(skillReports),
    capabilities: Object.freeze(capabilityReports),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
  assertSafeGovernanceJson(report);
  return report;
}

async function evaluateCapabilityReadiness(
  targets: readonly PreparedGovernance[],
  configuration: HomeLabCapabilityGovernanceConfiguration,
  request: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
): Promise<ReadonlyMap<string, z.infer<typeof ReadinessSchema>>> {
  const completed = new Map<string, z.infer<typeof ReadinessSchema>>();
  let pending = [...targets];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const next: PreparedGovernance[] = [];
    for (const item of pending) {
      const readinessOperation = OperationSchema.parse(
        await controlCommand(
          configuration,
          `/api/v1/capability-readiness/${encodeURIComponent(item.spec.capabilityId)}/1/evaluate`,
          runKey(
            configuration.runId,
            `capability-readiness-${String(attempt)}`,
            item.spec.capabilityId,
          ),
          { reason: `Evaluate exact Runtime readiness for ${item.spec.capabilityId}@1.` },
          request,
        ),
      );
      const readiness = ReadinessSchema.parse(readinessOperation.result);
      const exactImplementations =
        readiness.capabilityId === item.spec.capabilityId &&
        readiness.capabilityVersion === 1 &&
        readiness.availableImplementations.length === 1 &&
        readiness.availableImplementations[0] === item.implementation.bindingId &&
        readiness.unavailableImplementations.length === 0;
      if (readiness.status === 'available' && exactImplementations) {
        completed.set(item.spec.capabilityId, readiness);
        continue;
      }
      const reasons = readiness.reasons ?? [];
      if (
        readiness.status === 'unavailable' &&
        exactImplementations &&
        reasons.some(({ code }) => code === 'READINESS_STABILITY_WINDOW') &&
        reasons.every(({ severity }) => severity !== 'blocking')
      ) {
        next.push(item);
        continue;
      }
      fail('CAPABILITY_READINESS_NOT_EXACT', 'Capability readiness is not exact and available.');
    }
    if (next.length === 0) return completed;
    if (attempt === 2)
      fail(
        'CAPABILITY_READINESS_STABILITY_TIMEOUT',
        'Capability readiness did not leave its bounded stability window.',
      );
    await pause(10_250);
    pending = next;
  }
  return fail('CAPABILITY_READINESS_MISSING', 'Capability readiness was not recorded.');
}

export async function configurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<
  Readonly<{
    configuration: HomeLabCapabilityGovernanceConfiguration;
    reportFile: string;
  }>
> {
  return Object.freeze({
    configuration: Object.freeze({
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_NODE_CONTROL_URL'),
      nodeControlBearerToken: await secretFromEnvironment(
        environment,
        'SDAR_HOME_LAB_NODE_CONTROL_TOKEN',
      ),
      runtimeManagementBaseUrl: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUNTIME_URL'),
      packageWorkspaceRoot: requiredEnvironment(
        environment,
        'SDAR_HOME_LAB_GOVERNANCE_PACKAGE_ROOT',
      ),
      preflightReportFile: requiredEnvironment(
        environment,
        'SDAR_HOME_LAB_HA_PREFLIGHT_REPORT_FILE',
      ),
      preflightMaximumAgeMs: optionalPositiveInteger(
        environment,
        'SDAR_HOME_LAB_HA_PREFLIGHT_MAXIMUM_AGE_MS',
        86_400_000,
      ),
      runId: requiredEnvironment(environment, 'SDAR_HOME_LAB_RUN_ID'),
    }),
    reportFile:
      environment['SDAR_HOME_LAB_GOVERNANCE_REPORT_FILE'] ??
      'reports/sdar-smpp-integration/home-lab-capability-governance.redacted.json',
  });
}

export async function writeRedactedGovernanceReport(
  reportFile: string,
  report: HomeLabCapabilityGovernanceReport,
): Promise<void> {
  const target = resolve(reportFile);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, target);
}

function validateConfiguration(
  input: HomeLabCapabilityGovernanceConfiguration,
): HomeLabCapabilityGovernanceConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  if (input.nodeControlBearerToken.trim() === '')
    fail('DRIVER_CONFIGURATION_INVALID', 'Node Control bearer token is required.');
  if (input.runId.trim().length < 8 || input.runId.length > 128)
    fail('DRIVER_CONFIGURATION_INVALID', 'A bounded unique runId is required.');
  if (!isAbsolute(input.packageWorkspaceRoot))
    fail('DRIVER_CONFIGURATION_INVALID', 'Skill Package workspace root must be absolute.');
  if (!isAbsolute(input.preflightReportFile))
    fail('DRIVER_CONFIGURATION_INVALID', 'Preflight report path must be absolute.');
  const preflightMaximumAgeMs = input.preflightMaximumAgeMs ?? 86_400_000;
  if (
    !Number.isSafeInteger(preflightMaximumAgeMs) ||
    preflightMaximumAgeMs < 60_000 ||
    preflightMaximumAgeMs > 86_400_000
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Preflight maximum age must be 1 minute to 24 hours.');
  return Object.freeze({
    ...input,
    nodeControlBaseUrl,
    runtimeManagementBaseUrl,
    packageWorkspaceRoot: resolve(input.packageWorkspaceRoot),
    preflightReportFile: resolve(input.preflightReportFile),
    preflightMaximumAgeMs,
  });
}

async function loadPreflightPolicy(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  observedAt: string,
): Promise<HomeLabPreflightPolicy> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await readFile(configuration.preflightReportFile, 'utf8')) as unknown;
  } catch {
    return fail(
      'PREFLIGHT_EVIDENCE_UNAVAILABLE',
      'Read-only HA Preflight evidence is unavailable.',
    );
  }
  const parsed = z
    .object({
      evidenceClass: z.literal('real'),
      phase: z.literal('P1_HA_READ_ONLY_PREFLIGHT'),
      completedAt: z.iso.datetime(),
      status: z.literal('passed'),
      readOnly: z.literal(true),
      sideEffectsAttempted: z.literal(false),
      environment: z.literal('home-lab'),
      resources: z.array(
        z
          .object({
            resourceId: z.enum([
              MAIN_LIGHT_RESOURCE_ID,
              AUX_LIGHT_RESOURCE_ID,
              CLIMATE_RESOURCE_ID,
            ]),
            domain: z.enum(['light', 'climate']),
            reachable: z.literal(true),
            observedAt: z.iso.datetime({ offset: true }),
          })
          .loose(),
      ),
    })
    .loose()
    .safeParse(parsedJson);
  if (!parsed.success)
    return fail(
      'PREFLIGHT_EVIDENCE_INVALID',
      'Read-only HA Preflight evidence did not pass its strict policy projection.',
    );
  const completedAt = Date.parse(parsed.data.completedAt);
  const currentTime = Date.parse(observedAt);
  if (
    completedAt > currentTime ||
    currentTime - completedAt > (configuration.preflightMaximumAgeMs ?? 86_400_000)
  )
    fail('PREFLIGHT_EVIDENCE_EXPIRED', 'Read-only HA Preflight evidence is not current.');
  const exact = (
    resourceId:
      typeof MAIN_LIGHT_RESOURCE_ID | typeof AUX_LIGHT_RESOURCE_ID | typeof CLIMATE_RESOURCE_ID,
    domain: 'light' | 'climate',
    required: boolean,
  ) => {
    const matches = parsed.data.resources.filter(
      (resource) => resource.resourceId === resourceId && resource.domain === domain,
    );
    if (matches.length > 1 || (required && matches.length !== 1))
      fail(
        'PREFLIGHT_RESOURCE_AUTHORITY_INVALID',
        'Preflight public Resource authority is not exact.',
      );
    return matches.length === 1;
  };
  exact(MAIN_LIGHT_RESOURCE_ID, 'light', true);
  exact(CLIMATE_RESOURCE_ID, 'climate', true);
  const auxiliaryLightAvailable = exact(AUX_LIGHT_RESOURCE_ID, 'light', false);
  const lightResourceIds = Object.freeze([
    MAIN_LIGHT_RESOURCE_ID,
    ...(auxiliaryLightAvailable ? [AUX_LIGHT_RESOURCE_ID] : []),
  ]);
  const climateResourceIds = Object.freeze([CLIMATE_RESOURCE_ID]);
  return Object.freeze({
    auxiliaryLightAvailable,
    lightResourceIds,
    climateResourceIds,
    allResourceIds: Object.freeze([
      MAIN_LIGHT_RESOURCE_ID,
      CLIMATE_RESOURCE_ID,
      ...(auxiliaryLightAvailable ? [AUX_LIGHT_RESOURCE_ID] : []),
    ]),
  });
}

async function loadBindings(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  observedAt: string,
  request: typeof fetch,
): Promise<ReadonlyMap<ProviderKind, Binding>> {
  const result = new Map<ProviderKind, Binding>();
  for (const provider of Object.keys(PROVIDERS) as ProviderKind[]) {
    const expected = PROVIDERS[provider];
    const binding = BindingSchema.parse(
      await controlGet(
        configuration,
        `/api/v1/mcp-provider-bindings/${encodeURIComponent(expected.bindingId)}`,
        request,
      ),
    );
    if (binding.bindingId !== expected.bindingId)
      fail('PROVIDER_BINDING_IDENTITY_MISMATCH', 'Provider Binding identity is not exact.');
    requireFresh(binding.availabilityValidUntil, observedAt, 'PROVIDER_BINDING_FRESHNESS_EXPIRED');
    result.set(provider, binding);
  }
  return result;
}

async function loadTools(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  bindings: ReadonlyMap<ProviderKind, Binding>,
  request: typeof fetch,
): Promise<ReadonlyMap<string, Tool>> {
  const result = new Map<string, Tool>();
  for (const provider of Object.keys(PROVIDERS) as ProviderKind[]) {
    const binding = bindings.get(provider);
    if (binding === undefined)
      fail('PROVIDER_BINDING_MISSING', 'Provider Binding disappeared during preflight.');
    const collection = z
      .object({ items: z.array(ToolSchema) })
      .loose()
      .parse(
        await runtimeGet(
          configuration,
          `/api/v1/mcp/servers/${encodeURIComponent(binding.localServerId)}/tools`,
          request,
        ),
      );
    for (const [toolName, taskBehavior] of Object.entries(PROVIDERS[provider].tools)) {
      const [tool, ...duplicates] = collection.items.filter(
        (candidate) => candidate.toolName === toolName,
      );
      if (tool === undefined || duplicates.length !== 0)
        fail('MCP_TOOL_IDENTITY_NOT_EXACT', 'Expected exactly one case-sensitive MCP Tool name.');
      if (
        tool.serverId !== binding.localServerId ||
        tool.taskExecutionProfile.taskBehavior !== taskBehavior
      )
        fail('MCP_TOOL_CONTRACT_NOT_EXACT', 'MCP Tool server or taskBehavior is not exact.');
      requireObjectSchema(tool.inputSchema, 'MCP_TOOL_INPUT_SCHEMA_INVALID');
      requireObjectSchema(tool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID');
      assertSafeGovernanceJson({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema });
      result.set(`${provider}:${toolName}`, tool);
    }
  }
  return result;
}

function buildSkillContract(
  spec: GovernanceSpec,
  binding: Binding,
  tool: Tool,
  allowedResourceIds: readonly string[],
): Readonly<{
  skill: Readonly<Record<string, unknown>>;
  usage: Readonly<Record<string, unknown>>;
}> {
  const inputSchema = constrainedInputSchema(tool.inputSchema, allowedResourceIds);
  const outputSchema = requireObjectSchema(tool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID');
  const confirmation = spec.sideEffecting
    ? `Require explicit confirmation before invoking ${spec.toolName}.`
    : undefined;
  const outcomeBase = Object.freeze({
    schemaVersion: '1.0',
    skillId: spec.skillId,
    skillVersion: 1,
    effects: Object.freeze([spec.effect]),
    evidence: spec.evidence,
    artifacts: Object.freeze([]),
    taskGoalPolicy: Object.freeze({
      taskType: spec.toolName,
      allowedResourceIds,
      mcpProviderBindingId: binding.bindingId,
      localServerId: binding.localServerId,
      mcpToolName: spec.toolName,
    }),
    confidencePolicy: Object.freeze({
      rejectSuccessWithoutRequiredEvidence: true,
      requireSchemaValidation: true,
    }),
    sideEffectPolicy: Object.freeze(
      spec.sideEffecting
        ? {
            sideEffecting: true,
            confirmation: 'required_before_execution',
            allowRealDeviceSideEffectsEnv: 'ALLOW_REAL_DEVICE_SIDE_EFFECTS',
            realDeviceTestRunIdEnv: 'REAL_DEVICE_TEST_RUN_ID',
            stateConfirmationRequired: true,
            restorationRequired: true,
          }
        : { sideEffecting: false, confirmation: 'not_required' },
    ),
  });
  const outcomeSpecification = Object.freeze({
    ...outcomeBase,
    specificationHash: `sha256:${sha256(stableStringify(outcomeBase))}`,
  });
  const skill = Object.freeze({
    skillId: spec.skillId,
    version: 1,
    name: spec.name,
    summary: spec.summary,
    description: `${spec.summary} The execution path is restricted to ${binding.bindingId} and ${spec.toolName}.`,
    capabilities: Object.freeze([spec.capabilityId]),
    workflowGuidance: `Use exactly ${spec.toolName}; bind resourceId only from the declared public allowlist; reject aliases and Provider fallback.`,
    outputInstruction:
      'Return only schema-valid structured output with the declared evidence references.',
    inputSchema,
    outputSchema,
    toolPolicy: Object.freeze({
      required: Object.freeze([
        Object.freeze({ serverId: binding.localServerId, toolName: spec.toolName }),
      ]),
      optional: Object.freeze([]),
      forbidden: Object.freeze([]),
    }),
    runtimePolicy: Object.freeze({
      autoConfirmPlan: false,
      maxReplans: 0,
      maxDurationSeconds: spec.sideEffecting ? 300 : 60,
      maxLlmCalls: 0,
      maxMcpCalls: 1,
      cancelStrategy: 'wait_current',
      ...(spec.sideEffecting
        ? {
            compensationGuidance:
              'Restore the captured baseline state and record restoration evidence.',
          }
        : {}),
    }),
    outcomeSpecification,
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: CREATED_AT,
  });
  const usage = Object.freeze({
    visibility: Object.freeze({ userSelectable: true, composable: true, internalOnly: false }),
    normative: Object.freeze({
      constraints: Object.freeze([
        `Use only public resource IDs: ${allowedResourceIds.join(', ')}.`,
        `Require active, available and fresh Provider Binding ${binding.bindingId}.`,
        `Use exact Skill version ${spec.skillId}@1 and exact MCP Tool ${spec.toolName}.`,
      ]),
      forbiddenActions: Object.freeze([
        'Resolve, persist or return Home Assistant entity IDs.',
        'Select a different MCP Provider Binding or use a Tool alias.',
        'Invoke a resource outside the declared public resource allowlist.',
      ]),
      requiredConfirmations: Object.freeze(confirmation === undefined ? [] : [confirmation]),
      noApplicableSkill: 'reject',
    }),
    contextRequirements: Object.freeze([
      Object.freeze({
        requirementId: 'public-resource-id',
        description: 'A public resourceId admitted by the current home-lab preflight policy.',
        required: true,
        sourceOrder: Object.freeze(['authoritative_context', 'user_input']),
      }),
      Object.freeze({
        requirementId: 'provider-binding-freshness',
        description: 'The exact Provider Binding must remain active, available and unexpired.',
        required: true,
        sourceOrder: Object.freeze(['authoritative_context']),
      }),
    ]),
    taskBindings: Object.freeze([
      Object.freeze({
        bindingId: `task-binding-${spec.skillId}-v1`,
        taskType: spec.toolName,
        providerPolicy: Object.freeze({
          selection: 'required',
          preferredProviderIds: Object.freeze([]),
          requiredProviderId: binding.localServerId,
          forbiddenProviderIds: Object.freeze([]),
          requiredAttributes: Object.freeze([
            `task_behavior:${tool.taskExecutionProfile.taskBehavior}`,
          ]),
        }),
      }),
    ]),
    adaptive: Object.freeze({
      instructions: Object.freeze([
        'Preserve the exact Provider Binding, Tool, Skill version and public resource policy.',
      ]),
      optimizationHints: Object.freeze([]),
      allowPreferredProviderFallback: false,
    }),
    modes: Object.freeze({
      supported: Object.freeze(['procedure']),
      defaultMode: 'procedure',
      procedure: Object.freeze({
        summary: 'Deterministic exact-version home-lab execution.',
        instructions: Object.freeze([
          'Validate resourceId, confirmation, Provider Binding freshness and required evidence.',
        ]),
      }),
    }),
    evidence: Object.freeze({
      requirements: Object.freeze(
        spec.evidence.map((evidenceType, index) =>
          Object.freeze({
            requirementId: `evidence-${String(index + 1)}`,
            evidenceType,
            required: true,
            hardGate: true,
          }),
        ),
      ),
      rejectSuccessWithoutRequiredEvidence: true,
    }),
  });
  return Object.freeze({ skill, usage });
}

function buildCompositeSkillContract(
  lightBinding: Binding,
  climateBinding: Binding,
  lightTool: Tool,
  climateTool: Tool,
): Readonly<{
  skill: Readonly<Record<string, unknown>>;
  usage: Readonly<Record<string, unknown>>;
}> {
  const inputSchema = compositeInputSchema();
  const outputSchema = compositeOutputSchema(lightTool, climateTool);
  const providerBindings = Object.freeze([
    exactBindingPolicy(lightBinding, lightTool, Object.freeze([MAIN_LIGHT_RESOURCE_ID])),
    exactBindingPolicy(climateBinding, climateTool, Object.freeze([CLIMATE_RESOURCE_ID])),
  ]);
  const outcomeBase = Object.freeze({
    schemaVersion: '1.0',
    skillId: COMPOSITE_SPEC.skillId,
    skillVersion: 1,
    effects: Object.freeze([COMPOSITE_SPEC.effect]),
    evidence: COMPOSITE_SPEC.evidence,
    artifacts: Object.freeze([]),
    taskGoalPolicy: Object.freeze({
      taskType: COMPOSITE_TASK_TYPE,
      requestedCapabilityId: COMPOSITE_SPEC.capabilityId,
      mainLightResourceId: MAIN_LIGHT_RESOURCE_ID,
      climateResourceId: CLIMATE_RESOURCE_ID,
      providerBindings,
      requiredMcpCalls: 2,
    }),
    confidencePolicy: Object.freeze({
      rejectSuccessWithoutRequiredEvidence: true,
      requireSchemaValidation: true,
    }),
    sideEffectPolicy: Object.freeze({
      sideEffecting: false,
      confirmation: 'not_required',
      writesAllowed: false,
    }),
  });
  const outcomeSpecification = Object.freeze({
    ...outcomeBase,
    specificationHash: `sha256:${sha256(stableStringify(outcomeBase))}`,
  });
  const skill = Object.freeze({
    skillId: COMPOSITE_SPEC.skillId,
    version: 1,
    name: COMPOSITE_SPEC.name,
    summary: COMPOSITE_SPEC.summary,
    description:
      'Read exactly the living-room main light and climate public resources through both governed Provider Bindings.',
    capabilities: Object.freeze([COMPOSITE_SPEC.capabilityId]),
    workflowGuidance:
      'Call light_get_state once and climate_get_state once with their fixed public resource IDs, then return both structured results. Do not call any write Tool or LLM node.',
    outputInstruction:
      'Return a schema-valid object with mainLight and climate structured provider results.',
    inputSchema,
    outputSchema,
    toolPolicy: Object.freeze({
      required: Object.freeze([
        Object.freeze({ serverId: lightBinding.localServerId, toolName: lightTool.toolName }),
        Object.freeze({ serverId: climateBinding.localServerId, toolName: climateTool.toolName }),
      ]),
      optional: Object.freeze([]),
      forbidden: Object.freeze([
        Object.freeze({ serverId: lightBinding.localServerId, toolName: 'light_set_power' }),
        Object.freeze({ serverId: lightBinding.localServerId, toolName: 'light_set_brightness' }),
        Object.freeze({ serverId: climateBinding.localServerId, toolName: 'climate_set_power' }),
        Object.freeze({
          serverId: climateBinding.localServerId,
          toolName: 'climate_set_hvac_mode',
        }),
        Object.freeze({
          serverId: climateBinding.localServerId,
          toolName: 'climate_set_temperature',
        }),
      ]),
    }),
    runtimePolicy: Object.freeze({
      autoConfirmPlan: false,
      maxReplans: 0,
      maxDurationSeconds: 60,
      maxLlmCalls: 0,
      maxMcpCalls: 2,
      cancelStrategy: 'wait_current',
    }),
    outcomeSpecification,
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: CREATED_AT,
  });
  const usage = Object.freeze({
    visibility: Object.freeze({ userSelectable: true, composable: true, internalOnly: false }),
    normative: Object.freeze({
      constraints: Object.freeze([
        `Use exactly ${MAIN_LIGHT_RESOURCE_ID} and ${CLIMATE_RESOURCE_ID}.`,
        'Require both exact active, available, fresh Provider Bindings with no fallback.',
        'Invoke exactly light_get_state and climate_get_state once each; never invoke a write Tool.',
      ]),
      forbiddenActions: Object.freeze([
        'Resolve, persist or return Home Assistant entity IDs.',
        'Invoke any MCP Tool other than light_get_state and climate_get_state.',
        'Invoke any Tool with write or side-effect semantics.',
        'Select a different Provider Binding or use a Tool alias.',
      ]),
      requiredConfirmations: Object.freeze([]),
      noApplicableSkill: 'reject',
    }),
    // The exact resource values and both current Binding authorities are hard
    // gates at Capability admission. They are not duplicated as Workflow
    // context keys because no such runtime context authority is projected.
    contextRequirements: Object.freeze([]),
    taskBindings: Object.freeze([
      Object.freeze({
        bindingId: `task-binding-${COMPOSITE_SPEC.skillId}-light-v1`,
        taskType: lightTool.toolName,
        providerPolicy: Object.freeze({
          selection: 'required',
          preferredProviderIds: Object.freeze([]),
          requiredProviderId: lightBinding.localServerId,
          forbiddenProviderIds: Object.freeze([]),
          requiredAttributes: Object.freeze(['task_behavior:synchronous_only']),
        }),
      }),
      Object.freeze({
        bindingId: `task-binding-${COMPOSITE_SPEC.skillId}-climate-v1`,
        taskType: climateTool.toolName,
        providerPolicy: Object.freeze({
          selection: 'required',
          preferredProviderIds: Object.freeze([]),
          requiredProviderId: climateBinding.localServerId,
          forbiddenProviderIds: Object.freeze([]),
          requiredAttributes: Object.freeze(['task_behavior:synchronous_only']),
        }),
      }),
    ]),
    adaptive: Object.freeze({
      instructions: Object.freeze([
        'Preserve both exact Provider Bindings, Tool names, Skill version and fixed public resources.',
      ]),
      optimizationHints: Object.freeze([]),
      allowPreferredProviderFallback: false,
    }),
    modes: Object.freeze({
      supported: Object.freeze(['guidance']),
      defaultMode: 'guidance',
      guidance: Object.freeze({
        summary: 'Model-planned, policy-validated exact-two read-only living-room execution.',
        instructions: Object.freeze([
          'Generate the fixed two-read topology with both required evidence hard gates and preserve both results.',
        ]),
      }),
    }),
    evidence: Object.freeze({
      requirements: Object.freeze([
        Object.freeze({
          requirementId: 'evidence-light-state',
          evidenceType: 'light.state.observation',
          required: true,
          hardGate: true,
        }),
        Object.freeze({
          requirementId: 'evidence-climate-state',
          evidenceType: 'climate.state.observation',
          required: true,
          hardGate: true,
        }),
      ]),
      rejectSuccessWithoutRequiredEvidence: true,
    }),
  });
  return Object.freeze({ skill, usage });
}

function buildCompositeCapability(
  lightBinding: Binding,
  climateBinding: Binding,
  lightTool: Tool,
  climateTool: Tool,
): NodeCapabilityDefinitionVersion {
  return createNodeCapabilityDefinition({
    capabilityId: COMPOSITE_SPEC.capabilityId,
    version: CAPABILITY_VERSION,
    domain: 'home.living-room',
    name: COMPOSITE_SPEC.name,
    description: COMPOSITE_SPEC.summary,
    inputSchema: compositeInputSchema(),
    outputSchema: compositeOutputSchema(lightTool, climateTool),
    successCriteria: [
      Object.freeze({ type: 'output_schema_valid', required: true }),
      Object.freeze({ type: 'required_evidence_complete', required: true }),
    ],
    requiredEvidence: [
      Object.freeze({
        type: 'provider_result',
        field: 'mainLight',
        inputField: 'mainLightResourceId',
        serverId: lightBinding.localServerId,
        toolName: lightTool.toolName,
        evidenceType: 'light.state.observation',
        required: true,
        hardGate: true,
      }),
      Object.freeze({
        type: 'provider_result',
        field: 'climate',
        inputField: 'climateResourceId',
        serverId: climateBinding.localServerId,
        toolName: climateTool.toolName,
        evidenceType: 'climate.state.observation',
        required: true,
        hardGate: true,
      }),
    ],
    effects: [COMPOSITE_SPEC.effect],
    artifacts: [],
    constraints: [
      providerBindingConstraint(lightBinding, lightTool),
      providerBindingConstraint(climateBinding, climateTool),
      Object.freeze({ type: 'confirmation_policy', required: false, stage: 'not_applicable' }),
    ],
    supportedModes: ['deterministic'],
    riskLevel: COMPOSITE_SPEC.riskLevel,
    status: 'draft',
    createdBy: 'home-lab-governance-driver',
    createdAt: CREATED_AT,
  });
}

function buildCompositeImplementation(
  lightBinding: Binding,
  climateBinding: Binding,
  lightTool: Tool,
  climateTool: Tool,
): CapabilityImplementationBinding {
  return Object.freeze({
    bindingId: `capability-binding-${COMPOSITE_SPEC.capabilityId}-v1`,
    capabilityId: COMPOSITE_SPEC.capabilityId,
    capabilityVersion: CAPABILITY_VERSION,
    implementationType: 'skill',
    implementationId: COMPOSITE_SPEC.skillId,
    implementationVersion: String(SKILL_VERSION),
    role: 'primary',
    priority: 0,
    providerPolicyOverride: Object.freeze({
      selection: 'required_all',
      requirements: Object.freeze([
        exactBindingPolicy(lightBinding, lightTool, Object.freeze([MAIN_LIGHT_RESOURCE_ID])),
        exactBindingPolicy(climateBinding, climateTool, Object.freeze([CLIMATE_RESOURCE_ID])),
      ]),
    }),
    status: 'active',
    revision: 1,
  });
}

function exactBindingPolicy(
  binding: Binding,
  tool: Pick<Tool, 'toolName'>,
  allowedResourceIds: readonly string[],
) {
  return Object.freeze({
    selection: 'required' as const,
    mcpProviderBindingId: binding.bindingId,
    localServerId: binding.localServerId,
    mcpToolName: tool.toolName,
    allowedResourceIds,
    requireActive: true as const,
    requireAvailable: true as const,
    requireUnexpiredFreshness: true as const,
    denyFallback: true as const,
  });
}

function providerBindingConstraint(binding: Binding, tool: Tool) {
  return Object.freeze({
    type: 'provider_binding_policy',
    mcpProviderBindingId: binding.bindingId,
    localServerId: binding.localServerId,
    mcpToolName: tool.toolName,
    requiredStatus: 'active',
    requiredAvailabilityStatus: 'available',
    requiredFreshness: 'unexpired',
    fallback: 'deny',
  });
}

function compositeInputSchema(): JsonObject {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({
      mainLightResourceId: Object.freeze({
        type: 'string',
        enum: Object.freeze([MAIN_LIGHT_RESOURCE_ID]),
      }),
      climateResourceId: Object.freeze({
        type: 'string',
        enum: Object.freeze([CLIMATE_RESOURCE_ID]),
      }),
    }),
    required: Object.freeze(['mainLightResourceId', 'climateResourceId']),
  });
}

function compositeOutputSchema(lightTool: Tool, climateTool: Tool): JsonObject {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({
      mainLight: requireObjectSchema(lightTool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID'),
      climate: requireObjectSchema(climateTool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID'),
    }),
    required: Object.freeze(['mainLight', 'climate']),
  });
}

function buildCapability(
  spec: GovernanceSpec,
  binding: Binding,
  tool: Tool,
  allowedResourceIds: readonly string[],
): NodeCapabilityDefinitionVersion {
  const inputSchema = constrainedInputSchema(tool.inputSchema, allowedResourceIds);
  const outputSchema = requireObjectSchema(tool.outputSchema, 'MCP_TOOL_OUTPUT_SCHEMA_INVALID');
  const requiredEvidence = spec.evidence.map((evidenceType) =>
    Object.freeze({ type: 'required_evidence', evidenceType, required: true, hardGate: true }),
  );
  return createNodeCapabilityDefinition({
    capabilityId: spec.capabilityId,
    version: CAPABILITY_VERSION,
    domain: spec.provider === 'light' ? 'home.light' : 'home.climate',
    name: spec.name,
    description: spec.summary,
    inputSchema,
    outputSchema,
    successCriteria: [
      Object.freeze({ type: 'output_schema_valid', required: true }),
      Object.freeze({ type: 'resource_identity_matches_request', required: true }),
      Object.freeze({ type: 'required_evidence_complete', required: true }),
      ...(spec.sideEffecting
        ? [
            Object.freeze({ type: 'state_confirmation_matches_request', required: true }),
            Object.freeze({ type: 'baseline_restored', required: true }),
          ]
        : []),
    ],
    requiredEvidence,
    effects: [spec.effect],
    artifacts: [],
    constraints: [
      Object.freeze({
        type: 'resource_policy',
        identifierAuthority: 'public_resource_id',
        selection: 'request_value',
        allowedResourceIds,
        physicalResourceBinding: 'forbidden',
      }),
      Object.freeze({
        type: 'provider_binding_policy',
        mcpProviderBindingId: binding.bindingId,
        localServerId: binding.localServerId,
        mcpToolName: spec.toolName,
        requiredStatus: 'active',
        requiredAvailabilityStatus: 'available',
        requiredFreshness: 'unexpired',
        fallback: 'deny',
      }),
      Object.freeze({
        type: 'exact_skill_version',
        skillId: spec.skillId,
        skillVersion: SKILL_VERSION,
        taskType: spec.toolName,
      }),
      Object.freeze({
        type: 'confirmation_policy',
        required: spec.sideEffecting,
        stage: spec.sideEffecting ? 'before_execution' : 'not_applicable',
      }),
    ],
    supportedModes: ['deterministic'],
    riskLevel: spec.riskLevel,
    status: 'draft',
    createdBy: 'home-lab-governance-driver',
    createdAt: CREATED_AT,
  });
}

function buildImplementation(
  spec: GovernanceSpec,
  binding: Binding,
  allowedResourceIds: readonly string[],
): CapabilityImplementationBinding {
  return Object.freeze({
    bindingId: `capability-binding-${spec.capabilityId}-v1`,
    capabilityId: spec.capabilityId,
    capabilityVersion: CAPABILITY_VERSION,
    implementationType: 'skill',
    implementationId: spec.skillId,
    implementationVersion: String(SKILL_VERSION),
    role: 'primary',
    priority: 0,
    providerPolicyOverride: Object.freeze({
      selection: 'required',
      mcpProviderBindingId: binding.bindingId,
      localServerId: binding.localServerId,
      mcpToolName: spec.toolName,
      allowedResourceIds,
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    }),
    status: 'active',
    revision: 1,
  });
}

function resourcesFor(
  provider: ProviderKind,
  preflight: HomeLabPreflightPolicy,
): readonly string[] {
  return provider === 'climate' ? preflight.climateResourceIds : preflight.lightResourceIds;
}

function constrainedInputSchema(value: unknown, allowedResourceIds: readonly string[]): JsonObject {
  const input = requireObjectSchema(value, 'MCP_TOOL_INPUT_SCHEMA_INVALID');
  const properties = isRecord(input['properties']) ? input['properties'] : undefined;
  const resource = properties?.['resourceId'];
  if (!isRecord(resource))
    fail('MCP_TOOL_RESOURCE_SCHEMA_INVALID', 'MCP Tool input must declare resourceId.');
  const declared = [
    ...(typeof resource['const'] === 'string' ? [resource['const']] : []),
    ...(Array.isArray(resource['enum'])
      ? resource['enum'].filter((item): item is string => typeof item === 'string')
      : []),
  ];
  if (declared.some((resourceId) => !allowedResourceIds.includes(resourceId)))
    fail(
      'MCP_TOOL_RESOURCE_POLICY_CONFLICT',
      'MCP Tool schema admits a resource outside the public resource policy.',
    );
  const required = Array.isArray(input['required'])
    ? input['required'].filter((item): item is string => typeof item === 'string')
    : [];
  return Object.freeze({
    ...structuredClone(input),
    properties: Object.freeze({
      ...structuredClone(properties),
      resourceId: Object.freeze({
        ...structuredClone(resource),
        type: 'string',
        enum: Object.freeze([...allowedResourceIds]),
      }),
    }),
    required: Object.freeze([...new Set([...required, 'resourceId'])]),
  });
}

async function materializeSkillPackage(
  workspaceRoot: string,
  spec: Readonly<{ skillId: string; name: string; summary: string }>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
): Promise<Readonly<{ packageRoot: string; packageChecksum: string }>> {
  const packageRoot = join(workspaceRoot, spec.skillId, 'v1');
  await mkdir(packageRoot, { recursive: true });
  const markdown = `# ${spec.name}\n\n${spec.summary}\n\nThis exact version uses only the MCP Tools declared by its governed Provider Binding policy.\n`;
  const files = Object.freeze({
    'SKILL.md': markdown,
    'normative.json': stablePretty({
      visibility: usage['visibility'],
      normative: usage['normative'],
      contextRequirements: usage['contextRequirements'],
      taskBindings: usage['taskBindings'],
    }),
    'adaptive.json': stablePretty({ adaptive: usage['adaptive'] }),
    'modes.json': stablePretty(usage['modes']),
    'evidence.json': stablePretty(usage['evidence']),
  });
  const declarations = Object.freeze({
    normative: Object.freeze({ path: 'normative.json', sha256: sha256(files['normative.json']) }),
    adaptive: Object.freeze({ path: 'adaptive.json', sha256: sha256(files['adaptive.json']) }),
    modes: Object.freeze({ path: 'modes.json', sha256: sha256(files['modes.json']) }),
    evidence: Object.freeze({ path: 'evidence.json', sha256: sha256(files['evidence.json']) }),
  });
  const manifest = stablePretty({
    apiVersion: 'sdar.io/v1alpha1',
    kind: 'SkillPackage',
    skill,
    skillMarkdownSha256: sha256(markdown),
    files: declarations,
  });
  const allFiles = Object.freeze({ ...files, 'manifest.json': manifest });
  for (const [name, contents] of Object.entries(allFiles))
    await writeFile(join(packageRoot, name), contents, { encoding: 'utf8', mode: 0o600 });
  const checksums = Object.fromEntries(
    Object.entries(allFiles)
      .map(([name, contents]) => [name, sha256(contents)] as const)
      .sort(([left], [right]) => compare(left, right)),
  );
  const packageChecksum = sha256(
    Object.entries(checksums)
      .map(([name, checksum]) => `${name}\u0000${checksum}`)
      .join('\n'),
  );
  return Object.freeze({ packageRoot, packageChecksum });
}

async function runtimeGetSkill(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  skillId: string,
  request: typeof fetch,
): Promise<z.infer<typeof RuntimeSkillSchema> | undefined> {
  const response = await request(
    `${configuration.runtimeManagementBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/1`,
    { redirect: 'manual' },
  );
  if (response.status === 404) return undefined;
  return RuntimeSkillSchema.parse(await responseJson(response, 200));
}

async function controlGetCapability(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  capabilityId: string,
  request: typeof fetch,
): Promise<NodeCapabilityDefinitionVersion | undefined> {
  const response = await request(
    `${configuration.nodeControlBaseUrl}/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/1`,
    {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    },
  );
  if (response.status === 404) return undefined;
  return CapabilitySchema.parse(
    await responseJson(response, 200),
  ) as NodeCapabilityDefinitionVersion;
}

async function controlGetImplementations(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  capabilityId: string,
  request: typeof fetch,
): Promise<readonly CapabilityImplementationBinding[]> {
  const body = z
    .object({ items: z.array(ImplementationSchema) })
    .loose()
    .parse(
      await controlGet(
        configuration,
        `/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/1/implementations?pageSize=100`,
        request,
      ),
    );
  return Object.freeze(body.items as CapabilityImplementationBinding[]);
}

function assertRuntimeSkillExact(
  actual: z.infer<typeof RuntimeSkillSchema>,
  expected: Readonly<{
    skill: Readonly<Record<string, unknown>>;
    usage: Readonly<Record<string, unknown>>;
  }>,
): void {
  const exact = {
    ...expected.skill,
    status: 'enabled',
    usageSpecification: expectedRuntimeUsage(expected.usage),
  };
  for (const [key, value] of Object.entries(exact))
    if (stableStringify(actual[key]) !== stableStringify(value))
      fail('SKILL_EXACT_VERSION_DRIFT', `Existing exact Skill version drifted at ${key}.`);
  const taskBindings = (actual.usageSpecification['taskBindings'] ?? []) as readonly unknown[];
  if (stableStringify(taskBindings) !== stableStringify(expected.usage['taskBindings']))
    fail('SKILL_TASK_TYPE_NOT_EXACT', 'Skill task bindings differ from exact governance.');
}

function assertGovernedSkillExact(
  actual: z.infer<typeof GovernedSkillSchema>,
  skill: Readonly<Record<string, unknown>>,
  usage: Readonly<Record<string, unknown>>,
): void {
  if (actual.skillId !== skill['skillId'] || String(actual.version) !== '1')
    fail('SKILL_GOVERNANCE_IDENTITY_MISMATCH', 'Governed Skill identity is not exact.');
  const taskBindings = (actual.usageSpecification['taskBindings'] ?? []) as readonly unknown[];
  if (stableStringify(taskBindings) !== stableStringify(usage['taskBindings']))
    fail('SKILL_TASK_TYPE_NOT_EXACT', 'Governed Skill task bindings differ from governance.');
  const expectedToolPolicy = skill['toolPolicy'];
  const expectedOutcome = skill['outcomeSpecification'];
  if (
    !isRecord(expectedToolPolicy) ||
    !isRecord(expectedOutcome) ||
    stableStringify(actual.providerPolicy['required']) !==
      stableStringify(expectedToolPolicy['required']) ||
    stableStringify(actual.providerPolicy['optional']) !==
      stableStringify(expectedToolPolicy['optional']) ||
    stableStringify(actual.providerPolicy['forbidden']) !==
      stableStringify(expectedToolPolicy['forbidden']) ||
    stableStringify(actual.evidencePolicy['requiredEvidence']) !==
      stableStringify(expectedOutcome['evidence']) ||
    stableStringify(actual.inputSchema) !== stableStringify(skill['inputSchema']) ||
    stableStringify(actual.outputSchema) !== stableStringify(skill['outputSchema']) ||
    stableStringify(actual.outcomeSpecification) !==
      stableStringify(skill['outcomeSpecification']) ||
    stableStringify(actual.usageSpecification) !== stableStringify(expectedRuntimeUsage(usage))
  )
    fail('SKILL_GOVERNANCE_PROJECTION_DRIFT', 'Governed Skill projection is not exact.');
}

function expectedRuntimeUsage(
  usage: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    apiVersion: 'sdar.io/v1alpha1',
    visibility: usage['visibility'],
    normative: usage['normative'],
    contextRequirements: usage['contextRequirements'],
    taskBindings: usage['taskBindings'],
    adaptive: usage['adaptive'],
    modes: usage['modes'],
    evidencePolicy: usage['evidence'],
  });
}

function assertCapabilityExact(
  actual: NodeCapabilityDefinitionVersion,
  expected: NodeCapabilityDefinitionVersion,
): void {
  if (
    actual.capabilityId !== expected.capabilityId ||
    actual.version !== expected.version ||
    actual.definitionHash !== expected.definitionHash
  )
    fail('CAPABILITY_DEFINITION_DRIFT', 'Existing Capability business promises are not exact.');
  if (['suspended', 'deprecated', 'retired'].includes(actual.status))
    fail('CAPABILITY_LIFECYCLE_INVALID', 'Existing Capability is suspended or terminal.');
}

function assertImplementationExact(
  actual: CapabilityImplementationBinding,
  expected: CapabilityImplementationBinding,
): void {
  if (stableStringify(actual) !== stableStringify(expected))
    fail(
      'CAPABILITY_IMPLEMENTATION_DRIFT',
      'Capability implementation must be the exact Skill version and Provider policy.',
    );
}

async function controlGet(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    },
    200,
    request,
  );
}

async function runtimeGet(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    { redirect: 'manual' },
    200,
    request,
  );
}

async function controlCommand(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.nodeControlBearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    202,
    request,
  );
}

async function controlCreate(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.nodeControlBearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    201,
    request,
  );
}

async function controlMutation(
  configuration: HomeLabCapabilityGovernanceConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  ifMatch: string,
  expectedStatus: number,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.nodeControlBearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'if-match': ifMatch,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    },
    expectedStatus,
    request,
  );
}

async function requestJson(
  url: string,
  init: RequestInit,
  expectedStatus: number,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(await request(url, init), expectedStatus);
}

async function responseJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    let code = `HTTP_${String(response.status)}`;
    try {
      const problem = z
        .object({ code: z.string().min(1) })
        .loose()
        .parse(await response.json());
      code = problem.code;
    } catch {
      // Response bodies may contain endpoints or Provider details; never echo them.
    }
    return fail(
      code,
      `Governance HTTP request was rejected with status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    return fail('HTTP_RESPONSE_INVALID', 'Governance HTTP response was not JSON.');
  }
}

function safeManagementBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('DRIVER_CONFIGURATION_INVALID', 'Management URL must be absolute HTTP(S).');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Management URL contains unsupported components.');
  if (url.protocol === 'http:' && !isLoopback(url.hostname))
    fail('DRIVER_CONFIGURATION_INVALID', 'Non-loopback management URLs require HTTPS.');
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname.toLowerCase());
}

function requireFresh(validUntil: string, observedAt: string, code: string): void {
  if (Date.parse(validUntil) <= Date.parse(observedAt))
    fail(code, 'Persisted freshness has expired.');
}

function validTimestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) return fail(code, 'Expected an RFC 3339 timestamp.');
  return value;
}

function requireObjectSchema(value: unknown, code: string): JsonObject {
  if (!isRecord(value)) return fail(code, 'Expected an object JSON Schema.');
  return Object.freeze(structuredClone(value)) as JsonObject;
}

function assertSafeGovernanceJson(value: unknown): void {
  const inspect = (candidate: unknown, key = ''): void => {
    if (typeof candidate === 'string') {
      if (/^(?:light|climate|switch|sensor|binary_sensor)\.[a-z0-9_]+$/u.test(candidate))
        fail('ENTITY_ID_FORBIDDEN', 'Home Assistant entity IDs are forbidden in SDAR governance.');
      if (/https?:\/\//iu.test(candidate))
        fail('ENDPOINT_FORBIDDEN', 'Endpoints are forbidden in governance evidence and policies.');
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) inspect(item, key);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [entryKey, entry] of Object.entries(candidate)) {
      const normalized = entryKey.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
      if (
        [
          'entityid',
          'haentityid',
          'authorization',
          'accesstoken',
          'refreshtoken',
          'password',
          'secret',
        ].includes(normalized)
      )
        fail('SENSITIVE_GOVERNANCE_FIELD_FORBIDDEN', 'Sensitive or entity fields are forbidden.');
      inspect(entry, entryKey);
    }
  };
  inspect(value);
}

function stablePretty(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compare)
      .map((key) => [key, sortJson(value[key])]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableKey(scope: string, identity: string): string {
  return `home-lab-g06-${scope}-${sha256(identity).slice(0, 24)}`;
}

function runKey(runId: string, scope: string, identity: string): string {
  return `${runId}-${scope}-${sha256(identity).slice(0, 16)}`.slice(0, 256);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('DRIVER_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  let source: string;
  if (inline !== undefined) source = inline;
  else if (file !== undefined) source = await readFile(file, 'utf8');
  else source = fail('DRIVER_CONFIGURATION_INVALID', `${name} is unavailable.`);
  const value = source.trim();
  if (value === '') fail('DRIVER_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    return fail('DRIVER_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

function optionalPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(value))
    return fail('DRIVER_CONFIGURATION_INVALID', `${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    return fail('DRIVER_CONFIGURATION_INVALID', `${name} must be a safe integer.`);
  return parsed;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function fail(code: string, message: string): never {
  throw new HomeLabCapabilityGovernanceError(code, message);
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } = await configurationFromEnvironment();
    const report = await governHomeLabCapabilities(configuration);
    await writeRedactedGovernanceReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof HomeLabCapabilityGovernanceError
        ? error.code
        : 'HOME_LAB_CAPABILITY_GOVERNANCE_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
