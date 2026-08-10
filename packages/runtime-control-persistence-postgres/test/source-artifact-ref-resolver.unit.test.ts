import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';

import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  SourceArtifactRefError,
  buildRuntimeSourceArtifact,
  canonicalizeSourceArtifactJson,
  type ArtifactRef,
  type EvidenceJsonValue,
} from '../../domain/src/index.js';
import {
  PostgresRuntimeSourceArtifactResolver,
  RuntimeSourceArtifactResolutionError,
} from '../src/index.js';

describe('PostgresRuntimeSourceArtifactResolver', () => {
  it.each([
    {
      sourceTable: 'compiled_artifact' as const,
      sourceRecordId: "artifact-'-$2",
      sourceVersion: 4,
      sqlFragment: "definition #> '{artifact,definition}'",
      table: 'FROM compiled_artifact',
    },
    {
      sourceTable: 'replay_dataset_manifest' as const,
      sourceRecordId: "dataset-'-$2",
      sourceVersion: 6,
      sqlFragment: 'SELECT content AS value',
      table: 'FROM replay_dataset_manifest',
    },
    {
      sourceTable: 'artifact_replay_case' as const,
      sourceRecordId: "case-'-$2",
      sourceVersion: 1,
      sqlFragment: 'SELECT content AS value',
      table: 'FROM artifact_replay_case',
    },
    {
      sourceTable: 'pattern_candidate' as const,
      sourceRecordId: "pattern-'-$2",
      sourceVersion: 1,
      sqlFragment: 'SELECT definition AS value',
      table: 'FROM pattern_candidate',
    },
  ])('resolves and verifies the exact $sourceTable JSONB field', async (fixture) => {
    const value: EvidenceJsonValue =
      fixture.sourceTable === 'pattern_candidate'
        ? patternDefinition(fixture.sourceRecordId)
        : { nested: { b: 2, a: 'value' } };
    const built = buildRuntimeSourceArtifact({ ...fixture, value });
    const pool = new FakePool(
      fixture.sourceTable === 'pattern_candidate' ? patternEnvelope(value) : value,
    );
    const resolver = new PostgresRuntimeSourceArtifactResolver(pool as unknown as Pool);

    const resolved = await resolver.resolve(built.artifactRef);

    expect(resolved.value).toEqual(value);
    expect(resolved.artifactRef).toEqual(built.artifactRef);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.sql).toContain(fixture.sqlFragment);
    expect(pool.calls[0]?.sql).toContain(fixture.table);
    expect(pool.calls[0]?.sql).not.toContain(fixture.sourceRecordId);
    expect(pool.calls[0]?.parameters).toEqual([fixture.sourceRecordId, fixture.sourceVersion]);
  });

  it('fails closed when the authoritative bytes no longer match the reference', async () => {
    const built = buildRuntimeSourceArtifact({
      sourceTable: 'replay_dataset_manifest',
      sourceRecordId: 'dataset-a',
      sourceVersion: 2,
      value: { revision: 'original' },
    });
    const resolver = new PostgresRuntimeSourceArtifactResolver(
      new FakePool({ revision: 'changed' }) as unknown as Pool,
    );

    await expect(resolver.resolve(built.artifactRef)).rejects.toEqual(
      expect.objectContaining({ code: 'SOURCE_ARTIFACT_INTEGRITY_MISMATCH' }),
    );
  });

  it.each([
    {
      name: 'hash',
      mutate: (envelope: Readonly<Record<string, unknown>>) => ({
        ...envelope,
        contentHash: `sha256:${'0'.repeat(64)}`,
      }),
    },
    {
      name: 'size',
      mutate: (envelope: Readonly<Record<string, unknown>>) => ({
        ...envelope,
        uncompressedBytes: Number(envelope['uncompressedBytes']) + 1,
      }),
    },
  ])('fails closed when the compressed Pattern envelope $name drifts', async ({ mutate }) => {
    const patternId = 'pattern-integrity';
    const definition = patternDefinition(patternId);
    const built = buildRuntimeSourceArtifact({
      sourceTable: 'pattern_candidate',
      sourceRecordId: patternId,
      sourceVersion: 1,
      value: definition,
    });
    const resolver = new PostgresRuntimeSourceArtifactResolver(
      new FakePool(mutate(patternEnvelope(definition))) as unknown as Pool,
    );

    await expect(resolver.resolve(built.artifactRef)).rejects.toEqual(
      expect.objectContaining({ code: 'PATTERN_DEFINITION_INTEGRITY_MISMATCH' }),
    );
  });

  it('fails closed for missing rows and rejects invalid URIs before querying', async () => {
    const built = buildRuntimeSourceArtifact({
      sourceTable: 'compiled_artifact',
      sourceRecordId: 'artifact-a',
      sourceVersion: 1,
      value: { definition: true },
    });
    const missingPool = new FakePool(undefined);
    const resolver = new PostgresRuntimeSourceArtifactResolver(missingPool as unknown as Pool);
    await expect(resolver.resolve(built.artifactRef)).rejects.toBeInstanceOf(
      RuntimeSourceArtifactResolutionError,
    );

    const rejectedPool = new FakePool({ definition: true });
    const rejectedResolver = new PostgresRuntimeSourceArtifactResolver(
      rejectedPool as unknown as Pool,
    );
    const unsafeRef: ArtifactRef = {
      ...built.artifactRef,
      uri: 'artifact://runtime/v1/compiled_artifact/%2E%2E/1/definition/artifact/definition',
    };
    await expect(rejectedResolver.resolve(unsafeRef)).rejects.toBeInstanceOf(
      SourceArtifactRefError,
    );

    const pattern = buildRuntimeSourceArtifact({
      sourceTable: 'pattern_candidate',
      sourceRecordId: 'pattern-a',
      sourceVersion: 1,
      value: patternDefinition('pattern-a'),
    });
    for (const uri of [
      'artifact://runtime/v1/pattern_candidate/%2E%2E/1/definition',
      'artifact://runtime/v1/pattern_candidate/pattern-a/1/definition/traceRefs',
      'artifact://runtime/v1/pattern_candidate/pattern-a/1/definition?pointer=%2Fvariants',
    ]) {
      await expect(
        rejectedResolver.resolve({ ...pattern.artifactRef, uri }),
      ).rejects.toBeInstanceOf(SourceArtifactRefError);
    }
    expect(rejectedPool.calls).toEqual([]);
  });
});

function patternDefinition(patternId: string): Readonly<Record<string, EvidenceJsonValue>> {
  const quality = {
    supportCount: 1,
    totalTraceCount: 1,
    supportRate: 1,
    successRate: 1,
    traceCoverage: 1,
    fitness: 1,
    precisionProxy: 1,
    environmentCoverage: 1,
    contradictionRate: 0,
    generalization: 1,
    mandatoryThreshold: 1,
  };
  return {
    schemaVersion: '1.2',
    cohort: { tenantId: 'tenant-a', taskTypeId: 'task-type-a', minimumCompleteness: 1 },
    variants: [
      {
        variantId: 'variant-a',
        activitySequence: ['activity-a'],
        activityKindSequence: ['skill_goal'],
        concurrencyGroups: [],
        branchSequence: [],
        occurrenceCount: 1,
        traceRefs: ['trace-a'],
        successCount: 1,
        failureCount: 0,
      },
    ],
    discoveredPattern: {
      patternId,
      cohortFingerprint: `sha256:${'1'.repeat(64)}`,
      algorithmVersion: 'sdar-deterministic-process-miner/1.2',
      mandatoryActivities: ['activity-a'],
      optionalActivities: [],
      orderingConstraints: [],
      parallelCandidates: [],
      recoveryBranches: [],
      failureVariants: [],
      supportRefs: ['trace-a'],
      contradictionRefs: [],
      environmentCoverage: ['integration'],
      quality,
    },
    workflowPattern: {
      workflowPatternId: 'workflow-a',
      taskTypeId: 'task-type-a',
      activityPatterns: [
        {
          activityKey: 'activity-a',
          activityKind: 'skill_goal',
          objectiveSummary: 'Perform activity A.',
          required: true,
          supportCount: 1,
          supportRate: 1,
          capabilityRefs: ['capability-a'],
          effectRefs: ['effect-a'],
          lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
        },
      ],
      dependencyPatterns: [],
      recoveryPatterns: [],
      sourcePatternRef: patternId,
      sourceTraceRefs: ['trace-a'],
      quality,
    },
  };
}

function patternEnvelope(
  definition: Readonly<Record<string, EvidenceJsonValue>>,
): Readonly<Record<string, unknown>> {
  if (
    !isEvidenceRecord(definition['workflowPattern']) ||
    !isEvidenceRecord(definition['discoveredPattern'])
  ) {
    throw new Error('Pattern test definition invalid.');
  }
  const workflow = definition['workflowPattern'];
  const discovered = definition['discoveredPattern'];
  const sourceTraceRefs = workflow['sourceTraceRefs'];
  const contradictionRefs = discovered['contradictionRefs'];
  if (!Array.isArray(sourceTraceRefs) || !Array.isArray(contradictionRefs)) {
    throw new Error('Pattern test references invalid.');
  }
  const serialized = canonicalizeSourceArtifactJson(definition);
  return {
    schemaVersion: '1.2',
    encoding: 'br+base64',
    contentHash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    uncompressedBytes: Buffer.byteLength(serialized),
    workflowPatternId: workflow['workflowPatternId'],
    supportCount: sourceTraceRefs.length,
    contradictionCount: contradictionRefs.length,
    payload: brotliCompressSync(serialized).toString('base64'),
  };
}

function isEvidenceRecord(
  value: EvidenceJsonValue | undefined,
): value is Readonly<Record<string, EvidenceJsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class FakePool {
  readonly calls: { readonly sql: string; readonly parameters: readonly unknown[] }[] = [];
  readonly #value: unknown;

  constructor(value: unknown) {
    this.#value = value;
  }

  query(
    sql: string,
    parameters: readonly unknown[],
  ): Promise<Readonly<{ rows: readonly Readonly<{ value: unknown }>[] }>> {
    this.calls.push({ sql, parameters });
    return Promise.resolve({
      rows: this.#value === undefined ? [] : [{ value: this.#value }],
    });
  }
}
