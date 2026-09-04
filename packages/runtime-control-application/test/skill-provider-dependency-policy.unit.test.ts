import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { SkillPackageImporter, SkillPackageValidator } from '../../application/src/index.js';
import type { SkillPackageImportCandidate } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import type {
  CapabilityImplementationBinding,
  NodeCapabilityDefinitionVersion,
} from '../../node-control-domain/src/index.js';
import { NodeSkillPackageReader } from '../../skill-package-adapter/src/index.js';
import {
  UgvAgentProfileSkillProviderDependencyPolicy,
  type RuntimeSkillProviderDependencyPolicyInput,
} from '../src/index.js';

const PACKAGE_CHECKSUM = '6d5fc9c8e093de18a8b11c8377b96788336606b25d0df0f27efef7b4d9f6a48c';
const PROVIDER_BINDING_ID = 'mcp-binding-ugv1-profile';
const SERVER_ID = 'ugv1-profile-mcp';
const CATALOG_REVISION = 'catalog-ugv1-profile-v1';
const CATALOG_CHECKSUM = 'c'.repeat(64);
let importedPackage: SkillPackageImportCandidate;

beforeAll(async () => {
  const packageSchema = JSON.parse(
    await readFile(new URL('../../../schemas/skill-package.schema.json', import.meta.url), 'utf8'),
  ) as unknown;
  const importer = new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({
      schemas: new AjvJsonSchemaValidator(),
      packageSchema,
    }),
    clock: { now: () => '2026-08-21T00:00:00.000Z' },
  });
  importedPackage = await importer.import(
    fileURLToPath(new URL('../../../skills/embodied.move_to/', import.meta.url)),
  );
});

describe('UGV Agent Profile Skill Provider dependency policy', () => {
  it('authorizes the exact immutable Skill package and seven frozen Capability constraints', () => {
    const assessment = new UgvAgentProfileSkillProviderDependencyPolicy().assess(input());

    expect(importedPackage.packageChecksum).toBe(PACKAGE_CHECKSUM);
    expect(importedPackage.skillVersion.usageSpecification).toBeDefined();
    expect(assessment.decision).toBe('authorized');
    if (assessment.decision !== 'authorized') throw new Error('UGV_POLICY_NOT_AUTHORIZED');
    const authorization = assessment.authorization;
    expect(authorization).toEqual(
      expect.objectContaining({
        requirements: [
          expect.objectContaining({
            mcpProviderBindingId: PROVIDER_BINDING_ID,
            localServerId: SERVER_ID,
            mcpToolName: 'vehicle_navigate',
          }),
        ],
        expectedBindings: [
          {
            mcpProviderBindingId: PROVIDER_BINDING_ID,
            localServerId: SERVER_ID,
            bindingRevision: 7,
            catalogRevision: CATALOG_REVISION,
            catalogChecksum: CATALOG_CHECKSUM,
          },
        ],
      }),
    );
    expect(authorization.policyParts).toContain(`skill-package:${PACKAGE_CHECKSUM}`);
    expect(authorization.policyParts).toContain(
      'skill-usage:9801dd4ea424a1b925e51a273a5712f082e41daacbf76f7df9d8595c48b01b87',
    );
  });

  it('authorizes an append-only live Capability successor from its complete frozen contract', () => {
    const successor = liveSuccessorInput();
    const assessment = new UgvAgentProfileSkillProviderDependencyPolicy().assess(successor);

    expect(assessment.decision).toBe('authorized');
    if (assessment.decision !== 'authorized') throw new Error('UGV_SUCCESSOR_NOT_AUTHORIZED');
    expect(assessment.authorization.expectedBindings).toEqual([
      {
        mcpProviderBindingId: 'ugv-smpp-real-integration-r2-binding',
        localServerId: 'ugv-smpp-real-integration-r2',
        bindingRevision: 1,
        catalogRevision: '2.0.0-rc.1:1',
        catalogChecksum: '6'.repeat(64),
      },
    ]);
  });

  it('accepts additive Provider lineage and policy fields while preserving current authority references', () => {
    const successor = liveSuccessorInput();
    const constraints = (successor.definition.constraints ?? []).map((constraint) =>
      constraint['type'] === 'provider_binding_policy'
        ? {
            ...constraint,
            registryRevision: 2,
            registryChecksum: '1'.repeat(64),
            futureProviderContract: { revision: 7, semantics: 'provider_owned' },
          }
        : constraint,
    );
    const assessment = new UgvAgentProfileSkillProviderDependencyPolicy().assess({
      ...successor,
      definition: { ...successor.definition, constraints },
    });

    expect(assessment.decision).toBe('authorized');
    if (assessment.decision !== 'authorized') throw new Error('UGV_SUCCESSOR_NOT_AUTHORIZED');
    expect(assessment.authorization.expectedBindings).toEqual([
      {
        mcpProviderBindingId: 'ugv-smpp-real-integration-r2-binding',
        localServerId: 'ugv-smpp-real-integration-r2',
        bindingRevision: 1,
        catalogRevision: '2.0.0-rc.1:1',
        catalogChecksum: '6'.repeat(64),
      },
    ]);
  });

  it('rejects a live successor with missing append-only lineage', () => {
    const successor = liveSuccessorInput();
    const policy = new UgvAgentProfileSkillProviderDependencyPolicy();
    expect(
      policy.assess({
        ...successor,
        definition: { ...successor.definition, previousVersion: 2 },
      }).decision,
    ).toBe('denied');
  });

  it.each([
    'resource_policy',
    'exact_skill_version',
    'confirmation_policy',
    'physical_side_effect_policy',
    'runtime_execution_mode_policy',
    'ugv_simulation_target_policy',
  ])('rejects any %s constraint widening', (type) => {
    const original = input();
    const constraints = (original.definition.constraints ?? []).map((constraint) =>
      constraint['type'] === type ? { ...constraint, widened: true } : constraint,
    );

    expect(
      new UgvAgentProfileSkillProviderDependencyPolicy().assess({
        ...original,
        definition: { ...original.definition, constraints },
      }).decision,
    ).toBe('denied');
  });

  it('rejects missing, duplicate, or additional constraints', () => {
    const original = input();
    const constraints = original.definition.constraints ?? [];
    const policy = new UgvAgentProfileSkillProviderDependencyPolicy();

    expect(
      policy.assess({
        ...original,
        definition: { ...original.definition, constraints: constraints.slice(1) },
      }).decision,
    ).toBe('denied');
    expect(
      policy.assess({
        ...original,
        definition: { ...original.definition, constraints: [...constraints, constraints[0] ?? {}] },
      }).decision,
    ).toBe('denied');
  });

  it('rejects package, usage, Tool policy, exact resource, and implementation-set drift', () => {
    const original = input();
    const policy = new UgvAgentProfileSkillProviderDependencyPolicy();
    expect(
      policy.assess({
        ...original,
        skill: { ...original.skill, packageChecksum: 'd'.repeat(64) },
      }).decision,
    ).toBe('denied');
    const withoutPackageAudit = {
      toolPolicy: original.skill.toolPolicy,
      runtimePolicy: original.skill.runtimePolicy,
      usageSpecification: original.skill.usageSpecification,
    };
    expect(
      policy.assess({
        ...original,
        skill: withoutPackageAudit,
      }).decision,
    ).toBe('denied');
    expect(
      policy.assess({
        ...original,
        skill: {
          ...original.skill,
          toolPolicy: {
            required: [{ serverId: SERVER_ID, toolName: 'vehicle_navigate' }],
            optional: [],
            forbidden: [],
          },
        },
      }).decision,
    ).toBe('denied');
    expect(
      policy.assess({
        ...original,
        skill: {
          ...original.skill,
          usageSpecification: { ...record(original.skill.usageSpecification), drift: true },
        },
      }).decision,
    ).toBe('denied');
    expect(
      policy.assess(
        (() => {
          const implementation = {
            ...original.implementation,
            providerPolicyOverride: {
              ...record(original.implementation.providerPolicyOverride),
              allowedResourceIds: ['vehicle:ugv1', 'vehicle:ugv2'],
            },
          };
          return { ...original, implementation, implementations: [implementation] };
        })(),
      ).decision,
    ).toBe('denied');
    expect(
      policy.assess({
        ...original,
        implementations: [...original.implementations, { ...original.implementation }],
      }).decision,
    ).toBe('denied');
  });

  it('leaves unrelated Skills on the generic static readiness path', () => {
    const original = input();
    const implementation = {
      ...original.implementation,
      capabilityId: 'home.light.read-state',
      implementationId: 'home.light.get-state',
    };
    expect(
      new UgvAgentProfileSkillProviderDependencyPolicy().assess({
        ...original,
        definition: {
          ...original.definition,
          capabilityId: 'home.light.read-state',
        },
        implementation,
        implementations: [implementation],
      }).decision,
    ).toBe('not_applicable');
  });

  it.each([
    [
      'risk',
      (definition: NodeCapabilityDefinitionVersion) => ({
        ...definition,
        riskLevel: 'medium' as const,
      }),
    ],
    [
      'supported modes',
      (definition: NodeCapabilityDefinitionVersion) => ({
        ...definition,
        supportedModes: ['plan_confirmed'],
      }),
    ],
    [
      'success criteria',
      (definition: NodeCapabilityDefinitionVersion) => ({
        ...definition,
        successCriteria: definition.successCriteria.slice(1),
      }),
    ],
    [
      'hard evidence',
      (definition: NodeCapabilityDefinitionVersion) => ({
        ...definition,
        requiredEvidence: [{ ...definition.requiredEvidence[0], hardGate: false }],
      }),
    ],
    [
      'request schema',
      (definition: NodeCapabilityDefinitionVersion) => ({
        ...definition,
        inputSchema: { ...definition.inputSchema, additionalProperties: true },
      }),
    ],
    [
      'result schema',
      (definition: NodeCapabilityDefinitionVersion) => ({
        ...definition,
        outputSchema: { ...definition.outputSchema, additionalProperties: true },
      }),
    ],
  ] as const)('rejects %s drift in the safety-relevant definition', (_label, mutate) => {
    const original = input();
    expect(
      new UgvAgentProfileSkillProviderDependencyPolicy().assess({
        ...original,
        definition: mutate(original.definition),
      }).decision,
    ).toBe('denied');
  });

  it.each([
    '',
    'not bounded!',
    'uap-p3-b02-short',
    'uap-p3-b02-UPPERCASE01',
    'uap-p3-b02-bad:colon',
    `uap-p3-b02-${'x'.repeat(129)}`,
  ])('rejects an invalid simulation identity %j', (simulationId) => {
    const original = input();
    const constraints = (original.definition.constraints ?? []).map((constraint) =>
      constraint['type'] === 'runtime_execution_mode_policy'
        ? { ...constraint, simulationId }
        : constraint,
    );
    expect(
      new UgvAgentProfileSkillProviderDependencyPolicy().assess({
        ...original,
        definition: { ...original.definition, constraints },
      }).decision,
    ).toBe('denied');
  });
});

function input(): RuntimeSkillProviderDependencyPolicyInput {
  const implementation: CapabilityImplementationBinding = {
    bindingId: 'capability-binding-embodied.move-v2',
    capabilityId: 'embodied.move',
    capabilityVersion: 2,
    implementationType: 'skill',
    implementationId: 'embodied.move_to',
    implementationVersion: '1',
    role: 'primary',
    priority: 0,
    providerPolicyOverride: {
      selection: 'required',
      mcpProviderBindingId: PROVIDER_BINDING_ID,
      localServerId: SERVER_ID,
      mcpToolName: 'vehicle_navigate',
      allowedResourceIds: ['vehicle:ugv1'],
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    },
    status: 'active',
    revision: 1,
  };
  const definition: NodeCapabilityDefinitionVersion = {
    capabilityId: 'embodied.move',
    version: 2,
    domain: 'embodied',
    name: 'Move UGV',
    description: 'Move the exact simulated UGV with terminal position evidence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'target'],
      properties: {
        resourceId: { const: 'vehicle:ugv1' },
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y', 'frame'],
          properties: {
            x: { type: 'number', minimum: -180, maximum: 180 },
            y: { type: 'number', minimum: -90, maximum: 90 },
            frame: { const: 'WGS84' },
          },
        },
      },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'status', 'finalPosition'],
      properties: {
        resourceId: { const: 'vehicle:ugv1' },
        status: { const: 'completed' },
        finalPosition: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'y', 'frame'],
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            frame: { const: 'EPSG:4326' },
          },
        },
      },
    },
    successCriteria: [
      { type: 'output_schema_valid', required: true },
      { type: 'resource_identity_matches_request', required: true },
      { type: 'required_evidence_complete', required: true },
      { type: 'remote_task_identity_present', required: true },
      { type: 'remote_terminal_observation_present', required: true },
      { type: 'external_command_dispatch_count', maximum: 1 },
    ],
    requiredEvidence: [
      {
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      },
    ],
    constraints: constraints(),
    supportedModes: ['plan_confirmed', 'remote_task'],
    riskLevel: 'high',
    status: 'published',
    definitionHash: 'a'.repeat(64),
  };
  return {
    definition,
    implementations: [implementation],
    implementation,
    skill: {
      packageChecksum: PACKAGE_CHECKSUM,
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: {
        maxDurationSeconds: 600,
        maxMcpCalls: 8,
        maxReplans: 1,
        autoConfirmPlan: false,
        cancelStrategy: 'try_interrupt',
      },
      usageSpecification: importedPackage.skillVersion.usageSpecification,
    },
  };
}

function liveSuccessorInput(): RuntimeSkillProviderDependencyPolicyInput {
  const legacy = input();
  const providerBindingId = 'ugv-smpp-real-integration-r2-binding';
  const localServerId = 'ugv-smpp-real-integration-r2';
  const implementation: CapabilityImplementationBinding = {
    ...legacy.implementation,
    bindingId: 'capability-binding-embodied.move-v4',
    capabilityVersion: 4,
    providerPolicyOverride: {
      selection: 'required',
      mcpProviderBindingId: providerBindingId,
      localServerId,
      mcpToolName: 'vehicle_navigate',
      allowedResourceIds: ['vehicle:ugv1'],
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    },
  };
  const constraints = (legacy.definition.constraints ?? [])
    .filter((constraint) => constraint['type'] !== 'ugv_simulation_target_policy')
    .map((constraint) => {
      if (constraint['type'] === 'runtime_execution_mode_policy')
        return { type: 'runtime_execution_mode_policy', mode: 'live' };
      if (constraint['type'] !== 'provider_binding_policy') return constraint;
      return {
        ...constraint,
        mcpProviderBindingId: providerBindingId,
        localServerId,
        bindingRevision: 1,
        catalogRevision: '2.0.0-rc.1:1',
        catalogChecksum: '6'.repeat(64),
        executionSemantics: {
          effect: 'side_effecting',
          execution: 'task_required',
          cancellation: 'task_cancel',
          idempotency: 'server_managed',
          replay: 'forbidden',
          source: 'admin_override',
        },
      };
    });
  return {
    ...legacy,
    definition: {
      ...legacy.definition,
      version: 4,
      previousVersion: 3,
      status: 'published',
      constraints,
    },
    implementation,
    implementations: [implementation],
  };
}

function constraints(): NonNullable<NodeCapabilityDefinitionVersion['constraints']> {
  return [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['vehicle:ugv1'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: PROVIDER_BINDING_ID,
      localServerId: SERVER_ID,
      mcpToolName: 'vehicle_navigate',
      allowedResourceIds: ['vehicle:ugv1'],
      bindingRevision: 7,
      catalogRevision: CATALOG_REVISION,
      catalogChecksum: CATALOG_CHECKSUM,
      taskBehavior: 'task_required',
      executionSemantics: {
        effect: 'side_effecting',
        execution: 'task_required',
        cancellation: 'task_cancel',
        idempotency: 'server_managed',
        replay: 'simulation_only',
        source: 'admin_override',
      },
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    {
      type: 'exact_skill_version',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskType: 'embodied.move',
    },
    {
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    },
    {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    },
    {
      type: 'runtime_execution_mode_policy',
      mode: 'simulation',
      simulationId: 'uap-p3-b02-simulation-20260821',
    },
    {
      type: 'ugv_simulation_target_policy',
      policyId: 'ugv-agent-profile/explicit-wgs84-target',
      revision: 2,
      executionMode: 'simulation',
      resourceId: 'vehicle:ugv1',
      frame: 'WGS84',
      targetAuthority: 'task_capability_input_snapshot',
      targetDerivation: 'forbidden',
      distanceLimit: 'none',
      altitudePolicy: 'not_commanded_not_terminally_evaluated',
      forbiddenRegions: [],
    },
  ];
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('TEST_JSON_OBJECT_REQUIRED');
  return value as Readonly<Record<string, unknown>>;
}
