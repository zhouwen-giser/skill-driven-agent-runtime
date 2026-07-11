import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

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
  return {
    ...input,
    skillId,
    name: input.name.trim(),
    summary: input.summary.trim(),
    description: input.description.trim(),
  };
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
