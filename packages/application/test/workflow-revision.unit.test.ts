import { describe, expect, it } from 'vitest';
import type {
  WorkflowDefinition,
  WorkflowPlanAttempt,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  WorkflowRevisionService,
  WorkflowValidator,
  type PlanWorkflowInput,
  type WorkflowPlanRepository,
} from '../src/index.js';

describe('WorkflowRevisionService', () => {
  it('creates an immutable admin revision and revokes the source confirmation', async () => {
    const plans = repositoryWithSource('confirmed');
    const service = revisionService(plans);
    const revised = await service.reviseAdmin({
      sourcePlanId: 'plan-1',
      newPlanId: 'plan-2',
      format: 'dag',
      definition: definition({ version: 2 }),
    });

    expect(revised).toMatchObject({
      planId: 'plan-2',
      sourcePlanId: 'plan-1',
      revisionKind: 'admin_dag',
      confirmationStatus: 'awaiting_confirmation',
    });
    expect(plans.plans.get('plan-1')?.confirmationStatus).toBe('superseded');
    expect(plans.attempts).toHaveLength(1);
  });

  it('rejects invalid identity without superseding the active source', async () => {
    const plans = repositoryWithSource('confirmed');
    await expect(
      revisionService(plans).reviseAdmin({
        sourcePlanId: 'plan-1',
        newPlanId: 'plan-2',
        format: 'dsl',
        definition: definition({ version: 3 }),
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REVISION_IDENTITY_INVALID' });

    expect(plans.plans.get('plan-1')?.confirmationStatus).toBe('confirmed');
    expect(plans.plans.has('plan-2')).toBe(false);
    expect(plans.attempts).toHaveLength(0);
  });

  it('passes natural-language changes through the schema-bound planner with lineage', async () => {
    const plans = repositoryWithSource('awaiting_confirmation');
    const calls: unknown[] = [];
    const service = revisionService(plans, {
      plan: (input) => {
        calls.push(input);
        return Promise.resolve({
          planId: input.planId,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          goalContract: input.goalContract,
          definition: definition({ version: input.workflowVersion }),
          ...(input.sourcePlanId === undefined ? {} : { sourcePlanId: input.sourcePlanId }),
          ...(input.revisionKind === undefined ? {} : { revisionKind: input.revisionKind }),
          confirmationStatus: 'awaiting_confirmation' as const,
          attemptCount: 1,
          createdAt: '2026-07-12T00:00:00.000Z',
        });
      },
    });
    await service.reviseNaturalLanguage({
      sourcePlanId: 'plan-1',
      newPlanId: 'plan-2',
      instruction: 'Remove the optional notification.',
    });

    expect(calls).toEqual([
      expect.objectContaining({
        planId: 'plan-2',
        workflowVersion: 2,
        sourcePlanId: 'plan-1',
        revisionKind: 'natural_language',
        supersedeSourcePlan: true,
      }),
    ]);
    expect(JSON.stringify(calls[0])).toContain('Remove the optional notification.');
  });
});

function revisionService(
  plans: MemoryPlanRepository,
  planner: { plan(input: PlanWorkflowInput): Promise<WorkflowPlanRecord> } = {
    plan: () => Promise.reject(new Error('UNEXPECTED_PLAN')),
  },
) {
  return new WorkflowRevisionService({
    plans,
    planner,
    validator: new WorkflowValidator({
      tools: {
        exists: () => Promise.resolve(false),
        getInputSchema: () => Promise.resolve(undefined),
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
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
  });
}

function repositoryWithSource(status: 'confirmed' | 'awaiting_confirmation') {
  const repository = new MemoryPlanRepository();
  repository.plans.set('plan-1', {
    planId: 'plan-1',
    goalId: 'goal-1',
    goalVersion: 1,
    goalContract,
    definition: definition(),
    confirmationStatus: status,
    attemptCount: 1,
    createdAt: '2026-07-12T00:00:00.000Z',
  });
  return repository;
}

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    workflowDefinitionId: 'workflow-1',
    version: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    entryNodeId: 'result',
    exitNodeIds: ['result'],
    nodes: [
      { nodeId: 'result', name: 'Result', type: 'result', value: { op: 'literal', value: true } },
    ],
    edges: [],
    ...overrides,
  };
}

const goalContract = {
  goalId: 'goal-1',
  version: 1,
  title: 'Revise workflow',
  description: 'Revise the workflow safely.',
  constraints: ['safe'],
  successCriteria: ['valid revision'],
} as const;

class MemoryPlanRepository implements WorkflowPlanRepository {
  attempts: WorkflowPlanAttempt[] = [];
  plans = new Map<string, WorkflowPlanRecord>();
  findPlan(id: string) {
    return Promise.resolve(this.plans.get(id));
  }
  findConfirmedDefinition() {
    return Promise.resolve(undefined);
  }
  confirmPlan() {
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
    if (
      source === undefined ||
      !['confirmed', 'awaiting_confirmation'].includes(source.confirmationStatus)
    )
      return Promise.reject(new Error('WORKFLOW_REVISION_SOURCE_INACTIVE'));
    this.plans.set(sourcePlanId, { ...source, confirmationStatus: 'superseded' });
    this.plans.set(value.planId, value);
    return Promise.resolve();
  }
}
