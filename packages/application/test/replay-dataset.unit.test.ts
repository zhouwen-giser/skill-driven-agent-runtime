import { describe, expect, it } from 'vitest';

import {
  ArtifactReplayCaseBuilder,
  ReplayDatasetBuilder,
  snapshotCompleteness,
  type ArtifactReplaySource,
} from '../src/index.js';

const timestamp = '2026-07-28T16:00:00.000Z';

describe('P05 Replay Dataset builder', () => {
  it('computes snapshot completeness without filling missing history from current state', () => {
    const source = replaySource(1, {
      worldStateSnapshotRef: undefined,
      readinessSnapshotRef: undefined,
    });
    const completeness = snapshotCompleteness(source);
    expect(completeness).toMatchObject({
      requiredSnapshotCount: 9,
      availableSnapshotCount: 7,
      score: 0.777778,
      promotionEligible: false,
    });
    expect(completeness.missingSnapshots).toEqual(['world_state', 'readiness']);
    const result = new ArtifactReplayCaseBuilder().build(source);
    expect(result.replayCase?.worldStateSnapshotRef).toBeUndefined();
    expect(result.replayCase?.readinessSnapshotRef).toBeUndefined();
  });

  it('excludes a source missing a mandatory historical snapshot instead of fabricating a ref', () => {
    const result = new ArtifactReplayCaseBuilder().build(
      replaySource(1, { capabilityCatalogSnapshotRef: undefined }),
    );
    expect(result).toMatchObject({
      excludedReason: 'required_snapshot_missing',
    });
    expect(result.replayCase).toBeUndefined();
    expect(result.completeness.missingSnapshots).toContain('capability_catalog');
  });

  it('is deterministic for the same frozen source', () => {
    const builder = new ArtifactReplayCaseBuilder();
    const first = builder.build(replaySource(1));
    const second = builder.build(replaySource(1));
    expect(first.replayCase).toEqual(second.replayCase);
    expect(first.replayCase?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('creates four immutable Dataset manifests with time-based holdout isolation', () => {
    const cases = sourceCohort().map((source) => new ArtifactReplayCaseBuilder().build(source));
    const built = new ReplayDatasetBuilder().build({
      tenantId: 'tenant-p05',
      datasetVersion: 1,
      cases,
      candidateSourceTraceRefs: ['trace-5'],
      createdAt: timestamp,
    });
    expect(Object.keys(built.manifests).sort()).toEqual([
      'candidate_development',
      'counterexample',
      'discovery',
      'promotion_holdout',
    ]);
    expect(built.leakage).toMatchObject({
      passed: true,
      checkedCaseCount: 8,
    });
    expect(built.manifests.promotion_holdout.caseRefs).toHaveLength(1);
    expect(Object.isFrozen(built.manifests.promotion_holdout)).toBe(true);
  });

  it('keeps incomplete and Candidate-source cases out of promotion holdout', () => {
    const cases = sourceCohort().map((source) => new ArtifactReplayCaseBuilder().build(source));
    const built = new ReplayDatasetBuilder().build({
      tenantId: 'tenant-p05',
      datasetVersion: 1,
      cases,
      candidateSourceTraceRefs: ['trace-5'],
      createdAt: timestamp,
    });
    const incomplete = cases[3]?.replayCase?.replayCaseId;
    const candidateSource = cases[4]?.replayCase?.replayCaseId;
    expect(incomplete === undefined ? undefined : built.assignments[incomplete]).toBe(
      'candidate_development',
    );
    expect(candidateSource === undefined ? undefined : built.assignments[candidateSource]).toBe(
      'candidate_development',
    );
    expect(built.manifests.promotion_holdout.caseRefs).not.toContain(incomplete);
    expect(built.manifests.promotion_holdout.caseRefs).not.toContain(candidateSource);
  });

  it('keeps a counterexample in its own Dataset purpose', () => {
    const cases = sourceCohort().map((source) => new ArtifactReplayCaseBuilder().build(source));
    const built = new ReplayDatasetBuilder().build({
      tenantId: 'tenant-p05',
      datasetVersion: 1,
      cases,
      candidateSourceTraceRefs: ['trace-5'],
      createdAt: timestamp,
    });
    const counterexample = cases[7]?.replayCase?.replayCaseId;
    expect(counterexample === undefined ? undefined : built.assignments[counterexample]).toBe(
      'counterexample',
    );
  });

  it('keeps near-duplicate requests in the same split even across Episodes and time', () => {
    const sharedNearDuplicate = `sha256:${'d'.repeat(64)}`;
    const sources = sourceCohort().map((source, index) =>
      index === 0 || index === 6
        ? { ...source, nearDuplicateFingerprint: sharedNearDuplicate }
        : source,
    );
    const cases = sources.map((source) => new ArtifactReplayCaseBuilder().build(source));
    const built = new ReplayDatasetBuilder().build({
      tenantId: 'tenant-p05',
      datasetVersion: 1,
      cases,
      candidateSourceTraceRefs: ['trace-5'],
      createdAt: timestamp,
    });
    const first = cases[0]?.replayCase?.replayCaseId;
    const second = cases[6]?.replayCase?.replayCaseId;
    expect(first === undefined ? undefined : built.assignments[first]).toBe(
      second === undefined ? undefined : built.assignments[second],
    );
    expect(built.leakage.passed).toBe(true);
  });

  it('fails closed on tenant mixing', () => {
    const cases = [
      ...sourceCohort().map((source) => new ArtifactReplayCaseBuilder().build(source)),
      new ArtifactReplayCaseBuilder().build(replaySource(20, { tenantId: 'tenant-other' })),
    ];
    expect(() =>
      new ReplayDatasetBuilder().build({
        tenantId: 'tenant-p05',
        datasetVersion: 1,
        cases,
        candidateSourceTraceRefs: ['trace-5'],
        createdAt: timestamp,
      }),
    ).toThrow(/TENANT_SCOPE_DENIED/u);
  });
});

function sourceCohort(): readonly ArtifactReplaySource[] {
  return [
    replaySource(1),
    replaySource(2),
    replaySource(3),
    replaySource(4, { readinessSnapshotRef: undefined }),
    replaySource(5),
    replaySource(6),
    replaySource(7),
    replaySource(8, { counterexample: true }),
  ];
}

function replaySource(
  index: number,
  overrides: ArtifactReplaySourceOverrides = {},
): ArtifactReplaySource {
  const key = String(index);
  const source: ArtifactReplaySource = {
    tenantId: 'tenant-p05',
    sourceEpisodeRef: `episode-${key}`,
    sourceEpisodeRevisionRef: `episode-${key}:revision-1`,
    goalLineageHash: `sha256:${key.padStart(64, '0')}`,
    requestSnapshotRef: `request-snapshot-${key}`,
    requestFingerprint: `sha256:${key.padStart(64, '1')}`,
    nearDuplicateFingerprint: `sha256:${key.padStart(64, '2')}`,
    goalContractSnapshotRef: `goal-contract-snapshot-${key}`,
    capabilityCatalogSnapshotRef: `capability-catalog-snapshot-${key}`,
    worldStateSnapshotRef: `world-state-snapshot-${key}`,
    policySnapshotRef: `policy-snapshot-${key}`,
    readinessSnapshotRef: `readiness-snapshot-${key}`,
    acceptedPlanSnapshotRef: `accepted-plan-snapshot-${key}`,
    acceptedPlanRevisionRef: `accepted-plan-${key}:revision-1`,
    executionTraceSnapshotRef: `execution-trace-snapshot-${key}`,
    outcomeSnapshotRef: `outcome-snapshot-${key}`,
    correctionRefs: [],
    environmentClass: index % 2 === 0 ? 'warehouse' : 'laboratory',
    deviceClass: index % 2 === 0 ? 'arm' : 'mobile',
    taskTypeId: 'workflow.policy-remediation',
    sourceTraceRefs: [`trace-${key}`],
    counterexample: false,
    occurredAt: `2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`,
  };
  return { ...source, ...overrides } as ArtifactReplaySource;
}

type ArtifactReplaySourceOverrides = {
  readonly [Key in keyof ArtifactReplaySource]?: ArtifactReplaySource[Key] | undefined;
};
