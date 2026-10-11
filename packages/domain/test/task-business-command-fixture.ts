import type {
  TaskBusinessCommandIntent,
  TaskBusinessCommandRecord,
  TaskBusinessControlScope,
} from '../src/task-business-command.js';
import { taskBusinessIntentContentHash } from '../src/task-business-command.js';
import { taskBusinessFixture } from './task-business-fixture.js';

export const businessControlScope: TaskBusinessControlScope = {
  taskId: 'task-business-control',
  capabilityBindingId: 'capability-binding-business',
  capabilityId: 'vehicle.navigate',
  capabilityVersion: 1,
  capabilityAttemptId: 'capability-attempt-business',
  planId: 'plan-business',
  planHash: 'a'.repeat(64),
  skillId: 'skill-navigation',
  skillVersion: 1,
  providerBindingId: 'provider-binding-business',
  serverId: 'provider-server-business',
  toolName: 'vehicle_navigate',
};
export const businessMutationPolicy = {
  type: 'task_business_mutation_policy' as const,
  profileVersion: '1.0-rc2' as const,
  allowedOperations: ['input_response', 'navigation_adjust_plan'] as const,
  confirmation: 'trusted_human_per_command' as const,
  dispatchPolicy: 'single_sender_reconcile_never_redispatch' as const,
};
export function businessCommandFixture(
  operation: 'input_response' | 'navigation_adjust_plan' = 'navigation_adjust_plan',
): TaskBusinessCommandRecord {
  const view = taskBusinessFixture();
  const original = view.objects.find((object) => object.kind === 'input_request');
  const base: Omit<TaskBusinessCommandIntent, 'contentHash'> = {
    schemaVersion: 'sdar.task-business-command/v1',
    intentId: 'business-command-1',
    taskId: businessControlScope.taskId,
    bindingId: 'remote-binding-business',
    goalId: 'goal-business',
    goalVersion: 1,
    identity: view.context.identity,
    frozenBindingHash: `sha256:${'b'.repeat(64)}`,
    authority: businessControlScope,
    userRequestHash: `sha256:${'c'.repeat(64)}`,
    createdAt: '2026-10-10T10:00:00Z',
    validUntil: '2026-10-10T10:05:00Z',
    reconcileUntil: '2026-10-10T10:10:00Z',
    request:
      operation === 'navigation_adjust_plan'
        ? {
            operation,
            interventionId: String(
              view.objects.find((object) => object.kind === 'intervention')?.value[
                'interventionId'
              ],
            ),
            expectedInterventionRevision: 1,
            expectedEffectivePlanRevision: 4,
            commandId: 'business-command-1',
            waypoints: [{ longitude: 106.8, latitude: 29.7 }],
            density: 'normal',
          }
        : {
            operation,
            inputRequestId: 'original-input-1',
            inputLinkHash: `sha256:${'d'.repeat(64)}`,
            requestId: String(original?.value['requestId']),
            requestKey: String(original?.value['requestKey']),
            expectedRequestRevision: 1,
            expectedSubjectBinding: original?.value['subjectBinding'] as Readonly<
              Record<string, unknown>
            >,
            response: { action: 'accept', content: { decision: 'continue_observation' } },
          },
  };
  return {
    intent: { ...base, contentHash: taskBusinessIntentContentHash(base) },
    revision: 3,
    state: 'accepted',
    updatedAt: base.createdAt,
    readAttempts: 0,
  };
}
