import { describe, expect, it } from 'vitest';
import type {
  WorkflowDefinition,
  WorkflowPlanAttempt,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  WorkflowPlannerService,
  WorkflowValidator,
  type StructuredModelProvider,
  type WorkflowPlanRepository,
} from '../src/index.js';

describe('WorkflowPlannerService', () => {
  it('feeds structured validation errors back and saves every candidate', async () => {
    const repository = new MemoryPlanRepository();
    const model = new SequenceModel([{ nodes: [{ type: 'javascript' }] }, validDefinition()]);
    const plan = await planner(repository, model).plan(input());
    expect(plan).toMatchObject({ confirmationStatus: 'awaiting_confirmation', attemptCount: 2 });
    expect(repository.attempts).toHaveLength(2);
    expect(repository.attempts[0]).toMatchObject({
      valid: false,
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ code: 'WORKFLOW_SCHEMA_INVALID' }),
      ]),
    });
    expect(model.calls[1]?.correctionErrors.join(' ')).toContain('WORKFLOW_SCHEMA_INVALID');
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
});

function planner(
  repository: WorkflowPlanRepository,
  model: StructuredModelProvider,
  templates?: ConstructorParameters<typeof WorkflowPlannerService>[0]['templates'],
  memories?: ConstructorParameters<typeof WorkflowPlannerService>[0]['memories'],
) {
  return new WorkflowPlannerService({
    model,
    repository,
    workflowSchema: { type: 'object' },
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    maxAttempts: 2,
    ...(templates === undefined ? {} : { templates }),
    ...(memories === undefined ? {} : { memories }),
    validator: new WorkflowValidator({
      tools: {
        exists: () => Promise.resolve(false),
        getInputSchema: () => Promise.resolve(undefined),
      },
      skills: emptySkills(),
      schemas: new AjvJsonSchemaValidator(),
    }),
  });
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
