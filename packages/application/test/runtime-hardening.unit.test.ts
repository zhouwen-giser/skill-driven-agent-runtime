import { describe, expect, it } from 'vitest';

import {
  CognitiveRuntimeReconciler,
  DeletionPropagationService,
  FeatureRolloutPolicy,
  RetentionService,
} from '../src/index.js';
import {
  DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
  type MemoryRetentionPolicy,
} from '../../domain/src/index.js';

const policy: MemoryRetentionPolicy = {
  reviewAfterDays: 90,
  archiveAfterDays: null,
  deleteAfterDays: null,
  automaticArchiveEnabled: false,
  automaticDeleteEnabled: false,
  updatedAt: '2026-07-26T11:30:00.000Z',
};

describe('G17 cognitive runtime hardening', () => {
  it('rebuilds every PostgreSQL-authoritative wake and Active projection after Redis loss', async () => {
    const calls: string[] = [];
    const operation = (name: string, count: number) => () => {
      calls.push(name);
      return Promise.resolve(count);
    };
    const report = await new CognitiveRuntimeReconciler({
      dispatchTerminalOutbox: operation('outbox', 2),
      requeueExperience: operation('experience', 3),
      requeueObservation: operation('observation', 4),
      requeueReflection: operation('reflection', 5),
      rebuildActiveKnowledge: operation('knowledge', 6),
    }).rebuild();

    expect(calls).toEqual(['outbox', 'experience', 'observation', 'reflection', 'knowledge']);
    expect(report).toEqual({
      terminalOutboxDispatched: 2,
      experienceJobsRequeued: 3,
      observationJobsRequeued: 4,
      reflectionJobsRequeued: 5,
      activeKnowledgeProjectionsRebuilt: 6,
    });
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('applies review-only retention and never archives or deletes V1 history', async () => {
    const service = new RetentionService({
      policies: {
        getPolicy: () => Promise.resolve(policy),
        updatePolicy: () => Promise.resolve(policy),
      },
      reviewers: [{ review: () => Promise.resolve(2) }, { review: () => Promise.resolve(3) }],
    });

    await expect(service.apply()).resolves.toEqual({
      policy,
      reviewedCount: 5,
      archivedCount: 0,
      deletedCount: 0,
    });
  });

  it('propagates user deletion across named projections without changing source facts', async () => {
    const calls: string[] = [];
    const service = new DeletionPropagationService({
      targets: [
        {
          name: 'planning_preferences',
          deleteUserScope: (userId, actorId) => {
            calls.push(`${userId}:${actorId}`);
            return Promise.resolve(2);
          },
        },
        {
          name: 'active_knowledge_search',
          deleteUserScope: () => Promise.resolve(1),
        },
      ],
    });

    await expect(service.propagate('user.one', 'privacy.operator')).resolves.toEqual({
      userId: 'user.one',
      deletedCount: 3,
      targets: { planning_preferences: 2, active_knowledge_search: 1 },
    });
    expect(calls).toEqual(['user.one:privacy.operator']);
  });

  it('enforces the frozen rollout order and low-risk manual-review gate', () => {
    const rollout = new FeatureRolloutPolicy();
    expect(
      ['capture', 'observe', 'candidate', 'shadow'].map(
        (stage) =>
          rollout.evaluate({
            stage: stage as 'capture' | 'observe' | 'candidate' | 'shadow',
            flags: DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
          }).enabled,
      ),
    ).toEqual([true, true, true, true]);
    expect(
      rollout.evaluate({
        stage: 'advisory',
        flags: DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
      }).enabled,
    ).toBe(false);

    const activeFlags = {
      ...DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
      injectionMode: 'active_low_risk' as const,
    };
    expect(
      rollout.evaluate({
        stage: 'active_low_risk',
        flags: activeFlags,
        risk: 'low',
        humanApproved: true,
      }).enabled,
    ).toBe(true);
    expect(
      rollout.evaluate({
        stage: 'active_low_risk',
        flags: activeFlags,
        risk: 'high',
        humanApproved: true,
      }).enabled,
    ).toBe(false);
  });
});
