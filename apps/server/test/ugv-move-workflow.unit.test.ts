import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  WorkflowPlannerService,
  WorkflowValidator,
  checkSkillUsagePlanCompliance,
  type StructuredModelProvider,
  type WorkflowPlanRepository,
} from '../../../packages/application/src/index.js';
import {
  hashCanonicalEvidenceJson,
  type WorkflowDefinition,
  type WorkflowPlanAttempt,
  type WorkflowPlanRecord,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  UGV_MOVE_WORKFLOW_NODE_IDS,
  UgvMoveWorkflowCandidateGuard,
  prepareUgvMoveWorkflowPlan,
} from '../src/ugv-move-workflow.js';

import {
  UGV_WORKFLOW_GOAL,
  UGV_WORKFLOW_IDENTITY,
  UGV_WORKFLOW_NOW,
  ugvWorkflowPlanningFixture,
} from './ugv-move-workflow-test-fixture.js';

describe('UGV move Workflow Profile adapter', () => {
  it('uses formal Skill Usage and the existing Planner/validator to admit the deterministic DSL', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const repository = new MemoryWorkflowPlanRepository();
    const model = new NeverModel();
    const guard = candidateGuard(prepared);
    const plan = await planner(repository, model, guard).plan({
      planId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      goalId: UGV_WORKFLOW_IDENTITY.goalId,
      goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
      goalContract: UGV_WORKFLOW_GOAL,
      planningInstruction: prepared.planningInstruction,
      taskId: UGV_WORKFLOW_IDENTITY.taskId,
      skillUsagePolicy: prepared.policy,
      deterministicDefinition: prepared.deterministicDefinition,
      deterministicOnly: true,
    });

    expect(model.generateStructured).not.toHaveBeenCalled();
    expect(repository.attempts).toHaveLength(1);
    expect(repository.attempts[0]).toMatchObject({ valid: true, validationErrors: [] });
    expect(plan.confirmationStatus).toBe('awaiting_confirmation');
    expect(plan.definition).toEqual(prepared.deterministicDefinition);
    expect(prepared.policy.allowedTools).toEqual([
      { serverId: fixture.selected.server.serverId, toolName: 'vehicle_navigate' },
      { serverId: fixture.selected.finalStateRead.serverId, toolName: 'vehicle_get_state' },
    ]);
    expect(
      checkSkillUsagePlanCompliance(prepared.deterministicDefinition, prepared.policy),
    ).toEqual({ compliant: true, errors: [] });
    expect(
      prepared.deterministicDefinition.nodes.map(({ nodeId, type }) => ({ nodeId, type })),
    ).toEqual([
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.initialState, type: 'mcp_tool' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.currentPosition, type: 'condition' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.resourceState, type: 'condition' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.permissionContext, type: 'condition' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.navigate, type: 'mcp_tool' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.finalState, type: 'mcp_tool' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.finalPosition, type: 'condition' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.success, type: 'result' },
      { nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.failure, type: 'result' },
    ]);
    expect(
      prepared.deterministicDefinition.nodes.filter(
        (node) => node.type === 'mcp_tool' && node.tool.toolName === 'vehicle_navigate',
      ),
    ).toEqual([
      expect.objectContaining({
        nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.navigate,
        arguments: fixture.selected.resolvedArguments,
        taskExecution: { protocolMode: 'frozen_v1', availabilityCheck: 'required' },
      }),
    ]);
    expect(
      prepared.deterministicDefinition.edges.filter((edge) => edge.outcome === 'false'),
    ).toHaveLength(4);
    expect(
      prepared.deterministicDefinition.edges
        .filter((edge) => edge.outcome === 'false')
        .every((edge) => edge.targetNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.failure),
    ).toBe(true);
    expect(
      prepared.deterministicDefinition.nodes.find(
        (node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.success,
      ),
    ).toMatchObject({
      type: 'result',
      value: {
        op: 'ref',
        path: [
          'nodes',
          UGV_MOVE_WORKFLOW_NODE_IDS.finalState,
          'data',
          'metadata',
          'ugvSkillResult',
        ],
      },
    });
    expect(JSON.parse(prepared.planningInstruction)).toMatchObject({
      operation: 'plan_with_skill_usage_policy',
      ugvProfileAuthority: {
        selectedTaskOperationHash: fixture.selected.snapshotHash,
        navigateArgumentsHash: fixture.selected.argumentsHash,
        finalStateArgumentsHash: fixture.selected.finalStateRead.argumentsHash,
      },
    });
  });

  it('rejects topology drift through WorkflowPlannerService before persistence or model execution', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const definition = structuredClone(prepared.deterministicDefinition);
    const firstEdge = definition.edges.find(
      (edge) => edge.sourceNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.initialState,
    );
    const currentTrueEdge = definition.edges.find(
      (edge) =>
        edge.sourceNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.currentPosition && edge.outcome === 'true',
    );
    const resourceTrueEdge = definition.edges.find(
      (edge) =>
        edge.sourceNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.resourceState && edge.outcome === 'true',
    );
    if (firstEdge === undefined || currentTrueEdge === undefined || resourceTrueEdge === undefined)
      throw new Error('UGV_WORKFLOW_EDGE_FIXTURE_MISSING');
    Object.assign(firstEdge, { targetNodeId: UGV_MOVE_WORKFLOW_NODE_IDS.resourceState });
    Object.assign(resourceTrueEdge, { targetNodeId: UGV_MOVE_WORKFLOW_NODE_IDS.currentPosition });
    Object.assign(currentTrueEdge, { targetNodeId: UGV_MOVE_WORKFLOW_NODE_IDS.permissionContext });
    const repository = new MemoryWorkflowPlanRepository();
    const model = new NeverModel();

    await expect(
      planner(repository, model, candidateGuard(prepared)).plan({
        planId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
        workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
        workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
        goalId: UGV_WORKFLOW_IDENTITY.goalId,
        goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
        goalContract: UGV_WORKFLOW_GOAL,
        planningInstruction: prepared.planningInstruction,
        taskId: UGV_WORKFLOW_IDENTITY.taskId,
        skillUsagePolicy: prepared.policy,
        deterministicDefinition: definition,
        deterministicOnly: true,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_PLANNING_FAILED' });
    expect(model.generateStructured).not.toHaveBeenCalled();
    expect(repository.attempts).toHaveLength(1);
    expect(repository.attempts[0]?.validationErrors).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_TOPOLOGY_INVALID' }),
    );
    expect(repository.plans.get(UGV_WORKFLOW_IDENTITY.workflowPlanId)).toMatchObject({
      confirmationStatus: 'failed',
    });
  });

  it('fails closed for forbidden nodes/operations and authority or result drift', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const guard = candidateGuard(prepared);
    const validate = (definition: WorkflowDefinition) =>
      guard.validate({
        definition,
        taskId: UGV_WORKFLOW_IDENTITY.taskId,
        skillUsagePolicy: prepared.policy,
      });

    const forbiddenNode = structuredClone(prepared.deterministicDefinition);
    const initial = forbiddenNode.nodes.find(
      (node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.initialState,
    );
    if (initial === undefined) throw new Error('UGV_WORKFLOW_NODE_FIXTURE_MISSING');
    Object.assign(initial, {
      type: 'human_confirmation',
      prompt: 'Bypass the outer confirmation.',
    });
    expect(validate(forbiddenNode)).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_FORBIDDEN_NODE' }),
    );

    const forbiddenOperation = structuredClone(prepared.deterministicDefinition);
    const navigate = mcpNode(forbiddenOperation, UGV_MOVE_WORKFLOW_NODE_IDS.navigate);
    Object.assign(navigate.tool, { toolName: 'vehicle_fire_weapon' });
    expect(validate(forbiddenOperation)).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_FORBIDDEN_OPERATION' }),
    );

    const missionDrift = structuredClone(prepared.deterministicDefinition);
    Object.assign(mcpNode(missionDrift, UGV_MOVE_WORKFLOW_NODE_IDS.navigate), {
      arguments: {
        resourceId: 'vehicle:ugv1',
        mission: { type: 'route', target: { longitude: 112, latitude: 28 } },
        stopOnObstacle: true,
      },
    });
    expect(validate(missionDrift)).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_TOOL_BINDING_INVALID' }),
    );

    const finalArgumentsDrift = structuredClone(prepared.deterministicDefinition);
    Object.assign(mcpNode(finalArgumentsDrift, UGV_MOVE_WORKFLOW_NODE_IDS.finalState), {
      arguments: {
        resourceId: 'vehicle:ugv1',
        include: ['health'],
      },
    });
    expect(validate(finalArgumentsDrift)).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_TOOL_BINDING_INVALID' }),
    );

    const resultDrift = structuredClone(prepared.deterministicDefinition);
    const result = resultDrift.nodes.find(
      (node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.success,
    );
    if (result?.type !== 'result') throw new Error('UGV_WORKFLOW_RESULT_FIXTURE_MISSING');
    Object.assign(result, {
      value: { op: 'ref', path: ['nodes', UGV_MOVE_WORKFLOW_NODE_IDS.navigate] },
    });
    expect(validate(resultDrift)).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_RESULT_MAPPING_INVALID' }),
    );
  });

  it('rejects missing Task identity and future selection without racing the observed availability TTL', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const exact = candidateGuard(prepared);
    expect(
      exact.validate({
        definition: prepared.deterministicDefinition,
        skillUsagePolicy: prepared.policy,
      }),
    ).toContainEqual(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_IDENTITY_INVALID' }));

    const afterAvailabilityExpiry = new UgvMoveWorkflowCandidateGuard({
      selectedTaskOperation: prepared.selectedTaskOperation,
      skillUsagePolicy: prepared.policy,
      ...UGV_WORKFLOW_IDENTITY,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      clock: { now: () => '2026-08-21T12:05:00.000Z' },
    });
    expect(
      afterAvailabilityExpiry.validate({
        definition: prepared.deterministicDefinition,
        taskId: UGV_WORKFLOW_IDENTITY.taskId,
        skillUsagePolicy: prepared.policy,
      }),
    ).toEqual([]);

    const future = new UgvMoveWorkflowCandidateGuard({
      selectedTaskOperation: prepared.selectedTaskOperation,
      skillUsagePolicy: prepared.policy,
      ...UGV_WORKFLOW_IDENTITY,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      clock: { now: () => '2026-08-21T11:59:59.999Z' },
    });
    expect(
      future.validate({
        definition: prepared.deterministicDefinition,
        taskId: UGV_WORKFLOW_IDENTITY.taskId,
        skillUsagePolicy: prepared.policy,
      }),
    ).toContainEqual(
      expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_SELECTED_OPERATION_STALE' }),
    );
  });

  it('rejects Skill package policy drift before producing a Planner candidate', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const driftedSkill = {
      ...fixture.skill,
      runtimePolicy: { ...fixture.skill.runtimePolicy, autoConfirmPlan: true },
    };
    expect(() =>
      prepareUgvMoveWorkflowPlan({
        ...fixture,
        skill: driftedSkill,
        goalContract: UGV_WORKFLOW_GOAL,
        workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
        workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
        selectedTaskOperation: fixture.selected,
      }),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID' }));
  });

  it('rejects fabricated or unbound Skill context evidence before producing a candidate', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const baseline = fixture.candidate.applicability.context.requirements;
    for (const [index, evidenceRef] of [
      [0, 'context:current-position'],
      [
        1,
        `task-capability-binding:capability-binding-1:hash:${'b'.repeat(64)}:provider-context-hash:sha256:${'d'.repeat(64)}:workflow-read:vehicle_get_state:context:resource-state`,
      ],
      [2, 'task-capability:outer-plan-confirmation-required'],
    ] as const) {
      const requirements = baseline.map((requirement, requirementIndex) =>
        requirementIndex === index ? { ...requirement, evidenceRef } : requirement,
      );
      const candidate = {
        ...fixture.candidate,
        applicability: {
          ...fixture.candidate.applicability,
          context: { ...fixture.candidate.applicability.context, requirements },
        },
      };
      expect(() =>
        prepareUgvMoveWorkflowPlan({
          ...fixture,
          candidate,
          goalContract: UGV_WORKFLOW_GOAL,
          workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
          workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
          selectedTaskOperation: fixture.selected,
        }),
      ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID' }));
    }
  });

  it('keeps the generated DSL evidence fixture identical to the deterministic component output', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const evidence = JSON.parse(
      await readFile(
        new URL('../../../examples/ugv-agent-profile-workflow.json', import.meta.url),
        'utf8',
      ),
    ) as Readonly<Record<string, unknown>>;
    const { skillUsagePolicy, ...workflowDefinition } = prepared.deterministicDefinition;
    expect(skillUsagePolicy).toEqual(prepared.policy);

    expect(evidence).toMatchObject({
      schemaVersion: 'ugv-agent-profile.generated-workflow/v1',
      status: 'PASS',
      evidenceClass: 'external_simulation',
      observationClass: 'deterministic_local_component',
      productionEligible: false,
      physicalVehicleQualified: false,
      authority: {
        selectedTaskOperationHash: fixture.selected.snapshotHash,
        navigateArgumentsHash: fixture.selected.argumentsHash,
        finalStateArgumentsHash: fixture.selected.finalStateRead.argumentsHash,
        skillUsagePolicyHash: hashCanonicalEvidenceJson(prepared.policy),
      },
      workflowDefinition,
    });
  });
});

function candidateGuard(prepared: ReturnType<typeof prepareUgvMoveWorkflowPlan>) {
  return new UgvMoveWorkflowCandidateGuard({
    selectedTaskOperation: prepared.selectedTaskOperation,
    skillUsagePolicy: prepared.policy,
    ...UGV_WORKFLOW_IDENTITY,
    workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
    clock: { now: () => '2026-08-21T12:01:00.000Z' },
  });
}

function planner(
  repository: WorkflowPlanRepository,
  model: StructuredModelProvider,
  candidateGuard: UgvMoveWorkflowCandidateGuard,
) {
  return new WorkflowPlannerService({
    model,
    validator: new WorkflowValidator({
      tools: {
        exists: () => Promise.resolve(true),
        getInputSchema: () => Promise.resolve({ type: 'object' }),
      },
      skills: {
        find: () => Promise.resolve(undefined),
        findCurrentVersion: () => Promise.resolve(undefined),
        findVersion: () => Promise.resolve(undefined),
        listVersions: () => Promise.resolve([]),
        listEnabledVersions: () => Promise.resolve([]),
        listCurrentVersions: () => Promise.resolve([]),
        saveVersionAndSetCurrent: () => Promise.resolve(),
      },
      schemas: new AjvJsonSchemaValidator(),
    }),
    repository,
    workflowSchema: { type: 'object' },
    clock: { now: () => UGV_WORKFLOW_NOW },
    maxAttempts: 1,
    candidateGuard,
  });
}

function mcpNode(definition: WorkflowDefinition, nodeId: string) {
  const node = definition.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (node?.type !== 'mcp_tool') throw new Error('UGV_WORKFLOW_MCP_NODE_FIXTURE_MISSING');
  return node;
}

class NeverModel implements StructuredModelProvider {
  readonly generateStructured = vi.fn<StructuredModelProvider['generateStructured']>(() =>
    Promise.reject(new Error('UGV_WORKFLOW_MODEL_MUST_NOT_RUN')),
  );
}

class MemoryWorkflowPlanRepository implements WorkflowPlanRepository {
  readonly attempts: WorkflowPlanAttempt[] = [];
  readonly plans = new Map<string, WorkflowPlanRecord>();

  findPlan(planId: string): Promise<WorkflowPlanRecord | undefined> {
    return Promise.resolve(this.plans.get(planId));
  }

  findConfirmedDefinition(
    workflowDefinitionId: string,
    workflowVersion: number,
  ): Promise<WorkflowPlanRecord | undefined> {
    return Promise.resolve(
      [...this.plans.values()].find(
        (plan) =>
          plan.confirmationStatus === 'confirmed' &&
          plan.definition?.workflowDefinitionId === workflowDefinitionId &&
          plan.definition.version === workflowVersion,
      ),
    );
  }

  confirmPlan(planId: string): Promise<void> {
    const plan = this.plans.get(planId);
    if (plan !== undefined)
      this.plans.set(planId, Object.freeze({ ...plan, confirmationStatus: 'confirmed' }));
    return Promise.resolve();
  }

  saveAttempt(attempt: WorkflowPlanAttempt): Promise<void> {
    this.attempts.push(attempt);
    return Promise.resolve();
  }

  savePlan(plan: WorkflowPlanRecord): Promise<void> {
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }

  savePlanAndSupersede(plan: WorkflowPlanRecord, sourcePlanId: string): Promise<void> {
    const source = this.plans.get(sourcePlanId);
    if (source !== undefined)
      this.plans.set(sourcePlanId, Object.freeze({ ...source, confirmationStatus: 'superseded' }));
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }
}
