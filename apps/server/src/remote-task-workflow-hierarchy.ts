import type {
  SkillCallWorkflowRepository,
  WorkflowContinuationRepository,
} from '../../../packages/application/src/ports.js';
import type { SkillCallWorkflowService } from '../../../packages/application/src/skill-call-workflow.js';
import type { WorkflowControllerService } from '../../../packages/application/src/workflow-controller.js';
import type { WorkflowExecutionService } from '../../../packages/application/src/workflow-execution.js';
import {
  type WorkflowContinuationSnapshot,
  type WorkflowControlRecord,
  type WorkflowInstance,
} from '../../../packages/domain/src/index.js';

export async function continueRemoteTaskWorkflowHierarchy(
  dependencies: Readonly<{
    skillCallWorkflows: Pick<SkillCallWorkflowRepository, 'findByChildInstanceId'>;
    skillCallWorkflow: Pick<SkillCallWorkflowService, 'completeExternalChild'>;
    continuations: Pick<WorkflowContinuationRepository, 'findCurrent' | 'findLatestForWait'>;
    execution: Pick<WorkflowExecutionService, 'get' | 'continueExternal'>;
    controller: Pick<WorkflowControllerService, 'get' | 'listRounds' | 'continueAfterExternal'>;
    recordRootResume(snapshot: WorkflowContinuationSnapshot): Promise<void>;
    projectControl(
      snapshot: WorkflowContinuationSnapshot,
      control: WorkflowControlRecord,
    ): Promise<void>;
  }>,
  input: Readonly<{
    snapshot: WorkflowContinuationSnapshot;
    instance: WorkflowInstance;
    continuationAttemptId: string;
  }>,
): Promise<void> {
  let currentSnapshot = input.snapshot;
  let currentInstance = input.instance;
  let depth = 0;
  for (;;) {
    const childLink = await dependencies.skillCallWorkflows.findByChildInstanceId(
      currentInstance.instanceId,
    );
    if (childLink === undefined) {
      if (currentInstance.status === 'waiting_external') return;
      const [control, rounds] = await Promise.all([
        dependencies.controller.get(currentSnapshot.workflowControlId),
        dependencies.controller.listRounds(currentSnapshot.workflowControlId),
      ]);
      const matchingRound = rounds.find((round) => round.instanceId === currentInstance.instanceId);
      const alreadyConsumed =
        control.finalInstanceId === currentInstance.instanceId ||
        (matchingRound !== undefined && control.roundCount > matchingRound.roundIndex);
      if (alreadyConsumed) {
        await dependencies.projectControl(currentSnapshot, control);
        return;
      }
      if (control.status !== 'running')
        throw new Error('WORKFLOW_CONTROL_EXTERNAL_REENTRY_CONFLICT');
      await dependencies.recordRootResume(currentSnapshot);
      const continued = await dependencies.controller.continueAfterExternal(
        currentSnapshot.workflowControlId,
        currentInstance.instanceId,
      );
      await dependencies.projectControl(currentSnapshot, continued);
      return;
    }
    if (
      currentInstance.status === 'running' ||
      currentInstance.status === 'paused' ||
      currentInstance.status === 'waiting_external'
    )
      throw new Error('WORKFLOW_SKILL_CHILD_CONTINUATION_INCOMPLETE');
    const child = await dependencies.skillCallWorkflow.completeExternalChild(currentInstance);
    const [parentInstance, activeSnapshot, historicalSnapshot] = await Promise.all([
      dependencies.execution.get(child.parentInstanceId),
      dependencies.continuations.findCurrent(child.parentInstanceId),
      dependencies.continuations.findLatestForWait(child.parentInstanceId, {
        kind: 'child_workflow',
        sourceId: child.childInstanceId,
        nodeId: child.parentNodeId,
      }),
    ]);
    if (parentInstance === undefined || historicalSnapshot === undefined)
      throw new Error('WORKFLOW_SKILL_PARENT_CONTINUATION_NOT_FOUND');
    const parentWait = activeSnapshot?.waitingNodeRuns.find(
      (wait) =>
        wait.kind === 'child_workflow' &&
        wait.sourceId === child.childInstanceId &&
        wait.nodeId === child.parentNodeId,
    );
    if (activeSnapshot !== undefined && parentWait !== undefined) {
      currentInstance = await dependencies.execution.continueExternal({
        instanceId: child.parentInstanceId,
        continuationAttemptId: `${input.continuationAttemptId}-parent-${String(depth)}`,
        resolution:
          child.outcome.kind === 'completed'
            ? {
                kind: 'completed',
                waitId: parentWait.waitId,
                nodeRunId: parentWait.nodeRunId,
                result: child.outcome.result,
              }
            : {
                kind: 'failed',
                waitId: parentWait.waitId,
                nodeRunId: parentWait.nodeRunId,
                error: child.outcome.error,
              },
      });
      currentSnapshot = activeSnapshot;
      depth += 1;
      if (currentInstance.status === 'waiting_external') return;
      continue;
    }
    if (
      activeSnapshot !== undefined &&
      historicalSnapshot.lifecycle === 'superseded' &&
      activeSnapshot.continuationId === historicalSnapshot.continuationId &&
      activeSnapshot.stateVersion > historicalSnapshot.stateVersion &&
      parentInstance.status === 'waiting_external'
    )
      return;
    if (
      activeSnapshot === undefined &&
      (historicalSnapshot.lifecycle === 'terminal' ||
        historicalSnapshot.lifecycle === 'superseded') &&
      !['running', 'paused', 'waiting_external'].includes(parentInstance.status)
    ) {
      currentSnapshot = historicalSnapshot;
      currentInstance = parentInstance;
      depth += 1;
      continue;
    }
    throw new Error('WORKFLOW_SKILL_PARENT_CONTINUATION_NOT_FOUND');
  }
}
