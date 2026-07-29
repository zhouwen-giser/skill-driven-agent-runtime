import { describe, expect, it } from 'vitest';

import {
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  createCohortDefinition,
  createExperienceTrace,
  type ExperienceActivityKind,
  type ExperienceTrace,
  type ExperienceTraceEvent,
  type ExperienceTraceEventType,
} from '../../domain/src/index.js';
import { DeterministicProcessMiner } from '../src/compiler/process-miner.js';

const baseTime = Date.parse('2026-07-27T03:00:00.000Z');
const sha = (character: string): string => `sha256:${character.repeat(64)}`;

describe('DeterministicProcessMiner Activity Identity V1.2', () => {
  it('mines activityKey rather than lifecycle eventType and is byte-stable', async () => {
    const traces = goldenTraces();
    const miner = new DeterministicProcessMiner({ mandatoryThreshold: 2 / 3 });
    const first = await miner.discover(goldenCohort(), traces);
    const second = await miner.discover(goldenCohort(), [...traces].reverse());

    expect(first).toEqual(second);
    expect(first.discoveredPattern.mandatoryActivities).toEqual(
      expect.arrayContaining(['skill-goal:inspect', 'skill-goal:verify']),
    );
    expect(first.discoveredPattern.mandatoryActivities).not.toContain('skill_attempt_started');
    expect(first.workflowPattern.activityPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityKey: 'skill-goal:inspect',
          activityKind: 'skill_goal',
          objectiveSummary: 'Inspect the workflow',
          lifecycleEventTypes: expect.arrayContaining([
            'skill_attempt_started',
            'skill_attempt_completed',
          ]),
        }),
      ]),
    );
  });

  it('collapses start/complete for one attempt but preserves repeated A→A attempts and self-loop', async () => {
    const result = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-loop', 'succeeded', [
        lifecycle('goal_created', 0),
        activityEvent('skill_attempt_started', 1, 'skill-goal:inspect', 'attempt-a'),
        activityEvent('skill_attempt_completed', 2, 'skill-goal:inspect', 'attempt-a'),
        activityEvent('skill_attempt_started', 3, 'skill-goal:inspect', 'attempt-b'),
        activityEvent('skill_attempt_completed', 4, 'skill-goal:inspect', 'attempt-b'),
        lifecycle('goal_completed', 5),
      ]),
    ]);

    expect(result.variants[0]?.activitySequence).toEqual([
      'skill-goal:inspect',
      'skill-goal:inspect',
    ]);
    expect(result.discoveredPattern.orderingConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predecessorActivity: 'skill-goal:inspect',
          successorActivity: 'skill-goal:inspect',
          relation: 'direct_follows',
        }),
      ]),
    );
  });

  it('uses explicit concurrency evidence and never timestamp coincidence', async () => {
    const explicit = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-explicit', 'succeeded', [
        activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-a', {
          concurrencyGroup: 'parallel-1',
        }),
        activityEvent('business_event_observed', 1, 'provider-observation:state', 'observation-a', {
          activityKind: 'observation',
          concurrencyGroup: 'parallel-1',
        }),
      ]),
    ]);
    const timestampOnly = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-timestamp', 'succeeded', [
        activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-a'),
        activityEvent('business_event_observed', 1, 'provider-observation:state', 'observation-a', {
          activityKind: 'observation',
        }),
      ]),
    ]);

    expect(explicit.discoveredPattern.parallelCandidates).toEqual([
      expect.objectContaining({
        activityRefs: ['provider-observation:state', 'skill-goal:inspect'],
        evidenceType: 'explicit_concurrency',
      }),
    ]);
    expect(
      explicit.workflowPattern.dependencyPatterns.filter(
        (dependency) =>
          new Set([dependency.predecessorActivityKey, dependency.successorActivityKey]).size === 2,
      ),
    ).toEqual([
      expect.objectContaining({
        predecessorActivityKey: 'provider-observation:state',
        successorActivityKey: 'skill-goal:inspect',
        relation: 'parallel',
      }),
    ]);
    expect(timestampOnly.discoveredPattern.parallelCandidates).toEqual([]);
  });

  it('preserves repeated activity occurrences inside an explicit parallel group', async () => {
    const result = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-parallel-repeat', 'succeeded', [
        activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-a', {
          concurrencyGroup: 'parallel-repeat',
        }),
        activityEvent('skill_attempt_started', 1, 'skill-goal:inspect', 'attempt-b', {
          concurrencyGroup: 'parallel-repeat',
        }),
      ]),
    ]);

    expect(result.variants[0]?.concurrencyGroups).toEqual([
      ['skill-goal:inspect', 'skill-goal:inspect'],
    ]);
  });

  it('preserves recovery trigger, resume, sequence and required capability', async () => {
    const result = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-recovery', 'failed', [
        activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-a'),
        activityEvent('workflow_failed', 1, 'skill-goal:inspect', 'attempt-a'),
        activityEvent('recovery_started', 2, 'recovery:inspect:retry', 'recovery-a', {
          activityKind: 'skill_goal',
          branchRef: 'recovery-1',
          capabilityRefs: ['cap-recover'],
        }),
        activityEvent('skill_attempt_started', 3, 'skill-goal:verify', 'attempt-b', {
          branchRef: 'recovery-1',
        }),
        activityEvent('skill_attempt_started', 4, 'skill-goal:cleanup', 'attempt-c'),
        lifecycle('goal_failed', 5),
      ]),
    ]);

    expect(result.discoveredPattern.recoveryBranches).toEqual([
      expect.objectContaining({
        triggerActivityKey: 'skill-goal:inspect',
        resumeActivityKey: 'skill-goal:verify',
        activitySequence: ['recovery:inspect:retry', 'skill-goal:verify'],
        requiredCapabilityRefs: expect.arrayContaining(['cap-recover', 'capability-1']),
      }),
    ]);
    expect(result.discoveredPattern.failureVariants[0]).toMatchObject({
      failureActivity: 'skill-goal:inspect',
      traceRefs: ['trace-recovery'],
    });
  });

  it('does not silently generalize unknown Activity or pure lifecycle facts', async () => {
    const source = trace('trace-mixed', 'succeeded', [
      lifecycle('goal_created', 0),
      activityEvent('skill_attempt_started', 1, 'unknown-attempt:a', 'attempt-a', {
        activityKind: 'unknown',
      }),
      activityEvent('skill_attempt_started', 2, 'skill-goal:inspect', 'attempt-b'),
      lifecycle('goal_completed', 3),
    ]);
    const result = await new DeterministicProcessMiner().discover(goldenCohort(), [source]);

    expect(result.variants[0]?.activitySequence).toEqual(['skill-goal:inspect']);
    expect(JSON.stringify(result.workflowPattern)).not.toMatch(
      /goal_created|goal_completed|unknown-attempt/u,
    );
  });

  it('uses real denominators for support and trace coverage', async () => {
    const result = await new DeterministicProcessMiner({ mandatoryThreshold: 0.5 }).discover(
      goldenCohort(),
      [
        trace('trace-supported', 'succeeded', [
          activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-a'),
        ]),
        trace('trace-lifecycle-only', 'failed', [
          lifecycle('goal_created', 0),
          lifecycle('goal_failed', 1),
        ]),
      ],
    );

    expect(result.discoveredPattern.quality).toMatchObject({
      supportCount: 1,
      totalTraceCount: 2,
      supportRate: 0.5,
      traceCoverage: 0.5,
      successRate: 0.5,
    });
  });

  it('fails closed across tenant, Task Type and completeness boundaries', async () => {
    const miner = new DeterministicProcessMiner();
    const source = trace('trace-scope', 'succeeded', [
      activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-a'),
    ]);
    await expect(
      miner.discover({ ...goldenCohort(), tenantId: 'tenant-2' }, [source]),
    ).rejects.toThrow(/TENANT_MISMATCH/u);
    await expect(
      miner.discover({ ...goldenCohort(), taskTypeId: 'task-type-2' }, [source]),
    ).rejects.toThrow(/TASK_TYPE_MISMATCH/u);
    await expect(
      miner.discover({ ...goldenCohort(), minimumCompleteness: 1 }, [
        { ...source, completeness: 0.9 },
      ]),
    ).rejects.toThrow(/COMPLETENESS_MISMATCH/u);
  });

  it('cooperatively yields while mining a large cohort in the single runtime process', async () => {
    const traces = Array.from({ length: 2_048 }, (_, index) =>
      trace(`trace-cooperative-${String(index).padStart(4, '0')}`, 'succeeded', [
        activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', `attempt-${String(index)}`),
      ]),
    );
    let eventLoopTicks = 0;
    const timer = setInterval(() => {
      eventLoopTicks += 1;
    }, 0);
    try {
      await new DeterministicProcessMiner().discover(goldenCohort(), traces);
    } finally {
      clearInterval(timer);
    }
    expect(eventLoopTicks).toBeGreaterThan(2);
  });
});

function goldenCohort() {
  return createCohortDefinition({
    tenantId: 'tenant-1',
    taskTypeId: 'task-type-1',
    minimumCompleteness: 0.8,
  });
}

function goldenTraces(): readonly ExperienceTrace[] {
  return [
    trace('trace-success-a', 'succeeded', [
      lifecycle('goal_created', 0),
      activityEvent('skill_attempt_started', 1, 'skill-goal:inspect', 'attempt-a'),
      activityEvent('skill_attempt_completed', 2, 'skill-goal:inspect', 'attempt-a'),
      activityEvent('skill_attempt_started', 3, 'skill-goal:verify', 'attempt-b'),
      activityEvent('skill_attempt_completed', 4, 'skill-goal:verify', 'attempt-b'),
      lifecycle('goal_completed', 5),
    ]),
    trace('trace-success-b', 'succeeded', [
      activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-c'),
      activityEvent('skill_attempt_completed', 1, 'skill-goal:inspect', 'attempt-c'),
      activityEvent('skill_attempt_started', 2, 'skill-goal:verify', 'attempt-d'),
      activityEvent('skill_attempt_completed', 3, 'skill-goal:verify', 'attempt-d'),
    ]),
    trace('trace-failure', 'failed', [
      activityEvent('skill_attempt_started', 0, 'skill-goal:inspect', 'attempt-e'),
      activityEvent('workflow_failed', 1, 'skill-goal:inspect', 'attempt-e'),
      activityEvent('skill_attempt_started', 2, 'skill-goal:verify', 'attempt-f'),
      lifecycle('goal_failed', 3),
    ]),
  ];
}

function trace(
  traceId: string,
  outcomeStatus: ExperienceTrace['trace']['outcomeStatus'],
  events: readonly ExperienceTraceEvent[],
): ExperienceTrace {
  return createExperienceTrace({
    traceId,
    sourceEpisodeId: `episode-${traceId}`,
    taskTypeRefs: ['task-type-1'],
    goalFingerprint: sha('c'),
    capabilityFingerprint: sha('d'),
    environmentFingerprint: sha('e'),
    trace: {
      schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
      tenantId: 'tenant-1',
      events,
      correctionRefs: [],
      outcomeRef: `outcome-${traceId}`,
      outcomeStatus,
      missingFactCodes: [],
      environmentClass: 'server',
    },
    completeness: 0.95,
    dataClassification: 'internal',
    normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
    sourceHash: sha(traceId.includes('failure') ? 'b' : 'a'),
    createdAt: '2026-07-27T03:00:00.000Z',
  });
}

function lifecycle(eventType: ExperienceTraceEventType, sequence: number): ExperienceTraceEvent {
  return baseEvent(eventType, sequence);
}

function activityEvent(
  eventType: ExperienceTraceEventType,
  sequence: number,
  activityKey: string,
  attemptRef: string,
  optional: Readonly<{
    activityKind?: ExperienceActivityKind;
    concurrencyGroup?: string;
    branchRef?: string;
    capabilityRefs?: readonly string[];
  }> = {},
): ExperienceTraceEvent {
  const activityKind = optional.activityKind ?? 'skill_goal';
  const capabilityRefs = optional.capabilityRefs ?? ['capability-1'];
  return baseEvent(eventType, sequence, {
    activity: {
      activityKey,
      activityKind,
      objectiveSummary:
        activityKey === 'skill-goal:verify' ? 'Verify the workflow' : 'Inspect the workflow',
      sourceAttemptRef: attemptRef,
      capabilityRefs,
      effectRefs: [`effect:${activityKey}`],
    },
    capabilityRefs,
    ...(optional.concurrencyGroup === undefined
      ? {}
      : { concurrencyGroup: optional.concurrencyGroup }),
    ...(optional.branchRef === undefined ? {} : { branchRef: optional.branchRef }),
  });
}

function baseEvent(
  eventType: ExperienceTraceEventType,
  sequence: number,
  optional: Partial<ExperienceTraceEvent> = {},
): ExperienceTraceEvent {
  return {
    eventId: `event-${eventType}-${String(sequence)}`,
    sequence,
    occurredAt: new Date(baseTime + sequence * 1_000).toISOString(),
    eventType,
    actorType: eventType === 'human_intervention' ? 'user' : 'runtime',
    capabilityRefs: [],
    authorityRefs: [`source-${String(sequence)}`],
    parentEventRefs: [],
    payloadSummary: { eventType },
    ...optional,
  };
}
