import { describe, expect, it } from 'vitest';
import {
  snapshotSkillVersion,
  snapshotSkillUsageCompositionPlan,
  type SkillCompositionContext,
  type SkillUsagePlanPolicy,
  type SkillVersion,
  type WorkflowDefinition,
  type WorkflowPlanAttempt,
  type WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  WorkflowPlannerService,
  WorkflowValidator,
  type SkillRepository,
  type StructuredModelProvider,
  type WorkflowCandidateReadinessPolicy,
  type WorkflowCandidateGuard,
  type WorkflowPlanRepository,
} from '../src/index.js';

describe('WorkflowPlannerService', () => {
  it('validates deterministic Skill template/procedure candidates before any model repair', async () => {
    const directRepository = new MemoryPlanRepository();
    const directModel = new SequenceModel([]);
    const direct = await planner(directRepository, directModel).plan({
      ...input(),
      skillUsagePolicy: emptySkillUsagePolicy(),
      deterministicDefinition: validDefinition(),
    });
    expect(direct.attemptCount).toBe(1);
    expect(directModel.calls).toHaveLength(0);

    const repairRepository = new MemoryPlanRepository();
    const repairModel = new SequenceModel([validDefinition()]);
    const repaired = await planner(repairRepository, repairModel).plan({
      ...input(),
      skillUsagePolicy: emptySkillUsagePolicy(),
      deterministicDefinition: { invalid: true } as unknown as WorkflowDefinition,
    });
    expect(repaired.attemptCount).toBe(2);
    expect(repairModel.calls[0]?.correctionErrors.join(' ')).toContain('WORKFLOW_SCHEMA_INVALID');

    const closedRepository = new MemoryPlanRepository();
    const closedModel = new SequenceModel([validDefinition()]);
    await expect(
      planner(closedRepository, closedModel).plan({
        ...input(),
        deterministicDefinition: { invalid: true } as unknown as WorkflowDefinition,
        deterministicOnly: true,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_PLANNING_FAILED' });
    expect(closedModel.calls).toHaveLength(0);
    expect(closedRepository.attempts).toHaveLength(1);
    expect(closedRepository.plans.get('plan-1')).toMatchObject({ attemptCount: 1 });
  });

  it('requires a definition for deterministic-only planning before model or repository work', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([validDefinition()]);
    await expect(
      planner(repository, model).plan({ ...input(), deterministicOnly: true }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_DETERMINISTIC_DEFINITION_REQUIRED' });
    expect(model.calls).toHaveLength(0);
    expect(repository.attempts).toHaveLength(0);
  });

  it('feeds structured validation errors back and saves every candidate', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([{ nodes: [{ type: 'javascript' }] }, validDefinition()]);
    const plan = await planner(repository, model).plan({
      ...input(),
      taskId: 'task-workflow-planning',
    });
    expect(plan).toMatchObject({ confirmationStatus: 'awaiting_confirmation', attemptCount: 2 });
    expect(repository.attempts).toHaveLength(2);
    expect(repository.attempts[0]).toMatchObject({
      valid: false,
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ code: 'WORKFLOW_SCHEMA_INVALID' }),
      ]),
    });
    expect(model.calls[1]?.correctionErrors.join(' ')).toContain('WORKFLOW_SCHEMA_INVALID');
    expect(model.calls.map((call) => call.taskId)).toEqual([
      'task-workflow-planning',
      'task-workflow-planning',
    ]);
  });
  it('applies a production candidate guard before readiness or confirmation persistence', async () => {
    const repository = new MemoryPlanRepository();
    let readinessCalls = 0;
    const readiness: WorkflowCandidateReadinessPolicy = {
      assess: () => {
        readinessCalls += 1;
        return Promise.resolve({ accepted: true, readiness: readinessRecord('ready') });
      },
    };
    const guard: WorkflowCandidateGuard = {
      validate: () => [
        {
          code: 'PROFILE_WORKFLOW_CONTRACT_INVALID',
          path: 'definition',
          message: 'The profile contract rejected this candidate.',
        },
      ],
    };
    await expect(
      planner(
        repository,
        new SequenceModel([validDefinition(), validDefinition()]),
        undefined,
        undefined,
        emptySkills(),
        readiness,
        guard,
      ).plan(input()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_PLANNING_FAILED' });
    expect(readinessCalls).toBe(0);
    expect(repository.attempts).toHaveLength(2);
    expect(repository.attempts[0]?.validationErrors).toContainEqual(
      expect.objectContaining({ code: 'PROFILE_WORKFLOW_CONTRACT_INVALID' }),
    );
    expect(repository.plans.get('plan-1')).toMatchObject({ confirmationStatus: 'failed' });
  });
  it('persists a failed plan after the configured attempt limit', async () => {
    const repository = new MemoryPlanRepository();
    await expect(
      planner(repository, new SequenceModel([{}, {}])).plan(input()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_PLANNING_FAILED' });
    expect(repository.plans.get('plan-1')).toMatchObject({
      confirmationStatus: 'failed',
      attemptCount: 2,
    });
    expect(repository.attempts).toHaveLength(2);
  });
  it('inherits confirmation only from a repository-confirmed repair source', async () => {
    const repository = new MemoryPlanRepository();
    repository.plans.set('confirmed-plan', {
      planId: 'confirmed-plan',
      goalId: 'goal-1',
      goalVersion: 1,
      goalContract,
      definition: validDefinition(),
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const repaired = await planner(
      repository,
      new SequenceModel([validDefinition({ workflowDefinitionId: 'workflow-2', version: 2 })]),
    ).plan({
      ...input(),
      planId: 'plan-2',
      workflowDefinitionId: 'workflow-2',
      workflowVersion: 2,
      sourceConfirmedPlanId: 'confirmed-plan',
    });
    expect(repaired.confirmationStatus).toBe('confirmed');
    await expect(
      planner(repository, new SequenceModel([validDefinition()])).plan({
        ...input(),
        sourceConfirmedPlanId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REPAIR_SOURCE_NOT_CONFIRMED' });
  });
  it('does not inherit confirmation from a different complete Goal contract', async () => {
    const repository = new MemoryPlanRepository();
    repository.plans.set('confirmed-plan', {
      planId: 'confirmed-plan',
      goalId: 'goal-1',
      goalVersion: 1,
      goalContract: { ...goalContract, constraints: ['write allowed'] },
      definition: validDefinition(),
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const model = new SequenceModel([validDefinition()]);

    await expect(
      planner(repository, model).plan({
        ...input(),
        sourceConfirmedPlanId: 'confirmed-plan',
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REPAIR_GOAL_CONTRACT_MISMATCH' });
    expect(model.calls).toHaveLength(0);
  });
  it('offers a preferred successful template for adjustment and records the produced plan use', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([validDefinition()]);
    let usedPlanId: string | undefined;
    const template = {
      templateId: 'template-1',
      version: 1,
      goalKey: 'plan safely',
      structureKey: 'structure-1',
      workflow: validDefinition({ workflowDefinitionId: 'workflow-source' }),
      sourceExperienceIds: ['experience-1', 'experience-2', 'experience-3'],
      sourceSuccessCount: 3,
      useCount: 0,
      successfulUseCount: 0,
      averageUseDurationMs: 0,
      status: 'enabled' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    await planner(
      repository,
      model,
      {
        findPreferred: () => Promise.resolve(template),
        recordUse: (_template, planId) => {
          usedPlanId = planId;
          return Promise.resolve({
            useId: 'use-1',
            templateId: template.templateId,
            templateVersion: 1,
            planId,
            workflowDefinitionId: 'workflow-1',
            workflowVersion: 1,
            status: 'planned' as const,
            createdAt: '2026-07-12T00:00:00.000Z',
          });
        },
      },
      {
        searchForStage: () =>
          Promise.resolve([
            {
              item: {
                memoryId: 'memory-workflow',
                type: 'workflow_pattern',
                content: { pattern: 'read then return' },
                summary: 'Successful pattern.',
                status: 'active',
                sourceRefs: ['task:source'],
                supersedes: [],
                confidence: 0.9,
                durability: 'durable',
                authority: 'skill_experience',
                durabilityReason: 'The Workflow pattern is reusable.',
                createdAt: '2026-07-12T00:00:00.000Z',
              },
              score: 0.9,
            },
          ]),
      },
    ).plan({ ...input(), templateQuery: 'Plan safely' });
    expect(model.calls[0]?.instruction).toContain('preferredWorkflowTemplate');
    expect(model.calls[0]?.instruction).toContain('workflow-source');
    expect(model.calls[0]?.instruction).toContain('memory-workflow');
    expect(usedPlanId).toBe('plan-1');
  });

  it('rejects stale Goal content before invoking the model and audits the exact contract', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([validDefinition()]);
    await expect(
      planner(repository, model).plan({
        ...input(),
        goalContract: { ...goalContract, version: 2 },
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_GOAL_CONTRACT_MISMATCH' });
    expect(model.calls).toHaveLength(0);

    await planner(repository, model).plan(input());
    expect(JSON.parse(model.calls[0]?.instruction ?? '{}')).toMatchObject({ goalContract });
    expect(repository.attempts[0]?.goalContract).toEqual(goalContract);
  });

  it('snapshots the Goal contract before asynchronous planner dependencies run', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([validDefinition()]);
    const mutableContract = {
      ...goalContract,
      constraints: ['read-only'],
      successCriteria: ['status returned'],
    };

    const pending = planner(repository, model).plan({
      ...input(),
      goalContract: mutableContract,
    });
    mutableContract.constraints.push('caller mutation');
    mutableContract.successCriteria.push('caller mutation');

    const planned = await pending;
    expect(planned.goalContract).toMatchObject({
      constraints: ['read-only'],
      successCriteria: ['status returned'],
    });
    expect(JSON.parse(model.calls[0]?.instruction ?? '{}')).toMatchObject({
      goalContract: {
        constraints: ['read-only'],
        successCriteria: ['status returned'],
      },
    });
  });

  it('persists the exact Tool semantics used for planning and confirmation', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([validDefinition()]);
    const toolExecutionSemantics = [
      {
        reference: { serverId: 'mcp.devices', toolName: 'device_status' },
        executionSemantics: {
          effect: 'read_only' as const,
          execution: 'synchronous' as const,
          cancellation: 'cooperative' as const,
          idempotency: 'client_request_key' as const,
          replay: 'allowed' as const,
          source: 'mcp_declared' as const,
        },
      },
    ];

    const plan = await planner(repository, model).plan({
      ...input(),
      toolExecutionSemantics,
    });
    expect(plan.toolExecutionSemantics).toEqual(toolExecutionSemantics);
    expect(repository.attempts[0]?.toolExecutionSemantics).toEqual(toolExecutionSemantics);
    expect(JSON.parse(model.calls[0]?.instruction ?? '{}')).toMatchObject({
      toolExecutionSemantics,
    });

    const originalSemantics = toolExecutionSemantics[0];
    if (originalSemantics === undefined) throw new Error('TOOL_SEMANTICS_FIXTURE_MISSING');
    repository.plans.set(plan.planId, { ...plan, confirmationStatus: 'confirmed' });
    await expect(
      planner(repository, new SequenceModel([validDefinition()])).plan({
        ...input(),
        planId: 'repair-plan',
        sourceConfirmedPlanId: plan.planId,
        toolExecutionSemantics: [
          {
            reference: originalSemantics.reference,
            executionSemantics: {
              ...originalSemantics.executionSemantics,
              replay: 'forbidden',
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REPAIR_TOOL_SEMANTICS_MISMATCH' });
  });

  it('produces a different Workflow when the Goal success criteria change', async () => {
    const repository = new MemoryPlanRepository();
    const model: StructuredModelProvider = {
      generateStructured: ({ instruction }) => {
        const parsed = JSON.parse(instruction) as {
          goalContract: { successCriteria: string[] };
        };
        const criterion = parsed.goalContract.successCriteria[0] ?? 'unspecified';
        const detailed = criterion.includes('temperature');
        return Promise.resolve(
          validDefinition({
            workflowDefinitionId: detailed ? 'workflow-detailed' : 'workflow-basic',
            nodes: [
              {
                nodeId: 'result',
                name: 'Result',
                type: 'result',
                value: { op: 'literal', value: criterion },
              },
            ],
          }),
        );
      },
    };
    const basic = await planner(repository, model).plan({
      ...input(),
      planId: 'plan-basic',
      workflowDefinitionId: 'workflow-basic',
    });
    const detailedContract = {
      ...goalContract,
      successCriteria: ['status and temperature returned'],
    } as const;
    const detailed = await planner(repository, model).plan({
      ...input(),
      planId: 'plan-detailed',
      workflowDefinitionId: 'workflow-detailed',
      goalContract: detailedContract,
    });
    expect(basic.definition?.nodes).not.toEqual(detailed.definition?.nodes);
    expect(detailed.goalContract).toEqual(detailedContract);
  });

  it('offers only persisted graph-admitted children and audits the composition decision', async () => {
    const repository = new MemoryPlanRepository();
    const child = compositionSkill('skill.child');
    const definition = skillCallDefinition(child.skillId);
    const model = new SequenceModel([definition]);
    const context = compositionContext(child);

    const planned = await planner(
      repository,
      model,
      undefined,
      undefined,
      skillRepository(child),
    ).plan({ ...input(), compositionContext: context });

    expect(planned.compositionContext).toEqual(context);
    expect(repository.attempts[0]?.compositionContext).toEqual(context);
    expect(JSON.parse(model.calls[0]?.instruction ?? '{}')).toMatchObject({
      skillCompositionContext: {
        allowedChildSkillIds: [child.skillId],
        decisionSummary: context.decisionSummary,
      },
    });
  });

  it('rejects forged inherited composition snapshots before model invocation', async () => {
    const child = compositionSkill('skill.child');
    const attacker = compositionSkill('skill.disconnected');
    const valid = compositionContext(child);
    const forgedContexts: readonly SkillCompositionContext[] = [
      {
        ...valid,
        relatedSkills: [...valid.relatedSkills, snapshotSkillVersion(attacker)],
        allowedChildSkillIds: [...valid.allowedChildSkillIds, attacker.skillId],
      },
      {
        ...valid,
        allowedChildSkillIds: [child.skillId, child.skillId],
      },
    ];

    for (const compositionContext of forgedContexts) {
      const model = new SequenceModel([skillCallDefinition(child.skillId)]);
      await expect(
        planner(
          new MemoryPlanRepository(),
          model,
          undefined,
          undefined,
          skillRepository(child),
        ).plan({ ...input(), compositionContext }),
      ).rejects.toMatchObject({ code: 'SKILL_COMPOSITION_CONTEXT_INVALID' });
      expect(model.calls).toHaveLength(0);
    }
  });

  it('rejects an unrelated skill_call and permits an explicit capability-gap target', async () => {
    const child = compositionSkill('skill.unrelated');
    const definition = skillCallDefinition(child.skillId);
    const deniedRepository = new MemoryPlanRepository();
    await expect(
      planner(
        deniedRepository,
        new SequenceModel([definition, definition]),
        undefined,
        undefined,
        skillRepository(child),
      ).plan(input()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_PLANNING_FAILED' });
    expect(deniedRepository.attempts[0]?.validationErrors).toContainEqual(
      expect.objectContaining({ code: 'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION' }),
    );

    await expect(
      planner(
        new MemoryPlanRepository(),
        new SequenceModel([definition]),
        undefined,
        undefined,
        skillRepository(child),
      ).plan({ ...input(), capabilityGapSkillIds: [child.skillId] }),
    ).resolves.toMatchObject({ capabilityGapSkillIds: [child.skillId] });
  });

  it('runs Task readiness after structural validation and requires plan confirmation for risk', async () => {
    const repository = new MemoryPlanRepository();
    repository.plans.set('confirmed-plan', {
      planId: 'confirmed-plan',
      goalId: 'goal-1',
      goalVersion: 1,
      goalContract,
      definition: validDefinition(),
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const readiness: WorkflowCandidateReadinessPolicy = {
      assess: () =>
        Promise.resolve({
          accepted: true,
          readiness: readinessRecord('confirmation_required'),
        }),
    };
    const plan = await planner(
      repository,
      new SequenceModel([validDefinition({ workflowDefinitionId: 'workflow-2', version: 2 })]),
      undefined,
      undefined,
      emptySkills(),
      readiness,
    ).plan({
      ...input(),
      planId: 'plan-2',
      workflowDefinitionId: 'workflow-2',
      workflowVersion: 2,
      sourceConfirmedPlanId: 'confirmed-plan',
    });
    expect(plan).toMatchObject({
      confirmationStatus: 'awaiting_confirmation',
      executionReadiness: { disposition: 'confirmation_required' },
    });
  });

  it('feeds Task readiness revision errors into the next bounded model attempt', async () => {
    let calls = 0;
    const readiness: WorkflowCandidateReadinessPolicy = {
      assess: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? {
                accepted: false as const,
                readiness: readinessRecord('revision_required'),
                correctionErrors: ['DSL_RISK_RESCHEDULE:patrol:2026-07-17T01:00:00.000Z'],
                terminal: false,
              }
            : { accepted: true as const, readiness: readinessRecord('ready') },
        );
      },
    };
    const model = new SequenceModel([validDefinition(), validDefinition()]);
    const plan = await planner(
      new MemoryPlanRepository(),
      model,
      undefined,
      undefined,
      emptySkills(),
      readiness,
    ).plan(input());
    expect(plan.attemptCount).toBe(2);
    expect(model.calls[1]?.correctionErrors).toContain(
      'DSL_RISK_RESCHEDULE:patrol:2026-07-17T01:00:00.000Z',
    );
  });
});

function planner(
  repository: WorkflowPlanRepository,
  model: StructuredModelProvider,
  templates?: ConstructorParameters<typeof WorkflowPlannerService>[0]['templates'],
  memories?: ConstructorParameters<typeof WorkflowPlannerService>[0]['memories'],
  skills: SkillRepository = emptySkills(),
  readiness?: WorkflowCandidateReadinessPolicy,
  candidateGuard?: WorkflowCandidateGuard,
) {
  return new WorkflowPlannerService({
    model,
    repository,
    workflowSchema: { type: 'object' },
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    maxAttempts: 2,
    ...(templates === undefined ? {} : { templates }),
    ...(memories === undefined ? {} : { memories }),
    ...(readiness === undefined ? {} : { readiness }),
    ...(candidateGuard === undefined ? {} : { candidateGuard }),
    validator: new WorkflowValidator({
      tools: {
        exists: () => Promise.resolve(false),
        getInputSchema: () => Promise.resolve(undefined),
      },
      skills,
      schemas: new AjvJsonSchemaValidator(),
    }),
  });
}

function compositionContext(child: SkillVersion): SkillCompositionContext {
  const selected = compositionSkill('skill.parent');
  return {
    selectedSkill: snapshotSkillVersion(selected),
    relatedSkills: [snapshotSkillVersion(child)],
    relations: [
      {
        relationId: 'relation-composition',
        sourceSkillId: selected.skillId,
        targetSkillId: child.skillId,
        relationType: 'composition',
        metadata: {},
        createdAt: '2026-07-12T00:00:00.000Z',
      },
    ],
    allowedChildSkillIds: [child.skillId],
    decisionSummary:
      'The graph admitted one compatible child; the model decides whether to call it.',
  };
}

function skillCallDefinition(skillId: string): WorkflowDefinition {
  return validDefinition({
    entryNodeId: 'child',
    nodes: [
      { nodeId: 'child', name: 'Child', type: 'skill_call', skillId, input: {} },
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result',
        value: { op: 'literal', value: true },
      },
    ],
    edges: [{ sourceNodeId: 'child', targetNodeId: 'result' }],
  });
}

function compositionSkill(skillId: string): SkillVersion {
  return {
    skillId,
    version: 1,
    name: skillId,
    summary: skillId,
    description: skillId,
    capabilities: [skillId],
    workflowGuidance: 'Use when admitted.',
    outputInstruction: 'Return JSON.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}

function emptySkillUsagePolicy(): SkillUsagePlanPolicy {
  const composition = snapshotSkillUsageCompositionPlan({
    root: { skillId: 'skill.parent', skillVersion: 1 },
    expandedSkills: [{ skillId: 'skill.parent', skillVersion: 1 }],
    edges: [],
    maxDepth: 3,
    consumedDepth: 0,
    consumedSkills: 1,
    consumedNodes: 0,
  });
  return {
    skill: composition.root,
    mode: 'guidance',
    modeDecision: {
      decision: 'selected',
      mode: 'guidance',
      confirmationRequired: false,
      confirmationSatisfied: true,
      reasonCodes: [],
    },
    constraints: [],
    forbiddenActions: [],
    adaptiveInstructions: ['Plan safely.'],
    requiredConfirmations: [],
    requiredContextIds: [],
    allowedTools: [],
    taskOperations: [],
    childPolicies: [],
    evidenceRequirements: [],
    rejectSuccessWithoutRequiredEvidence: false,
    composition,
    context: {
      requirements: [],
      satisfied: 0,
      total: 0,
      complete: true,
      inputRequiredIds: [],
      unsatisfiedIds: [],
      unknownIds: [],
    },
    readiness: { overall: 'ready', bindings: [] },
  };
}

function skillRepository(skill: SkillVersion): SkillRepository {
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: (skillId) => Promise.resolve(skillId === skill.skillId ? skill : undefined),
    findVersion: (skillId, version) =>
      Promise.resolve(skillId === skill.skillId && version === skill.version ? skill : undefined),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([skill]),
    listCurrentVersions: () => Promise.resolve([skill]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}

function readinessRecord(disposition: 'ready' | 'confirmation_required' | 'revision_required') {
  return {
    readinessId: `readiness-${disposition}`,
    workflowPlanId: 'plan-1',
    planAttempt: 1,
    checkPhase: 'planning' as const,
    dslHash: 'a'.repeat(64),
    disposition,
    permittedActions: ['proceed'] as const,
    guardAction:
      disposition === 'revision_required' ? ('reschedule' as const) : ('proceed' as const),
    guardReasonCodes: [],
    confirmationRequired: disposition === 'confirmation_required',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}
function input() {
  return {
    planId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowVersion: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    goalContract,
    planningInstruction: 'Plan safely.',
  };
}
const goalContract = {
  goalId: 'goal-1',
  version: 1,
  title: 'Inspect device',
  description: 'Inspect the device safely.',
  constraints: ['read-only'],
  successCriteria: ['status returned'],
} as const;
function validDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    workflowDefinitionId: 'workflow-1',
    version: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    entryNodeId: 'result',
    exitNodeIds: ['result'],
    nodes: [
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result' as const,
        value: { op: 'literal' as const, value: true },
      },
    ],
    edges: [],
    ...overrides,
  };
}
function emptySkills() {
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: () => Promise.resolve(undefined),
    findVersion: () => Promise.resolve(undefined),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([]),
    listCurrentVersions: () => Promise.resolve([]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}
class SequenceModel implements StructuredModelProvider {
  readonly calls: Parameters<StructuredModelProvider['generateStructured']>[0][] = [];
  readonly #outputs: readonly unknown[];
  constructor(outputs: readonly unknown[]) {
    this.#outputs = outputs;
  }
  generateStructured(input_: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    this.calls.push(input_);
    return Promise.resolve(this.#outputs[this.calls.length - 1]);
  }
}
class MemoryPlanRepository implements WorkflowPlanRepository {
  attempts: WorkflowPlanAttempt[] = [];
  plans = new Map<string, WorkflowPlanRecord>();
  findPlan(id: string) {
    return Promise.resolve(this.plans.get(id));
  }
  findConfirmedDefinition(workflowDefinitionId: string, workflowVersion: number) {
    return Promise.resolve(
      [...this.plans.values()].find(
        (plan) =>
          plan.confirmationStatus === 'confirmed' &&
          plan.definition?.workflowDefinitionId === workflowDefinitionId &&
          plan.definition.version === workflowVersion,
      ),
    );
  }
  confirmPlan(id: string) {
    const plan = this.plans.get(id);
    if (plan !== undefined) this.plans.set(id, { ...plan, confirmationStatus: 'confirmed' });
    return Promise.resolve();
  }
  saveAttempt(value: WorkflowPlanAttempt) {
    this.attempts.push(value);
    return Promise.resolve();
  }
  savePlan(value: WorkflowPlanRecord) {
    this.plans.set(value.planId, value);
    return Promise.resolve();
  }
  savePlanAndSupersede(value: WorkflowPlanRecord, sourcePlanId: string) {
    const source = this.plans.get(sourcePlanId);
    if (source !== undefined)
      this.plans.set(sourcePlanId, { ...source, confirmationStatus: 'superseded' });
    this.plans.set(value.planId, value);
    return Promise.resolve();
  }
}
