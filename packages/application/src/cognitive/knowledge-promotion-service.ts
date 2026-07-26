import {
  createKnowledgePromotionEvaluation,
  createKnowledgeStatusTransition,
  type KnowledgeKind,
  type KnowledgePromotionEvaluation,
  type KnowledgeTransitionReason,
} from '../../../domain/src/index.js';
import type { ActiveKnowledgeProjector } from './active-knowledge-projector.js';
import type { EvidenceThresholdEvaluator } from './evidence-threshold-evaluator.js';
import type {
  KnowledgePromotionRepository,
  PromotionCandidateRecord,
  PromotionReplayEvaluationRunner,
  PromotionShadowReportSource,
  PromotionTarget,
} from './promotion-ports.js';
import type { DuplicateCandidateDetector } from './promotion-validation.js';

export class KnowledgePromotionService {
  readonly #repository: KnowledgePromotionRepository;
  readonly #evaluator: EvidenceThresholdEvaluator;
  readonly #replay: PromotionReplayEvaluationRunner;
  readonly #shadow: PromotionShadowReportSource;
  readonly #projector: ActiveKnowledgeProjector;
  readonly #duplicates: DuplicateCandidateDetector;
  readonly #targets: ReadonlyMap<KnowledgeKind, PromotionTarget>;
  readonly #policyVersion: string;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextEvaluationId: () => string;
  readonly #nextTransitionId: (ordinal: number) => string;

  constructor(
    dependencies: Readonly<{
      repository: KnowledgePromotionRepository;
      evaluator: EvidenceThresholdEvaluator;
      replay: PromotionReplayEvaluationRunner;
      shadow: PromotionShadowReportSource;
      projector: ActiveKnowledgeProjector;
      duplicates: DuplicateCandidateDetector;
      targets: readonly PromotionTarget[];
      policyVersion: string;
      clock: Readonly<{ now(): string }>;
      nextEvaluationId(): string;
      nextTransitionId(ordinal: number): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#evaluator = dependencies.evaluator;
    this.#replay = dependencies.replay;
    this.#shadow = dependencies.shadow;
    this.#projector = dependencies.projector;
    this.#duplicates = dependencies.duplicates;
    this.#targets = new Map(dependencies.targets.map((target) => [target.kind, target]));
    this.#policyVersion = dependencies.policyVersion;
    this.#clock = dependencies.clock;
    this.#nextEvaluationId = dependencies.nextEvaluationId;
    this.#nextTransitionId = dependencies.nextTransitionId;
    if (this.#targets.size !== 3) throw new Error('KNOWLEDGE_PROMOTION_TARGET_SET_INCOMPLETE');
  }

  list(kind: KnowledgeKind, limit = 100): Promise<readonly PromotionCandidateRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw promotionError('KNOWLEDGE_LIST_LIMIT_INVALID');
    }
    return this.#repository.list(kind, limit);
  }

  async evaluate(
    input: Readonly<{
      kind: KnowledgeKind;
      knowledgeId: string;
      expectedVersion: number;
      actorId: string;
      humanApproved: boolean;
      policyAllowed: boolean;
    }>,
  ): Promise<
    Readonly<{
      knowledge: PromotionCandidateRecord;
      evaluation: KnowledgePromotionEvaluation;
    }>
  > {
    const loaded = await this.#required(input.kind, input.knowledgeId);
    if (loaded.record.version !== input.expectedVersion) {
      throw promotionError('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
    }
    if (loaded.record.status !== 'candidate') {
      throw promotionError('KNOWLEDGE_PROMOTION_REQUIRES_CANDIDATE');
    }
    const target = this.#targets.get(input.kind);
    if (target === undefined) throw new Error('KNOWLEDGE_PROMOTION_TARGET_MISSING');
    const [duplicate, replay, shadow, priorActive] = await Promise.all([
      this.#duplicates.find(loaded.record),
      this.#replay.run(loaded.record),
      this.#shadow.find(loaded.record),
      this.#repository
        .listActive()
        .then((items) =>
          items.filter(
            (item) =>
              item.kind === input.kind &&
              item.knowledgeId === input.knowledgeId &&
              item.revision !== loaded.record.revision,
          ),
        ),
    ]);
    const decision = this.#evaluator.evaluate({
      candidate: loaded.record,
      evidence: loaded.evidence,
      replay,
      ...(shadow === undefined ? {} : { shadow }),
      humanApproved: input.humanApproved,
      policyAllowed: input.policyAllowed,
    });
    const staticFailures = target.validate(loaded.record);
    const extraGates = [
      ...staticFailures.map((code) => ({
        code,
        passed: false,
        actual: false,
        required: true,
      })),
      ...(duplicate === undefined
        ? []
        : [
            {
              code: 'duplicate_active_candidate',
              passed: false,
              actual: duplicate.knowledgeId,
              required: 'none',
            },
          ]),
    ];
    const passed = decision.passed && extraGates.length === 0;
    const now = this.#clock.now();
    const evaluation = createKnowledgePromotionEvaluation({
      schemaVersion: '1.0',
      evaluationId: this.#nextEvaluationId(),
      knowledgeKind: input.kind,
      knowledgeId: input.knowledgeId,
      knowledgeRevision: loaded.record.revision,
      policyVersion: this.#policyVersion,
      status: passed ? 'passed' : 'failed',
      evidence: decision.evidence,
      gates: [...decision.gates, ...extraGates],
      replayReportRef: replay.reportRef,
      ...(shadow === undefined ? {} : { shadowReportRef: shadow.reportRef }),
      humanApproved: input.humanApproved,
      policyAllowed: input.policyAllowed,
      ...(duplicate === undefined ? {} : { duplicateKnowledgeId: duplicate.knowledgeId }),
      decidedBy: input.actorId,
      decisionSummary: passed
        ? 'All deterministic Promotion gates passed.'
        : 'The Candidate remains inactive because one or more Promotion gates failed.',
      createdAt: now,
      decidedAt: now,
    });
    const first = createKnowledgeStatusTransition({
      schemaVersion: '1.0',
      transitionId: this.#nextTransitionId(1),
      knowledgeId: input.knowledgeId,
      knowledgeRevision: loaded.record.revision,
      expectedVersion: input.expectedVersion,
      fromStatus: 'candidate',
      toStatus: 'validating',
      reason: 'evaluation_started',
      actorId: input.actorId,
      humanApproved: false,
      occurredAt: now,
    });
    const second = createKnowledgeStatusTransition({
      schemaVersion: '1.0',
      transitionId: this.#nextTransitionId(2),
      knowledgeId: input.knowledgeId,
      knowledgeRevision: loaded.record.revision,
      expectedVersion: input.expectedVersion + 1,
      fromStatus: 'validating',
      toStatus: passed ? 'active' : 'candidate',
      reason: passed ? 'promotion_approved' : 'promotion_rejected',
      actorId: input.actorId,
      humanApproved: passed && input.humanApproved,
      occurredAt: now,
    });
    const activeCandidate: PromotionCandidateRecord | undefined = passed
      ? target.promote(loaded.record, input.expectedVersion + 2)
      : undefined;
    const projection =
      activeCandidate === undefined ? undefined : this.#projector.create(activeCandidate);
    const knowledge = await normalizeRepositoryError(() =>
      this.#repository.complete({
        expectedVersion: input.expectedVersion,
        evaluation,
        transitions: [first, second],
        finalStatus: passed ? 'active' : 'candidate',
        ...(projection === undefined ? {} : { projection }),
      }),
    );
    if (knowledge.status === 'active') {
      for (const prior of priorActive) {
        await this.#projector.remove(
          prior,
          input.actorId,
          'A newer revision became the sole Active Knowledge projection.',
        );
      }
      await this.#projector.project(knowledge);
    }
    return Object.freeze({ knowledge, evaluation });
  }

  async reject(
    input: Readonly<{
      kind: KnowledgeKind;
      knowledgeId: string;
      expectedVersion: number;
      actorId: string;
      reason: string;
    }>,
  ): Promise<PromotionCandidateRecord> {
    const loaded = await this.#required(input.kind, input.knowledgeId);
    if (loaded.record.status !== 'candidate' && loaded.record.status !== 'validating') {
      throw promotionError('KNOWLEDGE_REJECTION_STATUS_CONFLICT');
    }
    const now = this.#clock.now();
    const evaluation = createKnowledgePromotionEvaluation({
      schemaVersion: '1.0',
      evaluationId: this.#nextEvaluationId(),
      knowledgeKind: input.kind,
      knowledgeId: input.knowledgeId,
      knowledgeRevision: loaded.record.revision,
      policyVersion: this.#policyVersion,
      status: 'rejected',
      evidence: loaded.evidence,
      gates: [],
      humanApproved: true,
      policyAllowed: false,
      decidedBy: input.actorId,
      decisionSummary: input.reason,
      createdAt: now,
      decidedAt: now,
    });
    const transitioned = await this.#transition({
      record: loaded.record,
      expectedVersion: input.expectedVersion,
      toStatus: 'rejected',
      reason: 'promotion_rejected',
      actorId: input.actorId,
      humanApproved: true,
      evaluation,
    });
    return transitioned;
  }

  async revalidate(
    input: Readonly<{
      kind: KnowledgeKind;
      knowledgeId: string;
      expectedVersion: number;
      actorId: string;
      reason: Extract<
        KnowledgeTransitionReason,
        'contradiction_detected' | 'catalog_changed' | 'policy_changed' | 'skill_version_changed'
      >;
    }>,
  ): Promise<PromotionCandidateRecord> {
    const record = await this.#requiredActive(
      input.kind,
      input.knowledgeId,
      'KNOWLEDGE_REVALIDATION_REQUIRES_ACTIVE',
    );
    const transitioned = await this.#transition({
      record,
      expectedVersion: input.expectedVersion,
      toStatus: 'validating',
      reason: input.reason,
      actorId: input.actorId,
      humanApproved: false,
    });
    await this.#projector.remove(record, input.actorId, input.reason);
    return transitioned;
  }

  async deprecate(
    input: Readonly<{
      kind: KnowledgeKind;
      knowledgeId: string;
      expectedVersion: number;
      actorId: string;
    }>,
  ): Promise<PromotionCandidateRecord> {
    const record = await this.#requiredActive(
      input.kind,
      input.knowledgeId,
      'KNOWLEDGE_DEPRECATION_REQUIRES_ACTIVE',
    );
    const transitioned = await this.#transition({
      record,
      expectedVersion: input.expectedVersion,
      toStatus: 'deprecated',
      reason: 'manual_deprecation',
      actorId: input.actorId,
      humanApproved: true,
    });
    await this.#projector.remove(
      record,
      input.actorId,
      'Active Knowledge was manually deprecated.',
    );
    return transitioned;
  }

  rebuildActiveProjections(): Promise<number> {
    return this.#repository
      .listActive()
      .then((candidates) => this.#projector.reconcile(candidates));
  }

  async revalidateChangedActive(
    actorId = 'system.knowledge-promotion-invalidator',
  ): Promise<number> {
    const candidates = await this.#repository.listRevalidationCandidates(this.#policyVersion);
    let transitioned = 0;
    for (const candidate of candidates) {
      await this.#transition({
        record: candidate.record,
        expectedVersion: candidate.record.version,
        toStatus: 'validating',
        reason: candidate.reason,
        actorId,
        humanApproved: false,
      });
      transitioned += 1;
    }
    await this.rebuildActiveProjections();
    return transitioned;
  }

  async #required(kind: KnowledgeKind, knowledgeId: string) {
    const loaded = await this.#repository.find(kind, knowledgeId);
    if (loaded === undefined) throw promotionError('KNOWLEDGE_PROMOTION_CANDIDATE_NOT_FOUND');
    return loaded;
  }

  async #requiredActive(
    kind: KnowledgeKind,
    knowledgeId: string,
    missingCode: Extract<
      KnowledgePromotionErrorCode,
      'KNOWLEDGE_REVALIDATION_REQUIRES_ACTIVE' | 'KNOWLEDGE_DEPRECATION_REQUIRES_ACTIVE'
    >,
  ) {
    const record = await this.#repository.findActive(kind, knowledgeId);
    if (record === undefined) throw promotionError(missingCode);
    return record;
  }

  #transition(
    input: Readonly<{
      record: PromotionCandidateRecord;
      expectedVersion: number;
      toStatus: 'validating' | 'deprecated' | 'rejected';
      reason: KnowledgeTransitionReason;
      actorId: string;
      humanApproved: boolean;
      evaluation?: KnowledgePromotionEvaluation;
    }>,
  ) {
    if (input.record.version !== input.expectedVersion) {
      throw promotionError('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
    }
    const transition = createKnowledgeStatusTransition({
      schemaVersion: '1.0',
      transitionId: this.#nextTransitionId(1),
      knowledgeId: input.record.knowledgeId,
      knowledgeRevision: input.record.revision,
      expectedVersion: input.expectedVersion,
      fromStatus: input.record.status,
      toStatus: input.toStatus,
      reason: input.reason,
      actorId: input.actorId,
      humanApproved: input.humanApproved,
      occurredAt: this.#clock.now(),
    });
    return normalizeRepositoryError(() =>
      this.#repository.transition({
        kind: input.record.kind,
        knowledgeId: input.record.knowledgeId,
        knowledgeRevision: input.record.revision,
        expectedVersion: input.expectedVersion,
        toStatus: input.toStatus,
        transition,
        ...(input.evaluation === undefined ? {} : { evaluation: input.evaluation }),
      }),
    );
  }
}

export type KnowledgePromotionErrorCode =
  | 'KNOWLEDGE_LIST_LIMIT_INVALID'
  | 'KNOWLEDGE_PROMOTION_CANDIDATE_NOT_FOUND'
  | 'KNOWLEDGE_PROMOTION_VERSION_CONFLICT'
  | 'KNOWLEDGE_PROMOTION_EVALUATION_CONFLICT'
  | 'KNOWLEDGE_PROMOTION_REQUIRES_CANDIDATE'
  | 'KNOWLEDGE_REJECTION_STATUS_CONFLICT'
  | 'KNOWLEDGE_REVALIDATION_REQUIRES_ACTIVE'
  | 'KNOWLEDGE_DEPRECATION_REQUIRES_ACTIVE';

export class KnowledgePromotionError extends Error {
  readonly code: KnowledgePromotionErrorCode;

  constructor(code: KnowledgePromotionErrorCode) {
    super(code);
    this.name = 'KnowledgePromotionError';
    this.code = code;
  }
}

function promotionError(code: KnowledgePromotionErrorCode): KnowledgePromotionError {
  return new KnowledgePromotionError(code);
}

async function normalizeRepositoryError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message === 'KNOWLEDGE_PROMOTION_VERSION_CONFLICT' ||
        error.message === 'KNOWLEDGE_PROMOTION_EVALUATION_CONFLICT')
    ) {
      throw promotionError(error.message);
    }
    throw error;
  }
}
