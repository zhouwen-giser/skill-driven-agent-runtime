import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';
import { createSkillUsageSpecification, type SkillUsageSpecification } from './skill-usage.js';
import type { SkillOutcomeSpecification } from './user-goal-runtime.js';

export type SkillStatus =
  'draft' | 'validating' | 'enabled' | 'disabled' | 'deprecated' | 'validation_failed';
export interface ToolReference {
  readonly serverId: string;
  readonly toolName: string;
}
export interface SkillToolPolicy {
  readonly required: readonly ToolReference[];
  readonly optional: readonly ToolReference[];
  readonly forbidden: readonly ToolReference[];
}
export interface SkillRuntimePolicy {
  readonly autoConfirmPlan: boolean;
  readonly maxReplans?: number;
  readonly maxDurationSeconds?: number;
  readonly maxLlmCalls?: number;
  readonly maxMcpCalls?: number;
  readonly maxCost?: number;
  readonly pauseReplanThresholdSeconds?: number;
  readonly cancelStrategy?: 'wait_current' | 'try_interrupt' | 'cleanup_workflow';
  readonly compensationGuidance?: string;
}
export interface SkillVersion {
  readonly skillId: string;
  readonly version: number;
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly workflowGuidance: string;
  readonly outputInstruction: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly toolPolicy: SkillToolPolicy;
  readonly runtimePolicy: SkillRuntimePolicy;
  readonly status: SkillStatus;
  readonly sourceKind: 'admin' | 'a2a_draft' | 'experience_evolution' | 'manual_correction';
  readonly validationPassed: boolean;
  readonly previousVersion?: number;
  readonly createdAt: string;
  readonly usageSpecification?: SkillUsageSpecification;
  readonly outcomeSpecification?: SkillOutcomeSpecification;
}
export interface Skill {
  readonly skillId: string;
  readonly currentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createSkillVersion(input: SkillVersion): SkillVersion {
  const skillId = requireIdentifier(input.skillId, 'SKILL_ID_REQUIRED');
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new DomainError('SKILL_VERSION_INVALID', 'Skill version must be a positive integer.');
  }
  if (input.name.trim() === '' || input.summary.trim() === '' || input.description.trim() === '') {
    throw new DomainError(
      'SKILL_DESCRIPTION_REQUIRED',
      'Skill name, summary and description are required.',
    );
  }
  assertToolPolicy(input.toolPolicy);
  assertRuntimePolicy(input.runtimePolicy);
  if (input.status === 'enabled' && !input.validationPassed) {
    throw new DomainError(
      'SKILL_ENABLE_REQUIRES_VALIDATION',
      'Enabled Skill versions require validation.',
    );
  }
  if (input.status === 'enabled' && input.outcomeSpecification === undefined)
    throw new DomainError(
      'SKILL_ENABLE_REQUIRES_OUTCOME_SPEC',
      'Enabled Skill versions require an explicit SkillOutcomeSpecification.',
    );
  const outcomeSpecification =
    input.outcomeSpecification === undefined
      ? undefined
      : createSkillOutcomeSpecification(input.outcomeSpecification, input.skillId, input.version);
  return Object.freeze({
    ...input,
    skillId,
    name: input.name.trim(),
    summary: input.summary.trim(),
    description: input.description.trim(),
    capabilities: Object.freeze([...input.capabilities]),
    inputSchema: snapshotSkillJson(input.inputSchema),
    outputSchema: snapshotSkillJson(input.outputSchema),
    toolPolicy: Object.freeze({
      required: Object.freeze(
        input.toolPolicy.required.map((reference) => Object.freeze({ ...reference })),
      ),
      optional: Object.freeze(
        input.toolPolicy.optional.map((reference) => Object.freeze({ ...reference })),
      ),
      forbidden: Object.freeze(
        input.toolPolicy.forbidden.map((reference) => Object.freeze({ ...reference })),
      ),
    }),
    runtimePolicy: Object.freeze({ ...input.runtimePolicy }),
    ...(input.usageSpecification === undefined
      ? {}
      : { usageSpecification: createSkillUsageSpecification(input.usageSpecification) }),
    ...(outcomeSpecification === undefined ? {} : { outcomeSpecification }),
  });
}

export function createSkillOutcomeSpecification(
  input: SkillOutcomeSpecification,
  expectedSkillId = input.skillId,
  expectedSkillVersion = input.skillVersion,
): SkillOutcomeSpecification {
  if (
    input.skillId !== expectedSkillId ||
    input.skillVersion !== expectedSkillVersion ||
    input.skillVersion < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.specificationHash) ||
    input.effects.length === 0 ||
    input.evidence.length === 0 ||
    new Set(input.effects).size !== input.effects.length ||
    new Set(input.evidence).size !== input.evidence.length ||
    new Set(input.artifacts).size !== input.artifacts.length
  )
    throw new DomainError(
      'SKILL_OUTCOME_SPEC_INVALID',
      'Skill Outcome specification identity, hash, effects and evidence must be explicit and valid.',
    );
  return Object.freeze({
    ...input,
    effects: Object.freeze([...input.effects]),
    evidence: Object.freeze([...input.evidence]),
    artifacts: Object.freeze([...input.artifacts]),
    taskGoalPolicy: Object.freeze({ ...input.taskGoalPolicy }),
    confidencePolicy: Object.freeze({ ...input.confidencePolicy }),
    sideEffectPolicy: Object.freeze({ ...input.sideEffectPolicy }),
  });
}

function snapshotSkillJson(value: unknown, active = new WeakSet(), depth = 0): unknown {
  if (depth > 64)
    throw new DomainError(
      'SKILL_VERSION_JSON_INVALID',
      'Skill version JSON exceeds the maximum depth.',
    );
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object')
    throw new DomainError(
      'SKILL_VERSION_JSON_INVALID',
      'Skill version schemas must contain finite JSON data.',
    );
  if (active.has(value))
    throw new DomainError('SKILL_VERSION_JSON_INVALID', 'Skill version schemas cannot be cyclic.');
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value))
    throw new DomainError(
      'SKILL_VERSION_JSON_INVALID',
      'Skill version schemas require plain JSON objects.',
    );
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotSkillJson(item, active, depth + 1)));
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          snapshotSkillJson(item, active, depth + 1),
        ]),
      ),
    );
  } finally {
    active.delete(value);
  }
}

function assertRuntimePolicy(policy: SkillRuntimePolicy): void {
  for (const value of [policy.maxReplans, policy.maxLlmCalls, policy.maxMcpCalls])
    if (value !== undefined && (!Number.isInteger(value) || value < 0))
      throw new DomainError(
        'SKILL_RUNTIME_POLICY_INVALID',
        'Skill count budgets must be nonnegative integers.',
      );
  if (
    policy.maxDurationSeconds !== undefined &&
    (!Number.isInteger(policy.maxDurationSeconds) || policy.maxDurationSeconds < 1)
  )
    throw new DomainError(
      'SKILL_RUNTIME_POLICY_INVALID',
      'Skill duration budget must be a positive integer.',
    );
  if (policy.maxCost !== undefined && (!Number.isFinite(policy.maxCost) || policy.maxCost < 0))
    throw new DomainError(
      'SKILL_RUNTIME_POLICY_INVALID',
      'Skill cost budget must be finite and nonnegative.',
    );
}

function assertToolPolicy(policy: SkillToolPolicy): void {
  const memberships = new Map<string, string>();
  const groups: readonly (readonly [string, readonly ToolReference[]])[] = [
    ['required', policy.required],
    ['optional', policy.optional],
    ['forbidden', policy.forbidden],
  ];
  for (const [kind, references] of groups) {
    for (const reference of references) {
      const key = `${reference.serverId}/${reference.toolName}`;
      const previous = memberships.get(key);
      if (previous !== undefined) {
        throw new DomainError(
          'SKILL_TOOL_POLICY_OVERLAP',
          `Tool ${key} appears in ${previous} and ${kind}.`,
        );
      }
      memberships.set(key, kind);
    }
  }
}
