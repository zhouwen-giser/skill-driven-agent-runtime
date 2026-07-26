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
  createKnowledgeCandidateIdentity,
  createKnowledgeEvidence,
  createKnowledgeDelta,
  createExperienceReflection,
  createKnowledgeStatusTransition,
  createRuntimeCapabilitySummarySnapshot,
  createPublicCapabilityCardSnapshot,
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
      originalRequest: 'Inspect a device.',
      objective: 'Inspect a device.',
      taskTypeCandidates: [],
      capabilityRequirements: [],
      knownConstraints: ['Read only.'],
      knownDimensions: [],
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
      modelInvocationId: 'model-invocation.v123',
      confidence: 0.7,
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
        contextId: 'context.v123',
        episodeType: 'terminal',
        revision: 1,
        terminalOutcomeRef: 'runtime-terminal-outcome:outcome.v123',
        sourceHash: hash('c'),
        episodeHash: hash('d'),
        completeness: 1,
        status: 'complete',
        dataClassification: 'internal',
        snapshot: {},
        sourceRefs: [],
        redactionCodes: [],
        createdAt: timestamp,
      }),
    ).toThrow(expect.objectContaining({ code: 'EXPERIENCE_EPISODE_INVALID' }));
  });

  it('freezes a version-bound Public Capability Card and rejects profile drift', () => {
    const card = createPublicCapabilityCardSnapshot({
      schemaVersion: '1.0',
      cardId: 'card.v123',
      revision: 1,
      summaryId: 'summary.v123',
      catalogHash: hash('b'),
      generationPolicyVersion: 'policy.v123.1',
      profileVersion: '1.0',
      status: 'active',
      agentName: 'Skill-Driven Agent Runtime',
      description: 'Provides public capabilities.',
      profile: {
        profileVersion: '1.0',
        catalogHash: hash('b'),
        domains: [],
        capabilities: [],
        limitations: [],
        generatedAt: timestamp,
      },
      publicSkills: [],
      sourceSkillRefs: ['skill.public:1'],
      generationMode: 'deterministic',
      cardContentHash: hash('c'),
      generatedAt: timestamp,
    });

    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.profile)).toBe(true);
    expect(() =>
      createPublicCapabilityCardSnapshot({
        ...card,
        profile: { ...card.profile, catalogHash: hash('d') },
      }),
    ).toThrow(expect.objectContaining({ code: 'CAPABILITY_CARD_INVALID' }));
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

  it('freezes candidate-only Reflection Delta with positive and negative lineage', () => {
    const candidate = createKnowledgeCandidateSnapshot({
      schemaVersion: '1.0',
      knowledgeId: 'knowledge.reflection.v123',
      kind: 'planning_heuristic',
      revision: 1,
      status: 'candidate',
      scope: 'global_candidate',
      title: 'Retain counterexamples',
      summary: 'Keep supporting and contradictory evidence separate.',
      risk: 'low',
      supportSourceRefs: [sourceRef()],
      contradictionSourceRefs: [sourceRef()],
      createdAt: timestamp,
    });
    const evidence = (polarity: 'support' | 'contradiction') =>
      createKnowledgeEvidence({
        evidenceId: `evidence.${polarity}.v123`,
        polarity,
        observationId: 'observation.v123',
        statementIds: [`statement.${polarity}.v123`],
        sourceEpisodeIds: ['episode.v123'],
        sourceRefIds: ['source.goal.1'],
        sourceRefs: [sourceRef()],
        outcomeRefs: ['runtime-terminal-outcome:outcome.v123'],
        summary: `${polarity} evidence`,
        createdAt: timestamp,
      });
    const delta = createKnowledgeDelta({
      schemaVersion: '1.0',
      deltaId: 'delta.v123',
      reflectionId: 'reflection.v123',
      operation: 'CREATE_REVISION',
      knowledgeKind: 'planning_heuristic',
      fingerprint: hash('d'),
      identity: createKnowledgeCandidateIdentity({
        jobToBeDone: 'Retain evidence before reuse',
        objectiveTerms: ['retain', 'evidence'],
        criterionTerms: ['verified'],
        artifactTerms: ['report'],
        capabilityTerms: ['inspection'],
        tags: ['evidence'],
        deliverable: 'verified report',
      }),
      relatedKnowledgeIds: [],
      candidate,
      supportEvidence: [evidence('support')],
      contradictionEvidence: [evidence('contradiction')],
      confidence: 0.9,
      reason: 'Candidate-only revision.',
      createdAt: timestamp,
    });
    const reflection = createExperienceReflection({
      schemaVersion: '1.0',
      reflectionId: 'reflection.v123',
      seedObservationId: 'observation.v123',
      observationIds: ['observation.v123'],
      revision: 1,
      status: 'completed',
      group: {
        goalPatternFingerprint: hash('e'),
        capabilityFingerprint: hash('f'),
        timeWindow: '2026-07-23/P7D',
      },
      impacts: [
        {
          impactId: 'impact.v123',
          disposition: 'harmful',
          observationId: 'observation.v123',
          statementId: 'statement.contradiction.v123',
          sourceEpisodeIds: ['episode.v123'],
          sourceRefIds: ['source.goal.1'],
          outcomeRefs: ['runtime-terminal-outcome:outcome.v123'],
          summary: 'The contradiction prevents unconditional reuse.',
        },
      ],
      deltas: [delta],
      modelInvocationRefs: [],
      reflectionHash: hash('1'),
      createdAt: timestamp,
    });
    expect(Object.isFrozen(reflection)).toBe(true);
    expect(reflection.deltas[0]).toMatchObject({
      operation: 'CREATE_REVISION',
      candidate: { status: 'candidate' },
      supportEvidence: [expect.objectContaining({ polarity: 'support' })],
      contradictionEvidence: [expect.objectContaining({ polarity: 'contradiction' })],
    });
    expect(() =>
      createKnowledgeDelta({
        ...delta,
        candidate: { ...candidate, status: 'active' },
      }),
    ).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_DELTA_INVALID' }));
  });
});
