import type {
  ActiveKnowledgeProjection,
  KnowledgeKind,
  KnowledgePromotionEvaluation,
  KnowledgeStatus,
  KnowledgeStatusTransition,
  PromotionEvidenceSummary,
  PromotionReplayReport,
  PromotionShadowReport,
} from '../../../domain/src/index.js';

export interface PromotionCandidateRecord {
  readonly schemaVersion: '1.0';
  readonly knowledgeId: string;
  readonly revision: number;
  readonly version: number;
  readonly status: KnowledgeStatus;
  readonly kind: KnowledgeKind;
  readonly scope: 'task' | 'user' | 'tenant' | 'global_candidate';
  readonly tenantId?: string;
  readonly userId?: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly title: string;
  readonly summary: string;
  readonly definition: Readonly<Record<string, unknown>>;
  readonly supportSourceRefs: readonly string[];
  readonly contradictionSourceRefs: readonly string[];
  readonly fingerprint?: string;
  readonly catalogHash?: string;
  readonly createdAt: string;
}

export interface PromotionRevalidationCandidate {
  readonly record: PromotionCandidateRecord;
  readonly reason: Extract<
    KnowledgeStatusTransition['reason'],
    'contradiction_detected' | 'policy_changed'
  >;
}

export interface KnowledgePromotionRepository {
  find(
    kind: KnowledgeKind,
    knowledgeId: string,
  ): Promise<
    | Readonly<{
        record: PromotionCandidateRecord;
        evidence: PromotionEvidenceSummary;
      }>
    | undefined
  >;
  findActive(
    kind: KnowledgeKind,
    knowledgeId: string,
  ): Promise<PromotionCandidateRecord | undefined>;
  findDuplicate(record: PromotionCandidateRecord): Promise<PromotionCandidateRecord | undefined>;
  complete(
    input: Readonly<{
      expectedVersion: number;
      evaluation: KnowledgePromotionEvaluation;
      transitions: readonly KnowledgeStatusTransition[];
      finalStatus: Extract<KnowledgeStatus, 'active' | 'candidate'>;
      projection?: ActiveKnowledgeProjection;
    }>,
  ): Promise<PromotionCandidateRecord>;
  transition(
    input: Readonly<{
      kind: KnowledgeKind;
      knowledgeId: string;
      knowledgeRevision: number;
      expectedVersion: number;
      toStatus: Extract<KnowledgeStatus, 'validating' | 'deprecated' | 'rejected'>;
      transition: KnowledgeStatusTransition;
      evaluation?: KnowledgePromotionEvaluation;
    }>,
  ): Promise<PromotionCandidateRecord>;
  listActive(): Promise<readonly PromotionCandidateRecord[]>;
  listRevalidationCandidates(
    policyVersion: string,
  ): Promise<readonly PromotionRevalidationCandidate[]>;
}

export interface PromotionReplayEvaluationRunner {
  run(candidate: PromotionCandidateRecord): Promise<PromotionReplayReport>;
}

export interface PromotionShadowReportSource {
  find(candidate: PromotionCandidateRecord): Promise<PromotionShadowReport | undefined>;
}

export interface ActiveKnowledgeProjectionRepository {
  upsert(projection: ActiveKnowledgeProjection): Promise<void>;
  remove(
    knowledgeKind: KnowledgeKind,
    knowledgeId: string,
    knowledgeRevision: number,
    actorId: string,
    reason: string,
  ): Promise<void>;
  prune(activeProjectionIds: ReadonlySet<string>, actorId: string, reason: string): Promise<number>;
}

export interface ActiveKnowledgeProjectionInventory {
  listActiveProjectionIds(): Promise<readonly string[]>;
}

export interface PromotionTarget {
  readonly kind: KnowledgeKind;
  validate(candidate: PromotionCandidateRecord): readonly string[];
  promote(candidate: PromotionCandidateRecord, nextVersion: number): PromotionCandidateRecord;
}
