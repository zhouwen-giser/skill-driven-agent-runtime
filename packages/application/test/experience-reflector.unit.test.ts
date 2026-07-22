import { describe, expect, it } from 'vitest';

import {
  createKnowledgeCandidateIdentity,
  type KnowledgeCandidateIdentity,
} from '../../domain/src/index.js';
import {
  KnowledgeCuratorService,
  KnowledgeDeltaValidator,
  KnowledgeIdentityService,
} from '../src/cognitive/index.js';
import type { CognitiveStructuredModelStageInvoker } from '../src/cognitive/ports.js';

describe('G09 knowledge identity and curator boundaries', () => {
  it('merges the same reusable job after removing device, location and date instances', async () => {
    const service = identityService(0.94);
    const decision = await service.compare({
      draft: identity({
        jobToBeDone: 'Inspect pump P-17 in Shanghai on 2026-07-23 and verify pressure evidence',
        objectiveTerms: ['inspect', 'pump', 'pressure'],
        deliverable: 'pressure evidence report',
      }),
      candidates: [
        {
          knowledgeId: 'knowledge-1',
          revision: 2,
          fingerprint: `sha256:${'1'.repeat(64)}`,
          identity: identity({
            jobToBeDone: 'Inspect pump P-22 in Beijing on 2026-07-20 and verify pressure evidence',
            objectiveTerms: ['inspect', 'pump', 'pressure'],
            deliverable: 'pressure evidence report',
          }),
        },
      ],
    });

    expect(decision).toMatchObject({
      disposition: 'same_knowledge',
      targetKnowledgeId: 'knowledge-1',
      targetRevision: 2,
    });
    expect(decision.semanticScore).toBe(0.94);
    expect(decision.lexicalScore).toBeGreaterThan(0.7);
  });

  it('does not merge materially different deliverables or a recent intent boundary', async () => {
    const service = identityService(0.99);
    const base = identity({ deliverable: 'inspection report', recentIntentBoundary: 'intent-a' });

    await expect(
      service.compare({
        draft: identity({ deliverable: 'repair work order', recentIntentBoundary: 'intent-a' }),
        candidates: [candidate(base)],
      }),
    ).resolves.toMatchObject({ disposition: 'create_new', reason: 'deliverable_boundary' });
    await expect(
      service.compare({
        draft: identity({ deliverable: 'inspection report', recentIntentBoundary: 'intent-b' }),
        candidates: [candidate(base)],
      }),
    ).resolves.toMatchObject({ disposition: 'create_new', reason: 'recent_intent_boundary' });
  });

  it('defaults low-confidence identity to a new candidate instead of merging', async () => {
    const decision = await identityService(0.51).compare({
      draft: identity(),
      candidates: [candidate(identity())],
    });
    expect(decision).toMatchObject({ disposition: 'create_new', reason: 'identity_confidence_low' });
    expect(decision.targetKnowledgeId).toBeUndefined();
  });

  it('turns invalid curator JSON into NO_CHANGE and never creates active knowledge', async () => {
    const curator = new KnowledgeCuratorService({
      model: new InvalidCuratorModel(),
      validator: new KnowledgeDeltaValidator(),
      clock: { now: () => '2026-07-23T07:40:00.000Z' },
      nextDeltaId: () => 'delta-1',
    });
    const result = await curator.proposeDelta({
      reflectionId: 'reflection-1',
      draft: {
        knowledgeKind: 'planning_heuristic',
        title: 'Verify pressure evidence',
        summary: 'Collect cited pressure evidence before declaring completion.',
        risk: 'low',
        identity: identity(),
        supportEvidence: [evidence('support')],
        contradictionEvidence: [evidence('contradiction')],
      },
      identity: {
        disposition: 'create_new',
        confidence: 0.4,
        semanticScore: 0.4,
        lexicalScore: 0.4,
        reason: 'identity_confidence_low',
      },
      existing: undefined,
    });

    expect(result).toMatchObject({ operation: 'NO_CHANGE', candidate: undefined });
    expect(result.supportEvidence[0]).toMatchObject({
      polarity: 'support',
      sourceEpisodeIds: ['episode-1'],
      outcomeRefs: ['runtime-terminal-outcome:outcome-1'],
    });
    expect(result.contradictionEvidence[0]).toMatchObject({ polarity: 'contradiction' });
  });
});

function identityService(score: number): KnowledgeIdentityService {
  return new KnowledgeIdentityService({
    similarity: { compare: () => Promise.resolve(score) },
    policy: {
      semanticThreshold: 0.82,
      lexicalThreshold: 0.55,
      combinedThreshold: 0.72,
    },
  });
}

function identity(overrides: Partial<KnowledgeCandidateIdentity> = {}): KnowledgeCandidateIdentity {
  return createKnowledgeCandidateIdentity({
    jobToBeDone: 'Inspect a pump and verify pressure evidence',
    objectiveTerms: ['inspect', 'pump', 'pressure'],
    criterionTerms: ['verified'],
    artifactTerms: ['report'],
    capabilityTerms: ['sensor.read'],
    tags: ['inspection'],
    deliverable: 'inspection report',
    recentIntentBoundary: 'intent-a',
    ...overrides,
  });
}

function candidate(value: KnowledgeCandidateIdentity) {
  return {
    knowledgeId: 'knowledge-1',
    revision: 1,
    fingerprint: `sha256:${'1'.repeat(64)}`,
    identity: value,
  };
}

function evidence(polarity: 'support' | 'contradiction') {
  return {
    evidenceId: `evidence-${polarity}`,
    polarity,
    observationId: 'observation-1',
    statementIds: [`statement-${polarity}`],
    sourceEpisodeIds: ['episode-1'],
    sourceRefIds: ['source-outcome'],
    outcomeRefs: ['runtime-terminal-outcome:outcome-1'],
    summary: `${polarity} evidence`,
    createdAt: '2026-07-23T07:39:00.000Z',
  } as const;
}

class InvalidCuratorModel implements CognitiveStructuredModelStageInvoker {
  generate() {
    return Promise.resolve({ structuredResult: { operation: 'ACTIVATE_NOW' }, invocationId: 'model-1' });
  }
}
