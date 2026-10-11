import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from 'pg';
import type {
  McpTaskReadinessService,
  MemoryService,
  ModelRuntimeService,
  SkillCompositionPlanner,
  WorkflowTemplateService,
  WorkflowValidator,
} from '../../../../packages/application/src/index.js';
import {
  HomeLabReadOnlyWorkflowCandidateGuard,
  WorkflowPlannerService,
  type WorkflowCandidateGuard,
} from '../../../../packages/application/src/index.js';
import type { PostgresAgentTaskCommandContext } from '../../../../packages/persistence-postgres/src/index.js';
import { PostgresWorkflowPlanRepository } from '../../../../packages/persistence-postgres/src/index.js';
import { HomeLabGovernedLightWorkflowCandidateGuard } from '.././home-lab-governed-light-workflow-contract.js';
import type { UgvMoveWorkflowCandidateGuard } from '.././ugv-move-workflow.js';
import { validateUgvProfileWorkflowCandidate } from '.././ugv-move-workflow.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
export interface composePlanningDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly modelRuntime: ModelRuntimeService;
  readonly workflowValidator: WorkflowValidator;
  readonly pool: Pool;
  readonly taskCommands: PostgresAgentTaskCommandContext;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly workflowSchema: unknown;
  readonly clock: { now: () => string };
  readonly skillComposition: SkillCompositionPlanner;
  readonly workflowTemplates: WorkflowTemplateService;
  readonly memories: MemoryService;
  readonly homeLabReadOnlyProfile: boolean;
  readonly homeLabGovernedLightProfile: boolean;
  readonly ugvAgentProfile: boolean;
  readonly taskReadiness: McpTaskReadinessService | undefined;
}
export function composePlanning(dependencies: composePlanningDependencies) {
  const {
    modelRuntime,
    workflowValidator,
    pool,
    taskCommands,
    deviceWorkScope,
    workflowSchema,
    clock,
    skillComposition,
    workflowTemplates,
    memories,
    homeLabReadOnlyProfile,
    homeLabGovernedLightProfile,
    ugvAgentProfile,
    taskReadiness,
  } = dependencies;
  const ugvWorkflowCandidateGuard = new AsyncLocalStorage<UgvMoveWorkflowCandidateGuard>();
  const ugvWorkflowCandidateGuardDispatcher: WorkflowCandidateGuard = {
    validate(input) {
      return validateUgvProfileWorkflowCandidate(input, ugvWorkflowCandidateGuard.getStore());
    },
  };
  const workflowPlanner = new WorkflowPlannerService({
    model: modelRuntime,
    validator: workflowValidator,
    repository: new PostgresWorkflowPlanRepository(pool, taskCommands, deviceWorkScope),
    workflowSchema,
    clock,
    maxAttempts: 3,
    composition: skillComposition,
    templates: workflowTemplates,
    memories,
    ...(homeLabReadOnlyProfile
      ? { candidateGuard: new HomeLabReadOnlyWorkflowCandidateGuard() }
      : homeLabGovernedLightProfile
        ? { candidateGuard: new HomeLabGovernedLightWorkflowCandidateGuard() }
        : ugvAgentProfile
          ? { candidateGuard: ugvWorkflowCandidateGuardDispatcher }
          : {}),
    ...(taskReadiness === undefined
      ? {}
      : { readiness: taskReadiness.planningPolicy(), planningAuditCommit: taskReadiness }),
  });
  return { workflowPlanner, ugvWorkflowCandidateGuard };
}
