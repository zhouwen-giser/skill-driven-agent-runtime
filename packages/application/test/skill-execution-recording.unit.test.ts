import { describe, expect, it, vi } from 'vitest';

import {
  snapshotSkillUsageCompositionPlan,
  snapshotSkillUsagePlanPolicy,
  type SkillExecutionView,
} from '../../domain/src/index.js';
import { SkillExecutionRecordingService, type SkillExecutionRepository } from '../src/index.js';

function policy() {
  const composition = snapshotSkillUsageCompositionPlan({
    root: { skillId: 'skill-root', skillVersion: 2 },
    expandedSkills: [
      { skillId: 'skill-root', skillVersion: 2 },
      { skillId: 'skill-child', skillVersion: 4 },
    ],
    edges: [
      {
        edgeId: 'edge-child',
        kind: 'fixed_dependency',
        declarationId: 'dependency-child',
        parent: { skillId: 'skill-root', skillVersion: 2 },
        child: { skillId: 'skill-child', skillVersion: 4 },
        candidateSet: [{ skillId: 'skill-child', skillVersion: 4 }],
        failurePolicy: 'degraded',
        inputMappings: [],
        outputMappings: [],
        depth: 1,
      },
    ],
    maxDepth: 3,
    consumedDepth: 1,
    consumedSkills: 2,
    consumedNodes: 1,
  });
  return snapshotSkillUsagePlanPolicy({
    skill: composition.root,
    mode: 'procedure',
    modeDecision: {
      decision: 'selected',
      mode: 'procedure',
      confirmationRequired: true,
      confirmationSatisfied: false,
      reasonCodes: ['high_risk'],
    },
    constraints: ['Stay within policy.'],
    forbiddenActions: [],
    adaptiveInstructions: [],
    requiredConfirmations: ['confirm-motion'],
    requiredContextIds: ['position'],
    allowedTools: [],
    taskOperations: [
      {
        bindingId: 'move',
        taskType: 'embodied.move',
        providerId: 'provider-1',
        operationName: 'move_to',
      },
    ],
    childPolicies: [
      {
        edgeId: 'edge-child',
        child: { skillId: 'skill-child', skillVersion: 4 },
        failurePolicy: 'degraded',
        inputMappings: [],
        outputMappings: [],
      },
    ],
    evidenceRequirements: [
      {
        requirementId: 'final-position',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      },
    ],
    rejectSuccessWithoutRequiredEvidence: true,
    composition,
    context: {
      requirements: [
        {
          requirementId: 'position',
          required: true,
          status: 'satisfied',
          source: 'authoritative_context',
          evidenceRef: 'evidence-position',
          attemptedSources: ['authoritative_context'],
        },
      ],
      satisfied: 1,
      total: 1,
      complete: true,
      inputRequiredIds: [],
      unsatisfiedIds: [],
      unknownIds: [],
    },
    readiness: {
      overall: 'ready',
      bindings: [
        {
          bindingId: 'move',
          taskType: 'embodied.move',
          disposition: 'ready',
          confirmationRequired: true,
          reasonCodes: [],
          selectedProviderId: 'provider-1',
          selectedOperationName: 'move_to',
        },
      ],
    },
  });
}

describe('SkillExecutionRecordingService', () => {
  it('records exact planning events and thin references without changing Task authority', async () => {
    let sequence = 0;
    const create = vi.fn<SkillExecutionRepository['create']>((record, events, references) =>
      Promise.resolve({
        ...record,
        status: 'planning',
        events,
        references,
      } satisfies SkillExecutionView),
    );
    const repository: SkillExecutionRepository = {
      create,
      appendEvent: vi.fn(),
      appendReference: vi.fn(),
      find: vi.fn(),
      findByPlan: vi.fn(),
      listByTask: vi.fn(),
      listChildren: vi.fn(),
    };
    const service = new SkillExecutionRecordingService({
      repository,
      clock: { now: () => '2026-07-17T12:00:00.000Z' },
      nextId: (kind) => `${kind}-${String(++sequence)}`,
    });

    const view = await service.recordPlanning({
      executionId: 'execution-root',
      taskId: 'task-root',
      goalId: 'goal-root',
      goalVersion: 3,
      selectionRef: 'selection-root',
      applicabilityStatus: 'satisfied',
      policy: policy(),
      workflowPlanId: 'plan-root',
      workflowDefinitionId: 'workflow-root',
      workflowDefinitionVersion: 5,
      procedureCompiled: true,
      planCompliancePassed: true,
    });

    expect(view.status).toBe('planning');
    expect(view.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'skill.discovered',
        'skill.applicability_assessed',
        'skill.selected',
        'skill.mode_selected',
        'skill.context_resolved',
        'skill.composition_started',
        'skill.child_selected',
        'skill.plan_generated',
        'skill.procedure_compiled',
        'skill.plan_compliance_passed',
        'skill.hard_gate_triggered',
        'skill.human_intervention',
      ]),
    );
    expect(view.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'provider', referenceId: 'provider-1' }),
        expect.objectContaining({ kind: 'resource', referenceId: 'provider-1/move_to' }),
        expect.objectContaining({ kind: 'evidence', referenceId: 'evidence-position' }),
        expect.objectContaining({ kind: 'hard_gate', referenceId: 'final-position' }),
        expect.objectContaining({ kind: 'human_intervention', referenceId: 'confirm-motion' }),
      ]),
    );
    expect(create).toHaveBeenCalledOnce();
  });
});
