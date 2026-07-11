import type { SkillRuntimePolicy } from './skill.js';

export interface WorkflowBudgetLimits {
  readonly maxReplans: number;
  readonly maxDurationSeconds: number;
  readonly maxLlmCalls: number;
  readonly maxMcpCalls: number;
  readonly maxCost: number;
}

export interface WorkflowBudgetUsage {
  readonly replanCount: number;
  readonly durationMs: number;
  readonly llmCalls: number;
  readonly mcpCalls: number;
  readonly cost: number;
}

export type WorkflowBudgetTerminationReason =
  | 'duration_exhausted'
  | 'llm_calls_exhausted'
  | 'mcp_calls_exhausted'
  | 'cost_exhausted'
  | 'replans_exhausted';

export function resolveWorkflowBudgetLimits(
  systemDefaults: WorkflowBudgetLimits,
  skillPolicies: readonly SkillRuntimePolicy[],
): WorkflowBudgetLimits {
  validateWorkflowBudgetLimits(systemDefaults);
  const effective = skillPolicies.map((policy) => ({
    maxReplans: policy.maxReplans ?? systemDefaults.maxReplans,
    maxDurationSeconds: policy.maxDurationSeconds ?? systemDefaults.maxDurationSeconds,
    maxLlmCalls: policy.maxLlmCalls ?? systemDefaults.maxLlmCalls,
    maxMcpCalls: policy.maxMcpCalls ?? systemDefaults.maxMcpCalls,
    maxCost: policy.maxCost ?? systemDefaults.maxCost,
  }));
  for (const limits of effective) validateWorkflowBudgetLimits(limits);
  if (effective.length === 0) return { ...systemDefaults };
  return {
    maxReplans: Math.min(...effective.map((limits) => limits.maxReplans)),
    maxDurationSeconds: Math.min(...effective.map((limits) => limits.maxDurationSeconds)),
    maxLlmCalls: Math.min(...effective.map((limits) => limits.maxLlmCalls)),
    maxMcpCalls: Math.min(...effective.map((limits) => limits.maxMcpCalls)),
    maxCost: Math.min(...effective.map((limits) => limits.maxCost)),
  };
}

export function validateWorkflowBudgetLimits(limits: WorkflowBudgetLimits): void {
  const nonnegativeIntegers = [limits.maxReplans, limits.maxLlmCalls, limits.maxMcpCalls];
  if (
    nonnegativeIntegers.some((value) => !Number.isInteger(value) || value < 0) ||
    !Number.isInteger(limits.maxDurationSeconds) ||
    limits.maxDurationSeconds < 1 ||
    !Number.isFinite(limits.maxCost) ||
    limits.maxCost < 0
  )
    throw new WorkflowBudgetConfigurationError();
}

export class WorkflowBudgetConfigurationError extends Error {
  readonly code = 'WORKFLOW_BUDGET_CONFIGURATION_INVALID' as const;
  constructor() {
    super('Workflow budget limits must be finite and nonnegative, with positive duration.');
    this.name = 'WorkflowBudgetConfigurationError';
  }
}
