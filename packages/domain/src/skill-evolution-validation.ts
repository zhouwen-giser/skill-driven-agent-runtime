import type { SkillVersion } from './skill.js';
import type { McpServer, McpTool } from './mcp.js';
import type { WorkflowPlanAttempt, WorkflowDefinition } from './workflow.js';

/** Evidence for one candidate execution. It never grants a Task or Goal state transition. */
export interface SkillCandidateExecutionEvidence {
  readonly caseId: string;
  readonly experienceId: string;
  readonly recordingHash: string;
  readonly expectationHash: string;
  readonly planId: string;
  readonly instanceId: string;
  readonly modelInvocationIds: readonly string[];
  readonly planningAttempts: readonly WorkflowPlanAttempt[];
  readonly definition?: WorkflowDefinition;
  readonly status: string;
  readonly actualResultHash?: string;
  readonly errorCodes: readonly string[];
  readonly assertions: readonly Readonly<{ name: string; passed: boolean }>[];
  readonly invocationIds: readonly string[];
}

export interface SkillEvolutionValidationReceipt {
  readonly schemaVersion: '2.0';
  readonly inputCandidateHash: string;
  readonly targetHash: string;
  readonly target: SkillVersion;
  readonly base?: SkillVersion;
  readonly dependencies: readonly SkillVersion[];
  readonly servers: readonly McpServer[];
  readonly tools: readonly McpTool[];
  readonly inductionInvocationIds: readonly string[];
  readonly executions: readonly SkillCandidateExecutionEvidence[];
  readonly validatedAt: string;
}
