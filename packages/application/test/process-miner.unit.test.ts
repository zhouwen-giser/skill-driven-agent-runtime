import { describe, expect, it } from 'vitest';

import {
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  createCohortDefinition,
  createExperienceTrace,
  type ExperienceTrace,
  type ExperienceTraceEvent,
  type ExperienceTraceEventType,
} from '../../domain/src/index.js';
import { DeterministicProcessMiner } from '../src/compiler/process-miner.js';

const baseTime = Date.parse('2026-07-27T03:00:00.000Z');
const sha = (character: string): string => `sha256:${character.repeat(64)}`;

describe('DeterministicProcessMiner', () => {
  it('reproduces variants, thresholds, direct-follows and Workflow Pattern byte-for-byte', async () => {
    const traces = goldenTraces();
    const miner = new DeterministicProcessMiner({ mandatoryThreshold: 2 / 3 });
    const cohort = goldenCohort();
    const first = await miner.discover(cohort, traces);
    const second = await miner.discover(cohort, [...traces].reverse());

    expect(first).toEqual(second);
    expect(first.variants).toHaveLength(3);
    expect(first.variants.reduce((sum, variant) => sum + variant.occurrenceCount, 0)).toBe(3);
    expect(first.discoveredPattern.mandatoryActivities).toEqual(
      expect.arrayContaining(['goal_created', 'plan_created', 'skill_attempt_started']),
    );
    expect(first.discoveredPattern.optionalActivities).toContain('human_intervention');
    expect(first.discoveredPattern.orderingConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predecessorActivity: 'goal_created',
          successorActivity: 'plan_created',
          relation: 'direct_follows',
        }),
      ]),
    );
    expect(first.discoveredPattern.quality.mandatoryThreshold).toBe(2 / 3);
    expect(first.workflowPattern.taskTypeId).toBe('task-type-1');
    expect(first.workflowPattern.sourcePatternRef).toBe(first.discoveredPattern.patternId);
  });

  it('uses explicit concurrency evidence and never timestamp coincidence', async () => {
    const miner = new DeterministicProcessMiner();
    const explicit = await miner.discover(goldenCohort(), [
      trace('trace-explicit', 'succeeded', [
        event('goal_created', 0),
        event('skill_attempt_started', 1, { concurrencyGroup: 'parallel-1' }),
        event('business_event_observed', 2, { concurrencyGroup: 'parallel-1' }),
        event('goal_completed', 3),
      ]),
    ]);
    const timestampOnly = await miner.discover(goldenCohort(), [
      trace('trace-timestamp', 'succeeded', [
        event('goal_created', 0),
        event('skill_attempt_started', 1),
        event('business_event_observed', 2),
        event('goal_completed', 3),
      ]),
    ]);

    expect(explicit.discoveredPattern.parallelCandidates).toEqual([
      expect.objectContaining({
        activityRefs: ['business_event_observed', 'skill_attempt_started'],
        evidenceType: 'explicit_concurrency',
        supportRefs: ['trace-explicit'],
      }),
    ]);
    expect(timestampOnly.discoveredPattern.parallelCandidates).toEqual([]);
  });

  it('retains loops in the Process Variant activity sequence', async () => {
    const result = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-loop', 'succeeded', [
        event('goal_created', 0),
        event('skill_attempt_started', 1),
        event('skill_attempt_completed', 2),
        event('skill_attempt_started', 3),
        event('skill_attempt_completed', 4),
        event('goal_completed', 5),
      ]),
    ]);

    expect(result.variants[0]?.activitySequence).toEqual([
      'goal_created',
      'skill_attempt_started',
      'skill_attempt_completed',
      'skill_attempt_started',
      'skill_attempt_completed',
      'goal_completed',
    ]);
  });

  it('keeps recovery trigger/resume evidence and failed variants separate', async () => {
    const result = await new DeterministicProcessMiner({ mandatoryThreshold: 0.5 }).discover(
      goldenCohort(),
      goldenTraces(),
    );

    expect(result.discoveredPattern.recoveryBranches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          triggerActivity: 'workflow_failed',
          resumeActivity: 'skill_attempt_started',
          supportRefs: ['trace-failure'],
        }),
      ]),
    );
    expect(result.discoveredPattern.failureVariants).toEqual([
      expect.objectContaining({
        failureActivity: 'goal_failed',
        traceRefs: ['trace-failure'],
        count: 1,
      }),
    ]);
    expect(result.variants.reduce((sum, variant) => sum + variant.failureCount, 0)).toBe(1);
  });

  it('records reversed ordering as contradiction evidence', async () => {
    const result = await new DeterministicProcessMiner({ mandatoryThreshold: 0.5 }).discover(
      goldenCohort(),
      [
        trace('trace-order-a', 'succeeded', [
          event('goal_created', 0),
          event('plan_created', 1),
          event('human_intervention', 2),
          event('goal_completed', 3),
        ]),
        trace('trace-order-b', 'succeeded', [
          event('goal_created', 0),
          event('human_intervention', 1),
          event('plan_created', 2),
          event('goal_completed', 3),
        ]),
      ],
    );

    const relation = result.discoveredPattern.orderingConstraints.find(
      (constraint) =>
        constraint.predecessorActivity === 'human_intervention' &&
        constraint.successorActivity === 'plan_created' &&
        constraint.relation === 'direct_follows',
    );
    expect(relation).toMatchObject({
      supportRefs: ['trace-order-b'],
      contradictionRefs: ['trace-order-a'],
    });
    expect(result.discoveredPattern.contradictionRefs).toEqual(['trace-order-a', 'trace-order-b']);
  });

  it('separates environment coverage and exposes frozen quality proxies', async () => {
    const traces = [
      trace('trace-server', 'succeeded', [event('goal_created', 0), event('goal_completed', 1)]),
      trace('trace-device', 'succeeded', [event('goal_created', 0), event('goal_completed', 1)], {
        environmentClass: 'device',
        deviceClass: 'robot',
      }),
    ];
    const result = await new DeterministicProcessMiner().discover(
      createCohortDefinition({
        tenantId: 'tenant-1',
        taskTypeId: 'task-type-1',
        minimumCompleteness: 0.8,
      }),
      traces,
    );

    expect(result.discoveredPattern.environmentCoverage).toEqual(['device/robot', 'server']);
    expect(result.discoveredPattern.quality).toMatchObject({
      support: 1,
      successRate: 1,
      traceCoverage: 1,
      environmentCoverage: 1,
      contradictionRate: 0,
    });
  });

  it('fails closed across tenant, Task Type, completeness and cohort time boundaries', async () => {
    const miner = new DeterministicProcessMiner();
    const source = trace('trace-scope', 'succeeded', [
      event('goal_created', 0),
      event('goal_completed', 1),
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
    await expect(
      miner.discover(
        {
          ...goldenCohort(),
          timeRange: {
            from: '2026-07-28T00:00:00.000Z',
            to: '2026-07-29T00:00:00.000Z',
          },
        },
        [source],
      ),
    ).rejects.toThrow(/TIME_RANGE_MISMATCH/u);
  });

  it('cooperatively yields while mining a large cohort in the single runtime process', async () => {
    const traces = Array.from({ length: 2_048 }, (_, index) =>
      trace(`trace-cooperative-${String(index).padStart(4, '0')}`, 'succeeded', [
        event('goal_created', 0),
        event('plan_created', 1),
        event('goal_completed', 2),
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

  it('does not produce Artifact, Skill binding, schema or completion-contract authority', async () => {
    const result = await new DeterministicProcessMiner().discover(goldenCohort(), [
      trace('trace-boundary', 'succeeded', [event('goal_created', 0), event('goal_completed', 1)]),
    ]);
    const serialized = JSON.stringify(result.workflowPattern);

    expect(serialized).not.toMatch(
      /artifactId|skillId|inputSchema|outputSchema|completionContract|fastGateway/iu,
    );
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
      event('goal_created', 0),
      event('plan_created', 1),
      event('skill_attempt_started', 2, { concurrencyGroup: 'parallel-a' }),
      event('business_event_observed', 3, { concurrencyGroup: 'parallel-a' }),
      event('skill_attempt_completed', 4),
      event('goal_completed', 5),
    ]),
    trace('trace-success-b', 'succeeded', [
      event('goal_created', 0),
      event('plan_created', 1),
      event('human_intervention', 2),
      event('skill_attempt_started', 3),
      event('skill_attempt_completed', 4),
      event('goal_completed', 5),
    ]),
    trace('trace-failure', 'failed', [
      event('goal_created', 0),
      event('plan_created', 1),
      event('skill_attempt_started', 2),
      event('workflow_failed', 3),
      event('recovery_started', 4, { branchRef: 'recovery-1' }),
      event('skill_attempt_started', 5, { branchRef: 'recovery-1' }),
      event('goal_failed', 6),
    ]),
  ];
}

function trace(
  traceId: string,
  outcomeStatus: ExperienceTrace['trace']['outcomeStatus'],
  events: readonly ExperienceTraceEvent[],
  environment: Readonly<{ environmentClass: string; deviceClass?: string }> = {
    environmentClass: 'server',
  },
): ExperienceTrace {
  const hashCharacter = traceId.includes('failure') || traceId.includes('device') ? 'b' : 'a';
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
      environmentClass: environment.environmentClass,
      ...(environment.deviceClass === undefined ? {} : { deviceClass: environment.deviceClass }),
    },
    completeness: 0.95,
    dataClassification: 'internal',
    normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
    sourceHash: sha(hashCharacter),
    createdAt: '2026-07-27T03:00:00.000Z',
  });
}

function event(
  eventType: ExperienceTraceEventType,
  sequence: number,
  optional: Readonly<{
    concurrencyGroup?: string;
    branchRef?: string;
    parentEventRefs?: readonly string[];
  }> = {},
): ExperienceTraceEvent {
  return {
    eventId: `event-${eventType}-${String(sequence)}`,
    sequence,
    occurredAt: new Date(baseTime + sequence * 1_000).toISOString(),
    eventType,
    actorType: eventType === 'human_intervention' ? 'user' : 'runtime',
    capabilityRefs: eventType === 'skill_attempt_started' ? ['capability-1'] : [],
    authorityRefs: [`source-${String(sequence)}`],
    parentEventRefs: optional.parentEventRefs ?? [],
    ...(optional.concurrencyGroup === undefined
      ? {}
      : { concurrencyGroup: optional.concurrencyGroup }),
    ...(optional.branchRef === undefined ? {} : { branchRef: optional.branchRef }),
    payloadSummary: { eventType },
  };
}
