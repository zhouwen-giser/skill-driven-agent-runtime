import {
  assertIdentifier,
  assertPositiveVersion,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
} from './common.js';
import { CognitiveDomainError } from './errors.js';
import type { KnowledgeKind, KnowledgeStatus } from './knowledge.js';

export type KnowledgePromotionEvaluationStatus =
  'pending' | 'passed' | 'failed' | 'rejected' | 'incubating';

export interface PromotionEvidenceSummary {
  readonly uniqueGoalCount: number;
  readonly uniqueUserCount: number;
  readonly successfulOutcomeCount: number;
  readonly failedOutcomeCount: number;
  readonly userAcceptedPlanningCount: number;
  readonly userRejectedPlanningCount: number;
  readonly replayPassedCount: number;
  readonly replayFailedCount: number;
  readonly shadowImprovedCount: number;
  readonly shadowRegressedCount: number;
  readonly supportingRefs: readonly string[];
  readonly contradictingRefs: readonly string[];
}

export interface PromotionReplayReport {
  readonly reportRef: string;
  readonly passedCount: number;
  readonly failedCount: number;
}

export interface PromotionShadowReport {
  readonly reportRef: string;
  readonly improvedCount: number;
  readonly regressedCount: number;
}

export interface PromotionGateResult {
  readonly code: string;
  readonly passed: boolean;
  readonly actual: number | boolean | string;
  readonly required: number | boolean | string;
}

export interface PromotionDecision {
  readonly passed: boolean;
  readonly gates: readonly PromotionGateResult[];
  readonly evidence: PromotionEvidenceSummary;
}

export interface KnowledgePromotionEvaluation {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly knowledgeKind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly knowledgeRevision: number;
  readonly policyVersion: string;
  readonly status: KnowledgePromotionEvaluationStatus;
  readonly evidence: PromotionEvidenceSummary;
  readonly gates: readonly PromotionGateResult[];
  readonly replayReportRef?: string;
  readonly shadowReportRef?: string;
  readonly humanApproved: boolean;
  readonly policyAllowed: boolean;
  readonly duplicateKnowledgeId?: string;
  readonly decidedBy?: string;
  readonly decisionSummary: string;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface ActiveKnowledgeProjection {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly projectionId: string;
  readonly knowledgeKind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly knowledgeRevision: number;
  readonly authoritativeRef: string;
  readonly title: string;
  readonly summary: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly status: Extract<KnowledgeStatus, 'active'>;
  readonly projectedAt: string;
}

export function createPromotionEvidenceSummary(
  input: PromotionEvidenceSummary,
): PromotionEvidenceSummary {
  for (const [field, value] of Object.entries(input).filter(
    ([key]) => !['supportingRefs', 'contradictingRefs'].includes(key),
  )) {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
      invalid(`${field} must be non-negative.`);
  }
  return Object.freeze({
    ...input,
    supportingRefs: identifiers(input.supportingRefs, 'supportingRef'),
    contradictingRefs: identifiers(input.contradictingRefs, 'contradictingRef'),
  });
}

export function createKnowledgePromotionEvaluation(
  input: KnowledgePromotionEvaluation,
): KnowledgePromotionEvaluation {
  assertIdentifier(input.evaluationId, 'evaluationId');
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertIdentifier(input.policyVersion, 'policyVersion');
  assertPositiveVersion(input.knowledgeRevision, 'knowledgeRevision');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.decidedAt !== undefined) assertTimestamp(input.decidedAt, 'decidedAt');
  if (input.decidedBy !== undefined) assertIdentifier(input.decidedBy, 'decidedBy');
  if (input.duplicateKnowledgeId !== undefined) {
    assertIdentifier(input.duplicateKnowledgeId, 'duplicateKnowledgeId');
  }
  if (
    !['pending', 'passed', 'failed', 'rejected', 'incubating'].includes(input.status) ||
    input.decisionSummary.trim().length === 0
  ) {
    invalid('Promotion Evaluation status or summary is invalid.');
  }
  if (input.status === 'passed' && !input.humanApproved) {
    throw new CognitiveDomainError(
      'KNOWLEDGE_PROMOTION_FORBIDDEN',
      'A passed Promotion Evaluation requires human approval.',
    );
  }
  return Object.freeze({
    ...input,
    evidence: createPromotionEvidenceSummary(input.evidence),
    gates: Object.freeze(input.gates.map(createPromotionGateResult)),
  });
}

export function createActiveKnowledgeProjection(
  input: ActiveKnowledgeProjection,
): ActiveKnowledgeProjection {
  assertIdentifier(input.projectionId, 'projectionId');
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertPositiveVersion(input.knowledgeRevision, 'knowledgeRevision');
  assertTimestamp(input.projectedAt, 'projectedAt');
  if (
    input.authoritativeRef !==
      `${input.knowledgeKind}:${input.knowledgeId}:${String(input.knowledgeRevision)}` ||
    input.title.trim().length === 0 ||
    input.summary.trim().length === 0
  ) {
    invalid('Active Knowledge projection must contain only its exact authoritative reference.');
  }
  return Object.freeze({ ...input });
}

function createPromotionGateResult(input: PromotionGateResult): PromotionGateResult {
  assertIdentifier(input.code, 'promotionGateCode');
  if (!['number', 'boolean', 'string'].includes(typeof input.actual))
    invalid('Invalid gate actual.');
  if (!['number', 'boolean', 'string'].includes(typeof input.required)) {
    invalid('Invalid gate requirement.');
  }
  return Object.freeze({ ...input });
}

function identifiers(values: readonly string[], field: string): readonly string[] {
  const unique = [...new Set(values)].sort();
  for (const value of unique) assertIdentifier(value, field);
  return Object.freeze(unique);
}

function invalid(message: string): never {
  throw new CognitiveDomainError('KNOWLEDGE_PROMOTION_INVALID', message);
}
