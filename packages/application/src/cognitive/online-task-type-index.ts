import type { TaskTypeRepository } from './ports.js';
import type { KnowledgePromotionService } from './knowledge-promotion-service.js';
import { z } from 'zod';
import type { TextEmbeddingProvider } from '../ports.js';
import type {
  TaskTypeDefinition,
  TaskTypeIndexSource,
} from './generic-task-understanding-service.js';
import type { KnowledgeSearchRepository } from './knowledge-retrieval-ports.js';
import type { TaskTypeDefinitionSnapshot } from '../../../domain/src/index.js';
const definitionSchema = z.object({
  taskTypeId: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
  recognition: z.object({
    hints: z.array(z.string()),
    positiveExamples: z.array(z.string()),
    negativeExamples: z.array(z.string()),
  }),
  requiredDimensions: z.array(
    z.enum([
      'target',
      'scope',
      'time_range',
      'priority',
      'criteria',
      'artifact',
      'evidence',
      'side_effect_authorization',
      'risk_tolerance',
      'degradation_policy',
      'uncovered_case_policy',
      'human_confirmation_policy',
    ]),
  ),
  capabilityRequirements: z.array(z.string()),
  incompatibleConstraints: z.array(z.string()),
  sourceHash: z.string().optional(),
  fingerprint: z.string(),
  criteriaTemplate: z.array(z.string()),
  goalPattern: z.string(),
});
/** Bounded retrieval over current governed authority; static hints never decide admission. */
export class OnlineTaskTypeIndexSource implements TaskTypeIndexSource {
  constructor(
    private readonly searchRepository: KnowledgeSearchRepository,
    private readonly embeddings: TextEmbeddingProvider,
  ) {}
  async search(
    input: Readonly<{ requestText: string; limit: number }>,
  ): Promise<readonly TaskTypeDefinition[]> {
    const limit = Math.min(32, Math.max(1, input.limit));
    const filters = {
      kind: 'task_type' as const,
      scope: {},
      catalogHash: '',
      promotionPolicyVersion: 'knowledge-promotion-v1',
      applicabilityTerms: [],
      minConfidence: 0,
      limit: Math.min(64, limit * 4),
    };
    const embedding = await this.embeddings.embed(input.requestText);
    const [text, vector] = await Promise.all([
      this.searchRepository.textSearch(input.requestText, filters),
      this.searchRepository.vectorSearch({ ...embedding, filters }),
    ]);
    const ranks = new Map<string, { entry: (typeof text)[number]['entry']; score: number }>();
    for (const hits of [text, vector])
      hits.forEach((hit, index) => {
        if (hit.entry.kind !== 'task_type') return;
        const current = ranks.get(hit.entry.authoritativeRef);
        ranks.set(hit.entry.authoritativeRef, {
          entry: hit.entry,
          score: (current?.score ?? 0) + 1 / (60 + index),
        });
      });
    const selected = [...ranks.values()]
      .sort(
        (a, b) =>
          b.score - a.score || a.entry.authoritativeRef.localeCompare(b.entry.authoritativeRef),
      )
      .slice(0, limit);
    // Re-read exact active revisions after recall so revocation cannot be bypassed by a stale index.
    const active = await this.searchRepository.loadDefinitions(
      selected.map((hit) => hit.entry.authoritativeRef),
      filters,
    );
    return active
      .filter((entry) => entry.kind === 'task_type')
      .map((entry) => {
        const definition = definitionSchema.parse(entry.definition);
        if (definition.taskTypeId !== entry.knowledgeId || definition.revision !== entry.revision)
          throw new Error('TASK_TYPE_INDEX_IDENTITY_CONFLICT');
        return {
          taskTypeId: entry.knowledgeId,
          version: entry.revision,
          title: definition.title,
          recognitionHints: definition.recognition.hints,
          requiredDimensions: definition.requiredDimensions,
          capabilityRequirements: definition.capabilityRequirements,
          risks: definition.incompatibleConstraints,
          sourceHash: definition.sourceHash ?? definition.fingerprint,
          recognition: definition.recognition,
          criteriaTemplate: definition.criteriaTemplate,
          goalPattern: definition.goalPattern,
        };
      });
  }
}
export function configuredTaskTypeSnapshot(
  definition: TaskTypeDefinition,
  sourceHash: string,
  createdAt: string,
): TaskTypeDefinitionSnapshot {
  return {
    schemaVersion: '1.0',
    taskTypeId: definition.taskTypeId,
    revision: definition.version,
    status: 'candidate',
    origin: 'configured',
    sourceHash,
    inductionMode: 'offline_batch',
    fingerprint: sourceHash,
    title: definition.title,
    summary: definition.title,
    recognition: { hints: definition.recognitionHints, positiveExamples: [], negativeExamples: [] },
    requiredDimensions: definition.requiredDimensions,
    optionalDimensions: [],
    criteriaTemplate: [definition.title],
    capabilityRequirements: definition.capabilityRequirements,
    goalPattern: definition.title,
    dependencyPattern: [],
    incompatibleConstraints: definition.risks,
    exemplars: [],
    sourceRefs: [],
    createdAt,
  };
}

export class ConfiguredTaskTypeImportService {
  constructor(
    private readonly dependencies: Readonly<{
      repository: TaskTypeRepository;
      governance: Pick<KnowledgePromotionService, 'evaluate' | 'findCandidate'>;
      hash(value: unknown): string;
      now(): string;
    }>,
  ) {}
  async import(
    definition: TaskTypeDefinition,
    approval: Readonly<{ actorId: string; humanApproved: boolean; policyAllowed: boolean }>,
  ) {
    const sourceHash = this.dependencies.hash(definition);
    const previous = await this.dependencies.repository.findByFingerprint(sourceHash);
    if (previous !== undefined && previous.status !== 'candidate') {
      // Repeating configuration does not reactivate a revoked definition.
      return previous;
    }
    const candidate =
      previous ?? configuredTaskTypeSnapshot(definition, sourceHash, this.dependencies.now());
    if (previous === undefined) await this.dependencies.repository.saveCandidate(candidate);
    // An unapproved import is retained for review. It must not consume the existing
    // one-decision-per-revision governance evaluation before approval arrives.
    if (!approval.humanApproved || !approval.policyAllowed) return candidate;
    const record = await this.dependencies.governance.findCandidate(
      'task_type',
      candidate.taskTypeId,
    );
    if (record?.revision !== candidate.revision)
      throw new Error('TASK_TYPE_CONFIGURED_CANDIDATE_MISSING');
    await this.dependencies.governance.evaluate({
      kind: 'task_type',
      knowledgeId: candidate.taskTypeId,
      expectedVersion: record.version,
      ...approval,
    });
    return this.dependencies.repository.findByFingerprint(sourceHash);
  }
}
