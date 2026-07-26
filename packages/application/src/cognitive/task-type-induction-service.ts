import { z } from 'zod';

import {
  createTaskTypeDefinitionSnapshot,
  type CognitiveSourceRef,
  type TaskTypeDefinitionSnapshot,
  type TaskTypeInductionExample,
  type TaskTypeInductionMode,
} from '../../../domain/src/index.js';
import type { CognitiveStructuredModelStageInvoker, TaskTypeRepository } from './ports.js';
import type {
  TaskTypeCluster,
  TaskTypeClusterer,
  TaskTypeFingerprintBuilder,
} from './task-type-fingerprint.js';

const dimensionKinds = [
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
] as const;

const TaskTypeModelOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    summary: z.string().trim().min(1).max(4096),
    recognitionHints: z.array(z.string().trim().min(1).max(512)).min(1).max(32),
    positiveExamples: z.array(z.string().trim().min(1).max(2048)).min(1).max(16),
    negativeExamples: z.array(z.string().trim().min(1).max(2048)).min(1).max(16),
    requiredDimensions: z.array(z.enum(dimensionKinds)).max(16),
    optionalDimensions: z.array(z.enum(dimensionKinds)).max(16),
    criteriaTemplate: z.array(z.string().trim().min(1).max(2048)).min(1).max(32),
    capabilityRequirements: z.array(z.string().trim().min(1).max(128)).min(1).max(32),
    goalPattern: z.string().trim().min(1).max(4096),
    dependencyPattern: z.array(z.string().trim().min(1).max(2048)).min(1).max(64),
    incompatibleConstraints: z.array(z.string().trim().min(1).max(2048)).max(32),
  })
  .strict();

export class TaskTypeInductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaskTypeInductionError';
    this.code = code;
  }
}

export interface TaskTypeInductionResult {
  readonly candidates: readonly TaskTypeDefinitionSnapshot[];
  readonly skipped: readonly Readonly<{
    episodeIds: readonly string[];
    reasonCode: 'TASK_TYPE_EVIDENCE_INSUFFICIENT';
  }>[];
}

export class TaskTypeInductionService {
  readonly #fingerprints: TaskTypeFingerprintBuilder;
  readonly #clusterer: TaskTypeClusterer;
  readonly #repository: TaskTypeRepository;
  readonly #model: CognitiveStructuredModelStageInvoker;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextTaskTypeId: (fingerprint: string) => string;

  constructor(
    dependencies: Readonly<{
      fingerprints: TaskTypeFingerprintBuilder;
      clusterer: TaskTypeClusterer;
      repository: TaskTypeRepository;
      model: CognitiveStructuredModelStageInvoker;
      clock: Readonly<{ now(): string }>;
      nextTaskTypeId(fingerprint: string): string;
    }>,
  ) {
    this.#fingerprints = dependencies.fingerprints;
    this.#clusterer = dependencies.clusterer;
    this.#repository = dependencies.repository;
    this.#model = dependencies.model;
    this.#clock = dependencies.clock;
    this.#nextTaskTypeId = dependencies.nextTaskTypeId;
  }

  list(limit = 100): Promise<readonly TaskTypeDefinitionSnapshot[]> {
    return this.#repository.list(limit);
  }

  async induce(
    input: Readonly<{
      mode: TaskTypeInductionMode;
      examples: readonly TaskTypeInductionExample[];
    }>,
  ): Promise<TaskTypeInductionResult> {
    const limit = input.mode === 'online_candidate' ? 16 : 256;
    if (input.examples.length === 0 || input.examples.length > limit) {
      throw new TaskTypeInductionError(
        'TASK_TYPE_BATCH_INVALID',
        `Task Type ${input.mode} input must contain between 1 and ${String(limit)} Episodes.`,
      );
    }
    const candidates: TaskTypeDefinitionSnapshot[] = [];
    const skipped: TaskTypeInductionResult['skipped'][number][] = [];
    for (const cluster of this.#clusterer.cluster(input.examples)) {
      if (cluster.examples.length < 2) {
        skipped.push({
          episodeIds: Object.freeze(cluster.examples.map((example) => example.episodeId)),
          reasonCode: 'TASK_TYPE_EVIDENCE_INSUFFICIENT',
        });
        continue;
      }
      candidates.push(await this.#induceCluster(input.mode, cluster));
    }
    return Object.freeze({
      candidates: Object.freeze(candidates),
      skipped: Object.freeze(skipped.map((item) => Object.freeze(item))),
    });
  }

  async #induceCluster(
    mode: TaskTypeInductionMode,
    cluster: TaskTypeCluster,
  ): Promise<TaskTypeDefinitionSnapshot> {
    const existing = await this.#repository.findByFingerprint(cluster.fingerprint);
    const examples = cluster.examples.slice(0, 3);
    if (
      existing?.exemplars.map((exemplar) => exemplar.episodeId).join('\u0000') ===
      examples.map((example) => example.episodeId).join('\u0000')
    ) {
      return existing;
    }
    const representative = examples[0];
    if (representative === undefined) {
      throw new TaskTypeInductionError(
        'TASK_TYPE_EVIDENCE_INSUFFICIENT',
        'Task Type induction requires a deterministic cluster representative.',
      );
    }
    const generated = await this.#model.generate({
      stage: 'task_type_induction',
      instruction: JSON.stringify({
        policy: {
          rule: 'Name and summarize the deterministic cluster only. Produce recognition and negative examples. Never activate knowledge, invoke tools, or change source facts.',
          status: 'candidate',
          exemplarLimit: 3,
        },
        deterministicFingerprint: cluster.fingerprint,
        dimensions: this.#fingerprints.build(representative).dimensions,
        examples: examples.map((example) => ({
          episodeId: example.episodeId,
          goalId: example.goalId,
          constraints: example.constraints,
        })),
      }),
      responseSchema: TaskTypeModelOutputSchema.toJSONSchema(),
      sourceRefs: uniqueSourceRefs(examples).map((source) => source.sourceRefId),
      maxAttempts: 1,
      timeoutMs: 30_000,
    });
    const parsed = TaskTypeModelOutputSchema.safeParse(generated.structuredResult);
    if (!parsed.success) {
      throw new TaskTypeInductionError(
        'TASK_TYPE_MODEL_OUTPUT_INVALID',
        'Task Type induction model output failed strict validation.',
      );
    }
    const snapshot = createTaskTypeDefinitionSnapshot({
      schemaVersion: '1.0',
      taskTypeId: existing?.taskTypeId ?? this.#nextTaskTypeId(cluster.fingerprint),
      revision: (existing?.revision ?? 0) + 1,
      status: 'candidate',
      origin: 'induced',
      inductionMode: mode,
      fingerprint: cluster.fingerprint,
      title: parsed.data.title,
      summary: parsed.data.summary,
      recognition: {
        hints: parsed.data.recognitionHints,
        positiveExamples: parsed.data.positiveExamples,
        negativeExamples: parsed.data.negativeExamples,
      },
      requiredDimensions: parsed.data.requiredDimensions,
      optionalDimensions: parsed.data.optionalDimensions,
      criteriaTemplate: parsed.data.criteriaTemplate,
      capabilityRequirements: parsed.data.capabilityRequirements,
      goalPattern: parsed.data.goalPattern,
      dependencyPattern: parsed.data.dependencyPattern,
      incompatibleConstraints: parsed.data.incompatibleConstraints,
      exemplars: examples.map((example) => ({
        episodeId: example.episodeId,
        goalId: example.goalId,
        goalVersion: example.goalVersion,
        summary: exemplarSummary(example),
      })),
      sourceRefs: uniqueSourceRefs(examples),
      modelInvocationId: generated.invocationId,
      createdAt: this.#clock.now(),
    });
    await this.#repository.saveCandidate(snapshot);
    return snapshot;
  }
}

function uniqueSourceRefs(
  examples: readonly TaskTypeInductionExample[],
): readonly CognitiveSourceRef[] {
  return Object.freeze(
    [
      ...new Map(
        examples
          .flatMap((example) => example.sourceRefs)
          .map((source) => [source.sourceRefId, source]),
      ).values(),
    ].sort((left, right) => left.sourceRefId.localeCompare(right.sourceRefId)),
  );
}

function exemplarSummary(example: TaskTypeInductionExample): string {
  const objective = example.dimensions.semanticObjective.join(' ');
  const criteria = example.dimensions.criteria.join('; ');
  return `${objective}. Completion criteria: ${criteria}.`.slice(0, 4096);
}
