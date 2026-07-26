import { describe, expect, it, vi } from 'vitest';

import {
  BasePlannerFallbackPolicy,
  ExperienceEnrichedUserGoalPlanningService,
  type PlanningExperienceContext,
} from '../src/index.js';
import {
  createExperienceUsageRecord,
  createPlanningKnowledgeBundle,
  type Goal,
  type UserGoalCompletionContract,
  type UserGoalPlan,
} from '../../domain/src/index.js';

const goal: Goal = {
  goalId: 'goal.experience.plan',
  contextId: 'context.experience.plan',
  version: 1,
  title: 'Inspect pump',
  description: 'Inspect pump pressure safely.',
  constraints: ['Do not modify the pump.'],
  successCriteria: ['Pressure evidence is recorded.'],
  status: 'active',
  createdAt: '2026-07-26T09:30:00.000Z',
  updatedAt: '2026-07-26T09:30:00.000Z',
};

describe('G14 experience-enriched planning', () => {
  it('keeps off mode on the independent base Planner without retrieving experience', async () => {
    const fixture = planningFixture();
    const result = await fixture.service.plan(input('off'));
    expect(result).toMatchObject({ selected: 'base', mode: 'off', usageRecords: [] });
    expect(fixture.contexts.build).not.toHaveBeenCalled();
    expect(fixture.base.generateCandidate).toHaveBeenCalledTimes(1);
  });

  it('runs shadow planning without changing the formal base candidate', async () => {
    const fixture = planningFixture();
    const result = await fixture.service.plan(input('shadow'));
    expect(result.plan.planId).toBe('plan.base.1');
    expect(result).toMatchObject({
      selected: 'base',
      mode: 'shadow',
      shadow: { planHash: `sha256:${'2'.repeat(64)}` },
    });
    expect(fixture.base.generateCandidate).toHaveBeenCalledTimes(2);
    expect(result.usageRecords[0]?.influence).toMatchObject({
      affectedSkillGoalIds: ['skill-goal.enriched'],
    });
  });

  it('uses advisory context but requires manual confirmation', async () => {
    const fixture = planningFixture();
    const result = await fixture.service.plan(input('advisory'));
    expect(result).toMatchObject({
      selected: 'experience',
      mode: 'advisory',
      requiresManualConfirmation: true,
    });
    expect(result.plan.planId).toBe('plan.enriched.1');
  });

  it('uses active mode only for low-risk knowledge', async () => {
    const fixture = planningFixture();
    await expect(fixture.service.plan(input('active_low_risk'))).resolves.toMatchObject({
      selected: 'experience',
      requiresManualConfirmation: false,
    });
    fixture.contexts.build.mockResolvedValueOnce(context({ risk: 'high' }));
    await expect(fixture.service.plan(input('active_low_risk'))).resolves.toMatchObject({
      selected: 'base',
      fallbackReason: 'knowledge_risk_not_low',
      usageRecords: [
        {
          affectedSkillGoalIds: [],
          influence: {
            affectedSkillGoalIds: [],
            fallbackReason: 'knowledge_risk_not_low',
          },
        },
      ],
    });
  });

  it.each(['repository_failed', 'timeout', 'conflict', 'low_confidence'] as const)(
    'fails open to one base plan when experience is %s',
    async (reason) => {
      const fixture = planningFixture();
      if (reason === 'repository_failed')
        fixture.contexts.build.mockRejectedValueOnce(new Error('database unavailable'));
      else if (reason === 'timeout')
        fixture.contexts.build.mockImplementationOnce(() => new Promise(() => undefined));
      else
        fixture.contexts.build.mockResolvedValueOnce(
          context(reason === 'conflict' ? { conflicts: 1 } : { definitions: 0 }),
        );
      await expect(fixture.service.plan(input('advisory'))).resolves.toMatchObject({
        selected: 'base',
        fallbackReason: reason,
      });
      expect(fixture.base.generateCandidate).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back at most once when the enriched candidate is invalid', async () => {
    const fixture = planningFixture();
    fixture.base.generateCandidate
      .mockRejectedValueOnce(new Error('USER_GOAL_PLAN_CYCLE'))
      .mockResolvedValueOnce(candidate('base'));
    await expect(fixture.service.plan(input('advisory'))).resolves.toMatchObject({
      selected: 'base',
      fallbackReason: 'enhanced_plan_invalid',
    });
    expect(fixture.base.generateCandidate).toHaveBeenCalledTimes(2);
  });

  it('keeps an invalid shadow candidate non-authoritative and records its exact fallback', async () => {
    const fixture = planningFixture();
    fixture.base.generateCandidate
      .mockResolvedValueOnce(candidate('base'))
      .mockRejectedValueOnce(new Error('USER_GOAL_PLAN_CYCLE'));
    await expect(fixture.service.plan(input('shadow'))).resolves.toMatchObject({
      selected: 'base',
      fallbackReason: 'enhanced_plan_invalid',
      plan: { planId: 'plan.base.1' },
    });
    expect(fixture.base.generateCandidate).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed usage feedback before it can enter persistence', () => {
    const usage = context().usageRecords[0];
    if (usage === undefined) throw new Error('TEST_USAGE_REQUIRED');
    expect(() =>
      createExperienceUsageRecord({ ...usage, userAction: 'approved' as never }),
    ).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_USAGE_INVALID' }));
    expect(() => createExperienceUsageRecord({ ...usage, validatorResult: [] as never })).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_USAGE_INVALID' }),
    );
  });
});

function planningFixture() {
  const base = {
    generateCandidate: vi
      .fn()
      .mockImplementation((request: Readonly<{ planningContext?: unknown }>) =>
        Promise.resolve(candidate(request.planningContext === undefined ? 'base' : 'enriched')),
      ),
  };
  const contexts = { build: vi.fn().mockResolvedValue(context()) };
  return {
    base,
    contexts,
    service: new ExperienceEnrichedUserGoalPlanningService({
      base,
      contexts,
      fallback: new BasePlannerFallbackPolicy(),
      timeoutMs: 10,
    }),
  };
}

function input(mode: 'off' | 'shadow' | 'advisory' | 'active_low_risk') {
  return {
    mode,
    taskId: 'task.experience.plan',
    userId: 'user.experience.plan',
    planningSessionId: 'planning-session.experience.plan',
    planCandidateId: 'plan-candidate.experience.plan',
    catalogHash: `sha256:${'1'.repeat(64)}`,
    promotionPolicyVersion: 'knowledge-promotion-v1',
    goal,
  };
}

function context(
  options: Readonly<{ risk?: 'low' | 'high'; conflicts?: number; definitions?: number }> = {},
): PlanningExperienceContext {
  const definitions = options.definitions ?? 1;
  const definitionValues = Array.from({ length: definitions }, () => ({
    schemaVersion: '1.0' as const,
    kind: 'planning_heuristic' as const,
    knowledgeId: 'knowledge.experience.plan',
    revision: 1,
    version: 2,
    status: 'active' as const,
    scope: 'global_candidate' as const,
    risk: options.risk ?? ('low' as const),
    title: 'Inspect first',
    summary: 'Inspect before changing state.',
    definition: { applicableConditions: ['inspect'] },
    authoritativeRef: 'planning_heuristic:knowledge.experience.plan:1',
    exactSkillVersionRefs: [],
    promotionPolicyVersion: 'knowledge-promotion-v1',
    createdAt: '2026-07-26T09:30:00.000Z',
  }));
  const conflictValues = Array.from({ length: options.conflicts ?? 0 }, () => ({
    schemaVersion: '1.0' as const,
    relationId: 'relation.experience.conflict',
    sourceKind: 'planning_heuristic' as const,
    sourceKnowledgeId: 'knowledge.experience.plan',
    sourceRevision: 1,
    targetKind: 'planning_heuristic' as const,
    targetKnowledgeId: 'knowledge.experience.conflict',
    targetRevision: 1,
    relationType: 'contradicts' as const,
    evidenceRefs: [],
    createdAt: '2026-07-26T09:30:00.000Z',
  }));
  const budgeted = {
    index: [],
    definitions: definitionValues,
    exactSkills: [],
    conflicts: conflictValues,
  };
  return {
    bundle: createPlanningKnowledgeBundle({
      schemaVersion: '1.0',
      queryFingerprint: `sha256:${'3'.repeat(64)}`,
      ...budgeted,
      disclosureOrder: [],
      characterCount: JSON.stringify(budgeted).length,
      truncated: false,
      elapsedMs: 1,
    }),
    usageRecords: [
      createExperienceUsageRecord({
        schemaVersion: '1.0',
        usageId: 'usage.experience.plan',
        planningSessionId: 'planning-session.experience.plan',
        planCandidateId: 'plan-candidate.experience.plan',
        knowledgeKind: 'planning_heuristic',
        knowledgeId: 'knowledge.experience.plan',
        knowledgeRevision: 1,
        authoritativeRef: 'planning_heuristic:knowledge.experience.plan:1',
        queryFingerprint: `sha256:${'3'.repeat(64)}`,
        retrievalRank: 1,
        injectionMode: 'advisory',
        affectedSkillGoalIds: [],
        influence: { rrfScore: 1, sources: ['text', 'vector'] },
        createdAt: '2026-07-26T09:30:00.000Z',
      }),
    ],
  };
}

function candidate(kind: 'base' | 'enriched'): Readonly<{
  contract: UserGoalCompletionContract;
  plan: UserGoalPlan;
}> {
  const contract: UserGoalCompletionContract = {
    schemaVersion: '1.0',
    goalId: goal.goalId,
    goalVersion: goal.version,
    title: goal.title,
    description: goal.description,
    constraints: goal.constraints,
    criteria: [
      {
        criterionId: 'criterion-1',
        description: goal.successCriteria[0] ?? 'Evidence',
        required: true,
        expectedEffectRefs: ['effect-1'],
        evidenceRequirements: ['evidence-1'],
        artifactRequirements: [],
      },
    ],
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  };
  const skillGoalId = kind === 'base' ? 'skill-goal.base' : 'skill-goal.enriched';
  return {
    contract,
    plan: {
      schemaVersion: '1.0',
      planId: `plan.${kind}.1`,
      goalId: goal.goalId,
      goalVersion: goal.version,
      revision: 1,
      revisionKind: 'initial',
      status: 'validated',
      contractHash: `sha256:${'1'.repeat(64)}`,
      contentHash: `sha256:${kind === 'base' ? '1'.repeat(64) : '2'.repeat(64)}`,
      skillGoals: [
        {
          skillGoalId,
          requiredResult: 'Pressure evidence.',
          capabilityNeeds: ['inspection'],
          coveredCriterionIds: ['criterion-1'],
          requiredEffectRefs: ['effect-1'],
          evidenceRequirements: ['evidence-1'],
          artifactRequirements: [],
          assumptions: [],
          constraints: goal.constraints,
          status: 'pending',
        },
      ],
      dependencies: [],
      inheritedCompletedEffectIds: [],
      forbiddenReplayFingerprints: [],
      createdAt: '2026-07-26T09:30:00.000Z',
    },
  };
}
