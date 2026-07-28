import { createHash } from 'node:crypto';

import {
  createArtifactReplayCase,
  createReplayDatasetManifest,
  type ArtifactReplayCase,
  type ReplayDatasetManifest,
  type ReplayDatasetPurpose,
} from '../../../domain/src/index.js';

export const REPLAY_SPLIT_POLICY_VERSION = 'sdar-replay-split/1.1' as const;
export const REPLAY_CASE_BUILDER_VERSION = 'sdar-replay-case-builder/1.1' as const;

const SNAPSHOT_FIELDS = Object.freeze([
  'request',
  'goal_contract',
  'capability_catalog',
  'world_state',
  'policy',
  'readiness',
  'accepted_plan',
  'execution_trace',
  'outcome',
] as const);

export type ReplaySnapshotField = (typeof SNAPSHOT_FIELDS)[number];

export interface ArtifactReplaySource {
  readonly tenantId: string;
  readonly sourceEpisodeRef: string;
  readonly sourceEpisodeRevisionRef: string;
  readonly goalLineageHash: string;
  readonly requestSnapshotRef?: string;
  readonly requestFingerprint: string;
  readonly nearDuplicateFingerprint: string;
  readonly goalContractSnapshotRef?: string;
  readonly capabilityCatalogSnapshotRef?: string;
  readonly worldStateSnapshotRef?: string;
  readonly policySnapshotRef?: string;
  readonly readinessSnapshotRef?: string;
  readonly acceptedPlanSnapshotRef?: string;
  readonly acceptedPlanRevisionRef?: string;
  readonly executionTraceSnapshotRef?: string;
  readonly outcomeSnapshotRef?: string;
  readonly correctionRefs: readonly string[];
  readonly environmentClass: string;
  readonly deviceClass?: string;
  readonly taskTypeId: string;
  readonly sourceTraceRefs: readonly string[];
  readonly syntheticSeedRef?: string;
  readonly counterexample: boolean;
  readonly occurredAt: string;
}

export interface ReplaySnapshotCompleteness {
  readonly requiredSnapshotCount: number;
  readonly availableSnapshotCount: number;
  readonly availableSnapshots: readonly ReplaySnapshotField[];
  readonly missingSnapshots: readonly ReplaySnapshotField[];
  readonly score: number;
  readonly promotionEligible: boolean;
}

export interface ArtifactReplayCaseBuildResult {
  readonly sourceEpisodeRef: string;
  readonly replayCase?: ArtifactReplayCase;
  readonly completeness: ReplaySnapshotCompleteness;
  readonly excludedReason?: 'required_snapshot_missing';
  readonly source: ArtifactReplaySource;
}

export interface ReplayLeakageIssue {
  readonly code:
    | 'GOAL_LINEAGE_CROSS_SPLIT'
    | 'EPISODE_CROSS_SPLIT'
    | 'PLAN_REVISION_CROSS_SPLIT'
    | 'OUTCOME_CROSS_SPLIT'
    | 'REQUEST_CROSS_SPLIT'
    | 'NEAR_DUPLICATE_CROSS_SPLIT'
    | 'SYNTHETIC_SEED_CROSS_SPLIT'
    | 'CANDIDATE_SOURCE_IN_HOLDOUT'
    | 'INCOMPLETE_SNAPSHOT_IN_HOLDOUT';
  readonly groupRef: string;
  readonly purposes: readonly ReplayDatasetPurpose[];
}

export interface ReplayLeakageReport {
  readonly leakageCheckRef: string;
  readonly splitPolicyVersion: typeof REPLAY_SPLIT_POLICY_VERSION;
  readonly passed: boolean;
  readonly issues: readonly ReplayLeakageIssue[];
  readonly checkedCaseCount: number;
  readonly sourceHash: string;
}

export interface ReplayDatasetBuild {
  readonly manifests: Readonly<Record<ReplayDatasetPurpose, ReplayDatasetManifest>>;
  readonly cases: readonly ArtifactReplayCase[];
  readonly assignments: Readonly<Record<string, ReplayDatasetPurpose>>;
  readonly leakage: ReplayLeakageReport;
}

export class ArtifactReplayCaseBuilder {
  build(source: ArtifactReplaySource): ArtifactReplayCaseBuildResult {
    const completeness = snapshotCompleteness(source);
    if (
      source.requestSnapshotRef === undefined ||
      source.goalContractSnapshotRef === undefined ||
      source.capabilityCatalogSnapshotRef === undefined ||
      source.policySnapshotRef === undefined ||
      source.outcomeSnapshotRef === undefined
    ) {
      return Object.freeze({
        sourceEpisodeRef: source.sourceEpisodeRef,
        completeness,
        excludedReason: 'required_snapshot_missing' as const,
        source,
      });
    }
    const identity = {
      tenantId: source.tenantId,
      sourceEpisodeRef: source.sourceEpisodeRef,
      sourceEpisodeRevisionRef: source.sourceEpisodeRevisionRef,
      requestSnapshotRef: source.requestSnapshotRef,
      goalContractSnapshotRef: source.goalContractSnapshotRef,
      capabilityCatalogSnapshotRef: source.capabilityCatalogSnapshotRef,
      worldStateSnapshotRef: source.worldStateSnapshotRef,
      policySnapshotRef: source.policySnapshotRef,
      readinessSnapshotRef: source.readinessSnapshotRef,
      acceptedPlanSnapshotRef: source.acceptedPlanSnapshotRef,
      executionTraceSnapshotRef: source.executionTraceSnapshotRef,
      outcomeSnapshotRef: source.outcomeSnapshotRef,
      correctionRefs: source.correctionRefs,
      environmentClass: source.environmentClass,
      deviceClass: source.deviceClass,
      taskTypeId: source.taskTypeId,
      goalLineageHash: source.goalLineageHash,
      snapshotCompleteness: completeness.score,
      builderVersion: REPLAY_CASE_BUILDER_VERSION,
    };
    const contentHash = hash(identity);
    const replayCase = createArtifactReplayCase({
      replayCaseId: stableId('artifact-replay-case', contentHash),
      tenantId: source.tenantId,
      requestSnapshotRef: source.requestSnapshotRef,
      goalContractSnapshotRef: source.goalContractSnapshotRef,
      capabilityCatalogSnapshotRef: source.capabilityCatalogSnapshotRef,
      ...(source.worldStateSnapshotRef === undefined
        ? {}
        : { worldStateSnapshotRef: source.worldStateSnapshotRef }),
      policySnapshotRef: source.policySnapshotRef,
      ...(source.readinessSnapshotRef === undefined
        ? {}
        : { readinessSnapshotRef: source.readinessSnapshotRef }),
      ...(source.acceptedPlanSnapshotRef === undefined
        ? {}
        : { acceptedPlanSnapshotRef: source.acceptedPlanSnapshotRef }),
      ...(source.executionTraceSnapshotRef === undefined
        ? {}
        : { executionTraceSnapshotRef: source.executionTraceSnapshotRef }),
      outcomeSnapshotRef: source.outcomeSnapshotRef,
      correctionRefs: source.correctionRefs,
      environmentClass: source.environmentClass,
      ...(source.deviceClass === undefined ? {} : { deviceClass: source.deviceClass }),
      taskTypeId: source.taskTypeId,
      sourceEpisodeRefs: [source.sourceEpisodeRef],
      goalLineageHash: source.goalLineageHash,
      snapshotCompleteness: completeness.score,
      contentHash,
    });
    return Object.freeze({
      sourceEpisodeRef: source.sourceEpisodeRef,
      replayCase,
      completeness,
      source,
    });
  }
}

export interface ReplayDatasetBuilderInput {
  readonly tenantId: string;
  readonly datasetVersion: number;
  readonly cases: readonly ArtifactReplayCaseBuildResult[];
  readonly candidateSourceTraceRefs: readonly string[];
  readonly createdAt: string;
}

export class ReplayDatasetBuilder {
  build(input: ReplayDatasetBuilderInput): ReplayDatasetBuild {
    if (!Number.isSafeInteger(input.datasetVersion) || input.datasetVersion < 1) {
      throw new Error('REPLAY_DATASET_VERSION_INVALID');
    }
    const records = input.cases
      .filter(
        (
          item,
        ): item is ArtifactReplayCaseBuildResult & {
          readonly replayCase: ArtifactReplayCase;
        } => item.replayCase !== undefined,
      )
      .sort((left, right) => {
        const time = left.source.occurredAt.localeCompare(right.source.occurredAt);
        return time === 0
          ? left.replayCase.replayCaseId.localeCompare(right.replayCase.replayCaseId)
          : time;
      });
    if (records.length === 0) throw new Error('REPLAY_DATASET_CASES_REQUIRED');
    if (records.some((item) => item.replayCase.tenantId !== input.tenantId)) {
      throw new Error('REPLAY_DATASET_TENANT_SCOPE_DENIED');
    }

    const candidateSourceTraceRefs = new Set(input.candidateSourceTraceRefs);
    const grouped = groupRecords(records);
    const assignments = assignGroups(grouped, candidateSourceTraceRefs);
    const caseAssignments: Record<string, ReplayDatasetPurpose> = {};
    for (const [groupKey, members] of grouped) {
      const purpose = requiredMapValue(assignments, groupKey);
      for (const member of members) caseAssignments[member.replayCase.replayCaseId] = purpose;
    }
    const leakage = inspectLeakage(records, caseAssignments, input.candidateSourceTraceRefs);
    if (!leakage.passed) {
      throw new ReplayDatasetLeakageError(leakage);
    }

    const sourceRange = {
      from: records[0]?.source.occurredAt ?? input.createdAt,
      to: records.at(-1)?.source.occurredAt ?? input.createdAt,
    };
    const sourceHash = hash(
      records.map((item) => ({
        caseId: item.replayCase.replayCaseId,
        contentHash: item.replayCase.contentHash,
        sourceEpisodeRevisionRef: item.source.sourceEpisodeRevisionRef,
      })),
    );
    const manifests = Object.fromEntries(
      (['discovery', 'candidate_development', 'promotion_holdout', 'counterexample'] as const).map(
        (purpose) => {
          const purposeCases = records
            .filter((item) => caseAssignments[item.replayCase.replayCaseId] === purpose)
            .map((item) => item.replayCase);
          if (purposeCases.length === 0) {
            throw new Error(`REPLAY_DATASET_PURPOSE_EMPTY:${purpose}`);
          }
          const manifestIdentity = {
            datasetVersion: input.datasetVersion,
            purpose,
            tenantId: input.tenantId,
            taskTypeIds: uniqueSorted(purposeCases.map((item) => item.taskTypeId)),
            caseRefs: purposeCases.map((item) => item.replayCaseId).sort(),
            splitPolicyVersion: REPLAY_SPLIT_POLICY_VERSION,
            sourceRange,
            sourceHash,
            leakageCheckRef: leakage.leakageCheckRef,
            createdAt: input.createdAt,
          };
          const contentHash = hash(manifestIdentity);
          return [
            purpose,
            createReplayDatasetManifest({
              datasetId: stableId(
                'replay-dataset',
                `${input.tenantId}:${purpose}:${String(input.datasetVersion)}`,
              ),
              ...manifestIdentity,
              contentHash,
            }),
          ];
        },
      ),
    ) as unknown as Readonly<Record<ReplayDatasetPurpose, ReplayDatasetManifest>>;

    return Object.freeze({
      manifests: Object.freeze(manifests),
      cases: Object.freeze(records.map((item) => item.replayCase)),
      assignments: Object.freeze(caseAssignments),
      leakage,
    });
  }
}

export class ReplayDatasetLeakageError extends Error {
  readonly report: ReplayLeakageReport;

  constructor(report: ReplayLeakageReport) {
    super(`REPLAY_DATASET_LEAKAGE_DETECTED:${report.issues.map((item) => item.code).join(',')}`);
    this.name = 'ReplayDatasetLeakageError';
    this.report = report;
  }
}

export function snapshotCompleteness(source: ArtifactReplaySource): ReplaySnapshotCompleteness {
  const available = [
    source.requestSnapshotRef === undefined ? undefined : 'request',
    source.goalContractSnapshotRef === undefined ? undefined : 'goal_contract',
    source.capabilityCatalogSnapshotRef === undefined ? undefined : 'capability_catalog',
    source.worldStateSnapshotRef === undefined ? undefined : 'world_state',
    source.policySnapshotRef === undefined ? undefined : 'policy',
    source.readinessSnapshotRef === undefined ? undefined : 'readiness',
    source.acceptedPlanSnapshotRef === undefined ? undefined : 'accepted_plan',
    source.executionTraceSnapshotRef === undefined ? undefined : 'execution_trace',
    source.outcomeSnapshotRef === undefined ? undefined : 'outcome',
  ].filter((item): item is ReplaySnapshotField => item !== undefined);
  const missing = SNAPSHOT_FIELDS.filter((item) => !available.includes(item));
  const score = rounded(available.length / SNAPSHOT_FIELDS.length);
  return Object.freeze({
    requiredSnapshotCount: SNAPSHOT_FIELDS.length,
    availableSnapshotCount: available.length,
    availableSnapshots: Object.freeze(available),
    missingSnapshots: Object.freeze(missing),
    score,
    promotionEligible: score === 1,
  });
}

function groupRecords(
  records: readonly (ArtifactReplayCaseBuildResult & {
    readonly replayCase: ArtifactReplayCase;
  })[],
): ReadonlyMap<
  string,
  readonly (ArtifactReplayCaseBuildResult & { readonly replayCase: ArtifactReplayCase })[]
> {
  const parents = records.map((_, index) => index);
  const roots = new Map<string, number>();
  records.forEach((record, index) => {
    for (const groupRef of [
      `goal:${record.source.goalLineageHash}`,
      `episode:${record.source.sourceEpisodeRef}`,
      `episode-revision:${record.source.sourceEpisodeRevisionRef}`,
      ...(record.source.acceptedPlanRevisionRef === undefined
        ? []
        : [`plan-revision:${record.source.acceptedPlanRevisionRef}`]),
      ...(record.source.outcomeSnapshotRef === undefined
        ? []
        : [`outcome:${record.source.outcomeSnapshotRef}`]),
      `request:${record.source.requestFingerprint}`,
      `near-duplicate:${record.source.nearDuplicateFingerprint}`,
      ...(record.source.syntheticSeedRef === undefined
        ? []
        : [`synthetic-seed:${record.source.syntheticSeedRef}`]),
    ]) {
      const existing = roots.get(groupRef);
      if (existing === undefined) roots.set(groupRef, index);
      else union(parents, index, existing);
    }
  });
  const groups = new Map<
    string,
    (ArtifactReplayCaseBuildResult & { readonly replayCase: ArtifactReplayCase })[]
  >();
  const componentIds = new Map<number, string[]>();
  records.forEach((record, index) => {
    const root = findRoot(parents, index);
    const ids = componentIds.get(root) ?? [];
    ids.push(record.replayCase.replayCaseId);
    componentIds.set(root, ids);
  });
  const componentKeys = new Map(
    [...componentIds].map(([root, ids]) => [root, hash(ids.sort())] as const),
  );
  records.forEach((record, index) => {
    const key = componentKeys.get(findRoot(parents, index));
    if (key === undefined) throw new Error('REPLAY_DATASET_GROUP_KEY_MISSING');
    const current = groups.get(key) ?? [];
    current.push(record);
    groups.set(key, current);
  });
  return groups;
}

function findRoot(parents: number[], index: number): number {
  const parent = parents[index];
  if (parent === undefined) throw new Error('REPLAY_DATASET_GROUP_ROOT_MISSING');
  if (parent === index) return index;
  const root = findRoot(parents, parent);
  parents[index] = root;
  return root;
}

function union(parents: number[], left: number, right: number): void {
  const leftRoot = findRoot(parents, left);
  const rightRoot = findRoot(parents, right);
  if (leftRoot !== rightRoot)
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function assignGroups(
  groups: ReadonlyMap<
    string,
    readonly (ArtifactReplayCaseBuildResult & { readonly replayCase: ArtifactReplayCase })[]
  >,
  candidateSourceTraceRefs: ReadonlySet<string>,
): ReadonlyMap<string, ReplayDatasetPurpose> {
  const assignments = new Map<string, ReplayDatasetPurpose>();
  const eligible: {
    readonly key: string;
    readonly occurredAt: string;
  }[] = [];
  for (const [key, members] of groups) {
    const counterexample = members.some((item) => item.source.counterexample);
    const candidateSource = members.some((item) =>
      item.source.sourceTraceRefs.some((ref) => candidateSourceTraceRefs.has(ref)),
    );
    const complete = members.every((item) => item.completeness.promotionEligible);
    if (counterexample) assignments.set(key, 'counterexample');
    else if (candidateSource || !complete) assignments.set(key, 'candidate_development');
    else {
      eligible.push({
        key,
        occurredAt: members[0]?.source.occurredAt ?? '',
      });
    }
  }
  eligible.sort((left, right) => {
    const time = left.occurredAt.localeCompare(right.occurredAt);
    return time === 0 ? left.key.localeCompare(right.key) : time;
  });
  if (eligible.length < 3) throw new Error('REPLAY_DATASET_HOLDOUT_GROUPS_INSUFFICIENT');
  const holdoutCount = Math.max(1, Math.floor(eligible.length / 4));
  const holdoutStart = eligible.length - holdoutCount;
  const discoveryCount = Math.max(1, Math.floor(holdoutStart / 2));
  eligible.forEach((group, index) => {
    assignments.set(
      group.key,
      index >= holdoutStart
        ? 'promotion_holdout'
        : index < discoveryCount
          ? 'discovery'
          : 'candidate_development',
    );
  });
  return assignments;
}

function inspectLeakage(
  records: readonly (ArtifactReplayCaseBuildResult & {
    readonly replayCase: ArtifactReplayCase;
  })[],
  assignments: Readonly<Record<string, ReplayDatasetPurpose>>,
  candidateSourceTraceRefs: readonly string[],
): ReplayLeakageReport {
  const issues: ReplayLeakageIssue[] = [];
  const candidateSources = new Set(candidateSourceTraceRefs);
  checkGroup(
    'GOAL_LINEAGE_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.goalLineageHash,
    issues,
  );
  checkGroup(
    'EPISODE_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.sourceEpisodeRef,
    issues,
  );
  checkGroup(
    'PLAN_REVISION_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.acceptedPlanRevisionRef,
    issues,
  );
  checkGroup(
    'OUTCOME_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.outcomeSnapshotRef,
    issues,
  );
  checkGroup(
    'REQUEST_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.requestFingerprint,
    issues,
  );
  checkGroup(
    'NEAR_DUPLICATE_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.nearDuplicateFingerprint,
    issues,
  );
  checkGroup(
    'SYNTHETIC_SEED_CROSS_SPLIT',
    records,
    assignments,
    (item) => item.source.syntheticSeedRef,
    issues,
  );
  for (const record of records) {
    const purpose = assignments[record.replayCase.replayCaseId];
    if (
      purpose === 'promotion_holdout' &&
      record.source.sourceTraceRefs.some((ref) => candidateSources.has(ref))
    ) {
      issues.push({
        code: 'CANDIDATE_SOURCE_IN_HOLDOUT',
        groupRef: record.replayCase.replayCaseId,
        purposes: Object.freeze([purpose]),
      });
    }
    if (purpose === 'promotion_holdout' && !record.completeness.promotionEligible) {
      issues.push({
        code: 'INCOMPLETE_SNAPSHOT_IN_HOLDOUT',
        groupRef: record.replayCase.replayCaseId,
        purposes: Object.freeze([purpose]),
      });
    }
  }
  const sourceHash = hash(
    records.map((item) => ({
      replayCaseId: item.replayCase.replayCaseId,
      purpose: assignments[item.replayCase.replayCaseId],
    })),
  );
  const orderedIssues = issues.sort((left, right) => {
    const code = left.code.localeCompare(right.code);
    return code === 0 ? left.groupRef.localeCompare(right.groupRef) : code;
  });
  return Object.freeze({
    leakageCheckRef: stableId('replay-leakage-check', hash({ sourceHash, orderedIssues })),
    splitPolicyVersion: REPLAY_SPLIT_POLICY_VERSION,
    passed: orderedIssues.length === 0,
    issues: Object.freeze(orderedIssues),
    checkedCaseCount: records.length,
    sourceHash,
  });
}

function checkGroup(
  code: ReplayLeakageIssue['code'],
  records: readonly (ArtifactReplayCaseBuildResult & {
    readonly replayCase: ArtifactReplayCase;
  })[],
  assignments: Readonly<Record<string, ReplayDatasetPurpose>>,
  key: (
    record: ArtifactReplayCaseBuildResult & { readonly replayCase: ArtifactReplayCase },
  ) => string | undefined,
  issues: ReplayLeakageIssue[],
): void {
  const grouped = new Map<string, Set<ReplayDatasetPurpose>>();
  for (const record of records) {
    const groupRef = key(record);
    const purpose = assignments[record.replayCase.replayCaseId];
    if (groupRef === undefined || purpose === undefined) continue;
    const purposes = grouped.get(groupRef) ?? new Set<ReplayDatasetPurpose>();
    purposes.add(purpose);
    grouped.set(groupRef, purposes);
  }
  for (const [groupRef, purposes] of grouped) {
    if (purposes.size > 1) {
      issues.push({
        code,
        groupRef,
        purposes: Object.freeze([...purposes].sort()),
      });
    }
  }
}

function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error('REPLAY_DATASET_ASSIGNMENT_MISSING');
  return value;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
}
