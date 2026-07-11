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
});

function planner(repository: WorkflowPlanRepository, model: StructuredModelProvider) {
  return new WorkflowPlannerService({
    model,
    repository,
    workflowSchema: { type: 'object' },
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    maxAttempts: 2,
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
    planningInstruction: 'Plan safely.',
  };
}
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
