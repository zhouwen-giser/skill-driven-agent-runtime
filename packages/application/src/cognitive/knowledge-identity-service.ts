import { createHash } from 'node:crypto';

import {
  createKnowledgeCandidateIdentity,
  type KnowledgeCandidateIdentity,
} from '../../../domain/src/index.js';
import type { KnowledgeSemanticSimilarityPort } from './ports.js';

export interface KnowledgeIdentityCandidate {
  readonly knowledgeId: string;
  readonly revision: number;
  readonly fingerprint: string;
  readonly identity: KnowledgeCandidateIdentity;
}

export interface KnowledgeIdentityDecision {
  readonly disposition: 'same_knowledge' | 'create_new';
  readonly confidence: number;
  readonly semanticScore: number;
  readonly lexicalScore: number;
  readonly reason:
    | 'identity_match'
    | 'no_candidates'
    | 'deliverable_boundary'
    | 'recent_intent_boundary'
    | 'identity_confidence_low';
  readonly targetKnowledgeId?: string;
  readonly targetRevision?: number;
}

export class KnowledgeIdentityService {
  readonly #similarity: KnowledgeSemanticSimilarityPort;
  readonly #policy: Readonly<{
    semanticThreshold: number;
    lexicalThreshold: number;
    combinedThreshold: number;
  }>;

  constructor(
    dependencies: Readonly<{
      similarity: KnowledgeSemanticSimilarityPort;
      policy: Readonly<{
        semanticThreshold: number;
        lexicalThreshold: number;
        combinedThreshold: number;
      }>;
    }>,
  ) {
    this.#similarity = dependencies.similarity;
    this.#policy = Object.freeze({ ...dependencies.policy });
  }

  async compare(
    input: Readonly<{
      draft: KnowledgeCandidateIdentity;
      candidates: readonly KnowledgeIdentityCandidate[];
    }>,
  ): Promise<KnowledgeIdentityDecision> {
    const draft = createKnowledgeCandidateIdentity(input.draft);
    if (input.candidates.length === 0) return createNew('no_candidates', 0, 0);
    const draftFingerprint = fingerprintKnowledgeIdentity(draft);
    const exact = input.candidates.find((candidate) => candidate.fingerprint === draftFingerprint);
    if (exact !== undefined) {
      return Object.freeze({
        disposition: 'same_knowledge',
        confidence: 1,
        semanticScore: 1,
        lexicalScore: 1,
        reason: 'identity_match',
        targetKnowledgeId: exact.knowledgeId,
        targetRevision: exact.revision,
      });
    }
    let boundaryReason: KnowledgeIdentityDecision['reason'] = 'identity_confidence_low';
    let best:
      | Readonly<{
          candidate: KnowledgeIdentityCandidate;
          semanticScore: number;
          lexicalScore: number;
          confidence: number;
        }>
      | undefined;
    for (const candidate of input.candidates) {
      const existing = createKnowledgeCandidateIdentity(candidate.identity);
      if (tokenSimilarity(draft.deliverable, existing.deliverable) < 0.8) {
        boundaryReason = 'deliverable_boundary';
        continue;
      }
      if (
        draft.recentIntentBoundary !== undefined &&
        existing.recentIntentBoundary !== undefined &&
        draft.recentIntentBoundary !== existing.recentIntentBoundary
      ) {
        boundaryReason = 'recent_intent_boundary';
        continue;
      }
      const semanticScore = boundedScore(
        await this.#similarity.compare(
          deinstantiate(draft.jobToBeDone, draft.instanceTerms),
          deinstantiate(existing.jobToBeDone, existing.instanceTerms),
        ),
      );
      const lexicalScore = identityLexicalScore(draft, existing);
      const confidence = Number(((semanticScore + lexicalScore) / 2).toFixed(6));
      if (best === undefined || confidence > best.confidence) {
        best = { candidate, semanticScore, lexicalScore, confidence };
      }
    }
    if (best === undefined) return createNew(boundaryReason, 0, 0);
    if (
      best.semanticScore < this.#policy.semanticThreshold ||
      best.lexicalScore < this.#policy.lexicalThreshold ||
      best.confidence < this.#policy.combinedThreshold
    ) {
      return createNew('identity_confidence_low', best.semanticScore, best.lexicalScore);
    }
    return Object.freeze({
      disposition: 'same_knowledge',
      confidence: best.confidence,
      semanticScore: best.semanticScore,
      lexicalScore: best.lexicalScore,
      reason: 'identity_match',
      targetKnowledgeId: best.candidate.knowledgeId,
      targetRevision: best.candidate.revision,
    });
  }
}

export function fingerprintKnowledgeIdentity(identity: KnowledgeCandidateIdentity): string {
  const value = createKnowledgeCandidateIdentity(identity);
  const canonical = JSON.stringify({
    jobToBeDone: deinstantiate(value.jobToBeDone, value.instanceTerms),
    objectiveTerms: value.objectiveTerms,
    criterionTerms: value.criterionTerms,
    artifactTerms: value.artifactTerms,
    capabilityTerms: value.capabilityTerms,
    tags: value.tags,
    deliverable: normalize(value.deliverable),
    recentIntentBoundary: value.recentIntentBoundary ?? null,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function identityLexicalScore(
  left: KnowledgeCandidateIdentity,
  right: KnowledgeCandidateIdentity,
): number {
  const signals = [
    jaccard(left.objectiveTerms, right.objectiveTerms),
    jaccard(left.criterionTerms, right.criterionTerms),
    jaccard(left.artifactTerms, right.artifactTerms),
    jaccard(left.capabilityTerms, right.capabilityTerms),
    jaccard(left.tags, right.tags),
    tokenSimilarity(left.deliverable, right.deliverable),
  ];
  return Number((signals.reduce((sum, value) => sum + value, 0) / signals.length).toFixed(6));
}

function tokenSimilarity(left: string, right: string): number {
  return jaccard(tokens(left), tokens(right));
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left.map(normalize).filter(Boolean));
  const rightSet = new Set(right.map(normalize).filter(Boolean));
  if (leftSet.size === 0 && rightSet.size === 0) return 1;
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokens(value: string): readonly string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}_.:-]+/u)
    .filter(Boolean);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function deinstantiate(value: string, instanceTerms: readonly string[] = []): string {
  let normalized = normalize(value);
  for (const term of [...instanceTerms].sort((left, right) => right.length - left.length)) {
    const instance = normalize(term);
    if (instance.length > 0) normalized = normalized.replaceAll(instance, '[instance]');
  }
  return normalized
    .replace(/\b\d{4}-\d{2}-\d{2}\b/gu, '[date]')
    .replace(/\b(?:[a-z]+[-_])?\d+[a-z0-9_-]*\b/giu, '[instance]')
    .replace(/\b\d+(?:\.\d+)?\b/gu, '[number]');
}

function boundedScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createNew(
  reason: KnowledgeIdentityDecision['reason'],
  semanticScore: number,
  lexicalScore: number,
): KnowledgeIdentityDecision {
  return Object.freeze({
    disposition: 'create_new',
    confidence: Number(((semanticScore + lexicalScore) / 2).toFixed(6)),
    semanticScore,
    lexicalScore,
    reason,
  });
}
