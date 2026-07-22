import { describe, expect, it } from 'vitest';

import {
  createPlanningCorrectionFact,
  type PlanningCorrectionFact,
} from '../../domain/src/index.js';
import { PlanningCorrectionService, PlanningPreferenceProjector } from '../src/cognitive/index.js';
import type {
  PlanningCorrectionRepository,
  PlanningInteractionEpisodeBuilderPort,
} from '../src/cognitive/ports.js';

describe('G06 planning correction facts', () => {
  it('freezes complete before/instruction/patch/after/validation evidence and scope', () => {
    const fact = correctionFact();
    expect(fact.target).toBe('skill_goal_plan');
    expect(fact.scope).toBe('task');
    expect(fact.beforeSnapshot).toEqual({ plan: 1 });
    expect(fact.afterSnapshot).toEqual({ plan: 2 });
    expect(Object.isFrozen(fact.structuredPatch)).toBe(true);
    const { userId: _userId, ...withoutUser } = fact;
    void _userId;
    expect(() => createPlanningCorrectionFact({ ...withoutUser, scope: 'user' })).toThrow(
      'User-scoped correction requires userId',
    );
  });

  it('records one idempotent fact and appends a deterministic interaction episode', async () => {
    const repository = new InMemoryPlanningCorrectionRepository();
    let projectionAttempts = 0;
    const builder: PlanningInteractionEpisodeBuilderPort = {
      build(input) {
        return Promise.resolve({
          schemaVersion: '1.0',
          episodeId: `episode-${String(repository.episodes.length + 1)}`,
          taskId: input.taskId,
          revision: repository.episodes.length + 1,
          originalRequest: 'Inspect pump and report in a table.',
          turns: [],
          correctionIds: repository.facts.map((fact) => fact.correctionId),
          ...(input.outcomeRef === undefined ? {} : { outcomeRef: input.outcomeRef }),
          counterexampleRefs: input.counterexampleRefs ?? [],
          completeness: input.outcomeRef === undefined ? 0.75 : 1,
          inductionFingerprint: hash('b'),
          episodeHash: hash(input.outcomeRef === undefined ? 'c' : 'd'),
          sourceRefs: [sourceRef('episode-source')],
          createdAt: '2026-07-23T05:00:00.000Z',
        });
      },
    };
    const service = new PlanningCorrectionService({
      repository,
      builder,
      preferences: {
        projectLowRisk: () => {
          projectionAttempts += 1;
          return Promise.resolve();
        },
        deleteUserScope: () => Promise.resolve(0),
      },
      clock: { now: () => '2026-07-23T05:00:00.000Z' },
      nextCorrectionId: () => 'correction-1',
    });
    const input = {
      taskId: 'task-1',
      sessionId: 'planning-session-1',
      turnId: 'turn-1',
      idempotencyKey: 'patch-1',
      actorId: 'user-1',
      target: 'skill_goal_plan' as const,
      correctionType: 'wrong_dependency' as const,
      scope: 'task' as const,
      beforeSnapshot: { plan: 1 },
      userInstruction: 'Run inspection before reporting.',
      structuredPatch: { dependencies: ['inspect->report'] },
      afterSnapshot: { plan: 2 },
      validation: { valid: true },
      accepted: true,
      sourceRefs: [sourceRef('plan-source')],
    };

    const first = await service.record(input);
    const duplicate = await service.record(input);
    expect(first.fact.correctionId).toBe('correction-1');
    expect(duplicate.fact.correctionId).toBe('correction-1');
    expect(repository.facts).toHaveLength(1);
    expect(repository.episodes).toHaveLength(1);
    expect(projectionAttempts).toBe(2);

    await service.recordOutcome({
      taskId: 'task-1',
      outcomeRef: 'runtime-outcome:outcome-1',
      counterexampleRefs: ['counterexample:later-failure'],
    });
    expect(repository.episodes).toHaveLength(2);
    expect(repository.episodes[0]?.outcomeRef).toBeUndefined();
    expect(repository.episodes[1]?.outcomeRef).toBe('runtime-outcome:outcome-1');
  });

  it('projects only explicit low-risk user preferences and propagates deletion', async () => {
    const memories = new FakeScopedMemories();
    const projector = new PlanningPreferenceProjector({ memories });

    await expect(
      projector.projectLowRisk(
        correctionFact({
          scope: 'user',
          userId: 'user-1',
          preferenceCategory: 'report_format',
        }),
      ),
    ).resolves.toMatchObject({ scope: 'user', userId: 'user-1' });
    await expect(
      projector.projectLowRisk(
        correctionFact({
          correctionId: 'correction-unsafe',
          scope: 'user',
          userId: 'user-1',
          correctionType: 'unsafe_side_effect',
          preferenceCategory: 'report_format',
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      projector.projectLowRisk(
        correctionFact({
          correctionId: 'correction-global',
          scope: 'global_candidate',
          preferenceCategory: 'report_format',
        }),
      ),
    ).resolves.toBeUndefined();

    expect(
      await projector.deleteUserScope(
        'user-1',
        [correctionFact({ scope: 'user', userId: 'user-1', preferenceCategory: 'report_format' })],
        'user-delete',
      ),
    ).toBe(1);
    expect(memories.items.get('planning-preference-correction-1')?.status).toBe('invalid');
  });
});

class InMemoryPlanningCorrectionRepository implements PlanningCorrectionRepository {
  readonly facts: PlanningCorrectionFact[] = [];
  readonly episodes: Awaited<ReturnType<PlanningInteractionEpisodeBuilderPort['build']>>[] = [];

  findByIdempotencyKey(taskId: string, key: string) {
    return Promise.resolve(
      this.facts.find((fact) => fact.taskId === taskId && fact.idempotencyKey === key),
    );
  }
  async saveIfAbsent(fact: PlanningCorrectionFact) {
    const existing = await this.findByIdempotencyKey(fact.taskId, fact.idempotencyKey);
    if (existing !== undefined) return { fact: existing, inserted: false as const };
    this.facts.push(fact);
    return { fact, inserted: true as const };
  }
  listByTask(taskId: string) {
    return Promise.resolve(this.facts.filter((fact) => fact.taskId === taskId));
  }
  listUserScoped(userId: string) {
    return Promise.resolve(
      this.facts.filter((fact) => fact.scope === 'user' && fact.userId === userId),
    );
  }
  listTenantScoped(tenantId: string) {
    return Promise.resolve(
      this.facts.filter((fact) => fact.scope === 'tenant' && fact.tenantId === tenantId),
    );
  }
  saveEpisode(episode: (typeof this.episodes)[number]) {
    if (this.episodes.some((item) => item.episodeHash === episode.episodeHash)) {
      return Promise.resolve(false);
    }
    this.episodes.push(episode);
    return Promise.resolve(true);
  }
  listEpisodes(taskId: string) {
    return Promise.resolve(this.episodes.filter((episode) => episode.taskId === taskId));
  }
}

class FakeScopedMemories {
  readonly items = new Map<
    string,
    Record<string, unknown> & {
      memoryId: string;
      status: 'active' | 'superseded' | 'invalid';
      scope?: 'global' | 'user';
      userId?: string;
    }
  >();
  create(input: Record<string, unknown> & { memoryId?: string }) {
    const item = {
      ...input,
      memoryId: input.memoryId ?? 'generated',
      status: 'active' as const,
    };
    this.items.set(item.memoryId, item);
    return Promise.resolve(item);
  }
  get(memoryId: string) {
    const item = this.items.get(memoryId);
    if (item === undefined) throw new Error('MEMORY_NOT_FOUND');
    return Promise.resolve(item);
  }
  async invalidate(memoryId: string) {
    const item = await this.get(memoryId);
    this.items.set(memoryId, { ...item, status: 'invalid' });
  }
}

function correctionFact(overrides: Partial<PlanningCorrectionFact> = {}): PlanningCorrectionFact {
  return createPlanningCorrectionFact({
    schemaVersion: '1.0',
    correctionId: 'correction-1',
    taskId: 'task-1',
    sessionId: 'planning-session-1',
    turnId: 'turn-1',
    idempotencyKey: 'patch-1',
    actorId: 'user-1',
    target: 'skill_goal_plan',
    correctionType: 'wrong_dependency',
    scope: 'task',
    beforeSnapshot: { plan: 1 },
    userInstruction: 'Run inspection before reporting.',
    structuredPatch: { dependencies: ['inspect->report'] },
    afterSnapshot: { plan: 2 },
    validation: { valid: true },
    accepted: true,
    counterexampleRefs: [],
    correctionHash: hash('a'),
    sourceRefs: [sourceRef('correction-source')],
    createdAt: '2026-07-23T05:00:00.000Z',
    ...overrides,
  });
}

function sourceRef(id: string) {
  return {
    schemaVersion: '1.0' as const,
    sourceRefId: id,
    sourceKind: 'planning_correction' as const,
    sourceId: id,
    sourceRevision: 1,
    authority: 'user_instruction' as const,
    dataClassification: 'user_scoped' as const,
    capturedAt: '2026-07-23T05:00:00.000Z',
  };
}

function hash(seed: string) {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}
