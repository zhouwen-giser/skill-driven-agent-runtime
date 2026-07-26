import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  createCapabilityPatternDefinitionSnapshot,
  createCapabilityPatternInductionExample,
  type CapabilityGapCandidateSnapshot,
  type CapabilityPatternDefinitionSnapshot,
  type CapabilityPatternEvidenceSnapshot,
  type CapabilityPatternInductionExample,
  type CognitiveSourceRef,
} from '../../../domain/src/index.js';
import type { CapabilityGapService } from './capability-gap-service.js';
import type { CapabilitySkillMapper } from './capability-skill-mapper.js';
import type { CapabilityPatternRepository, CognitiveStructuredModelStageInvoker } from './ports.js';

const CapabilityPatternModelOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    summary: z.string().trim().min(1).max(4096),
    applicableConditions: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
    effects: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
    evidenceRequirements: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
    artifacts: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
    prerequisites: z.array(z.string().trim().min(1).max(4096)).max(64),
    dependencies: z.array(z.string().trim().min(1).max(4096)).max(64),
    failures: z.array(z.string().trim().min(1).max(4096)).max(64),
    limitations: z.array(z.string().trim().min(1).max(4096)).max(64),
  })
  .strict();

type ModelOutput = z.infer<typeof CapabilityPatternModelOutputSchema>;

export interface CapabilityPatternInductionResult {
  readonly patterns: readonly CapabilityPatternDefinitionSnapshot[];
  readonly gaps: readonly CapabilityGapCandidateSnapshot[];
  readonly skipped: readonly Readonly<{
    capabilityId: string;
    episodeIds: readonly string[];
    reasonCode: 'CAPABILITY_PATTERN_EVIDENCE_INSUFFICIENT';
  }>[];
}

export class CapabilityPatternInductionService {
  readonly #repository: CapabilityPatternRepository;
  readonly #mapper: CapabilitySkillMapper;
  readonly #gaps: CapabilityGapService;
  readonly #model: CognitiveStructuredModelStageInvoker;
  readonly #policyVersion: string;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextPatternId: (capabilityId: string) => string;

  constructor(
    dependencies: Readonly<{
      repository: CapabilityPatternRepository;
      mapper: CapabilitySkillMapper;
      gaps: CapabilityGapService;
      model: CognitiveStructuredModelStageInvoker;
      policyVersion: string;
      clock: Readonly<{ now(): string }>;
      nextPatternId(capabilityId: string): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#mapper = dependencies.mapper;
    this.#gaps = dependencies.gaps;
    this.#model = dependencies.model;
    this.#policyVersion = dependencies.policyVersion;
    this.#clock = dependencies.clock;
    this.#nextPatternId = dependencies.nextPatternId;
  }

  list(limit = 100): Promise<readonly CapabilityPatternDefinitionSnapshot[]> {
    return this.#repository.list(limit);
  }

  listGaps(limit = 100): Promise<readonly CapabilityGapCandidateSnapshot[]> {
    return this.#repository.listGaps(limit);
  }

  async induce(input: Readonly<{ examples: readonly CapabilityPatternInductionExample[] }>) {
    if (input.examples.length === 0 || input.examples.length > 256) {
      throw new CapabilityPatternInductionError(
        'CAPABILITY_PATTERN_BATCH_INVALID',
        'Capability Pattern input must contain between 1 and 256 Experience examples.',
      );
    }
    const groups = groupExamples(input.examples);
    const patterns: CapabilityPatternDefinitionSnapshot[] = [];
    const gaps: CapabilityGapCandidateSnapshot[] = [];
    const skipped: CapabilityPatternInductionResult['skipped'][number][] = [];
    for (const [capabilityId, examples] of groups) {
      if (examples.length < 2) {
        skipped.push({
          capabilityId,
          episodeIds: Object.freeze(examples.map((example) => example.episodeId)),
          reasonCode: 'CAPABILITY_PATTERN_EVIDENCE_INSUFFICIENT',
        });
        continue;
      }
      const mapping = await this.#mapper.mapCurrentVersions(capabilityId);
      const fingerprint = patternFingerprint(capabilityId, examples);
      const existing = await this.#repository.findLatest(capabilityId);
      if (
        existing?.fingerprint === fingerprint &&
        existing.catalogHash === mapping.catalogHash &&
        existing.policyVersion === this.#policyVersion &&
        sameEpisodeEvidence(existing, examples)
      ) {
        patterns.push(existing);
        if (existing.exactSkillVersionMappings.length === 0) {
          gaps.push(await this.#gaps.createCandidate(existing));
        }
        continue;
      }
      const grounding = groundingSignals(examples, mapping.declaredSignals);
      const generated = await this.#model.generate({
        stage: 'capability_pattern_induction',
        instruction: JSON.stringify({
          policy: {
            rule: 'Describe only the supplied Capability evidence. Never assert current Provider readiness or Skill compatibility and never publish a Skill.',
            status: 'candidate',
          },
          capabilityId,
          fingerprint,
          declaredMappings: mapping.exactSkillVersionMappings,
          evidence: examples.map((example) => ({
            episodeId: example.episodeId,
            level: example.evidenceLevel,
            signals: example.signals,
          })),
        }),
        responseSchema: CapabilityPatternModelOutputSchema.toJSONSchema(),
        sourceRefs: uniqueSourceRefs([
          ...examples.flatMap((example) => example.sourceRefs),
          ...mapping.sourceRefs,
        ]).map((source) => source.sourceRefId),
        maxAttempts: 1,
        timeoutMs: 30_000,
      });
      const parsed = CapabilityPatternModelOutputSchema.safeParse(generated.structuredResult);
      if (!parsed.success) {
        throw new CapabilityPatternInductionError(
          'CAPABILITY_PATTERN_MODEL_OUTPUT_INVALID',
          'Capability Pattern model output failed strict validation.',
        );
      }
      assertGrounded(parsed.data, grounding);
      const sourceRefs = uniqueSourceRefs([
        ...examples.flatMap((example) => example.sourceRefs),
        ...mapping.sourceRefs,
      ]);
      const pattern = createCapabilityPatternDefinitionSnapshot({
        schemaVersion: '1.0',
        patternId: existing?.patternId ?? this.#nextPatternId(capabilityId),
        revision: (existing?.revision ?? 0) + 1,
        version: 1,
        status: 'candidate',
        fingerprint,
        catalogHash: mapping.catalogHash,
        policyVersion: this.#policyVersion,
        capabilityId,
        title: parsed.data.title,
        summary: parsed.data.summary,
        applicableConditions: parsed.data.applicableConditions,
        effects: parsed.data.effects,
        evidenceRequirements: parsed.data.evidenceRequirements,
        artifacts: parsed.data.artifacts,
        prerequisites: parsed.data.prerequisites,
        dependencies: parsed.data.dependencies,
        failures: parsed.data.failures,
        limitations: parsed.data.limitations,
        evidenceByLevel: {
          declared: mapping.declaredEvidence,
          observed: exampleEvidence(examples, 'observed'),
          validated: exampleEvidence(examples, 'validated'),
        },
        exactSkillVersionMappings: mapping.exactSkillVersionMappings,
        requiresCurrentReadiness: true,
        sourceRefs,
        modelInvocationId: generated.invocationId,
        createdAt: this.#clock.now(),
      });
      await this.#repository.saveCandidate(pattern);
      patterns.push(pattern);
      if (pattern.exactSkillVersionMappings.length === 0) {
        gaps.push(await this.#gaps.createCandidate(pattern));
      }
    }
    return Object.freeze({
      patterns: Object.freeze(patterns),
      gaps: Object.freeze(gaps),
      skipped: Object.freeze(skipped.map((item) => Object.freeze(item))),
    });
  }
}

export class CapabilityPatternInductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CapabilityPatternInductionError';
    this.code = code;
  }
}

function groupExamples(
  input: readonly CapabilityPatternInductionExample[],
): ReadonlyMap<string, readonly CapabilityPatternInductionExample[]> {
  const groups = new Map<string, CapabilityPatternInductionExample[]>();
  for (const example of input.map(createCapabilityPatternInductionExample)) {
    const items = groups.get(example.capabilityId) ?? [];
    items.push(example);
    groups.set(example.capabilityId, items);
  }
  return new Map(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [
        key,
        Object.freeze(
          values.sort(
            (left, right) =>
              left.episodeId.localeCompare(right.episodeId) ||
              left.evidenceLevel.localeCompare(right.evidenceLevel),
          ),
        ),
      ]),
  );
}

function patternFingerprint(
  capabilityId: string,
  examples: readonly CapabilityPatternInductionExample[],
): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        capabilityId,
        examples: examples.map((example) => ({
          episodeId: example.episodeId,
          evidenceLevel: example.evidenceLevel,
          signals: Object.fromEntries(
            Object.entries(example.signals).map(([key, values]) => [
              key,
              [...(values as readonly string[])].sort(),
            ]),
          ),
        })),
      }),
    )
    .digest('hex')}`;
}

function groundingSignals(
  examples: readonly CapabilityPatternInductionExample[],
  declared: Readonly<{
    effects: readonly string[];
    evidenceRequirements: readonly string[];
    artifacts: readonly string[];
  }>,
): Readonly<Record<keyof Omit<ModelOutput, 'title' | 'summary'>, ReadonlySet<string>>> {
  const values = (key: keyof CapabilityPatternInductionExample['signals']) =>
    new Set(examples.flatMap((example) => example.signals[key]));
  return {
    applicableConditions: values('applicableConditions'),
    effects: new Set([...values('effects'), ...declared.effects]),
    evidenceRequirements: new Set([...values('evidence'), ...declared.evidenceRequirements]),
    artifacts: new Set([...values('artifacts'), ...declared.artifacts]),
    prerequisites: values('prerequisites'),
    dependencies: values('dependencies'),
    failures: values('failures'),
    limitations: values('limitations'),
  };
}

function assertGrounded(
  output: ModelOutput,
  grounding: Readonly<Record<keyof Omit<ModelOutput, 'title' | 'summary'>, ReadonlySet<string>>>,
): void {
  for (const key of Object.keys(grounding) as (keyof typeof grounding)[]) {
    if (output[key].some((value) => !grounding[key].has(value))) {
      throw new CapabilityPatternInductionError(
        'CAPABILITY_PATTERN_MODEL_OUTPUT_UNGROUNDED',
        `Capability Pattern model output contains an ungrounded ${key} value.`,
      );
    }
  }
}

function exampleEvidence(
  examples: readonly CapabilityPatternInductionExample[],
  level: 'observed' | 'validated',
): readonly CapabilityPatternEvidenceSnapshot[] {
  return Object.freeze(
    examples
      .filter((example) => example.evidenceLevel === level)
      .map((example) =>
        Object.freeze({
          level,
          episodeId: example.episodeId,
          summary: [
            ...example.signals.skillOutcomes,
            ...example.signals.attempts,
            ...example.signals.evidence,
          ].join('; '),
          sourceRefIds: Object.freeze(example.sourceRefs.map((source) => source.sourceRefId)),
        }),
      ),
  );
}

function uniqueSourceRefs(input: readonly CognitiveSourceRef[]): readonly CognitiveSourceRef[] {
  return Object.freeze(
    [...new Map(input.map((source) => [source.sourceRefId, source])).values()].sort((left, right) =>
      left.sourceRefId.localeCompare(right.sourceRefId),
    ),
  );
}

function sameEpisodeEvidence(
  existing: CapabilityPatternDefinitionSnapshot,
  examples: readonly CapabilityPatternInductionExample[],
): boolean {
  const persisted = [...existing.evidenceByLevel.observed, ...existing.evidenceByLevel.validated]
    .map((evidence) => evidence.episodeId)
    .filter((episodeId): episodeId is string => episodeId !== undefined)
    .sort();
  return (
    persisted.join('\u0000') ===
    examples
      .map((example) => example.episodeId)
      .sort()
      .join('\u0000')
  );
}
