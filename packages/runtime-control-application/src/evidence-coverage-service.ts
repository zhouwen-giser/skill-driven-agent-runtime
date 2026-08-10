import {
  EPISODE_EVIDENCE_POLICY,
  hashCanonicalEvidenceJson,
  type EpisodeEvidenceManifest,
  type EvidenceExpectedRecord,
  type EvidenceQualityIssue,
  type EvidenceRecordFamily,
  type EvidenceSourceCoverage,
} from '../../domain/src/index.js';

export interface EpisodeEvidenceCoverageSnapshot {
  readonly expectedRecords: readonly EvidenceExpectedRecord[];
  readonly qualityIssues: readonly EvidenceQualityIssue[];
  readonly lastEvidenceSequence: string;
  readonly sourceSnapshotHash: `sha256:${string}`;
  readonly previousManifest?: EpisodeEvidenceManifest;
}

export interface EpisodeEvidenceCoverageRepository {
  refreshEpisodeExpectations(input: {
    readonly episodeId: string;
    readonly taskId: string;
    readonly policyRecords: typeof EPISODE_EVIDENCE_POLICY.records;
    readonly recomputedAt: string;
  }): Promise<EpisodeEvidenceCoverageSnapshot>;
  saveManifest(manifest: EpisodeEvidenceManifest): Promise<void>;
}

export interface ReconcileEpisodeEvidenceInput {
  readonly episodeId: string;
  readonly taskId: string;
  readonly terminalOutcomeId: string;
  readonly sealRequested: boolean;
}

export class EpisodeEvidenceCoverageService {
  readonly #repository: EpisodeEvidenceCoverageRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(input: {
    readonly repository: EpisodeEvidenceCoverageRepository;
    readonly clock?: Readonly<{ now(): string }>;
  }) {
    this.#repository = input.repository;
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async reconcile(input: ReconcileEpisodeEvidenceInput): Promise<EpisodeEvidenceManifest> {
    const episodeId = requiredText(input.episodeId, 'episodeId');
    const taskId = requiredText(input.taskId, 'taskId');
    const terminalOutcomeId = requiredText(input.terminalOutcomeId, 'terminalOutcomeId');
    const recomputedAt = timestamp(this.#clock.now(), 'recomputedAt');
    const snapshot = await this.#repository.refreshEpisodeExpectations({
      episodeId,
      taskId,
      policyRecords: EPISODE_EVIDENCE_POLICY.records,
      recomputedAt,
    });
    decimalSequence(snapshot.lastEvidenceSequence, 'lastEvidenceSequence');
    hash(snapshot.sourceSnapshotHash, 'sourceSnapshotHash');

    if (
      snapshot.previousManifest?.policyVersion === EPISODE_EVIDENCE_POLICY.policyVersion &&
      snapshot.previousManifest.taskId === taskId &&
      snapshot.previousManifest.terminalOutcomeId === terminalOutcomeId &&
      snapshot.previousManifest.sourceSnapshotHash === snapshot.sourceSnapshotHash &&
      (snapshot.previousManifest.status !== 'projecting') === input.sealRequested
    ) {
      return snapshot.previousManifest;
    }

    const applicableRequired = snapshot.expectedRecords.filter(
      (record) => record.applicable && record.evaluationRole === 'required',
    );
    const families = uniqueFamilies(applicableRequired.map((record) => record.recordFamily));
    const coverage = sourceCoverage(families, applicableRequired);
    const projectedRequiredRecords = applicableRequired.filter((record) =>
      completedStages.has(record.stage),
    ).length;
    const pendingRequiredRecords = applicableRequired.filter((record) =>
      pendingStages.has(record.stage),
    ).length;
    const failedRequiredRecords = applicableRequired.filter((record) =>
      failedStages.has(record.stage),
    ).length;
    const completedFamilies = families.filter((family) =>
      applicableRequired
        .filter((record) => record.recordFamily === family)
        .every((record) => completedStages.has(record.stage)),
    );
    const missingFamilies = families.filter(
      (family) => (coverage[family]?.pending ?? 0) + (coverage[family]?.failed ?? 0) > 0,
    );
    const status = manifestStatus({
      sealRequested: input.sealRequested,
      issues: snapshot.qualityIssues,
      pendingRequiredRecords,
      failedRequiredRecords,
    });
    const previous = snapshot.previousManifest;
    const manifest: EpisodeEvidenceManifest = Object.freeze({
      manifestId:
        previous?.manifestId ??
        `manifest_${hashCanonicalEvidenceJson([episodeId, terminalOutcomeId]).slice('sha256:'.length)}`,
      episodeId,
      taskId,
      terminalOutcomeId,
      revision: (previous?.revision ?? 0) + 1,
      policyVersion: EPISODE_EVIDENCE_POLICY.policyVersion,
      sourceSnapshotHash: snapshot.sourceSnapshotHash,
      recomputedAt,
      expectedRequiredRecords: applicableRequired.length,
      projectedRequiredRecords,
      pendingRequiredRecords,
      failedRequiredRecords,
      expectedFamilies: families,
      completedFamilies,
      missingFamilies,
      sourceCoverage: coverage,
      lastEvidenceSequence: snapshot.lastEvidenceSequence,
      status,
      qualityIssueIds: Object.freeze(snapshot.qualityIssues.map((issue) => issue.issueId).sort()),
      createdAt: previous?.createdAt ?? recomputedAt,
      ...(status === 'projecting' ? {} : { sealedAt: recomputedAt }),
    });
    await this.#repository.saveManifest(manifest);
    return manifest;
  }
}

// A Required fact is complete only after the sink acknowledged it. Projected
// and sent-but-unacknowledged facts remain pending so a sealed Manifest cannot
// report complete/degraded while Required export is still outstanding.
const completedStages = new Set(['acknowledged']);
const pendingStages = new Set([
  'source_fact_missing',
  'source_fact_unprojected',
  'projected_pending_export',
  'exported_unacknowledged',
]);
const failedStages = new Set(['projection_failed', 'schema_invalid', 'payload_conflict']);

function manifestStatus(input: {
  readonly sealRequested: boolean;
  readonly issues: readonly EvidenceQualityIssue[];
  readonly pendingRequiredRecords: number;
  readonly failedRequiredRecords: number;
}): EpisodeEvidenceManifest['status'] {
  if (!input.sealRequested) return 'projecting';
  if (
    input.pendingRequiredRecords > 0 ||
    input.failedRequiredRecords > 0 ||
    input.issues.some((issue) => issue.severity === 'blocking')
  ) {
    return 'incomplete';
  }
  if (input.issues.some((issue) => issue.severity === 'degraded')) {
    return 'degraded';
  }
  return 'complete';
}

function sourceCoverage(
  families: readonly EvidenceRecordFamily[],
  records: readonly EvidenceExpectedRecord[],
): Readonly<Record<string, EvidenceSourceCoverage>> {
  return Object.freeze(
    Object.fromEntries(
      families.map((family) => {
        const selected = records.filter((record) => record.recordFamily === family);
        return [
          family,
          Object.freeze({
            expected: selected.length,
            projected: selected.filter((record) => completedStages.has(record.stage)).length,
            pending: selected.filter((record) => pendingStages.has(record.stage)).length,
            failed: selected.filter((record) => failedStages.has(record.stage)).length,
          }),
        ];
      }),
    ),
  );
}

function uniqueFamilies(values: readonly EvidenceRecordFamily[]): readonly EvidenceRecordFamily[] {
  return Object.freeze([...new Set(values)].sort());
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 512) throw new Error(`EVIDENCE_COVERAGE_${field}`);
  return normalized;
}

function decimalSequence(value: string, field: string): void {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(`EVIDENCE_COVERAGE_${field}`);
}

function hash(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`EVIDENCE_COVERAGE_${field}`);
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`EVIDENCE_COVERAGE_${field}`);
  return parsed.toISOString();
}
