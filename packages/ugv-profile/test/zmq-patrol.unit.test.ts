import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseZmqPatrolInput,
  zmqPatrolChildInput,
  aggregateZmqPatrol,
  zmqPatrolNavigationSucceeded,
  ZMQ_PATROL_CHILDREN,
  assertZmqPatrolDeadline,
} from '../../domain/src/zmq-area-patrol.js';
import { type PatrolChildEvidence } from '../../domain/src/area-patrol.js';
import { patrolFixture, patrolNow } from '../test-support/zmq-patrol.js';
import { prepareZmqPatrolWorkflow } from '../src/zmq-patrol-workflow.js';
import {
  compileWorkflow,
  type WorkflowRuntimePorts,
} from '../../langgraph-runtime/src/workflow-compiler.js';
import {
  checkSkillUsagePlanCompliance,
  SkillPackageImporter,
  SkillPackageValidator,
} from '../../application/src/index.js';
import { UgvAgentProfileSkillProviderDependencyPolicy } from '../../runtime-control-application/src/skill-provider-dependency-policy.js';
import { writeNativeZmqPackage } from '../../../apps/node-control-acceptance/src/zmq-skill-governance.js';
import { NodeSkillPackageReader } from '../../skill-package-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { skillSchemaContractErrors } from '../../domain/src/skill-schema-contract.js';
import {
  nativeZmqPatrolInputMappingPolicy,
  reviewedNativeZmqTool,
} from '../src/zmq-patrol-composition.js';
import { buildNativeZmqSkill } from '../src/zmq-skill.js';
import { explicitProviderJsonDictionaries } from '../../domain/src/schema-json-dictionaries.js';
import { SkillCompositionPlanner } from '../../application/src/skill-composition.js';
import type { ZmqSiteStaticAuthority } from '../src/zmq-site-profile.js';
const resourceId = 'vehicle:ugv1';
const navigation = (nativeOutcome = 'completed', stopConfirmed = true) => ({
  schemaVersion: 'sdar.zmq-skill-report/2',
  catalogProfile: 'zmq_v1_2_0_site_control_13',
  qualification: 'site_control',
  resourceId,
  toolName: 'vehicle_zmq_navigate',
  status: 'degraded',
  providerResult: {
    schemaVersion: 'ugv.zmq-control-result/2',
    resourceId,
    nativeOutcome,
    stopConfirmed,
  },
  missingEvidence: ['SOURCE_TIME_UNCONFIRMED'],
});
const inspection = () => ({
  schemaVersion: 'sdar.zmq-skill-report/2',
  catalogProfile: 'zmq_v1_2_0_site_control_13',
  qualification: 'site_control',
  resourceId,
  toolName: 'vehicle_zmq_inspect_area',
  status: 'degraded',
  providerResult: {
    schemaVersion: 'ugv.zmq-inspection-result/2',
    resourceId,
    nativeOutcome: 'completed',
    stopConfirmed: true,
    inspectionReport: { completion: 'partial', complete: false, sourceStreamComplete: null },
    coverageEvidence: { complete: true, footprints: null },
    anomalies: [],
    missingEvidence: ['PRODUCER_EPOCH_UNATTESTED'],
  },
  missingEvidence: [],
});
const evidence = (
  result: Record<string, unknown>,
  index: 0 | 1,
  phase: PatrolChildEvidence['phase'] = 'completed',
): PatrolChildEvidence => ({
  taskId: `child-${String(index)}`,
  skillId: ZMQ_PATROL_CHILDREN[index],
  skillVersion: 2,
  phase,
  result,
  missingEvidence: [],
});
describe('native site single-region patrol', () => {
  it('composes the exact native transformation and rejects a changed child schema', async () => {
    const f = patrolFixture();
    const authority: ZmqSiteStaticAuthority = {
      catalogProfile: 'zmq_v1_2_0_site_control_13',
      originType: 'direct',
      bindingId: 'site-binding',
      providerId: 'site-provider',
      resourceId,
      localServerId: 'site-native',
      bindingRevision: 1,
      catalogRevision: 'catalog-1',
      catalogChecksum: 'a'.repeat(64),
      executionMode: 'live',
      simulationId: null,
    };
    const children = (['vehicle_zmq_navigate', 'vehicle_zmq_inspect_area'] as const).map((name) => {
      const built = buildNativeZmqSkill(authority, name, reviewedNativeZmqTool(authority, name), 2);
      return {
        ...built,
        outputSchema: explicitProviderJsonDictionaries(
          built.outputSchema as Readonly<Record<string, unknown>>,
        ),
        status: 'enabled' as const,
      };
    });
    const skills = [{ ...f.skill, status: 'enabled' as const }, ...children];
    const planner = new SkillCompositionPlanner({
      inputMappingPolicy: nativeZmqPatrolInputMappingPolicy,
      skills: {
        findCurrentVersion: (id) => Promise.resolve(skills.find((s) => s.skillId === id)),
        findVersion: (id, version) =>
          Promise.resolve(skills.find((s) => s.skillId === id && s.version === version)),
        listEnabledVersions: () => Promise.resolve(skills),
      },
      graph: {
        listRelationsFrom: (id) =>
          Promise.resolve(
            children
              .filter(() => id === f.skill.skillId)
              .map((c) => ({
                relationId: id + ':' + c.skillId,
                sourceSkillId: id,
                targetSkillId: c.skillId,
                relationType: 'parent_child',
                metadata: {},
                createdAt: patrolNow,
              })),
          ),
      },
    });
    expect(
      (await planner.composeUsage({ skillId: f.skill.skillId, skillVersion: 1 }, [])).edges,
    ).toHaveLength(2);
    const nav = children[0];
    if (!nav) throw Error('NAVIGATION_FIXTURE_REQUIRED');
    const mapping =
      f.skill.usageSpecification?.composition?.fixedDependencies[0]?.inputMappings ?? [];
    expect(
      nativeZmqPatrolInputMappingPolicy(
        f.skill,
        { ...nav, inputSchema: { type: 'object' } },
        mapping,
      ),
    ).toBe(false);
    expect(
      nativeZmqPatrolInputMappingPolicy({ ...f.skill, skillId: 'unreviewed' }, nav, mapping),
    ).toBeUndefined();
  });
  it.each(['axis', 'height', 'convex', 'duplicate', 'outside', 'window'] as const)(
    'rejects invalid %s before dispatch',
    (kind) => {
      const { input } = patrolFixture();
      const first = input.area.vertices[0],
        third = input.area.vertices[2];
      if (!first || !third) throw Error('AREA_FIXTURE_REQUIRED');
      if (kind === 'axis') first.latitude = 106;
      if (kind === 'height') Reflect.deleteProperty(first, 'ellipsoidHeightM');
      if (kind === 'convex') {
        third.longitude = 106.001;
        third.latitude = 29.001;
      }
      if (kind === 'duplicate') input.area.vertices[1] = first;
      if (kind === 'outside') input.entryPoint.longitude = 107;
      if (kind === 'window') input.timeWindow.deadline = patrolNow;
      expect(() => parseZmqPatrolInput(input)).toThrow();
    },
  );
  it('maps one point then one inspection and consumes the original deadline', () => {
    const { input } = patrolFixture();
    expect(zmqPatrolChildInput(input, ZMQ_PATROL_CHILDREN[0])).toMatchObject({
      operation: { name: 'navigation.point', params: { destination: input.entryPoint } },
    });
    expect(zmqPatrolChildInput(input, ZMQ_PATROL_CHILDREN[1])).toEqual({
      resourceId,
      area: input.area,
      timeWindow: input.timeWindow,
    });
    expect(assertZmqPatrolDeadline(input, patrolNow).timing.maxElapsedMs).toBe(300000);
    expect(assertZmqPatrolDeadline(input, '2026-10-28T00:09:59.500Z').timing.maxElapsedMs).toBe(
      500,
    );
    expect(() => assertZmqPatrolDeadline(input, input.timeWindow.deadline)).toThrow(
      'DEADLINE_EXPIRED',
    );
  });
  it.each([
    ['completed', true, 2],
    ['completed', false, 1],
    ['failed', true, 1],
    ['unknown', false, 1],
  ] as const)(
    'runs %s/stop=%s through LangGraph with %s child calls',
    async (outcome, stopped, count) => {
      const f = patrolFixture();
      const prepared = prepareZmqPatrolWorkflow(f.planning, f.input, patrolNow);
      const definition = prepared.deterministicDefinition;
      expect(checkSkillUsagePlanCompliance(definition, prepared.policy)).toMatchObject({
        compliant: true,
      });
      const executeSkill = vi
        .fn<WorkflowRuntimePorts['executeSkill']>()
        .mockImplementation(({ skillId, input }) => {
          expect(input).toEqual(zmqPatrolChildInput(f.input, skillId));
          return Promise.resolve({
            status: 'completed',
            output:
              skillId === ZMQ_PATROL_CHILDREN[0] ? navigation(outcome, stopped) : inspection(),
          });
        });
      const forbidden = () => {
        throw Error('UNEXPECTED_SIDE_CHANNEL');
      };
      const ports: WorkflowRuntimePorts = {
        executeSkill,
        isDeterministicSkillCall: () => Promise.resolve(true),
        executeLlm: forbidden,
        callMcpTool: forbidden,
        executeSubworkflow: forbidden,
        requestHumanConfirmation: forbidden,
        decideExecutionError: () =>
          Promise.resolve({ strategy: 'terminate', summary: 'No replay.' }),
        now: () => patrolNow,
        nowMilliseconds: () => 0,
      };
      await compileWorkflow(definition, 'confirmed', ports).invoke(
        {
          skillInput: f.input,
          context: { 'public-resource-id': true, 'provider-binding-freshness': true },
        },
        { maxReplans: 0, maxLlmCalls: 0, maxMcpCalls: 2, maxDurationSeconds: 300, maxCost: 10 },
        { llm: 1, mcp: 1, skill: 1, subworkflow: 1 },
      );
      expect(executeSkill).toHaveBeenCalledTimes(count);
    },
  );
  it('retains real execution while degrading incomplete coverage and target stream', () => {
    const { input } = patrolFixture();
    const report = aggregateZmqPatrol(input, [
      evidence(navigation(), 0),
      evidence(inspection(), 1),
    ]);
    expect(report).toMatchObject({
      status: 'degraded',
      navigationSucceeded: true,
      inspectionExecuted: true,
      coveredSubregions: [],
      missingSubregions: ['subregion-1'],
    });
    expect(report.missingEvidence).toEqual(
      expect.arrayContaining([
        'COVERAGE_FOOTPRINTS_UNAVAILABLE',
        'TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE',
        'SOURCE_STREAM_COMPLETENESS_UNVERIFIED',
      ]),
    );
    expect(
      new AjvJsonSchemaValidator().validate(patrolFixture().skill.outputSchema, report).valid,
    ).toBe(true);
    expect(aggregateZmqPatrol(input, [evidence(navigation(), 0, 'canceled')]).status).toBe(
      'cancelled',
    );
    expect(aggregateZmqPatrol(input, [evidence(navigation('failed'), 0, 'failed')]).status).toBe(
      'failed',
    );
    // The runtime may stop the device cooperatively after a deadline. Its native
    // cancellation receipt cannot turn the owning Task's timeout into user cancellation.
    expect(
      aggregateZmqPatrol(input, [
        evidence({ ...navigation('cancelled'), status: 'cancelled' }, 0, 'failed'),
      ]).status,
    ).toBe('failed');
    expect(() =>
      aggregateZmqPatrol(input, [evidence({ ...inspection(), resourceId: 'other' }, 1)]),
    ).toThrow('IDENTITY_CONFLICT');
    expect(zmqPatrolNavigationSucceeded(navigation('unknown'), resourceId)).toBe(false);
    const nativeWithoutResource = navigation();
    Reflect.deleteProperty(nativeWithoutResource.providerResult, 'resourceId');
    expect(zmqPatrolNavigationSucceeded(nativeWithoutResource, resourceId)).toBe(true);
    expect(
      zmqPatrolNavigationSucceeded(
        {
          ...navigation(),
          providerResult: { ...navigation().providerResult, resourceId: 'other' },
        },
        resourceId,
      ),
    ).toBe(false);
  });
  it('routes a failed navigation child directly to reporting without replay or inspection', async () => {
    const f = patrolFixture(),
      prepared = prepareZmqPatrolWorkflow(f.planning, f.input, patrolNow);
    const executeSkill = vi
      .fn<WorkflowRuntimePorts['executeSkill']>()
      .mockRejectedValue(Error('NATIVE_NAVIGATION_FAILED'));
    const forbidden = () => {
      throw Error('UNEXPECTED_SIDE_CHANNEL');
    };
    const runtime: WorkflowRuntimePorts = {
      executeSkill,
      isDeterministicSkillCall: () => Promise.resolve(true),
      executeLlm: forbidden,
      callMcpTool: forbidden,
      executeSubworkflow: forbidden,
      requestHumanConfirmation: forbidden,
      decideExecutionError: (input) => {
        expect(input.gotoNodeId).toBe('usage_failure');
        return Promise.resolve({ strategy: 'goto', summary: 'Report this retained failure.' });
      },
      now: () => patrolNow,
      nowMilliseconds: () => 0,
    };
    const result = await compileWorkflow(
      prepared.deterministicDefinition,
      'confirmed',
      runtime,
    ).invoke(
      {
        skillInput: f.input,
        context: { 'public-resource-id': true, 'provider-binding-freshness': true },
      },
      { maxReplans: 0, maxLlmCalls: 0, maxMcpCalls: 2, maxDurationSeconds: 300, maxCost: 10 },
      { llm: 1, mcp: 1, skill: 1, subworkflow: 1 },
    );
    expect(executeSkill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: 'succeeded', result: false });
  });
  it('imports the package and admits only its complete reviewed governance contract', async () => {
    const f = patrolFixture();
    const root = await mkdtemp(join(tmpdir(), 'zmq-patrol-'));
    try {
      expect(skillSchemaContractErrors(f.skill.inputSchema, 'input')).toEqual([]);
      expect(skillSchemaContractErrors(f.skill.outputSchema, 'output')).toEqual([]);
      await writeNativeZmqPackage(root, f.skill);
      const imported = await new SkillPackageImporter({
        reader: new NodeSkillPackageReader(),
        validator: new SkillPackageValidator({
          schemas: new AjvJsonSchemaValidator(),
          packageSchema: JSON.parse(
            await readFile('schemas/skill-package.schema.json', 'utf8'),
          ) as unknown,
        }),
        clock: { now: () => patrolNow },
      }).import(root);
      expect(imported.skillVersion).toEqual(f.skill);
      const input = {
        definition: f.definition,
        implementation: f.implementation,
        implementations: [f.implementation],
        skill: {
          ...f.skill,
          usageSpecification: f.skill.usageSpecification,
          packageChecksum: imported.packageChecksum,
        },
      };
      const policy = new UgvAgentProfileSkillProviderDependencyPolicy();
      expect(policy.assess(input).decision).toBe('authorized');
      for (const type of [
        'confirmation_policy',
        'composition_authority_policy',
        'runtime_execution_mode_policy',
        'composed_side_effect_policy',
      ])
        expect(
          policy.assess({
            ...input,
            definition: {
              ...input.definition,
              constraints: (input.definition.constraints ?? []).filter((c) => c['type'] !== type),
            },
          }).decision,
        ).toBe('denied');
      expect(
        policy.assess({
          ...input,
          skill: {
            ...input.skill,
            runtimePolicy: { ...f.skill.runtimePolicy, autoConfirmPlan: true },
          },
        }).decision,
      ).toBe('denied');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
