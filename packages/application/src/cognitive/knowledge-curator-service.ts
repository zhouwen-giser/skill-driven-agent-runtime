import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  createKnowledgeCandidateSnapshot,
  createKnowledgeDelta,
  type KnowledgeCandidateDraft,
  type KnowledgeCandidateSnapshot,
  type KnowledgeDelta,
} from '../../../domain/src/index.js';
import type { KnowledgeDeltaValidator } from './knowledge-delta-validator.js';
import {
  fingerprintKnowledgeIdentity,
  type KnowledgeIdentityDecision,
} from './knowledge-identity-service.js';
import type { CognitiveStructuredModelStageInvoker } from './ports.js';

const CuratorOutputSchema = z
  .object({
    operation: z.enum([
      'CREATE_REVISION',
      'SUGGEST_MERGE',
      'SUGGEST_SUPERSEDE',
      'ADD_EVIDENCE',
      'ADD_CONTRADICTION',
      'NO_CHANGE',
    ]),
    relatedKnowledgeIds: z.array(z.string().min(1).max(128)).max(8).default([]),
    reason: z.string().trim().min(1).max(2048),
  })
  .strict();

export class KnowledgeCuratorService {
  readonly #model: CognitiveStructuredModelStageInvoker;
  readonly #validator: KnowledgeDeltaValidator;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextDeltaId: () => string;

  constructor(
    dependencies: Readonly<{
      model: CognitiveStructuredModelStageInvoker;
      validator: KnowledgeDeltaValidator;
      clock: Readonly<{ now(): string }>;
      nextDeltaId(): string;
    }>,
  ) {
    this.#model = dependencies.model;
    this.#validator = dependencies.validator;
    this.#clock = dependencies.clock;
    this.#nextDeltaId = dependencies.nextDeltaId;
  }

  async proposeDelta(
    input: Readonly<{
      reflectionId: string;
      draft: KnowledgeCandidateDraft;
      identity: KnowledgeIdentityDecision;
      existing: KnowledgeCandidateSnapshot | undefined;
      knownKnowledgeIds?: readonly string[];
    }>,
  ): Promise<KnowledgeDelta> {
    const fingerprint = fingerprintKnowledgeIdentity(input.draft.identity);
    let generated: Readonly<{ structuredResult: unknown; invocationId: string }> | undefined;
    try {
      generated = await this.#model.generate({
        stage: 'experience_reflection',
        instruction: JSON.stringify({
          policy: {
            rule: 'Propose exactly one allowlisted candidate-only operation. Never activate knowledge, invoke tools, or mutate a source. Invalid or uncertain input must return NO_CHANGE.',
          },
          draft: input.draft,
          identityDecision: input.identity,
          existingCandidate: input.existing,
        }),
        responseSchema: CuratorOutputSchema.toJSONSchema(),
        sourceRefs: [
          ...new Set(
            [...input.draft.supportEvidence, ...input.draft.contradictionEvidence].flatMap(
              (item) => item.sourceRefIds,
            ),
          ),
        ],
        maxAttempts: 1,
        timeoutMs: 30_000,
      });
      const parsed = CuratorOutputSchema.safeParse(generated.structuredResult);
      if (!parsed.success) {
        return this.#noChange(input, fingerprint, 'curator_output_invalid', generated.invocationId);
      }
      if (parsed.data.operation === 'NO_CHANGE') {
        return this.#noChange(input, fingerprint, parsed.data.reason, generated.invocationId);
      }
      if (
        ['SUGGEST_MERGE', 'SUGGEST_SUPERSEDE'].includes(parsed.data.operation) &&
        parsed.data.relatedKnowledgeIds.some(
          (knowledgeId) => !(input.knownKnowledgeIds ?? []).includes(knowledgeId),
        )
      ) {
        return this.#noChange(
          input,
          fingerprint,
          'curator_relation_unknown',
          generated.invocationId,
        );
      }
      const candidate = mutationCandidate(
        parsed.data.operation,
        input,
        fingerprint,
        this.#clock.now(),
      );
      const delta = createKnowledgeDelta({
        schemaVersion: '1.0',
        deltaId: this.#nextDeltaId(),
        reflectionId: input.reflectionId,
        operation: parsed.data.operation,
        knowledgeKind: input.draft.knowledgeKind,
        fingerprint,
        identity: input.draft.identity,
        ...(input.identity.targetKnowledgeId === undefined
          ? {}
          : {
              targetKnowledgeId: input.identity.targetKnowledgeId,
              targetRevision: input.identity.targetRevision,
            }),
        relatedKnowledgeIds: parsed.data.relatedKnowledgeIds,
        ...(candidate === undefined ? {} : { candidate }),
        supportEvidence: input.draft.supportEvidence,
        contradictionEvidence: input.draft.contradictionEvidence,
        confidence: input.identity.confidence,
        reason: sanitizeText(parsed.data.reason),
        modelInvocationId: generated.invocationId,
        createdAt: this.#clock.now(),
      });
      return this.#validator.validate(delta);
    } catch {
      return this.#noChange(
        input,
        fingerprint,
        'curator_operation_failed',
        generated?.invocationId,
      );
    }
  }

  #noChange(
    input: Readonly<{
      reflectionId: string;
      draft: KnowledgeCandidateDraft;
      identity: KnowledgeIdentityDecision;
    }>,
    fingerprint: string,
    reason: string,
    modelInvocationId?: string,
  ): KnowledgeDelta {
    return this.#validator.validate(
      createKnowledgeDelta({
        schemaVersion: '1.0',
        deltaId: this.#nextDeltaId(),
        reflectionId: input.reflectionId,
        operation: 'NO_CHANGE',
        knowledgeKind: input.draft.knowledgeKind,
        fingerprint,
        identity: input.draft.identity,
        relatedKnowledgeIds: [],
        supportEvidence: input.draft.supportEvidence,
        contradictionEvidence: input.draft.contradictionEvidence,
        confidence: input.identity.confidence,
        reason: sanitizeText(reason),
        ...(modelInvocationId === undefined ? {} : { modelInvocationId }),
        createdAt: this.#clock.now(),
      }),
    );
  }
}

function mutationCandidate(
  operation: z.infer<typeof CuratorOutputSchema>['operation'],
  input: Readonly<{
    draft: KnowledgeCandidateDraft;
    identity: KnowledgeIdentityDecision;
    existing: KnowledgeCandidateSnapshot | undefined;
  }>,
  fingerprint: string,
  createdAt: string,
): KnowledgeCandidateSnapshot | undefined {
  if (!['CREATE_REVISION', 'ADD_EVIDENCE', 'ADD_CONTRADICTION'].includes(operation)) {
    return undefined;
  }
  if (input.existing !== undefined && input.existing.status !== 'candidate') return undefined;
  const existing = input.existing;
  const knowledgeId =
    existing?.knowledgeId ??
    `knowledge-${input.draft.knowledgeKind}-${createHash('sha256').update(fingerprint).digest('hex').slice(0, 24)}`;
  return createKnowledgeCandidateSnapshot({
    schemaVersion: '1.0',
    knowledgeId,
    kind: input.draft.knowledgeKind,
    revision: (existing?.revision ?? 0) + 1,
    status: 'candidate',
    scope: existing?.scope ?? 'global_candidate',
    ...(input.draft.tenantId === undefined ? {} : { tenantId: input.draft.tenantId }),
    ...(input.draft.userId === undefined ? {} : { userId: input.draft.userId }),
    title: input.draft.title,
    summary: input.draft.summary,
    risk: input.draft.risk,
    supportSourceRefs: [
      ...(existing?.supportSourceRefs ?? []),
      ...input.draft.supportEvidence.flatMap((item) => item.sourceRefs ?? []),
    ],
    contradictionSourceRefs: [
      ...(existing?.contradictionSourceRefs ?? []),
      ...input.draft.contradictionEvidence.flatMap((item) => item.sourceRefs ?? []),
    ],
    createdAt,
  });
}

function sanitizeText(value: string): string {
  return value
    .replace(
      /ignore\s+(?:all\s+)?(?:previous\s+system|previous|prior|system)\s+instructions?/giu,
      '[UNTRUSTED_DIRECTIVE]',
    )
    .replace(/<\/?(?:system|assistant|developer)>/giu, '[UNTRUSTED_ROLE_TAG]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .slice(0, 2048);
}
