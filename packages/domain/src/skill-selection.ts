import type { GoalExecutionContract } from './goal.js';
import type { McpDependencyWarningReason } from './mcp.js';
import type { SkillRuntimePolicy, SkillToolPolicy } from './skill.js';

export interface SkillPerformanceMetrics {
  readonly sampleCount: number;
  readonly successRate: number;
  readonly averageDurationMs: number;
  readonly averageCost: number;
  readonly failureCount: number;
  readonly stabilityScore: number;
}

export interface SkillSchemaSummary {
  readonly type: string;
  readonly requiredFields: readonly string[];
  readonly propertyNames: readonly string[];
  readonly allowsAdditionalProperties: boolean | 'unspecified';
}

export interface SkillCandidateMcpDependencyWarning {
  readonly warningId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly reason: McpDependencyWarningReason;
  readonly toolRevision: number;
  readonly createdAt: string;
}

export interface SkillCandidateSnapshot {
  readonly skillId: string;
  readonly skillVersion: number;
  readonly name: string;
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly inputSchemaSummary: SkillSchemaSummary;
  readonly outputSchemaSummary: SkillSchemaSummary;
  readonly toolPolicy: SkillToolPolicy;
  readonly workflowGuidanceSummary: string;
  readonly runtimePolicy: SkillRuntimePolicy;
  readonly activeMcpDependencyWarnings: readonly SkillCandidateMcpDependencyWarning[];
  readonly autoConfirmPlan: boolean;
  readonly createdAt: string;
  readonly semanticScore: number;
  readonly metrics: SkillPerformanceMetrics;
}

export interface SkillSelectionRecord {
  readonly selectionId: string;
  readonly goalContract: GoalExecutionContract;
  readonly goalDescription: string;
  readonly candidates: readonly SkillCandidateSnapshot[];
  readonly selectedSkillId: string;
  readonly selectedSkillVersion: number;
  readonly decisionSummary: string;
  readonly createdAt: string;
}

export interface SkillReplacementPlan {
  readonly replacementPlanId: string;
  readonly selectionId: string;
  readonly goalContract: GoalExecutionContract;
  readonly failedSkillId: string;
  readonly candidates: readonly SkillCandidateSnapshot[];
  readonly replacementSkillId: string;
  readonly replacementSkillVersion: number;
  readonly decisionSummary: string;
  readonly status: 'awaiting_confirmation';
  readonly createdAt: string;
}
