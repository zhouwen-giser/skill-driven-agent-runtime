import { DomainError } from './errors.js';
import { snapshotSkillUsagePlanPolicy, type SkillUsagePlanPolicy } from './skill-usage-planning.js';

export const SKILL_EXECUTION_STATUSES = [
  'selected',
  'planning',
  'executing',
  'waiting_external',
  'completed',
  'failed',
  'cancelled',
  'degraded',
] as const;

export type SkillExecutionStatus = (typeof SKILL_EXECUTION_STATUSES)[number];

export const SKILL_EXECUTION_EVENT_TYPES = [
  'skill.discovered',
  'skill.applicability_assessed',
  'skill.selected',
  'skill.mode_selected',
  'skill.context_missing',
  'skill.context_resolved',
  'skill.composition_started',
  'skill.child_selected',
  'skill.plan_generated',
  'skill.procedure_compiled',
  'skill.plan_compliance_passed',
  'skill.plan_compliance_failed',
  'skill.execution_started',
  'skill.execution_waiting_external',
  'skill.execution_degraded',
  'skill.execution_completed',
  'skill.execution_failed',
  'skill.hard_gate_triggered',
  'skill.human_intervention',
  'skill.patch_candidate_created',
] as const;

export type SkillExecutionEventType = (typeof SKILL_EXECUTION_EVENT_TYPES)[number];

export type SkillExecutionReferenceKind =
  | 'provider'
  | 'resource'
  | 'remote_task_binding'
  | 'evidence'
  | 'hard_gate'
  | 'human_intervention'
  | 'outcome';

export interface SkillExecutionRecord {
  readonly executionId: string;
  readonly parentExecutionId?: string;
  readonly taskId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly skillId: string;
  readonly skillVersion: number;
  /** Selection record ID or a stable composition/call selection reference. */
  readonly selectionRef: string;
  readonly applicabilityStatus: 'satisfied' | 'partial' | 'unsatisfied' | 'unknown';
  readonly usagePolicy: SkillUsagePlanPolicy;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly createdAt: string;
}

export interface SkillExecutionEvent {
  readonly eventId: string;
  readonly executionId: string;
  readonly eventType: SkillExecutionEventType;
  readonly statusAfter?: SkillExecutionStatus;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface SkillExecutionReference {
  readonly linkId: string;
  readonly executionId: string;
  readonly kind: SkillExecutionReferenceKind;
  readonly referenceId: string;
  readonly referenceType: string;
  readonly sourceSystem: string;
  readonly uri?: string;
  readonly checksum?: string;
  readonly producedAt?: string;
  readonly producerRefs: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface SkillExecutionView extends SkillExecutionRecord {
  readonly status: SkillExecutionStatus;
  readonly events: readonly SkillExecutionEvent[];
  readonly references: readonly SkillExecutionReference[];
}

export function createSkillExecutionRecord(input: SkillExecutionRecord): SkillExecutionRecord {
  const policy = snapshotSkillUsagePlanPolicy(input.usagePolicy);
  if (policy.skill.skillId !== input.skillId || policy.skill.skillVersion !== input.skillVersion)
    invalid('Skill execution identity must match its selected Usage policy.');
  return Object.freeze({
    executionId: identifier(input.executionId, 'execution ID'),
    ...(input.parentExecutionId === undefined
      ? {}
      : { parentExecutionId: identifier(input.parentExecutionId, 'parent execution ID') }),
    taskId: identifier(input.taskId, 'Task ID'),
    goalId: identifier(input.goalId, 'Goal ID'),
    goalVersion: positiveInteger(input.goalVersion, 'Goal version'),
    skillId: identifier(input.skillId, 'Skill ID'),
    skillVersion: positiveInteger(input.skillVersion, 'Skill version'),
    selectionRef: identifier(input.selectionRef, 'selection reference'),
    applicabilityStatus: enumValue(
      input.applicabilityStatus,
      ['satisfied', 'partial', 'unsatisfied', 'unknown'] as const,
      'applicability status',
    ),
    usagePolicy: policy,
    workflowPlanId: identifier(input.workflowPlanId, 'Workflow plan ID'),
    workflowDefinitionId: identifier(input.workflowDefinitionId, 'Workflow definition ID'),
    workflowDefinitionVersion: positiveInteger(
      input.workflowDefinitionVersion,
      'Workflow definition version',
    ),
    createdAt: timestamp(input.createdAt, 'createdAt'),
  });
}

export function createSkillExecutionEvent(input: SkillExecutionEvent): SkillExecutionEvent {
  return Object.freeze({
    eventId: identifier(input.eventId, 'event ID'),
    executionId: identifier(input.executionId, 'execution ID'),
    eventType: enumValue(input.eventType, SKILL_EXECUTION_EVENT_TYPES, 'event type'),
    ...(input.statusAfter === undefined
      ? {}
      : { statusAfter: enumValue(input.statusAfter, SKILL_EXECUTION_STATUSES, 'status') }),
    summary: boundedText(input.summary, 'event summary', 8_192),
    details: snapshotJsonRecord(input.details),
    occurredAt: timestamp(input.occurredAt, 'occurredAt'),
  });
}

export function createSkillExecutionReference(
  input: SkillExecutionReference,
): SkillExecutionReference {
  if (input.checksum !== undefined && !/^[0-9a-f]{64}$/u.test(input.checksum))
    invalid('Evidence checksum must be a lowercase SHA-256 digest.');
  const producerRefs = input.producerRefs.map((item) => identifier(item, 'producer reference'));
  if (new Set(producerRefs).size !== producerRefs.length)
    invalid('Producer references must be unique.');
  return Object.freeze({
    linkId: identifier(input.linkId, 'link ID'),
    executionId: identifier(input.executionId, 'execution ID'),
    kind: enumValue(
      input.kind,
      [
        'provider',
        'resource',
        'remote_task_binding',
        'evidence',
        'hard_gate',
        'human_intervention',
        'outcome',
      ] as const,
      'reference kind',
    ),
    referenceId: identifier(input.referenceId, 'reference ID'),
    referenceType: identifier(input.referenceType, 'reference type'),
    sourceSystem: identifier(input.sourceSystem, 'source system'),
    ...(input.uri === undefined ? {} : { uri: boundedText(input.uri, 'URI', 4_096) }),
    ...(input.checksum === undefined ? {} : { checksum: input.checksum }),
    ...(input.producedAt === undefined
      ? {}
      : { producedAt: timestamp(input.producedAt, 'producedAt') }),
    producerRefs: Object.freeze(producerRefs),
    metadata: snapshotJsonRecord(input.metadata),
    createdAt: timestamp(input.createdAt, 'createdAt'),
  });
}

export function assertSkillExecutionStatusTransition(
  current: SkillExecutionStatus,
  next: SkillExecutionStatus,
): void {
  const allowed: Readonly<Record<SkillExecutionStatus, readonly SkillExecutionStatus[]>> = {
    selected: ['planning', 'failed', 'cancelled'],
    planning: ['executing', 'failed', 'cancelled'],
    executing: ['waiting_external', 'completed', 'failed', 'cancelled', 'degraded'],
    waiting_external: ['executing', 'completed', 'failed', 'cancelled', 'degraded'],
    completed: [],
    failed: [],
    cancelled: [],
    degraded: [],
  };
  if (!allowed[current].includes(next))
    invalid(`Skill execution cannot transition from ${current} to ${next}.`);
}

export function isTerminalSkillExecutionStatus(status: SkillExecutionStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'degraded'].includes(status);
}

function identifier(value: string, label: string): string {
  return boundedText(value, label, 512);
}

function boundedText(value: string, label: string, limit: number): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > limit)
    invalid(`${label} must contain 1-${String(limit)} characters.`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${label} must be a positive integer.`);
  return value;
}

function timestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) invalid(`${label} must be an ISO timestamp.`);
  return value;
}

function enumValue<const T extends string>(value: T, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value)) invalid(`Skill execution ${label} is unsupported.`);
  return value;
}

function snapshotJsonRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const snapshot = snapshotJson(value, new WeakSet(), 0);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== 'object')
    invalid('Skill execution metadata must be a plain JSON object.');
  return snapshot as Readonly<Record<string, unknown>>;
}

function snapshotJson(value: unknown, active: WeakSet<object>, depth: number): unknown {
  if (depth > 32) invalid('Skill execution metadata exceeds its JSON depth boundary.');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object') invalid('Skill execution metadata must contain finite JSON data.');
  if (active.has(value)) invalid('Skill execution metadata must be acyclic.');
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotJson(item, active, depth + 1)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      invalid('Skill execution metadata must contain plain JSON objects.');
    for (const key of Object.keys(value)) {
      if (
        /^(?:chainOfThought|chain_of_thought|privateReasoning|private_reasoning|cot)$/iu.test(key)
      )
        invalid('Private reasoning fields are forbidden in Skill execution evidence.');
      if (
        /^(?:password|secret|token|authorization|apiKey|api_key|credential|credentials)$/iu.test(
          key,
        )
      )
        invalid('Credential fields are forbidden in Skill execution evidence.');
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, snapshotJson(item, active, depth + 1)]),
      ),
    );
  } finally {
    active.delete(value);
  }
}

function invalid(message: string): never {
  throw new DomainError('SKILL_EXECUTION_RECORD_INVALID', message);
}
