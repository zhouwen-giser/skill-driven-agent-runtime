import { createHash } from 'node:crypto';

import {
  createTaskTypeInductionExample,
  type TaskTypeFingerprintDimensions,
  type TaskTypeInductionExample,
} from '../../../domain/src/index.js';

export interface TaskTypeFingerprint {
  readonly fingerprint: string;
  readonly dimensions: TaskTypeFingerprintDimensions;
}

export interface TaskTypeCluster {
  readonly fingerprint: string;
  readonly examples: readonly TaskTypeInductionExample[];
}

export class TaskTypeFingerprintBuilder {
  readonly #aliases: Readonly<Record<string, string>>;

  constructor(options: Readonly<{ objectiveAliases?: Readonly<Record<string, string>> }> = {}) {
    this.#aliases = Object.freeze(
      Object.fromEntries(
        Object.entries(options.objectiveAliases ?? {}).map(([key, value]) => [
          normalize(key),
          normalize(value),
        ]),
      ),
    );
  }

  build(input: TaskTypeInductionExample): TaskTypeFingerprint {
    const example = createTaskTypeInductionExample(input);
    const dimensions = Object.freeze({
      semanticObjective: canonicalTerms(
        example.dimensions.semanticObjective.map(
          (term) => this.#aliases[normalize(term)] ?? normalize(term),
        ),
      ),
      criteria: canonicalTerms(example.dimensions.criteria),
      artifacts: canonicalTerms(example.dimensions.artifacts),
      capabilities: canonicalTerms(example.dimensions.capabilities),
      dagShape: canonicalTerms(example.dimensions.dagShape),
      corrections: canonicalTerms(example.dimensions.corrections),
      outcome: canonicalTerms(example.dimensions.outcome),
    });
    return Object.freeze({
      fingerprint: `sha256:${createHash('sha256')
        .update(JSON.stringify(dimensions))
        .digest('hex')}`,
      dimensions,
    });
  }
}

export class TaskTypeClusterer {
  readonly #fingerprints: TaskTypeFingerprintBuilder;

  constructor(dependencies: Readonly<{ fingerprints: TaskTypeFingerprintBuilder }>) {
    this.#fingerprints = dependencies.fingerprints;
  }

  cluster(input: readonly TaskTypeInductionExample[]): readonly TaskTypeCluster[] {
    const examples = [...input]
      .map(createTaskTypeInductionExample)
      .sort((left, right) => left.episodeId.localeCompare(right.episodeId));
    const uniqueEpisodeIds = new Set(examples.map((example) => example.episodeId));
    if (uniqueEpisodeIds.size !== examples.length) {
      throw new Error('TASK_TYPE_DUPLICATE_EPISODE');
    }
    const groups = new Map<string, TaskTypeInductionExample[]>();
    for (const example of examples) {
      const fingerprint = this.#fingerprints.build(example).fingerprint;
      const group = groups.get(fingerprint) ?? [];
      group.push(example);
      groups.set(fingerprint, group);
    }
    return Object.freeze(
      [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fingerprint, members]) =>
          Object.freeze({ fingerprint, examples: Object.freeze(members) }),
        ),
    );
  }
}

function canonicalTerms(input: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(input.map(normalize))].sort());
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}
