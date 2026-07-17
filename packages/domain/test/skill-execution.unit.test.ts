import { describe, expect, it } from 'vitest';

import {
  SKILL_EXECUTION_EVENT_TYPES,
  assertSkillExecutionStatusTransition,
  createSkillExecutionEvent,
  createSkillExecutionRecord,
  createSkillExecutionReference,
  snapshotSkillUsageCompositionPlan,
  snapshotSkillUsagePlanPolicy,
} from '../src/index.js';

function usagePolicy() {
  const composition = snapshotSkillUsageCompositionPlan({
    root: { skillId: 'skill.execute', skillVersion: 3 },
    expandedSkills: [{ skillId: 'skill.execute', skillVersion: 3 }],
    edges: [],
    maxDepth: 3,
    consumedDepth: 0,
    consumedSkills: 1,
    consumedNodes: 0,
  });
  return snapshotSkillUsagePlanPolicy({
    skill: composition.root,
    mode: 'guidance',
    modeDecision: {
      decision: 'selected',
      mode: 'guidance',
      confirmationRequired: false,
      confirmationSatisfied: true,
      reasonCodes: ['safe_default'],
    },
    constraints: [],
    forbiddenActions: [],
    adaptiveInstructions: ['Use bounded evidence.'],
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
  });
}

describe('Skill execution evidence contract', () => {
  it('pins exact Goal, Skill, policy and Workflow identities', () => {
    const record = createSkillExecutionRecord({
      executionId: 'execution-1',
      taskId: 'task-1',
      goalId: 'goal-1',
      goalVersion: 2,
      skillId: 'skill.execute',
      skillVersion: 3,
      selectionRef: 'selection-1',
      applicabilityStatus: 'satisfied',
      usagePolicy: usagePolicy(),
      workflowPlanId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowDefinitionVersion: 4,
      createdAt: '2026-07-17T00:00:00.000Z',
    });

    expect(record.usagePolicy.skill).toEqual({ skillId: 'skill.execute', skillVersion: 3 });
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => createSkillExecutionRecord({ ...record, skillVersion: 4 })).toThrow(
      /identity must match/u,
    );
  });

  it('accepts every frozen event name while rejecting private or cyclic detail data', () => {
    expect(SKILL_EXECUTION_EVENT_TYPES).toHaveLength(20);
    for (const eventType of SKILL_EXECUTION_EVENT_TYPES)
      expect(
        createSkillExecutionEvent({
          eventId: `event-${eventType}`,
          executionId: 'execution-1',
          eventType,
          summary: eventType,
          details: {},
          occurredAt: '2026-07-17T00:00:00.000Z',
        }).eventType,
      ).toBe(eventType);

    const cyclic: Record<string, unknown> = {};
    cyclic['cycle'] = cyclic;
    expect(() =>
      createSkillExecutionEvent({
        eventId: 'event-cycle',
        executionId: 'execution-1',
        eventType: 'skill.discovered',
        summary: 'Cyclic details.',
        details: cyclic,
        occurredAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toThrow(/acyclic/u);
    expect(() =>
      createSkillExecutionEvent({
        eventId: 'event-private',
        executionId: 'execution-1',
        eventType: 'skill.discovered',
        summary: 'Forbidden private field.',
        details: { private_reasoning: 'must-not-persist' },
        occurredAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toThrow(/Private reasoning/u);
    expect(() =>
      createSkillExecutionEvent({
        eventId: 'event-credential',
        executionId: 'execution-1',
        eventType: 'skill.discovered',
        summary: 'Forbidden credential field.',
        details: { authorization: 'must-not-persist' },
        occurredAt: '2026-07-17T00:00:00.000Z',
      }),
    ).toThrow(/Credential/u);
  });

  it('enforces forward-only status transitions and terminal immutability', () => {
    expect(() => {
      assertSkillExecutionStatusTransition('selected', 'planning');
    }).not.toThrow();
    expect(() => {
      assertSkillExecutionStatusTransition('planning', 'completed');
    }).toThrow();
    expect(() => {
      assertSkillExecutionStatusTransition('completed', 'executing');
    }).toThrow();
    expect(() => {
      assertSkillExecutionStatusTransition('waiting_external', 'executing');
    }).not.toThrow();
  });

  it('validates thin evidence references and SHA-256 checksums', () => {
    const reference = createSkillExecutionReference({
      linkId: 'link-1',
      executionId: 'execution-1',
      kind: 'evidence',
      referenceId: 'evidence-1',
      referenceType: 'inspection.result',
      sourceSystem: 'sdar',
      uri: 'urn:sdar:evidence:evidence-1',
      checksum: 'a'.repeat(64),
      producedAt: '2026-07-17T00:00:01.000Z',
      producerRefs: ['provider-1'],
      metadata: { verified: true },
      createdAt: '2026-07-17T00:00:02.000Z',
    });

    expect(reference.metadata).toEqual({ verified: true });
    expect(() => createSkillExecutionReference({ ...reference, checksum: 'not-a-digest' })).toThrow(
      /SHA-256/u,
    );
  });
});
