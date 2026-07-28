import { createHash } from 'node:crypto';

import {
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  createExperienceTrace,
  type CognitiveSourceRef,
  type ExperienceTrace,
  type ExperienceActivityRef,
  type ExperienceTraceActorType,
  type ExperienceTraceEvent,
  type ExperienceTraceEventType,
  type GoalExperienceEpisode,
} from '../../../domain/src/index.js';
import type { JsonValue } from '../../../domain/src/compiler/contracts.js';

interface EventCandidate {
  readonly sourceKey: string;
  readonly eventType: ExperienceTraceEventType;
  readonly actorType: ExperienceTraceActorType;
  readonly activity?: ExperienceActivityRef;
  readonly occurredAt: string;
  readonly capabilityRefs: readonly string[];
  readonly authorityRefs: readonly string[];
  readonly explicitParentKeys: readonly string[];
  readonly concurrencyGroup?: string;
  readonly branchRef?: string;
  readonly payloadSummary: JsonValue;
  readonly rank: number;
}

export interface ExperienceTraceNormalizationReport {
  readonly trace: ExperienceTrace;
  readonly missingFactCodes: readonly string[];
  readonly redactionCodes: readonly string[];
}

export class ExperienceTraceNormalizer {
  normalize(episode: GoalExperienceEpisode): ExperienceTraceNormalizationReport {
    const snapshot = episode.snapshot;
    const missing = new Set<string>();
    const redactions = new Set(episode.redactionCodes);
    const task = optionalRecord(snapshot['task']);
    const contract = optionalRecord(snapshot['contract']);
    const plans = records(snapshot['planRevisions']);
    const attempts = records(snapshot['attempts']);
    const progress = records(snapshot['progress']);
    const recovery = records(snapshot['recovery']);
    const eventImpacts = records(snapshot['eventImpacts']);
    const interactions = records(snapshot['interactions']);
    const terminal = optionalRecord(snapshot['terminalOutcome']);
    const judgment = optionalRecord(snapshot['userGoalJudgment']);

    if (task === undefined) missing.add('task_missing');
    if (contract === undefined) missing.add('goal_contract_missing');
    if (plans.length === 0) missing.add('plan_revisions_missing');
    if (attempts.length === 0) missing.add('skill_attempts_missing');
    if (terminal === undefined) missing.add('terminal_outcome_missing');

    const tenantId =
      firstString(
        task?.['tenantId'],
        task?.['tenant_id'],
        contract?.['tenantId'],
        contract?.['tenant_id'],
        optionalRecord(snapshot['goal'])?.['tenant_id'],
      ) ?? `unscoped-${digest(`${episode.goalId}:${String(episode.goalVersion)}`)}`;
    if (tenantId.startsWith('unscoped-')) missing.add('tenant_scope_missing');

    const environmentClass =
      firstString(
        task?.['environmentClass'],
        task?.['environment_class'],
        optionalRecord(task?.['runtimeContext'])?.['environmentClass'],
      ) ?? 'unknown-environment';
    if (environmentClass === 'unknown-environment') missing.add('environment_class_missing');
    const deviceClass = firstString(
      task?.['deviceClass'],
      task?.['device_class'],
      optionalRecord(task?.['runtimeContext'])?.['deviceClass'],
    );

    let taskTypeRefs = collectIdentifiers(snapshot, [
      'taskTypeId',
      'task_type_id',
      'taskTypeRef',
      'task_type_ref',
    ]);
    if (taskTypeRefs.length === 0) {
      missing.add('task_type_missing');
      const requestText = firstString(task?.['requestText'], task?.['request_text']);
      if (requestText !== undefined) {
        taskTypeRefs = [
          `request-fingerprint-${digest(requestText.trim().toLocaleLowerCase('en-US'))}`,
        ];
        missing.add('task_type_compatibility_fingerprint');
      }
    }
    const capabilityRefs = collectIdentifiers(snapshot, [
      'capabilityId',
      'capability_id',
      'capabilityRef',
      'capability_ref',
      'requiredCapabilities',
      'required_capabilities',
    ]);
    if (capabilityRefs.length === 0) missing.add('capability_refs_missing');

    const candidates = this.#candidates({
      episode,
      ...(task === undefined ? {} : { task }),
      ...(contract === undefined ? {} : { contract }),
      plans,
      attempts,
      progress,
      recovery,
      eventImpacts,
      interactions,
      ...(terminal === undefined ? {} : { terminal }),
      ...(judgment === undefined ? {} : { judgment }),
      capabilityRefs,
      redactions,
    });
    if (candidates.some((item) => item.activity?.activityKind === 'unknown')) {
      missing.add('activity_identity_unknown');
    }
    if (candidates.length === 0) missing.add('trace_events_missing');
    const candidateSourceKeys = new Set(candidates.map((item) => item.sourceKey));
    if (
      candidates.some((item) =>
        item.explicitParentKeys.some((parentKey) => !candidateSourceKeys.has(parentKey)),
      )
    ) {
      missing.add('activity_parent_evidence_unresolved');
    }
    const events = materializeEvents(candidates);
    const outcomeStatus = determineOutcomeStatus(terminal, judgment);
    const outcomeRef =
      terminal === undefined
        ? undefined
        : (firstString(terminal['outcomeId'], terminal['outcome_id']) ??
          episode.terminalOutcomeRef.replace(/^runtime-terminal-outcome:/u, ''));
    const correctionRefs = uniqueSorted([
      ...interactions.flatMap((item) =>
        stringList(item['correctionIds'] ?? item['correction_ids']),
      ),
      ...episode.sourceRefs
        .filter((source) => source.sourceKind === 'planning_correction')
        .map((source) => source.sourceId),
    ]);
    const sourceHash = episode.sourceHash;
    const goalFingerprint = hash({
      tenantId,
      goalId: episode.goalId,
      goalVersion: episode.goalVersion,
      contractHash:
        contract === undefined
          ? 'missing'
          : (firstString(contract['contractHash'], contract['contract_hash']) ?? hash(contract)),
    });
    const capabilityFingerprint = hash({ tenantId, capabilityRefs });
    const environmentFingerprint = hash({
      tenantId,
      environmentClass,
      ...(deviceClass === undefined ? {} : { deviceClass }),
    });
    const traceId = `trace-${digest(
      canonicalJson({
        sourceEpisodeId: episode.episodeId,
        sourceHash,
        normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
      }),
    )}`;
    const normalizedCompleteness = Number(
      Math.max(0, episode.completeness * (1 - Math.min(missing.size, 8) * 0.05)).toFixed(4),
    );
    const trace = createExperienceTrace({
      traceId,
      sourceEpisodeId: episode.episodeId,
      taskTypeRefs,
      goalFingerprint,
      capabilityFingerprint,
      environmentFingerprint,
      trace: {
        schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
        tenantId,
        events,
        correctionRefs,
        ...(outcomeRef === undefined ? {} : { outcomeRef }),
        outcomeStatus,
        missingFactCodes: [...missing].sort(),
        environmentClass,
        ...(deviceClass === undefined ? {} : { deviceClass }),
      },
      completeness: normalizedCompleteness,
      dataClassification: episode.dataClassification,
      normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
      sourceHash,
      createdAt: episode.createdAt,
    });
    return Object.freeze({
      trace,
      missingFactCodes: Object.freeze([...missing].sort()),
      redactionCodes: Object.freeze([...redactions].sort()),
    });
  }

  #candidates(
    input: Readonly<{
      episode: GoalExperienceEpisode;
      task?: Readonly<Record<string, unknown>>;
      contract?: Readonly<Record<string, unknown>>;
      plans: readonly Readonly<Record<string, unknown>>[];
      attempts: readonly Readonly<Record<string, unknown>>[];
      progress: readonly Readonly<Record<string, unknown>>[];
      recovery: readonly Readonly<Record<string, unknown>>[];
      eventImpacts: readonly Readonly<Record<string, unknown>>[];
      interactions: readonly Readonly<Record<string, unknown>>[];
      terminal?: Readonly<Record<string, unknown>>;
      judgment?: Readonly<Record<string, unknown>>;
      capabilityRefs: readonly string[];
      redactions: Set<string>;
    }>,
  ): readonly EventCandidate[] {
    const candidates: EventCandidate[] = [];
    const sourceRefs = input.episode.sourceRefs;
    const skillGoals = skillGoalsFromPlans(input.plans);
    const recoveryBranchesByReplacementAttempt = recoveryReplacementAttemptBranches(
      input.recovery,
      input.attempts,
    );
    if (input.task !== undefined) {
      candidates.push(
        candidate({
          sourceKey: `task:${sourceId(input.task, ['taskId', 'task_id'], input.episode.goalId)}`,
          eventType: 'goal_created',
          actorType: 'runtime',
          occurredAt: sourceTime(input.task, input.episode.createdAt),
          sourceKind: 'task_request',
          sourceRefs,
          payload: summary(input.task, 'task', input.redactions),
          rank: 10,
        }),
      );
    }
    if (input.contract !== undefined) {
      candidates.push(
        candidate({
          sourceKey: `contract:${sourceId(
            input.contract,
            ['contractHash', 'contract_hash', 'goalId'],
            input.episode.goalId,
          )}`,
          eventType: 'goal_contract_confirmed',
          actorType: 'user',
          occurredAt: sourceTime(input.contract, input.episode.createdAt),
          sourceKind: 'goal_contract',
          sourceRefs,
          payload: summary(input.contract, 'goal_contract', input.redactions),
          rank: 20,
        }),
      );
    }
    for (const [index, plan] of input.plans.entries()) {
      const planId = sourceId(plan, ['planId', 'plan_id'], `plan-${String(index)}`);
      const planKey = `plan:${planId}:created`;
      const planCapabilities = uniqueSorted([
        ...input.capabilityRefs,
        ...collectIdentifiers(plan, [
          'capabilityId',
          'capability_id',
          'requiredCapabilities',
          'required_capabilities',
        ]),
      ]);
      candidates.push(
        candidate({
          sourceKey: planKey,
          eventType: index === 0 ? 'plan_created' : 'plan_revised',
          actorType: 'agent',
          occurredAt: sourceTime(plan, input.episode.createdAt),
          sourceKind: 'plan_revision',
          sourceRefs,
          capabilityRefs: planCapabilities,
          payload: summary(plan, 'plan_revision', input.redactions),
          ...optionalField(
            'branchRef',
            optionalIdentifier(plan['branchRef'] ?? plan['branch_ref']),
          ),
          rank: index === 0 ? 30 : 35,
        }),
      );
      if (isConfirmed(plan)) {
        candidates.push(
          candidate({
            sourceKey: `plan:${planId}:confirmed`,
            eventType: 'plan_confirmed',
            actorType: 'user',
            occurredAt: sourceTime(plan, input.episode.createdAt, ['updatedAt', 'updated_at']),
            sourceKind: 'plan_revision',
            sourceRefs,
            capabilityRefs: planCapabilities,
            explicitParentKeys: [planKey],
            payload: summary(plan, 'plan_confirmation', input.redactions),
            ...optionalField(
              'branchRef',
              optionalIdentifier(plan['branchRef'] ?? plan['branch_ref']),
            ),
            rank: 40,
          }),
        );
      }
    }
    for (const [index, attempt] of input.attempts.entries()) {
      const attemptId = sourceId(attempt, ['attempt_id', 'attemptId'], `attempt-${String(index)}`);
      const startKey = `attempt:${attemptId}:started`;
      const capabilities = uniqueSorted([
        ...stringList(attempt['capability_refs'] ?? attempt['capabilityRefs']),
        ...stringList(attempt['required_capabilities'] ?? attempt['requiredCapabilities']),
      ]);
      const attemptSkillGoalId = firstString(attempt['skill_goal_id'], attempt['skillGoalId']);
      const concurrencyGroup =
        explicitConcurrency(attempt) ??
        (attemptSkillGoalId === undefined
          ? undefined
          : skillGoals.get(attemptSkillGoalId)?.parallelGroup);
      const branchRef =
        optionalIdentifier(attempt['branch_ref'] ?? attempt['branchRef']) ??
        recoveryBranchesByReplacementAttempt.get(attemptId);
      const activity = activityForAttempt(attempt, skillGoals, capabilities);
      candidates.push(
        candidate({
          sourceKey: startKey,
          eventType: 'skill_attempt_started',
          actorType: 'runtime',
          occurredAt: sourceTime(attempt, input.episode.createdAt),
          sourceKind: 'skill_attempt',
          sourceRefs,
          activity,
          capabilityRefs: capabilities,
          explicitParentKeys: explicitParentKeys(attempt),
          payload: summary(attempt, 'skill_attempt', input.redactions),
          ...optionalField('concurrencyGroup', concurrencyGroup),
          ...optionalField('branchRef', branchRef),
          rank: 50,
        }),
      );
      if (isAttemptTerminal(attempt)) {
        candidates.push(
          candidate({
            sourceKey: `attempt:${attemptId}:completed`,
            eventType: attemptFailed(attempt) ? 'workflow_failed' : 'skill_attempt_completed',
            actorType: 'runtime',
            occurredAt: sourceTime(attempt, input.episode.createdAt, [
              'completed_at',
              'completedAt',
              'updated_at',
              'updatedAt',
            ]),
            sourceKind: 'skill_attempt',
            sourceRefs,
            activity,
            capabilityRefs: capabilities,
            explicitParentKeys: [startKey],
            payload: summary(attempt, 'skill_attempt_outcome', input.redactions),
            ...optionalField('concurrencyGroup', concurrencyGroup),
            ...optionalField('branchRef', branchRef),
            rank: 60,
          }),
        );
      }
    }
    for (const [index, item] of input.progress.entries()) {
      const status =
        firstString(item['classification'], item['status'], item['state'])?.toLowerCase() ?? '';
      if (!/wait|block|pause|stalled|regressing/iu.test(status)) continue;
      const progressId = sourceId(
        item,
        ['progress_observation_id', 'progressObservationId'],
        String(index),
      );
      candidates.push(
        candidate({
          sourceKey: `progress:${progressId}`,
          eventType: 'workflow_waiting',
          actorType: 'runtime',
          occurredAt: sourceTime(item, input.episode.createdAt),
          sourceKind: 'workflow_outcome',
          sourceRefs,
          activity: activityForReferencedFact(
            item,
            skillGoals,
            'observation',
            `Observe ${status || 'workflow'} progress`,
            progressId,
          ),
          payload: summary(item, 'progress_observation', input.redactions),
          rank: 65,
        }),
      );
    }
    for (const [index, item] of input.recovery.entries()) {
      const recoveryId = sourceId(
        item,
        ['recovery_decision_id', 'recoveryDecisionId'],
        String(index),
      );
      const failedAttemptId = firstString(item['attempt_id'], item['attemptId']);
      candidates.push(
        candidate({
          sourceKey: `recovery:${recoveryId}`,
          eventType: 'recovery_started',
          actorType: 'runtime',
          occurredAt: sourceTime(item, input.episode.createdAt),
          sourceKind: 'recovery_decision',
          sourceRefs,
          activity: recoveryActivity(item, skillGoals, recoveryId),
          capabilityRefs: stringList(item['required_capabilities'] ?? item['requiredCapabilities']),
          explicitParentKeys: uniqueSorted([
            ...explicitParentKeys(item),
            ...(failedAttemptId === undefined ? [] : [`attempt:${failedAttemptId}:completed`]),
          ]),
          payload: summary(item, 'recovery_decision', input.redactions),
          branchRef: recoveryBranchRef(item, recoveryId),
          rank: 70,
        }),
      );
    }
    for (const [index, item] of input.eventImpacts.entries()) {
      const impactId = sourceId(
        item,
        ['assessment_id', 'assessmentId', 'event_id', 'eventId'],
        String(index),
      );
      candidates.push(
        candidate({
          sourceKey: `business-event:${impactId}`,
          eventType: 'business_event_observed',
          actorType: 'provider',
          occurredAt: sourceTime(item, input.episode.createdAt),
          sourceKind: 'business_event',
          sourceRefs,
          activity: providerObservationActivity(item, impactId),
          payload: summary(item, 'business_event', input.redactions),
          ...optionalField(
            'branchRef',
            optionalIdentifier(item['branch_ref'] ?? item['branchRef']),
          ),
          rank: 75,
        }),
      );
    }
    for (const [index, item] of input.interactions.entries()) {
      const interactionId = sourceId(item, ['episodeId', 'episode_id'], String(index));
      candidates.push(
        candidate({
          sourceKey: `interaction:${interactionId}`,
          eventType: 'human_intervention',
          actorType: 'user',
          occurredAt: sourceTime(item, input.episode.createdAt),
          sourceKind: 'planning_correction',
          sourceRefs,
          activity: {
            activityKey: `human-gate:${interactionId}`,
            activityKind: 'human_gate',
            objectiveSummary: 'Apply confirmed human planning input',
            operationRef: interactionId,
            capabilityRefs: [],
            effectRefs: [],
          },
          payload: summary(item, 'planning_interaction', input.redactions),
          rank: 80,
        }),
      );
    }
    if (input.terminal !== undefined) {
      const failed = determineOutcomeStatus(input.terminal, input.judgment) === 'failed';
      candidates.push(
        candidate({
          sourceKey: `terminal:${sourceId(
            input.terminal,
            ['outcomeId', 'outcome_id'],
            input.episode.terminalOutcomeRef,
          )}`,
          eventType: failed ? 'goal_failed' : 'goal_completed',
          actorType: 'runtime',
          occurredAt: sourceTime(input.terminal, input.episode.createdAt),
          sourceKind: 'runtime_terminal_outcome',
          sourceRefs,
          payload: summary(input.terminal, 'terminal_outcome', input.redactions),
          rank: 100,
        }),
      );
    }
    return candidates;
  }
}

function candidate(
  input: Readonly<{
    sourceKey: string;
    eventType: ExperienceTraceEventType;
    actorType: ExperienceTraceActorType;
    occurredAt: string;
    sourceKind: CognitiveSourceRef['sourceKind'];
    sourceRefs: readonly CognitiveSourceRef[];
    activity?: ExperienceActivityRef;
    capabilityRefs?: readonly string[];
    explicitParentKeys?: readonly string[];
    concurrencyGroup?: string;
    branchRef?: string;
    payload: JsonValue;
    rank: number;
  }>,
): EventCandidate {
  return Object.freeze({
    sourceKey: input.sourceKey,
    eventType: input.eventType,
    actorType: input.actorType,
    ...(input.activity === undefined ? {} : { activity: input.activity }),
    occurredAt: input.occurredAt,
    capabilityRefs: uniqueSorted(input.capabilityRefs ?? []),
    authorityRefs: uniqueSorted(
      input.sourceRefs
        .filter((source) => source.sourceKind === input.sourceKind)
        .map((source) => source.sourceRefId),
    ),
    explicitParentKeys: uniqueSorted(input.explicitParentKeys ?? []),
    ...(input.concurrencyGroup === undefined ? {} : { concurrencyGroup: input.concurrencyGroup }),
    ...(input.branchRef === undefined ? {} : { branchRef: input.branchRef }),
    payloadSummary: input.payload,
    rank: input.rank,
  });
}

function materializeEvents(candidates: readonly EventCandidate[]): readonly ExperienceTraceEvent[] {
  const sorted = [...candidates].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.rank - right.rank ||
      left.sourceKey.localeCompare(right.sourceKey),
  );
  const idBySource = new Map(
    sorted.map((item) => [
      item.sourceKey,
      `trace-event-${digest(
        canonicalJson({
          sourceKey: item.sourceKey,
          eventType: item.eventType,
          occurredAt: item.occurredAt,
        }),
      )}`,
    ]),
  );
  return Object.freeze(
    sorted.map((item, sequence) => ({
      eventId: requireMapValue(idBySource, item.sourceKey),
      sequence,
      occurredAt: item.occurredAt,
      eventType: item.eventType,
      actorType: item.actorType,
      ...(item.activity === undefined ? {} : { activity: item.activity }),
      capabilityRefs: item.capabilityRefs,
      authorityRefs: item.authorityRefs,
      parentEventRefs: uniqueSorted(
        item.explicitParentKeys.flatMap((key) => {
          const parent = idBySource.get(key);
          return parent === undefined ? [] : [parent];
        }),
      ),
      ...(item.concurrencyGroup === undefined ? {} : { concurrencyGroup: item.concurrencyGroup }),
      ...(item.branchRef === undefined ? {} : { branchRef: item.branchRef }),
      payloadSummary: item.payloadSummary,
    })),
  );
}

function summary(
  value: Readonly<Record<string, unknown>>,
  sourceKind: string,
  redactions: Set<string>,
): JsonValue {
  const allowedKeys = [
    'status',
    'state',
    'phase',
    'revision',
    'revision_kind',
    'revisionKind',
    'reason_code',
    'reasonCode',
    'action',
    'confidence',
    'controlStatus',
    'control_status',
    'outcome_kind',
    'outcomeKind',
    'attempt_number',
    'attemptNumber',
    'execution_mode',
    'executionMode',
    'classification',
  ];
  const properties = Object.fromEntries(
    allowedKeys.flatMap((key) => {
      const item = value[key];
      if (
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))
      ) {
        return [[key, sanitizeScalar(item, redactions)]];
      }
      return [];
    }),
  );
  return {
    sourceKind,
    properties,
    sourceFactHash: hash(redactForHash(value, redactions, 0)),
  };
}

function redactForHash(value: unknown, redactions: Set<string>, depth: number): JsonValue {
  if (depth > 16) {
    redactions.add('large_payload_abstracted');
    return '[ABSTRACTED_DEPTH]';
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === 'string') return sanitizeScalar(value, redactions);
  if (Array.isArray(value)) {
    if (value.length > 128) redactions.add('large_payload_abstracted');
    return value.slice(0, 128).map((item) => redactForHash(item, redactions, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 128);
    if (Object.keys(value).length > entries.length) redactions.add('large_payload_abstracted');
    return Object.fromEntries(
      entries.flatMap(([key, item]) => {
        if (isProhibitedKey(key)) {
          redactions.add(
            /reasoning|chain[_-]?of[_-]?thought/iu.test(key)
              ? 'private_reasoning_excluded'
              : /email|phone|address|full[_-]?name|user[_-]?id/iu.test(key)
                ? 'unnecessary_pii_excluded'
                : 'credentials_excluded',
          );
          return [];
        }
        return [[key, redactForHash(item, redactions, depth + 1)]];
      }),
    );
  }
  return '[ABSTRACTED_NON_JSON]';
}

function sanitizeScalar(value: string | number | boolean, redactions: Set<string>): JsonValue {
  if (typeof value !== 'string') return value;
  let sanitized = value;
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/iu.test(sanitized)) {
    redactions.add('credentials_excluded');
    sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]');
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(sanitized)) {
    redactions.add('unnecessary_pii_excluded');
    sanitized = sanitized.replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      '[REDACTED_EMAIL]',
    );
  }
  if (sanitized.length > 512) {
    redactions.add('large_payload_abstracted');
    sanitized = `${sanitized.slice(0, 512)}[TRUNCATED]`;
  }
  return sanitized;
}

function isProhibitedKey(key: string): boolean {
  return /credential|password|secret|token|authorization|api[_-]?key|private[_-]?reasoning|chain[_-]?of[_-]?thought|reasoning[_-]?content|^(?:email|phone|address|full[_-]?name|user[_-]?id)$/iu.test(
    key,
  );
}

function determineOutcomeStatus(
  terminal: Readonly<Record<string, unknown>> | undefined,
  judgment: Readonly<Record<string, unknown>> | undefined,
): ExperienceTrace['trace']['outcomeStatus'] {
  const judgmentStatus =
    firstString(
      judgment?.['status'],
      optionalRecord(judgment?.['decision'])?.['status'],
      terminal?.['status'],
      terminal?.['controlStatus'],
      terminal?.['control_status'],
    )?.toLowerCase() ?? '';
  if (/achieved|completed|succeeded|success/u.test(judgmentStatus)) return 'succeeded';
  if (judgmentStatus.includes('partial')) return 'partial';
  if (/failed|not_achieved|canceled|cancelled|capability_gap/u.test(judgmentStatus))
    return 'failed';
  return 'unknown';
}

function isConfirmed(plan: Readonly<Record<string, unknown>>): boolean {
  const status = firstString(plan['status'], plan['state'])?.toLowerCase();
  return status !== undefined && /confirmed|accepted|active|completed/u.test(status);
}

function isAttemptTerminal(attempt: Readonly<Record<string, unknown>>): boolean {
  const status = firstString(attempt['status'], attempt['state'])?.toLowerCase();
  return status !== undefined && /completed|succeeded|failed|canceled|cancelled/u.test(status);
}

function attemptFailed(attempt: Readonly<Record<string, unknown>>): boolean {
  const status = firstString(attempt['status'], attempt['state'])?.toLowerCase() ?? '';
  return /failed|canceled|cancelled/u.test(status);
}

interface FormalSkillGoalActivity {
  readonly skillGoalId: string;
  readonly objectiveSummary: string;
  readonly sourcePlanNodeRef?: string;
  readonly parallelGroup?: string;
  readonly capabilityRefs: readonly string[];
  readonly effectRefs: readonly string[];
}

function skillGoalsFromPlans(
  plans: readonly Readonly<Record<string, unknown>>[],
): ReadonlyMap<string, FormalSkillGoalActivity> {
  const result = new Map<string, FormalSkillGoalActivity>();
  for (const planRevision of plans) {
    const plan = optionalRecord(planRevision['plan']) ?? planRevision;
    const skillGoals = records(plan['skillGoals'] ?? plan['skill_goals']);
    const partialOrderGroups = partialOrderParallelGroups(plan, skillGoals);
    const declaredGroups = declaredParallelGroups(planRevision, plan);
    for (const skillGoal of skillGoals) {
      const skillGoalId = firstString(skillGoal['skillGoalId'], skillGoal['skill_goal_id']);
      if (skillGoalId === undefined) continue;
      const sourcePlanNodeRef = firstString(
        skillGoal['planNodeRef'],
        skillGoal['plan_node_ref'],
        skillGoal['nodeKey'],
        skillGoal['node_key'],
      );
      result.set(
        skillGoalId,
        Object.freeze({
          skillGoalId,
          objectiveSummary:
            firstString(
              skillGoal['requiredResult'],
              skillGoal['required_result'],
              skillGoal['objective'],
              skillGoal['description'],
            ) ?? `Satisfy formal Skill Goal ${skillGoalId}`,
          ...(sourcePlanNodeRef === undefined ? {} : { sourcePlanNodeRef }),
          ...optionalField(
            'parallelGroup',
            declaredGroups.get(skillGoalId) ?? partialOrderGroups.get(skillGoalId),
          ),
          capabilityRefs: collectIdentifiers(skillGoal, [
            'capabilityNeeds',
            'capability_needs',
            'capabilityRefs',
            'capability_refs',
          ]),
          effectRefs: collectIdentifiers(skillGoal, [
            'requiredEffectRefs',
            'required_effect_refs',
            'effectRefs',
            'effect_refs',
          ]),
        }),
      );
    }
  }
  return result;
}

function declaredParallelGroups(
  planRevision: Readonly<Record<string, unknown>>,
  plan: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const owner of [planRevision, plan]) {
    const metadata = optionalRecord(owner['planningMetadata'] ?? owner['planning_metadata']);
    const groups =
      optionalRecord(metadata?.['parallelGroups'] ?? metadata?.['parallel_groups']) ??
      optionalRecord(owner['parallelGroups'] ?? owner['parallel_groups']);
    if (groups === undefined) continue;
    for (const [declaredKey, value] of Object.entries(groups).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const activityIds = stringList(value);
      if (activityIds.length < 2) continue;
      const groupKey =
        optionalIdentifier(declaredKey) ??
        `parallel-declared:${digest(canonicalJson(activityIds))}`;
      for (const activityId of activityIds) result.set(activityId, groupKey);
    }
  }
  return result;
}

function partialOrderParallelGroups(
  plan: Readonly<Record<string, unknown>>,
  skillGoals: readonly Readonly<Record<string, unknown>>[],
): ReadonlyMap<string, string> {
  const ids = uniqueSorted(
    skillGoals.flatMap((skillGoal) => {
      const id = firstString(skillGoal['skillGoalId'], skillGoal['skill_goal_id']);
      return id === undefined ? [] : [id];
    }),
  );
  const idSet = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const dependency of records(plan['dependencies'])) {
    const predecessor = firstString(
      dependency['predecessorSkillGoalId'],
      dependency['predecessor_skill_goal_id'],
    );
    const successor = firstString(
      dependency['successorSkillGoalId'],
      dependency['successor_skill_goal_id'],
    );
    if (
      predecessor === undefined ||
      successor === undefined ||
      predecessor === successor ||
      !idSet.has(predecessor) ||
      !idSet.has(successor) ||
      outgoing.get(predecessor)?.includes(successor) === true
    ) {
      continue;
    }
    outgoing.get(predecessor)?.push(successor);
    indegree.set(successor, (indegree.get(successor) ?? 0) + 1);
  }
  const groups = new Map<string, string>();
  const remaining = new Set(ids);
  while (remaining.size > 0) {
    const wave = [...remaining].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
    if (wave.length === 0) return new Map();
    if (wave.length > 1) {
      const groupKey = `parallel-partial-order:${digest(canonicalJson(wave))}`;
      for (const id of wave) groups.set(id, groupKey);
    }
    for (const id of wave) {
      remaining.delete(id);
      for (const successor of outgoing.get(id) ?? []) {
        indegree.set(successor, (indegree.get(successor) ?? 0) - 1);
      }
    }
  }
  return groups;
}

function activityForAttempt(
  attempt: Readonly<Record<string, unknown>>,
  skillGoals: ReadonlyMap<string, FormalSkillGoalActivity>,
  attemptCapabilities: readonly string[],
): ExperienceActivityRef {
  const attemptId = sourceId(attempt, ['attempt_id', 'attemptId'], 'attempt-unknown');
  const skillGoalId = firstString(attempt['skill_goal_id'], attempt['skillGoalId']);
  const skillGoal = skillGoalId === undefined ? undefined : skillGoals.get(skillGoalId);
  const sourcePlanNodeRef =
    firstString(
      attempt['plan_node_ref'],
      attempt['planNodeRef'],
      attempt['node_key'],
      attempt['nodeKey'],
    ) ?? skillGoal?.sourcePlanNodeRef;
  const operationRef = firstString(
    attempt['provider_operation_ref'],
    attempt['providerOperationRef'],
    attempt['operation_ref'],
    attempt['operationRef'],
  );
  const activityKind =
    skillGoalId !== undefined
      ? ('skill_goal' as const)
      : operationRef !== undefined
        ? ('provider_operation' as const)
        : ('unknown' as const);
  const activityKey =
    skillGoalId !== undefined
      ? `skill-goal:${skillGoalId}`
      : operationRef !== undefined
        ? `provider-operation:${operationRef}`
        : `unknown-attempt:${attemptId}`;
  return Object.freeze({
    activityKey,
    activityKind,
    objectiveSummary:
      skillGoal?.objectiveSummary ??
      firstString(attempt['objective'], attempt['operation_name'], attempt['operationName']) ??
      `Execute formal attempt ${attemptId}`,
    ...(skillGoalId === undefined
      ? {}
      : {
          ...(sourcePlanNodeRef === undefined ? {} : { sourcePlanNodeRef }),
          sourceSkillGoalRef: activityKey,
        }),
    sourceAttemptRef: attemptId,
    ...(operationRef === undefined ? {} : { operationRef }),
    capabilityRefs: uniqueSorted([...attemptCapabilities, ...(skillGoal?.capabilityRefs ?? [])]),
    effectRefs: uniqueSorted([
      ...(skillGoal?.effectRefs ?? []),
      ...collectIdentifiers(attempt, [
        'effectRefs',
        'effect_refs',
        'requiredEffectRefs',
        'required_effect_refs',
      ]),
    ]),
  });
}

function activityForReferencedFact(
  fact: Readonly<Record<string, unknown>>,
  skillGoals: ReadonlyMap<string, FormalSkillGoalActivity>,
  activityKind: ExperienceActivityRef['activityKind'],
  fallbackObjective: string,
  fallbackOperationRef: string,
): ExperienceActivityRef {
  const skillGoalId = firstString(fact['skill_goal_id'], fact['skillGoalId']);
  const attemptId = firstString(fact['attempt_id'], fact['attemptId']);
  const skillGoal = skillGoalId === undefined ? undefined : skillGoals.get(skillGoalId);
  const sourcePlanNodeRef =
    firstString(fact['plan_node_ref'], fact['planNodeRef'], fact['node_key'], fact['nodeKey']) ??
    skillGoal?.sourcePlanNodeRef;
  return Object.freeze({
    activityKey:
      skillGoalId === undefined && attemptId === undefined
        ? `progress-observation:${fallbackOperationRef}`
        : skillGoalId === undefined
          ? `attempt-observation:${String(attemptId)}`
          : `skill-goal:${skillGoalId}`,
    activityKind: skillGoalId === undefined ? activityKind : 'skill_goal',
    objectiveSummary: skillGoal?.objectiveSummary ?? fallbackObjective,
    ...(skillGoalId === undefined
      ? {}
      : {
          ...(sourcePlanNodeRef === undefined ? {} : { sourcePlanNodeRef }),
          sourceSkillGoalRef: `skill-goal:${skillGoalId}`,
        }),
    ...(attemptId === undefined ? {} : { sourceAttemptRef: attemptId }),
    ...(skillGoalId === undefined && attemptId === undefined
      ? { operationRef: fallbackOperationRef }
      : {}),
    capabilityRefs: uniqueSorted([
      ...(skillGoal?.capabilityRefs ?? []),
      ...collectIdentifiers(fact, [
        'capabilityId',
        'capability_id',
        'capabilityRef',
        'capability_ref',
        'capabilityRefs',
        'capability_refs',
        'requiredCapabilities',
        'required_capabilities',
      ]),
    ]),
    effectRefs: uniqueSorted([
      ...(skillGoal?.effectRefs ?? []),
      ...collectIdentifiers(fact, ['effectRefs', 'effect_refs']),
    ]),
  });
}

function recoveryActivity(
  recovery: Readonly<Record<string, unknown>>,
  skillGoals: ReadonlyMap<string, FormalSkillGoalActivity>,
  recoveryId: string,
): ExperienceActivityRef {
  const skillGoalId = firstString(recovery['skill_goal_id'], recovery['skillGoalId']);
  const attemptId = firstString(recovery['attempt_id'], recovery['attemptId']);
  const skillGoal = skillGoalId === undefined ? undefined : skillGoals.get(skillGoalId);
  const sourcePlanNodeRef =
    firstString(
      recovery['plan_node_ref'],
      recovery['planNodeRef'],
      recovery['node_key'],
      recovery['nodeKey'],
    ) ?? skillGoal?.sourcePlanNodeRef;
  const action = firstString(recovery['action'], recovery['reason_code'], recovery['reasonCode']);
  return Object.freeze({
    activityKey: `recovery:${skillGoalId ?? recoveryId}:${action ?? 'resume'}`,
    activityKind: 'skill_goal',
    objectiveSummary:
      action === undefined
        ? `Recover formal activity ${skillGoalId ?? recoveryId}`
        : `Recover ${skillGoalId ?? recoveryId} via ${action}`,
    ...(skillGoalId === undefined
      ? {}
      : {
          ...(sourcePlanNodeRef === undefined ? {} : { sourcePlanNodeRef }),
          sourceSkillGoalRef: `skill-goal:${skillGoalId}`,
        }),
    ...(attemptId === undefined ? {} : { sourceAttemptRef: attemptId }),
    operationRef: recoveryId,
    capabilityRefs: uniqueSorted([
      ...(skillGoal?.capabilityRefs ?? []),
      ...collectIdentifiers(recovery, [
        'required_capabilities',
        'requiredCapabilities',
        'capability_refs',
        'capabilityRefs',
      ]),
    ]),
    effectRefs: uniqueSorted([
      ...(skillGoal?.effectRefs ?? []),
      ...collectIdentifiers(recovery, ['effect_refs', 'effectRefs']),
    ]),
  });
}

function recoveryReplacementAttemptBranches(
  recoveryFacts: readonly Readonly<Record<string, unknown>>[],
  attempts: readonly Readonly<Record<string, unknown>>[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [index, recovery] of recoveryFacts.entries()) {
    const action = firstString(recovery['action'])?.toLowerCase();
    if (action !== 'replacement_attempt') continue;
    const recoveryId = sourceId(
      recovery,
      ['recovery_decision_id', 'recoveryDecisionId'],
      String(index),
    );
    const decision = optionalRecord(recovery['decision_json'] ?? recovery['decisionJson']);
    const explicitReplacementAttemptId = firstString(
      recovery['replacement_attempt_id'],
      recovery['replacementAttemptId'],
      recovery['next_attempt_id'],
      recovery['nextAttemptId'],
      decision?.['replacement_attempt_id'],
      decision?.['replacementAttemptId'],
      decision?.['next_attempt_id'],
      decision?.['nextAttemptId'],
    );
    const failedAttemptId = firstString(recovery['attempt_id'], recovery['attemptId']);
    const skillGoalId = firstString(recovery['skill_goal_id'], recovery['skillGoalId']);
    const recoveryOccurredAt = Date.parse(sourceTime(recovery, '1970-01-01T00:00:00.000Z'));
    const inferredReplacement = [...attempts]
      .filter((attempt) => {
        const attemptId = firstString(attempt['attempt_id'], attempt['attemptId']);
        if (attemptId === undefined || attemptId === failedAttemptId) return false;
        if (
          skillGoalId !== undefined &&
          firstString(attempt['skill_goal_id'], attempt['skillGoalId']) !== skillGoalId
        ) {
          return false;
        }
        return Date.parse(sourceTime(attempt, '1970-01-01T00:00:00.000Z')) >= recoveryOccurredAt;
      })
      .sort(
        (left, right) =>
          Date.parse(sourceTime(left, '1970-01-01T00:00:00.000Z')) -
            Date.parse(sourceTime(right, '1970-01-01T00:00:00.000Z')) ||
          sourceId(left, ['attempt_id', 'attemptId'], '').localeCompare(
            sourceId(right, ['attempt_id', 'attemptId'], ''),
          ),
      )
      .map((attempt) => firstString(attempt['attempt_id'], attempt['attemptId']))
      .find((attemptId) => attemptId !== undefined);
    const replacementAttemptId = explicitReplacementAttemptId ?? inferredReplacement;
    if (replacementAttemptId !== undefined) {
      result.set(replacementAttemptId, recoveryBranchRef(recovery, recoveryId));
    }
  }
  return result;
}

function recoveryBranchRef(
  recovery: Readonly<Record<string, unknown>>,
  recoveryId: string,
): string {
  return (
    optionalIdentifier(recovery['branch_ref'] ?? recovery['branchRef']) ?? `recovery:${recoveryId}`
  );
}

function providerObservationActivity(
  fact: Readonly<Record<string, unknown>>,
  fallbackOperationRef: string,
): ExperienceActivityRef {
  const operationRef =
    firstString(
      fact['provider_operation_ref'],
      fact['providerOperationRef'],
      fact['operation_ref'],
      fact['operationRef'],
      fact['event_id'],
      fact['eventId'],
    ) ?? fallbackOperationRef;
  return Object.freeze({
    activityKey: `provider-observation:${operationRef}`,
    activityKind: 'observation',
    objectiveSummary:
      firstString(
        fact['objective'],
        fact['classification'],
        fact['event_type'],
        fact['eventType'],
      ) ?? `Observe provider operation ${operationRef}`,
    operationRef,
    capabilityRefs: collectIdentifiers(fact, [
      'capability_refs',
      'capabilityRefs',
      'capability_id',
      'capabilityId',
    ]),
    effectRefs: collectIdentifiers(fact, ['effect_refs', 'effectRefs']),
  });
}

function explicitConcurrency(value: Readonly<Record<string, unknown>>): string | undefined {
  return optionalIdentifier(
    value['concurrency_group'] ??
      value['concurrencyGroup'] ??
      value['parallel_group'] ??
      value['parallelGroup'],
  );
}

function explicitParentKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
  return uniqueSorted(
    [
      firstString(value['parent_event_ref'], value['parentEventRef']),
      ...stringList(value['parent_event_refs'] ?? value['parentEventRefs']),
    ].flatMap((item) => (item === undefined ? [] : [item])),
  );
}

function collectIdentifiers(value: unknown, keys: readonly string[]): readonly string[] {
  const collected: string[] = [];
  walk(value, 0, (key, item) => {
    if (!keys.includes(key)) return;
    if (typeof item === 'string') {
      const normalized = optionalIdentifier(item);
      if (normalized !== undefined) collected.push(normalized);
    } else {
      collected.push(...stringList(item));
    }
  });
  return uniqueSorted(collected);
}

function walk(value: unknown, depth: number, visitor: (key: string, value: unknown) => void): void {
  if (depth > 16 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 4096)) walk(item, depth + 1, visitor);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    visitor(key, item);
    walk(item, depth + 1, visitor);
  }
}

function sourceTime(
  value: Readonly<Record<string, unknown>>,
  fallback: string,
  preferred: readonly string[] = [],
): string {
  for (const key of [
    ...preferred,
    'occurredAt',
    'occurred_at',
    'startedAt',
    'started_at',
    'observedAt',
    'observed_at',
    'createdAt',
    'created_at',
    'updatedAt',
    'updated_at',
    'committedAt',
    'committed_at',
  ]) {
    const candidate = value[key];
    if (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))) {
      return new Date(candidate).toISOString();
    }
    if (candidate instanceof Date && Number.isFinite(candidate.getTime())) {
      return candidate.toISOString();
    }
  }
  return fallback;
}

function sourceId(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  fallback: string,
): string {
  return firstString(...keys.map((key) => value[key])) ?? fallback;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  const result: Readonly<Record<string, unknown>>[] = [];
  for (const item of value) {
    const record = optionalRecord(item);
    if (record !== undefined) result.push(record);
  }
  return result;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return uniqueSorted(
    value.flatMap((item) => {
      const normalized = optionalIdentifier(item);
      return normalized === undefined ? [] : [normalized];
    }),
  );
}

function optionalIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 && !containsControlCharacter(normalized)
    ? normalized
    : undefined;
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    const normalized = optionalIdentifier(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function requireMapValue(map: ReadonlyMap<string, string>, key: string): string {
  const value = map.get(key);
  if (value === undefined) throw new Error('EXPERIENCE_TRACE_EVENT_ID_MISSING');
  return value;
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Readonly<Record<Key, Value>> | Readonly<Record<string, never>> {
  return value === undefined ? {} : ({ [key]: value } as Readonly<Record<Key, Value>>);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
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
    if (!Number.isFinite(value)) throw new Error('EXPERIENCE_COMPILATION_NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('EXPERIENCE_COMPILATION_NON_JSON_VALUE');
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
