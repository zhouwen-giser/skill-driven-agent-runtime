import { createHash } from 'node:crypto';

import {
  PROCESS_MINING_ALGORITHM_VERSION,
  createCohortDefinition,
  createDiscoveredProcessPattern,
  createProcessVariant,
  createWorkflowPattern,
  type ActivityPattern,
  type CohortDefinition,
  type DependencyPattern,
  type DiscoveredProcessPattern,
  type ExperienceTrace,
  type FailureVariant,
  type OrderingConstraint,
  type ParallelCandidate,
  type PatternQuality,
  type ProcessVariant,
  type RecoveryPattern,
  type WorkflowPattern,
} from '../../../domain/src/index.js';
import type { ProcessMiningResult } from './experience-compilation.js';

export interface ProcessMiningPolicy {
  readonly mandatoryThreshold: number;
}

interface RelationEvidence {
  readonly support: Set<string>;
  readonly contradiction: Set<string>;
}

interface VariantAccumulator {
  readonly activitySequence: readonly string[];
  readonly concurrencyGroups: readonly (readonly string[])[];
  readonly branchSequence: readonly string[];
  readonly traceRefs: string[];
  successCount: number;
  failureCount: number;
}

export class DeterministicProcessMiner {
  readonly #policy: ProcessMiningPolicy;

  constructor(policy: ProcessMiningPolicy = { mandatoryThreshold: 0.8 }) {
    if (
      !Number.isFinite(policy.mandatoryThreshold) ||
      policy.mandatoryThreshold <= 0 ||
      policy.mandatoryThreshold > 1
    ) {
      throw new Error('PROCESS_MINING_MANDATORY_THRESHOLD_INVALID');
    }
    this.#policy = Object.freeze({ ...policy });
  }

  fingerprintCohort(input: CohortDefinition): string {
    const cohort = createCohortDefinition(input);
    return hash({
      contractVersion: '1.1',
      algorithmVersion: PROCESS_MINING_ALGORITHM_VERSION,
      cohort,
      mandatoryThreshold: this.#policy.mandatoryThreshold,
    });
  }

  async discover(
    input: CohortDefinition,
    traceInput: readonly ExperienceTrace[],
  ): Promise<ProcessMiningResult> {
    const cohort = createCohortDefinition(input);
    const traces = [...traceInput].sort((left, right) => left.traceId.localeCompare(right.traceId));
    if (traces.length === 0) throw new Error('PROCESS_MINING_COHORT_EMPTY');
    for (const [index, trace] of traces.entries()) {
      assertTraceInCohort(trace, cohort);
      await yieldForOnlineRuntime(index);
    }
    const cohortFingerprint = this.fingerprintCohort(cohort);
    const variants = await discoverVariants(traces);
    const activitySupport = await activitySupportByTrace(traces);
    const allActivities = [...activitySupport.keys()].sort();
    const mandatoryActivities = allActivities.filter(
      (activity) =>
        requiredMapValue(activitySupport, activity).size / traces.length >=
        this.#policy.mandatoryThreshold,
    );
    const optionalActivities = allActivities.filter(
      (activity) => !mandatoryActivities.includes(activity),
    );
    const directEvidence = await relationEvidence(traces, 'direct_follows');
    const precedenceEvidence = await relationEvidence(traces, 'precedes');
    const orderingConstraints = [
      ...toOrderingConstraints(directEvidence, 'direct_follows'),
      ...toOrderingConstraints(precedenceEvidence, 'precedes'),
    ].sort(compareOrdering);
    const parallelCandidates = await discoverParallelCandidates(traces);
    const recoveryBranches = await discoverRecoveryPatterns(traces);
    const failureVariants = await discoverFailureVariants(traces);
    const contradictionRefs = uniqueSorted([
      ...orderingConstraints.flatMap((constraint) => constraint.contradictionRefs),
      ...parallelCandidates.flatMap((candidate) => candidate.contradictionRefs),
    ]);
    const supportRefs = traces.map((trace) => trace.traceId);
    const environmentCoverage = uniqueSorted(
      traces.map(
        (trace) =>
          `${trace.trace.environmentClass}${
            trace.trace.deviceClass === undefined ? '' : `/${trace.trace.deviceClass}`
          }`,
      ),
    );
    const quality = patternQuality({
      traces,
      mandatoryActivities,
      allActivities,
      orderingConstraints,
      contradictionRefs,
      environmentCoverage,
      mandatoryThreshold: this.#policy.mandatoryThreshold,
    });
    const traceSetHash = hash(
      traces.map((trace) => ({
        traceId: trace.traceId,
        sourceHash: trace.sourceHash,
        outcomeStatus: trace.trace.outcomeStatus,
      })),
    );
    const patternId = `process-pattern-${digest(
      canonicalJson({
        cohortFingerprint,
        algorithmVersion: PROCESS_MINING_ALGORITHM_VERSION,
        traceSetHash,
      }),
    )}`;
    const discoveredPattern = createDiscoveredProcessPattern({
      patternId,
      cohortFingerprint,
      algorithmVersion: PROCESS_MINING_ALGORITHM_VERSION,
      mandatoryActivities,
      optionalActivities,
      orderingConstraints,
      parallelCandidates,
      recoveryBranches,
      failureVariants,
      supportRefs,
      contradictionRefs,
      environmentCoverage,
      quality,
    });
    const workflowPattern = toWorkflowPattern({
      cohort,
      traces,
      activitySupport,
      discoveredPattern,
    });
    return Object.freeze({
      cohort,
      cohortFingerprint,
      variants,
      discoveredPattern,
      workflowPattern,
    });
  }
}

async function discoverVariants(
  traces: readonly ExperienceTrace[],
): Promise<readonly ProcessVariant[]> {
  const accumulators = new Map<string, VariantAccumulator>();
  for (const [index, trace] of traces.entries()) {
    const activitySequence = trace.trace.events.map((event) => event.eventType);
    if (activitySequence.length === 0) continue;
    const concurrencyGroups = traceConcurrencyGroups(trace);
    const branchSequence = trace.trace.events.flatMap((event) =>
      event.branchRef === undefined ? [] : [event.branchRef],
    );
    const key = canonicalJson({ activitySequence, concurrencyGroups, branchSequence });
    const accumulator = accumulators.get(key) ?? {
      activitySequence,
      concurrencyGroups,
      branchSequence,
      traceRefs: [],
      successCount: 0,
      failureCount: 0,
    };
    accumulator.traceRefs.push(trace.traceId);
    if (trace.trace.outcomeStatus === 'succeeded') accumulator.successCount += 1;
    if (trace.trace.outcomeStatus === 'failed') accumulator.failureCount += 1;
    accumulators.set(key, accumulator);
    await yieldForOnlineRuntime(index);
  }
  return Object.freeze(
    [...accumulators.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) =>
        createProcessVariant({
          variantId: `process-variant-${digest(key)}`,
          activitySequence: value.activitySequence,
          concurrencyGroups: value.concurrencyGroups,
          branchSequence: value.branchSequence,
          occurrenceCount: value.traceRefs.length,
          traceRefs: value.traceRefs.sort(),
          successCount: value.successCount,
          failureCount: value.failureCount,
        }),
      ),
  );
}

function traceConcurrencyGroups(trace: ExperienceTrace): readonly (readonly string[])[] {
  const groups = new Map<string, { firstSequence: number; activities: string[] }>();
  for (const event of trace.trace.events) {
    if (event.concurrencyGroup === undefined) continue;
    const group = groups.get(event.concurrencyGroup) ?? {
      firstSequence: event.sequence,
      activities: [],
    };
    group.firstSequence = Math.min(group.firstSequence, event.sequence);
    group.activities.push(event.eventType);
    groups.set(event.concurrencyGroup, group);
  }
  return Object.freeze(
    [...groups.entries()]
      .sort(
        ([leftKey, left], [rightKey, right]) =>
          left.firstSequence - right.firstSequence || leftKey.localeCompare(rightKey),
      )
      .map(([, value]) => Object.freeze([...value.activities])),
  );
}

async function activitySupportByTrace(
  traces: readonly ExperienceTrace[],
): Promise<ReadonlyMap<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const [index, trace] of traces.entries()) {
    for (const activity of new Set(trace.trace.events.map((event) => event.eventType))) {
      const support = result.get(activity) ?? new Set<string>();
      support.add(trace.traceId);
      result.set(activity, support);
    }
    await yieldForOnlineRuntime(index);
  }
  return result;
}

async function relationEvidence(
  traces: readonly ExperienceTrace[],
  relation: OrderingConstraint['relation'],
): Promise<ReadonlyMap<string, RelationEvidence>> {
  const supports = new Map<string, Set<string>>();
  for (const [index, trace] of traces.entries()) {
    const activities = trace.trace.events.map((event) => event.eventType);
    const pairs =
      relation === 'direct_follows' ? directPairs(activities) : precedencePairs(activities);
    for (const [predecessor, successor] of pairs) {
      const key = relationKey(predecessor, successor);
      const refs = supports.get(key) ?? new Set<string>();
      refs.add(trace.traceId);
      supports.set(key, refs);
    }
    await yieldForOnlineRuntime(index);
  }
  const result = new Map<string, RelationEvidence>();
  for (const [key, support] of supports) {
    const [predecessor, successor] = splitRelationKey(key);
    const reverse = supports.get(relationKey(successor, predecessor)) ?? new Set<string>();
    result.set(key, {
      support,
      contradiction: new Set([...reverse].filter((traceId) => !support.has(traceId))),
    });
  }
  return result;
}

function directPairs(activities: readonly string[]): readonly (readonly [string, string])[] {
  const pairs = new Map<string, readonly [string, string]>();
  for (let index = 0; index + 1 < activities.length; index += 1) {
    const predecessor = activities[index];
    const successor = activities[index + 1];
    if (predecessor === undefined || successor === undefined || predecessor === successor) continue;
    pairs.set(relationKey(predecessor, successor), [predecessor, successor]);
  }
  return [...pairs.values()];
}

function precedencePairs(activities: readonly string[]): readonly (readonly [string, string])[] {
  const positions = new Map<string, { first: number; last: number }>();
  for (const [index, activity] of activities.entries()) {
    const current = positions.get(activity);
    positions.set(activity, {
      first: current?.first ?? index,
      last: index,
    });
  }
  const uniqueActivities = [...positions.keys()].sort();
  const pairs: (readonly [string, string])[] = [];
  for (const predecessor of uniqueActivities) {
    for (const successor of uniqueActivities) {
      if (predecessor === successor) continue;
      const left = requiredMapValue(positions, predecessor);
      const right = requiredMapValue(positions, successor);
      if (left.last < right.first) pairs.push([predecessor, successor]);
    }
  }
  return pairs;
}

function toOrderingConstraints(
  evidence: ReadonlyMap<string, RelationEvidence>,
  relation: OrderingConstraint['relation'],
): readonly OrderingConstraint[] {
  return [...evidence.entries()].flatMap(([key, value]) => {
    if (value.support.size < value.contradiction.size) return [];
    const [predecessorActivity, successorActivity] = splitRelationKey(key);
    return [
      {
        predecessorActivity,
        successorActivity,
        relation,
        supportRefs: [...value.support].sort(),
        contradictionRefs: [...value.contradiction].sort(),
      },
    ];
  });
}

async function discoverParallelCandidates(
  traces: readonly ExperienceTrace[],
): Promise<readonly ParallelCandidate[]> {
  const support = new Map<string, Set<string>>();
  const activitiesByKey = new Map<string, readonly string[]>();
  for (const [index, trace] of traces.entries()) {
    for (const activities of traceConcurrencyGroups(trace)) {
      const uniqueActivities = uniqueSorted(activities);
      if (uniqueActivities.length < 2) continue;
      const key = canonicalJson(uniqueActivities);
      const refs = support.get(key) ?? new Set<string>();
      refs.add(trace.traceId);
      support.set(key, refs);
      activitiesByKey.set(key, uniqueActivities);
    }
    await yieldForOnlineRuntime(index);
  }
  return Object.freeze(
    [...support.keys()].sort().map((key) => {
      const activities = requiredMapValue(activitiesByKey, key);
      const supportRefs = [...requiredMapValue(support, key)].sort();
      const contradictionRefs = traces
        .filter(
          (trace) =>
            !supportRefs.includes(trace.traceId) && hasExplicitParentOrdering(trace, activities),
        )
        .map((trace) => trace.traceId)
        .sort();
      return {
        activityRefs: activities,
        evidenceType: 'explicit_concurrency' as const,
        supportRefs,
        contradictionRefs,
      };
    }),
  );
}

function hasExplicitParentOrdering(trace: ExperienceTrace, activities: readonly string[]): boolean {
  const events = trace.trace.events.filter((event) => activities.includes(event.eventType));
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  return events.some((event) =>
    event.parentEventRefs.some((parentRef) => eventById.has(parentRef)),
  );
}

async function discoverRecoveryPatterns(
  traces: readonly ExperienceTrace[],
): Promise<readonly RecoveryPattern[]> {
  const patterns = new Map<
    string,
    {
      triggerActivity: string;
      resumeActivity?: string;
      activitySequence: string[];
      refs: Set<string>;
    }
  >();
  for (const [traceIndex, trace] of traces.entries()) {
    for (const [index, event] of trace.trace.events.entries()) {
      if (event.eventType !== 'recovery_started') continue;
      const triggerActivity =
        trace.trace.events[index - 1]?.eventType ?? 'recovery_trigger_unknown';
      const resumeActivity = trace.trace.events[index + 1]?.eventType;
      const activitySequence = trace.trace.events
        .slice(index)
        .map((candidate) => candidate.eventType);
      const key = canonicalJson({
        triggerActivity,
        ...(resumeActivity === undefined ? {} : { resumeActivity }),
        activitySequence,
      });
      const pattern = patterns.get(key) ?? {
        triggerActivity,
        ...(resumeActivity === undefined ? {} : { resumeActivity }),
        activitySequence,
        refs: new Set<string>(),
      };
      pattern.refs.add(trace.traceId);
      patterns.set(key, pattern);
    }
    await yieldForOnlineRuntime(traceIndex);
  }
  return Object.freeze(
    [...patterns.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, pattern]) => ({
        triggerActivity: pattern.triggerActivity,
        ...(pattern.resumeActivity === undefined ? {} : { resumeActivity: pattern.resumeActivity }),
        activitySequence: pattern.activitySequence,
        supportRefs: [...pattern.refs].sort(),
      })),
  );
}

async function discoverFailureVariants(
  traces: readonly ExperienceTrace[],
): Promise<readonly FailureVariant[]> {
  const failures = new Map<
    string,
    { activitySequence: readonly string[]; failureActivity: string; traceRefs: string[] }
  >();
  for (const [index, trace] of traces.entries()) {
    const failureEvent = [...trace.trace.events]
      .reverse()
      .find((event) => ['workflow_failed', 'goal_failed'].includes(event.eventType));
    if (trace.trace.outcomeStatus !== 'failed' && failureEvent === undefined) continue;
    const activitySequence = trace.trace.events.map((event) => event.eventType);
    const failureActivity =
      failureEvent?.eventType ?? activitySequence.at(-1) ?? 'failure_activity_unknown';
    const key = canonicalJson({ activitySequence, failureActivity });
    const failure = failures.get(key) ?? { activitySequence, failureActivity, traceRefs: [] };
    failure.traceRefs.push(trace.traceId);
    failures.set(key, failure);
    await yieldForOnlineRuntime(index);
  }
  return Object.freeze(
    [...failures.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, failure]) => ({
        activitySequence: failure.activitySequence,
        failureActivity: failure.failureActivity,
        traceRefs: failure.traceRefs.sort(),
        count: failure.traceRefs.length,
      })),
  );
}

function patternQuality(
  input: Readonly<{
    traces: readonly ExperienceTrace[];
    mandatoryActivities: readonly string[];
    allActivities: readonly string[];
    orderingConstraints: readonly OrderingConstraint[];
    contradictionRefs: readonly string[];
    environmentCoverage: readonly string[];
    mandatoryThreshold: number;
  }>,
): PatternQuality {
  const successCount = input.traces.filter(
    (trace) => trace.trace.outcomeStatus === 'succeeded',
  ).length;
  const fitness =
    input.mandatoryActivities.length === 0
      ? 0
      : mean(
          input.traces.map((trace) => {
            const activities = new Set<string>(trace.trace.events.map((event) => event.eventType));
            return (
              input.mandatoryActivities.filter((activity) => activities.has(activity)).length /
              input.mandatoryActivities.length
            );
          }),
        );
  const supportedConstraints = input.orderingConstraints.filter(
    (constraint) => constraint.supportRefs.length > constraint.contradictionRefs.length,
  ).length;
  return Object.freeze({
    support: 1,
    successRate: rounded(successCount / input.traces.length),
    traceCoverage: 1,
    fitness: rounded(fitness),
    precisionProxy:
      input.orderingConstraints.length === 0
        ? 0
        : rounded(supportedConstraints / input.orderingConstraints.length),
    environmentCoverage: rounded(
      Math.min(1, input.environmentCoverage.length / input.traces.length),
    ),
    contradictionRate: rounded(input.contradictionRefs.length / input.traces.length),
    generalization: rounded(
      Math.min(1, Math.log2(input.traces.length + 1) / 4) *
        (1 - Math.min(1, input.contradictionRefs.length / input.traces.length)),
    ),
    mandatoryThreshold: input.mandatoryThreshold,
  });
}

function toWorkflowPattern(
  input: Readonly<{
    cohort: CohortDefinition;
    traces: readonly ExperienceTrace[];
    activitySupport: ReadonlyMap<string, Set<string>>;
    discoveredPattern: DiscoveredProcessPattern;
  }>,
): WorkflowPattern {
  const activityPatterns: ActivityPattern[] = [
    ...input.discoveredPattern.mandatoryActivities,
    ...input.discoveredPattern.optionalActivities,
  ]
    .sort()
    .map((activity) => ({
      activity,
      required: input.discoveredPattern.mandatoryActivities.includes(activity),
      supportRate: rounded(
        requiredMapValue(input.activitySupport, activity).size / input.traces.length,
      ),
      capabilityRefs: uniqueSorted(
        input.traces.flatMap((trace) =>
          trace.trace.events
            .filter((event) => event.eventType === activity)
            .flatMap((event) => event.capabilityRefs),
        ),
      ),
    }));
  const dependencyPatterns: DependencyPattern[] = [
    ...input.discoveredPattern.orderingConstraints.map((constraint) => ({
      predecessorActivity: constraint.predecessorActivity,
      successorActivity: constraint.successorActivity,
      relation: constraint.relation,
      supportRefs: constraint.supportRefs,
      contradictionRefs: constraint.contradictionRefs,
    })),
    ...input.discoveredPattern.parallelCandidates.flatMap((candidate) =>
      unorderedPairs(candidate.activityRefs).map(([predecessorActivity, successorActivity]) => ({
        predecessorActivity,
        successorActivity,
        relation: 'parallel' as const,
        supportRefs: candidate.supportRefs,
        contradictionRefs: candidate.contradictionRefs,
      })),
    ),
  ].sort(compareDependencies);
  return createWorkflowPattern({
    workflowPatternId: `workflow-pattern-${digest(input.discoveredPattern.patternId)}`,
    taskTypeId: input.cohort.taskTypeId,
    activityPatterns,
    dependencyPatterns,
    recoveryPatterns: input.discoveredPattern.recoveryBranches,
    sourcePatternRef: input.discoveredPattern.patternId,
    sourceTraceRefs: input.discoveredPattern.supportRefs,
    quality: input.discoveredPattern.quality,
  });
}

function assertTraceInCohort(trace: ExperienceTrace, cohort: CohortDefinition): void {
  if (trace.trace.tenantId !== cohort.tenantId) throw new Error('PROCESS_MINING_TENANT_MISMATCH');
  if (!trace.taskTypeRefs.includes(cohort.taskTypeId)) {
    throw new Error('PROCESS_MINING_TASK_TYPE_MISMATCH');
  }
  if (trace.completeness < cohort.minimumCompleteness) {
    throw new Error('PROCESS_MINING_COMPLETENESS_MISMATCH');
  }
  if (cohort.goalFingerprint !== undefined && trace.goalFingerprint !== cohort.goalFingerprint) {
    throw new Error('PROCESS_MINING_GOAL_FINGERPRINT_MISMATCH');
  }
  if (
    cohort.capabilityFingerprint !== undefined &&
    trace.capabilityFingerprint !== cohort.capabilityFingerprint
  ) {
    throw new Error('PROCESS_MINING_CAPABILITY_FINGERPRINT_MISMATCH');
  }
  if (
    cohort.environmentClass !== undefined &&
    trace.trace.environmentClass !== cohort.environmentClass
  ) {
    throw new Error('PROCESS_MINING_ENVIRONMENT_MISMATCH');
  }
  if (cohort.deviceClass !== undefined && trace.trace.deviceClass !== cohort.deviceClass) {
    throw new Error('PROCESS_MINING_DEVICE_MISMATCH');
  }
  if (
    cohort.timeRange !== undefined &&
    (Date.parse(trace.createdAt) < Date.parse(cohort.timeRange.from) ||
      Date.parse(trace.createdAt) > Date.parse(cohort.timeRange.to))
  ) {
    throw new Error('PROCESS_MINING_TIME_RANGE_MISMATCH');
  }
}

function unorderedPairs(values: readonly string[]): readonly (readonly [string, string])[] {
  const result: (readonly [string, string])[] = [];
  const sorted = [...values].sort();
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex];
      const right = sorted[rightIndex];
      if (left !== undefined && right !== undefined) result.push([left, right]);
    }
  }
  return result;
}

function relationKey(predecessor: string, successor: string): string {
  return `${predecessor}\u001f${successor}`;
}

function splitRelationKey(key: string): readonly [string, string] {
  const separator = key.indexOf('\u001f');
  if (separator < 1 || separator === key.length - 1) {
    throw new Error('PROCESS_MINING_RELATION_KEY_INVALID');
  }
  return [key.slice(0, separator), key.slice(separator + 1)];
}

function compareOrdering(left: OrderingConstraint, right: OrderingConstraint): number {
  return (
    left.predecessorActivity.localeCompare(right.predecessorActivity) ||
    left.successorActivity.localeCompare(right.successorActivity) ||
    left.relation.localeCompare(right.relation)
  );
}

function compareDependencies(left: DependencyPattern, right: DependencyPattern): number {
  return (
    left.predecessorActivity.localeCompare(right.predecessorActivity) ||
    left.successorActivity.localeCompare(right.successorActivity) ||
    left.relation.localeCompare(right.relation)
  );
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function requiredMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) throw new Error('PROCESS_MINING_MAP_VALUE_MISSING');
  return value;
}

async function yieldForOnlineRuntime(index: number): Promise<void> {
  if (index === 0 || index % 128 !== 0) return;
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 40);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PROCESS_MINING_NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('PROCESS_MINING_NON_JSON_VALUE');
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
