import { describe, expect, it } from 'vitest';

import {
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  PROCESS_MINING_ALGORITHM_VERSION,
  createCohortDefinition,
  createDiscoveredProcessPattern,
  createExperienceTrace,
  createExperienceTraceEvent,
  createProcessVariant,
  createWorkflowPattern,
  type CohortDefinition,
  type ExperienceTrace,
} from '../src/index.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const occurredAt = '2026-07-27T01:00:00.000Z';

describe('P03 frozen Experience compilation contracts', () => {
  it('creates an immutable strict ExperienceTrace with ordered parent evidence', () => {
    const first = createExperienceTraceEvent({
      eventId: 'event-1',
      sequence: 0,
      occurredAt,
      eventType: 'goal_created',
      actorType: 'runtime',
      capabilityRefs: [],
      authorityRefs: ['source-1'],
      parentEventRefs: [],
      payloadSummary: { sourceKind: 'task' },
    });
    const second = createExperienceTraceEvent({
      eventId: 'event-2',
      sequence: 1,
      occurredAt: '2026-07-27T01:00:01.000Z',
      eventType: 'goal_completed',
      actorType: 'runtime',
      activity: {
        activityKey: 'skill-goal:inspect',
        activityKind: 'skill_goal',
        objectiveSummary: 'Inspect the workflow',
        sourcePlanNodeRef: 'inspect',
        sourceSkillGoalRef: 'inspect',
        sourceAttemptRef: 'attempt-1',
        capabilityRefs: ['capability-1'],
        effectRefs: ['effect-inspected'],
      },
      capabilityRefs: ['capability-1'],
      authorityRefs: ['source-2'],
      parentEventRefs: ['event-1'],
      payloadSummary: { status: 'completed' },
    });
    const trace = createExperienceTrace({
      traceId: 'trace-1',
      sourceEpisodeId: 'episode-1',
      taskTypeRefs: ['task-type-1'],
      goalFingerprint: sha('a'),
      capabilityFingerprint: sha('b'),
      environmentFingerprint: sha('c'),
      trace: {
        schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
        tenantId: 'tenant-1',
        events: [first, second],
        correctionRefs: [],
        outcomeRef: 'outcome-1',
        outcomeStatus: 'succeeded',
        missingFactCodes: [],
        environmentClass: 'server',
      },
      completeness: 1,
      dataClassification: 'internal',
      normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
      sourceHash: sha('d'),
      createdAt: occurredAt,
    });

    expect(Object.keys(trace)).toEqual([
      'traceId',
      'sourceEpisodeId',
      'taskTypeRefs',
      'goalFingerprint',
      'capabilityFingerprint',
      'environmentFingerprint',
      'trace',
      'completeness',
      'dataClassification',
      'normalizerVersion',
      'sourceHash',
      'createdAt',
    ]);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.trace.events)).toBe(true);
  });

  it('rejects extra frozen-contract fields and non-contiguous event order', () => {
    const input = baseTrace();
    expect(() =>
      createExperienceTrace({
        ...input,
        localAlias: 'forbidden',
      } as ExperienceTrace),
    ).toThrow(/frozen contract/u);
    expect(() =>
      createExperienceTrace({
        ...input,
        trace: {
          ...input.trace,
          events: [{ ...requiredFirstEvent(input), sequence: 1 }],
        },
      }),
    ).toThrow(/contiguous/u);
  });

  it('rejects extra fields in every persisted Trace and cohort envelope', () => {
    const input = baseTrace();
    expect(() =>
      createExperienceTrace({
        ...input,
        trace: { ...input.trace, localAlias: 'forbidden' },
      } as ExperienceTrace),
    ).toThrow(/frozen contract/u);
    expect(() =>
      createCohortDefinition({
        tenantId: 'tenant-1',
        taskTypeId: 'task-type-1',
        timeRange: {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-31T23:59:59.000Z',
          localAlias: 'forbidden',
        },
        minimumCompleteness: 0.8,
      } as CohortDefinition),
    ).toThrow(/frozen contract/u);
  });

  it('rejects a parent that does not precede its child', () => {
    const input = baseTrace();
    expect(() =>
      createExperienceTrace({
        ...input,
        trace: {
          ...input.trace,
          events: [{ ...requiredFirstEvent(input), parentEventRefs: ['event-missing'] }],
        },
      }),
    ).toThrow(/precede/u);
  });

  it('validates cohort bounds and deterministic Process Variant counts', () => {
    expect(
      createCohortDefinition({
        tenantId: 'tenant-1',
        taskTypeId: 'task-type-1',
        environmentClass: 'server',
        timeRange: {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-31T23:59:59.000Z',
        },
        minimumCompleteness: 0.8,
      }).minimumCompleteness,
    ).toBe(0.8);
    expect(() =>
      createCohortDefinition({
        tenantId: 'tenant-1',
        taskTypeId: 'task-type-1',
        timeRange: {
          from: '2026-07-31T23:59:59.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        minimumCompleteness: 0.8,
      }),
    ).toThrow(/reversed/u);
    expect(() =>
      createProcessVariant({
        variantId: 'variant-1',
        activitySequence: ['skill-goal:inspect'],
        activityKindSequence: ['skill_goal'],
        concurrencyGroups: [],
        branchSequence: [],
        occurrenceCount: 1,
        traceRefs: ['trace-1'],
        successCount: 1,
        failureCount: 1,
      }),
    ).toThrow(/inconsistent/u);
  });

  it('accepts 10k mining evidence references while retaining a finite evidence bound', () => {
    const tenThousandRefs = Array.from({ length: 10_000 }, (_, index) => `trace-${String(index)}`);
    expect(
      createProcessVariant({
        variantId: 'variant-10k',
        activitySequence: ['skill-goal:inspect', 'skill-goal:verify'],
        activityKindSequence: ['skill_goal', 'verification'],
        concurrencyGroups: [],
        branchSequence: [],
        occurrenceCount: tenThousandRefs.length,
        traceRefs: tenThousandRefs,
        successCount: tenThousandRefs.length,
        failureCount: 0,
      }).traceRefs,
    ).toHaveLength(10_000);

    const overBoundRefs = Array.from(
      { length: 65_537 },
      (_, index) => `trace-over-bound-${String(index)}`,
    );
    expect(() =>
      createProcessVariant({
        variantId: 'variant-over-bound',
        activitySequence: ['skill-goal:inspect'],
        activityKindSequence: ['skill_goal'],
        concurrencyGroups: [],
        branchSequence: [],
        occurrenceCount: overBoundRefs.length,
        traceRefs: overBoundRefs,
        successCount: overBoundRefs.length,
        failureCount: 0,
      }),
    ).toThrow(/too large/u);
  });

  it('keeps discovered and Workflow Patterns as evidence-only contracts', () => {
    const quality = {
      supportCount: 1,
      totalTraceCount: 2,
      supportRate: 0.5,
      successRate: 1,
      traceCoverage: 1,
      fitness: 1,
      precisionProxy: 1,
      environmentCoverage: 1,
      contradictionRate: 0,
      generalization: 0.5,
      mandatoryThreshold: 0.8,
    } as const;
    const pattern = createDiscoveredProcessPattern({
      patternId: 'pattern-1',
      cohortFingerprint: sha('e'),
      algorithmVersion: PROCESS_MINING_ALGORITHM_VERSION,
      mandatoryActivities: ['skill-goal:inspect', 'skill-goal:verify'],
      optionalActivities: [],
      orderingConstraints: [
        {
          predecessorActivity: 'skill-goal:inspect',
          successorActivity: 'skill-goal:verify',
          relation: 'direct_follows',
          supportRefs: ['trace-1'],
          contradictionRefs: [],
        },
      ],
      parallelCandidates: [],
      recoveryBranches: [],
      failureVariants: [],
      supportRefs: ['trace-1'],
      contradictionRefs: [],
      environmentCoverage: ['server'],
      quality,
    });
    const workflow = createWorkflowPattern({
      workflowPatternId: 'workflow-pattern-1',
      taskTypeId: 'task-type-1',
      activityPatterns: [
        {
          activityKey: 'skill-goal:inspect',
          activityKind: 'skill_goal',
          objectiveSummary: 'Inspect the workflow',
          required: true,
          supportCount: 1,
          supportRate: 1,
          capabilityRefs: ['capability-1'],
          effectRefs: ['effect-inspected'],
          lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
        },
      ],
      dependencyPatterns: [],
      recoveryPatterns: [],
      sourcePatternRef: pattern.patternId,
      sourceTraceRefs: ['trace-1'],
      quality,
    });

    expect('artifactId' in pattern).toBe(false);
    expect('skillId' in workflow).toBe(false);
    expect(workflow.sourcePatternRef).toBe(pattern.patternId);
  });
});

function baseTrace(): ExperienceTrace {
  return {
    traceId: 'trace-1',
    sourceEpisodeId: 'episode-1',
    taskTypeRefs: [],
    goalFingerprint: sha('a'),
    capabilityFingerprint: sha('b'),
    environmentFingerprint: sha('c'),
    trace: {
      schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
      tenantId: 'tenant-1',
      events: [
        {
          eventId: 'event-1',
          sequence: 0,
          occurredAt,
          eventType: 'goal_created',
          actorType: 'runtime',
          capabilityRefs: [],
          authorityRefs: [],
          parentEventRefs: [],
          payloadSummary: {},
        },
      ],
      correctionRefs: [],
      outcomeStatus: 'unknown',
      missingFactCodes: [],
      environmentClass: 'unknown-environment',
    },
    completeness: 1,
    dataClassification: 'internal',
    normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
    sourceHash: sha('d'),
    createdAt: occurredAt,
  };
}

function requiredFirstEvent(trace: ExperienceTrace) {
  const event = trace.trace.events[0];
  if (event === undefined) throw new Error('Expected a fixture event.');
  return event;
}
