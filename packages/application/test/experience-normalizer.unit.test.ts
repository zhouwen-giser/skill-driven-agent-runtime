import { describe, expect, it } from 'vitest';

import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveSourceRef,
  createGoalExperienceEpisode,
  type GoalExperienceEpisode,
} from '../../domain/src/index.js';
import { ExperienceTraceNormalizer } from '../src/compiler/experience-normalizer.js';

const createdAt = '2026-07-27T01:00:00.000Z';
const sourceHash = `sha256:${'a'.repeat(64)}`;
const episodeHash = `sha256:${'b'.repeat(64)}`;

describe('ExperienceTraceNormalizer', () => {
  it('normalizes formal Episode facts deterministically with order, branch and explicit concurrency', () => {
    const episode = fixtureEpisode();
    const normalizer = new ExperienceTraceNormalizer();
    const first = normalizer.normalize(episode);
    const second = normalizer.normalize(episode);

    expect(first).toEqual(second);
    expect(first.trace.trace.events.map((event) => event.eventType)).toEqual([
      'goal_created',
      'goal_contract_confirmed',
      'plan_created',
      'plan_confirmed',
      'skill_attempt_started',
      'skill_attempt_started',
      'skill_attempt_completed',
      'workflow_failed',
      'recovery_started',
      'human_intervention',
      'goal_completed',
    ]);
    expect(
      first.trace.trace.events
        .filter((event) => event.eventType === 'skill_attempt_started')
        .map((event) => event.concurrencyGroup),
    ).toEqual(['parallel-a', 'parallel-a']);
    expect(
      first.trace.trace.events.find((event) => event.eventType === 'recovery_started')?.branchRef,
    ).toBe('recovery-branch-1');
    expect(first.trace.taskTypeRefs).toEqual(['task-type-1']);
    expect(first.trace.trace.tenantId).toBe('tenant-1');
  });

  it('does not infer parallelism from identical timestamps without explicit evidence', () => {
    const episode = fixtureEpisode({
      attempts: [attempt('attempt-a', 'completed', {}), attempt('attempt-b', 'completed', {})],
    });
    const events = new ExperienceTraceNormalizer()
      .normalize(episode)
      .trace.trace.events.filter((event) => event.eventType === 'skill_attempt_started');

    expect(events).toHaveLength(2);
    expect(events.every((event) => event.concurrencyGroup === undefined)).toBe(true);
  });

  it('preserves incomplete data as missing codes without fabricating facts', () => {
    const episode = fixtureEpisode({
      task: undefined,
      contract: undefined,
      planRevisions: [],
      attempts: [],
      terminalOutcome: undefined,
      userGoalJudgment: undefined,
      taskTypeId: undefined,
      capabilityId: undefined,
    });
    const result = new ExperienceTraceNormalizer().normalize(episode);

    expect(result.missingFactCodes).toEqual(
      expect.arrayContaining([
        'task_missing',
        'goal_contract_missing',
        'plan_revisions_missing',
        'skill_attempts_missing',
        'terminal_outcome_missing',
        'task_type_missing',
        'capability_refs_missing',
      ]),
    );
    expect(result.trace.trace.events.map((event) => event.eventType)).toEqual([
      'recovery_started',
      'human_intervention',
    ]);
    expect(
      result.trace.trace.events.some((event) =>
        ['goal_created', 'plan_created', 'goal_completed', 'goal_failed'].includes(event.eventType),
      ),
    ).toBe(false);
    expect(result.trace.trace.outcomeStatus).toBe('unknown');
    expect(result.trace.completeness).toBeLessThan(episode.completeness);
  });

  it('excludes credentials, private reasoning, PII and large raw values from persisted summaries', () => {
    const episode = fixtureEpisode({
      attempts: [
        {
          ...attempt('attempt-secret', 'completed', {}),
          authorization: 'Bearer top-secret-token',
          private_reasoning: 'never persist',
          email: 'person@example.com',
          summary: 'x'.repeat(2_000),
        },
      ],
    });
    const result = new ExperienceTraceNormalizer().normalize(episode);
    const serialized = JSON.stringify(result.trace);

    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('never persist');
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('x'.repeat(1_000));
    expect(result.redactionCodes).toEqual(
      expect.arrayContaining([
        'credentials_excluded',
        'private_reasoning_excluded',
        'unnecessary_pii_excluded',
        'large_payload_abstracted',
      ]),
    );
  });

  it('creates a goal-specific isolation partition when the source has no tenant fact', () => {
    const episode = fixtureEpisode({
      task: {
        taskId: 'task-1',
        contextId: 'context-1',
        taskTypeId: 'task-type-1',
        environmentClass: 'server',
        createdAt,
      },
    });
    const result = new ExperienceTraceNormalizer().normalize(episode);

    expect(result.trace.trace.tenantId).toMatch(/^unscoped-[0-9a-f]{40}$/u);
    expect(result.missingFactCodes).toContain('tenant_scope_missing');
  });

  it('uses a deterministic request compatibility fingerprint when formal V1 has no task type', () => {
    const episode = fixtureEpisode({
      task: {
        taskId: 'task-1',
        contextId: 'context-1',
        tenantId: 'sdar-v1-trusted-intranet',
        requestText: '  Inspect the current workflow  ',
        environmentClass: 'server',
        createdAt,
      },
    });
    const first = new ExperienceTraceNormalizer().normalize(episode);
    const second = new ExperienceTraceNormalizer().normalize(episode);

    expect(first.trace.taskTypeRefs).toEqual(second.trace.taskTypeRefs);
    expect(first.trace.taskTypeRefs).toEqual([
      expect.stringMatching(/^request-fingerprint-[0-9a-f]{40}$/u),
    ]);
    expect(first.missingFactCodes).toEqual(
      expect.arrayContaining(['task_type_missing', 'task_type_compatibility_fingerprint']),
    );
    expect(first.trace.trace.tenantId).toBe('sdar-v1-trusted-intranet');
  });
});

function fixtureEpisode(overrides: Readonly<Record<string, unknown>> = {}): GoalExperienceEpisode {
  const snapshot: Readonly<Record<string, unknown>> = {
    task: {
      taskId: 'task-1',
      contextId: 'context-1',
      tenantId: 'tenant-1',
      taskTypeId: 'task-type-1',
      environmentClass: 'server',
      createdAt,
    },
    contract: {
      goalId: 'goal-1',
      contractHash: sourceHash,
      createdAt: '2026-07-27T01:00:01.000Z',
    },
    planRevisions: [
      {
        planId: 'plan-1',
        revision: 1,
        status: 'confirmed',
        capabilityId: 'capability-1',
        createdAt: '2026-07-27T01:00:02.000Z',
        updatedAt: '2026-07-27T01:00:03.000Z',
      },
    ],
    attempts: [
      attempt('attempt-a', 'completed', { concurrency_group: 'parallel-a' }),
      attempt('attempt-b', 'failed', { concurrency_group: 'parallel-a' }),
    ],
    progress: [],
    recovery: [
      {
        recovery_decision_id: 'recovery-1',
        status: 'admitted',
        branch_ref: 'recovery-branch-1',
        created_at: '2026-07-27T01:00:06.000Z',
      },
    ],
    eventImpacts: [],
    interactions: [
      {
        episodeId: 'interaction-1',
        correctionIds: ['correction-1'],
        createdAt: '2026-07-27T01:00:07.000Z',
      },
    ],
    terminalOutcome: {
      outcomeId: 'outcome-1',
      controlStatus: 'completed',
      committedAt: '2026-07-27T01:00:08.000Z',
    },
    userGoalJudgment: { status: 'achieved' },
    ...overrides,
  };
  return createGoalExperienceEpisode({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    episodeId: 'episode-1',
    goalId: 'goal-1',
    goalVersion: 1,
    taskId: 'task-1',
    contextId: 'context-1',
    episodeType: 'terminal',
    revision: 1,
    terminalOutcomeRef: 'runtime-terminal-outcome:outcome-1',
    sourceHash,
    episodeHash,
    completeness: 0.95,
    status: 'complete',
    dataClassification: 'user_scoped',
    snapshot,
    sourceRefs: [
      source('task-source', 'task_request', 'task-1'),
      source('contract-source', 'goal_contract', 'goal-1'),
      source('plan-source', 'plan_revision', 'plan-1'),
      source('attempt-source', 'skill_attempt', 'attempt-a'),
      source('recovery-source', 'recovery_decision', 'recovery-1'),
      source('correction-source', 'planning_correction', 'correction-1'),
      source('outcome-source', 'runtime_terminal_outcome', 'outcome-1'),
    ],
    redactionCodes: [],
    createdAt,
  });
}

function attempt(
  attemptId: string,
  status: string,
  extra: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    attempt_id: attemptId,
    status,
    capability_refs: ['capability-1'],
    created_at: '2026-07-27T01:00:04.000Z',
    updated_at: '2026-07-27T01:00:05.000Z',
    ...extra,
  };
}

function source(
  sourceRefId: string,
  sourceKind:
    | 'task_request'
    | 'goal_contract'
    | 'plan_revision'
    | 'skill_attempt'
    | 'recovery_decision'
    | 'planning_correction'
    | 'runtime_terminal_outcome',
  sourceId: string,
) {
  return createCognitiveSourceRef({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    sourceRefId,
    sourceKind,
    sourceId,
    sourceRevision: 1,
    authority: 'runtime_fact',
    dataClassification: 'internal',
    capturedAt: createdAt,
  });
}
