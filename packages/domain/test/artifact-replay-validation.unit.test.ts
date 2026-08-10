import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_REPLAY_VALIDATION_CONTRACT_VERSION,
  ARTIFACT_REPLAY_VALIDATION_SCHEMA_HASHES,
  ArtifactDomainError,
  createArtifactCounterexample,
  createArtifactReplayCase,
  createArtifactValidationFailure,
  createArtifactValidationResult,
  createArtifactValidationRun,
  createReplayDatasetManifest,
  type ArtifactReplayCase,
  type ArtifactReplaySafety,
  type ArtifactReplayValidationResult,
  type ArtifactValidationResult,
} from '../src/index.js';

const hash = `sha256:${'a'.repeat(64)}`;
const laterHash = `sha256:${'b'.repeat(64)}`;
const timestamp = '2026-07-28T15:00:00.000Z';

describe('P05 artifact replay and validation contracts', () => {
  it('publishes the V1.2 result hash without changing unrelated schema identities', () => {
    expect(ARTIFACT_REPLAY_VALIDATION_CONTRACT_VERSION).toBe('1.2');
    expect(ARTIFACT_REPLAY_VALIDATION_SCHEMA_HASHES).toEqual({
      ArtifactReplayCase: 'ab24f3c2d8a692f6e569c7e95f04f4389244941da0b297ec799610e8d1bab64f',
      ReplayDatasetManifest: '132f1c215f12fdd28388ac3879589fd22e8772f1fd75ce058ce36977802c746e',
      ArtifactValidationRun: 'c602d26e36dc9fc55b0ecaeeeebbf962af8e4d8f80080b7d9f12798be2afdd1a',
      ArtifactValidationResult: '64be4fd20222d6d13d879ad591b7b492c36012d6138ce537a92a70222d3e99c5',
      ArtifactValidationFailure: 'e017c434add5d1f1aec004552a8795c34509461699d351d879a02003ddb37182',
      ArtifactCounterexample: 'ef317932640d095863d9bb13c96e2f738989bc7858aec9a613f76c4438ad46f3',
    });
  });

  it('derives the V1.2 ArtifactValidationResult hash from its canonical JSON Schema', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL(
          '../src/compiler/schemas/artifact-validation-result-1.2.schema.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown;
    const canonical = JSON.stringify(sortSchemaValue(schema));
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(
      ARTIFACT_REPLAY_VALIDATION_SCHEMA_HASHES.ArtifactValidationResult,
    );
  });

  it('creates an immutable strict ReplayCase without inventing optional snapshots', () => {
    const value = createArtifactReplayCase(replayCase());
    expect(value).toMatchObject({
      replayCaseId: 'replay-case-1',
      snapshotCompleteness: 0.8,
    });
    expect(value.worldStateSnapshotRef).toBeUndefined();
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.sourceEpisodeRefs)).toBe(true);
  });

  it('rejects unknown ReplayCase fields and invalid hashes', () => {
    expect(() =>
      createArtifactReplayCase({
        ...replayCase(),
        unexpected: true,
      } as ArtifactReplayCase),
    ).toThrow(ArtifactDomainError);
    expect(() =>
      createArtifactReplayCase({ ...replayCase(), goalLineageHash: 'not-a-hash' }),
    ).toThrow(/goalLineageHash/u);
  });

  it('creates a versioned immutable Dataset Manifest with a valid source range', () => {
    const manifest = createReplayDatasetManifest({
      datasetId: 'dataset-1',
      datasetVersion: 2,
      purpose: 'promotion_holdout',
      tenantId: 'tenant-1',
      taskTypeIds: ['task.type'],
      caseRefs: ['replay-case-1'],
      splitPolicyVersion: 'sdar-replay-split/1.1',
      sourceRange: {
        from: '2026-07-01T00:00:00.000Z',
        to: timestamp,
      },
      sourceHash: hash,
      contentHash: laterHash,
      leakageCheckRef: 'leakage-check-1',
      createdAt: timestamp,
    });
    expect(manifest.purpose).toBe('promotion_holdout');
    expect(Object.isFrozen(manifest.sourceRange)).toBe(true);
    expect(Object.isFrozen(manifest.caseRefs)).toBe(true);
    expect(() =>
      createReplayDatasetManifest({
        ...manifest,
        sourceRange: { from: timestamp, to: '2026-07-01T00:00:00.000Z' },
      }),
    ).toThrow(/inverted/u);
  });

  it('requires terminal Validation Runs to carry result and completion together', () => {
    expect(
      createArtifactValidationRun({
        validationRunId: 'validation-run-1',
        artifactId: 'artifact-1',
        artifactVersion: 1,
        validationType: 'replay',
        datasetRef: 'dataset-1:2',
        status: 'pending',
        metrics: {},
        counterexampleRefs: [],
        startedAt: timestamp,
      }).status,
    ).toBe('pending');
    expect(() =>
      createArtifactValidationRun({
        validationRunId: 'validation-run-1',
        artifactId: 'artifact-1',
        artifactVersion: 1,
        validationType: 'replay',
        datasetRef: 'dataset-1:2',
        status: 'passed',
        metrics: {},
        counterexampleRefs: [],
        startedAt: timestamp,
      }),
    ).toThrow(/terminal/u);
  });

  it('freezes transparent metrics and binds unsafe flag to unsafe result', () => {
    const result = createArtifactValidationResult(validationResult());
    expect(result.metrics).toEqual({
      criterion_coverage: 1,
      side_effect_attempt_count: 0,
      unsafe_allow_count: 0,
    });
    expect(Object.isFrozen(result.metrics)).toBe(true);
    expect(result.replaySafety).toEqual({
      provider: 'ReplayNoPhysicalProvider',
      physicalAdapterInvocationCount: 0,
      sideEffectAttemptCount: 0,
      deniedBeforePhysicalBoundaryCount: 0,
      denialEvidenceRefs: [],
      physicalOutcomeClaim: 'none',
    });
    expect(Object.isFrozen(result.replaySafety)).toBe(true);
    expect(Object.isFrozen(result.replaySafety?.denialEvidenceRefs)).toBe(true);
    expect(() =>
      createArtifactValidationResult({
        ...validationResult(),
        unsafe: true,
        result: 'passed',
      }),
    ).toThrow(/unsafe flag/u);
  });

  it('requires replay safety proof to agree with the authoritative side-effect metric', () => {
    const missingReplaySafety = omitReplaySafety(validationResult());
    expect(() => createArtifactValidationResult(missingReplaySafety)).toThrow(
      /require replaySafety/u,
    );
    expect(() =>
      createArtifactValidationResult({
        ...validationResult(),
        metrics: {
          ...validationResult().metrics,
          side_effect_attempt_count: 1,
        },
      }),
    ).toThrow(/denial counts/u);
    expect(() =>
      createArtifactValidationResult({
        ...validationResult(),
        replaySafety: {
          ...requiredReplaySafety(validationResult()),
          physicalAdapterInvocationCount: 1 as 0,
        },
      }),
    ).toThrow(/physicalAdapterInvocationCount/u);
  });

  it('accepts exact canonical denial evidence only for an unsafe replay result', () => {
    const unsafeResult = requiredReplayValidationResult(
      createArtifactValidationResult({
        ...validationResult(),
        metrics: {
          ...validationResult().metrics,
          side_effect_attempt_count: 1,
        },
        failureRefs: ['failure-1'],
        unsafe: true,
        result: 'unsafe',
        replaySafety: {
          provider: 'ReplayNoPhysicalProvider',
          physicalAdapterInvocationCount: 0,
          sideEffectAttemptCount: 1,
          deniedBeforePhysicalBoundaryCount: 1,
          denialEvidenceRefs: ['replay-denial-1'],
          physicalOutcomeClaim: 'none',
        },
      }),
    );
    expect(unsafeResult.replaySafety.denialEvidenceRefs).toEqual(['replay-denial-1']);
    expect(() =>
      createArtifactValidationResult({
        ...unsafeResult,
        replaySafety: {
          ...requiredReplaySafety(unsafeResult),
          denialEvidenceRefs: ['replay-denial-z', 'replay-denial-a'],
        },
      }),
    ).toThrow(/canonical order/u);
  });

  it('requires side-effect failures to be critical and evidence-linked', () => {
    expect(
      createArtifactValidationFailure({
        failureId: 'failure-1',
        validationRunRef: 'validation-run-1',
        replayCaseRef: 'replay-case-1',
        category: 'side_effect_attempt',
        severity: 'critical',
        evidenceRefs: ['replay-denial-1'],
        explanation: 'Replay denied an MCP tool invocation before transport.',
      }).severity,
    ).toBe('critical');
    expect(() =>
      createArtifactValidationFailure({
        failureId: 'failure-1',
        validationRunRef: 'validation-run-1',
        replayCaseRef: 'replay-case-1',
        category: 'side_effect_attempt',
        severity: 'major',
        evidenceRefs: ['replay-denial-1'],
        explanation: 'Invalid severity.',
      }),
    ).toThrow(/critical/u);
  });

  it('deep-freezes Counterexample failure boundaries and preserves lineage', () => {
    const counterexample = createArtifactCounterexample({
      counterexampleId: 'counterexample-1',
      artifactRef: 'artifact-1:1',
      replayCaseRef: 'replay-case-1',
      failureRef: 'failure-1',
      conditionFingerprint: hash,
      environmentClass: 'warehouse',
      failureBoundaryCandidate: {
        trigger: 'skill-goal:verify-policy',
        recovery: ['skill-goal:apply-safe-remediation'],
      },
      sourceRefs: ['episode-1', 'trace-1'],
      status: 'recorded',
      createdAt: timestamp,
    });
    expect(Object.isFrozen(counterexample.failureBoundaryCandidate)).toBe(true);
    expect(
      Object.isFrozen(
        (counterexample.failureBoundaryCandidate as { readonly recovery: readonly string[] })
          .recovery,
      ),
    ).toBe(true);
    expect(counterexample.sourceRefs).toEqual(['episode-1', 'trace-1']);
  });
});

function replayCase(): ArtifactReplayCase {
  return {
    replayCaseId: 'replay-case-1',
    tenantId: 'tenant-1',
    requestSnapshotRef: 'request-snapshot-1',
    goalContractSnapshotRef: 'goal-contract-snapshot-1',
    capabilityCatalogSnapshotRef: 'capability-catalog-snapshot-1',
    policySnapshotRef: 'policy-snapshot-1',
    acceptedPlanSnapshotRef: 'accepted-plan-snapshot-1',
    executionTraceSnapshotRef: 'execution-trace-snapshot-1',
    outcomeSnapshotRef: 'outcome-snapshot-1',
    correctionRefs: ['correction-1'],
    environmentClass: 'warehouse',
    taskTypeId: 'workflow.policy-remediation',
    sourceEpisodeRefs: ['episode-1'],
    goalLineageHash: hash,
    snapshotCompleteness: 0.8,
    contentHash: laterHash,
  };
}

function validationResult(): ArtifactReplayValidationResult {
  return {
    validationRunId: 'validation-run-1',
    artifactRef: 'artifact-1:1',
    datasetRef: 'dataset-1:2',
    validationType: 'replay',
    metrics: {
      unsafe_allow_count: 0,
      criterion_coverage: 1,
      side_effect_attempt_count: 0,
    },
    failureRefs: [],
    counterexampleRefs: [],
    unsafe: false,
    result: 'passed',
    validatorVersion: 'sdar-artifact-validator/1.1',
    metricCatalogVersion: 'sdar-validation-metrics/1.1',
    artifactHash: hash,
    datasetHash: laterHash,
    resultHash: hash,
    replaySafety: {
      provider: 'ReplayNoPhysicalProvider',
      physicalAdapterInvocationCount: 0,
      sideEffectAttemptCount: 0,
      deniedBeforePhysicalBoundaryCount: 0,
      denialEvidenceRefs: [],
      physicalOutcomeClaim: 'none',
    },
    completedAt: timestamp,
  };
}

function requiredReplaySafety(result: ArtifactValidationResult): ArtifactReplaySafety {
  if (result.replaySafety === undefined) throw new Error('fixture replaySafety missing');
  return result.replaySafety;
}

function requiredReplayValidationResult(
  result: ArtifactValidationResult,
): ArtifactReplayValidationResult {
  if (result.validationType !== 'replay') throw new Error('fixture replay result missing');
  return result;
}

function omitReplaySafety(result: ArtifactValidationResult): ArtifactValidationResult {
  const externalValue: Record<string, unknown> = { ...result };
  delete externalValue['replaySafety'];
  return externalValue as unknown as ArtifactValidationResult;
}

function sortSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSchemaValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortSchemaValue(item)]),
    );
  }
  return value;
}
