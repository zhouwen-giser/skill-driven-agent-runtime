import type { TaskTypeDefinition } from '../../application/src/index.js';
import type { UgvMovePositionPolicy } from './ugv-move-position-result.js';

/** Read-only deployment facts needed to validate this profile; no server lifecycle or state writer. */
export interface UgvProfileRuntimeConfiguration {
  readonly taskUnderstanding?: Readonly<{
    profile?: string;
    taskTypes: readonly TaskTypeDefinition[];
    entryPolicy?: 'ambiguous_only' | 'all_requests';
    skillSelectionMode?: 'exact_compatible_only' | 'model_ranked';
  }>;
  readonly capabilityAuthorityReader?: unknown;
  readonly currentMcpProviderBindingAuthorityReader?: unknown;
  readonly skillSelection?: unknown;
  readonly frozenMcpTasks?: unknown;
  readonly governedControlPrincipalResolver?: unknown;
  readonly evidenceEnvironment?: string;
  readonly ugvMovePositionPolicy?: UgvMovePositionPolicy;
}

export interface UgvProfileTaskUnderstandingConfiguration {
  readonly profile: 'ugv-agent-profile';
  readonly taskTypes: readonly TaskTypeDefinition[];
  readonly entryPolicy: 'all_requests';
  readonly skillSelectionMode: 'exact_compatible_only';
  readonly lowRiskUserPreferences: readonly string[];
  readonly interactiveGoalBudgets: Readonly<{
    maxClarificationRounds: number;
    maxContractRevisions: number;
    maxElapsedMs: number;
  }>;
}
