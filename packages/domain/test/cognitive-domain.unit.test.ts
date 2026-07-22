import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
  createCognitiveDomainEvent,
  createCognitiveRuntimeFeatureFlags,
  createCognitiveSourceRef,
  createGenericTaskUnderstandingRevision,
  createGoalExperienceEpisode,
  createInteractiveSessionSnapshot,
  createKnowledgeCandidateSnapshot,
  createKnowledgeStatusTransition,
  createRuntimeCapabilitySummarySnapshot,
} from '../src/index.js';

const timestamp = '2026-07-23T00:00:00.000Z';
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const sourceRef = () =>
  createCognitiveSourceRef({
    schemaVersion: '1.0',
    sourceRefId: 'source.goal.1',
    sourceKind: 'goal_contract',
    sourceId: 'goal.v123',
    sourceRevision: 1,
    authority: 'runtime_fact',
    dataClassification: 'internal',
    capturedAt: timestamp,
    contentHash: hash('a'),
  });

describe('SDAR v1.2.3 cognitive Domain skeleton', () => {
  it('freezes the release defaults with manual promotion and shadow injection', () => {
    expect(createCognitiveRuntimeFeatureFlags(DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS)).toEqual(
      expect.objectContaining({
        understandingMode: 'ambiguous_only',
        interactiveMode: 'manual',
        inductionMode: 'shadow',
        promotionMode: 'manual',
        injectionMode: 'shadow',
      }),
    );
    expect(Object.isFrozen(DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS)).toBe(true);
  });

  it('creates source-linked immutable events without accepting unknown event types', () => {
    const event = createCognitiveDomainEvent({
      schemaVersion: '1.0',
      eventId: 'event.cognitive.1',
      eventType: 'user_goal.terminal_committed',
      aggregateType: 'user_goal',
      aggregateId: 'goal.v123',
      aggregateVersion: 1,
      occurredAt: timestamp,
      correlation: { correlationId: 'correlation.v123', goalId: 'goal.v123' },
      payload: { outcomeId: 'outcome.v123' },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(() => createCognitiveDomainEvent({ ...event, eventType: 'unknown' as never })).toThrow(
      expect.objectContaining({ code: 'COGNITIVE_EVENT_INVALID' }),
    );
  });

  it('validates capability, understanding and interactive-session snapshots', () => {
    const summary = createRuntimeCapabilitySummarySnapshot({
      schemaVersion: '1.0',
      summaryId: 'summary.v123',
      revision: 1,
      catalogHash: hash('b'),
      generationPolicyVersion: 'policy.v123.1',
      status: 'building',
      items: [
        {
          capabilityId: 'capability.inspect',
          domain: 'capability',
          title: ' Inspect ',
          shortDescription: 'Inspect a device.',
          public: true,
          effects: ['observed'],
          evidence: ['structured'],
          artifacts: [],
          contexts: ['intranet'],
          modes: ['read_only'],
          taskTypes: [],
          composition: [],
          limitations: [
            {
              limitationId: 'limitation.readiness',
              reasonCode: 'confirmation_required',
              detail: 'Current Provider readiness is not asserted.',
            },
          ],
          exactSkillVersionRefs: ['skill.inspect@1'],
        },
      ],
      sourceRefs: [sourceRef()],
      builtAt: timestamp,
    });
    expect(summary.items[0]?.title).toBe('Inspect');
    expect(Object.isFrozen(summary.items)).toBe(true);

    const understanding = createGenericTaskUnderstandingRevision({
      schemaVersion: '1.0',
      understandingId: 'understanding.v123',
      taskId: 'task.v123',
      revision: 1,
      disposition: 'clarification_required',
      objective: 'Inspect a device.',
      knownConstraints: ['Read only.'],
      assumptions: [],
      missingDimensions: [
        {
          dimensionId: 'dimension.target',
          kind: 'target',
          severity: 'blocking',
          question: 'Which device?',
          answered: false,
          authorizationSensitive: false,
        },
      ],
      sourceRefs: [sourceRef()],
      policyVersion: 'policy.v123.1',
      stateHash: hash('c'),
      createdAt: timestamp,
    });
    expect(understanding.missingDimensions).toHaveLength(1);

    expect(() =>
      createInteractiveSessionSnapshot({
        schemaVersion: '1.0',
        sessionId: 'session.v123',
        taskId: 'task.v123',
        kind: 'goal',
        state: 'understand',
        version: 1,
        clarificationRounds: 5,
        revisionCount: 0,
        maxClarificationRounds: 4,
        maxRevisions: 4,
        idempotencyKeys: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toThrow(expect.objectContaining({ code: 'INTERACTIVE_SESSION_INVALID' }));
  });

  it('requires persisted facts before constructing an Experience Episode', () => {
    expect(() =>
      createGoalExperienceEpisode({
        schemaVersion: '1.0',
        episodeId: 'episode.v123',
        goalId: 'goal.v123',
        goalVersion: 1,
        revision: 1,
        episodeHash: hash('d'),
        completeness: 1,
        dataClassification: 'internal',
        sourceRefs: [],
        redactionCodes: [],
        createdAt: timestamp,
      }),
    ).toThrow(expect.objectContaining({ code: 'EXPERIENCE_EPISODE_INVALID' }));
  });

  it('keeps candidates out of active knowledge and enforces audited transitions', () => {
    const candidate = createKnowledgeCandidateSnapshot({
      schemaVersion: '1.0',
      knowledgeId: 'knowledge.v123',
      kind: 'planning_heuristic',
      revision: 1,
      status: 'candidate',
      scope: 'global_candidate',
      title: 'Inspect first',
      summary: 'Gather evidence before proposing a repair.',
      risk: 'low',
      supportSourceRefs: [sourceRef()],
      contradictionSourceRefs: [],
      createdAt: timestamp,
    });
    expect(candidate.status).toBe('candidate');
    expect(() => createKnowledgeCandidateSnapshot({ ...candidate, status: 'active' })).toThrow(
      expect.objectContaining({ code: 'KNOWLEDGE_CANDIDATE_INVALID' }),
    );
    expect(() =>
      createKnowledgeStatusTransition({
        schemaVersion: '1.0',
        transitionId: 'transition.v123',
        knowledgeId: candidate.knowledgeId,
        knowledgeRevision: 1,
        expectedVersion: 1,
        fromStatus: 'candidate',
        toStatus: 'active',
        reason: 'promotion_approved',
        actorId: 'operator.v123',
        humanApproved: true,
        occurredAt: timestamp,
      }),
    ).toThrow(expect.objectContaining({ code: 'COGNITIVE_STATE_TRANSITION_INVALID' }));
    const validating = createKnowledgeStatusTransition({
      schemaVersion: '1.0',
      transitionId: 'transition.validating.v123',
      knowledgeId: candidate.knowledgeId,
      knowledgeRevision: 1,
      expectedVersion: 1,
      fromStatus: 'candidate',
      toStatus: 'validating',
      reason: 'evaluation_started',
      actorId: 'operator.v123',
      humanApproved: false,
      occurredAt: timestamp,
    });
    expect(validating.toStatus).toBe('validating');
    expect(() =>
      createKnowledgeStatusTransition({
        ...validating,
        transitionId: 'transition.active.v123',
        expectedVersion: 2,
        fromStatus: 'validating',
        toStatus: 'active',
        reason: 'promotion_approved',
        humanApproved: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_PROMOTION_FORBIDDEN' }));
  });
});
