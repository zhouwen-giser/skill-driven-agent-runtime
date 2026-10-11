import {
  createBusinessEventEnvelope,
  type BusinessEventInboxRecord,
  type BusinessEventSubscription,
} from '../../domain/src/index.js';
import { TaskBusinessError } from '../../domain/src/task-business.js';
import type {
  BusinessEventImpactRepository,
  BusinessEventRemoteBindingRepository,
  BusinessEventRelationAuthority,
} from './business-event-impact.js';
import {
  BusinessEventTerminalProcessingError,
  type BusinessEventProcessor,
} from './business-events.js';
import type {
  TaskBusinessRepository,
  TaskBusinessSyncService,
  TaskBusinessCommit,
} from './task-business-sync.js';

/** Composes the existing impact assessor with the same inbox, relation authority, and atomic checkpoint. */
export class TaskBusinessEventProcessor implements BusinessEventProcessor {
  constructor(
    readonly dependencies: Readonly<{
      impact: BusinessEventProcessor;
      events: Pick<BusinessEventImpactRepository, 'findBusinessEventSubscription'>;
      bindings: BusinessEventRemoteBindingRepository;
      relations: BusinessEventRelationAuthority;
      sync: TaskBusinessSyncService;
      repository: TaskBusinessRepository;
    }>,
  ) {}

  async process(
    record: BusinessEventInboxRecord,
  ): Promise<Readonly<{ processedAtomically: true }>> {
    const event = createBusinessEventEnvelope(
      record.envelope as Parameters<typeof createBusinessEventEnvelope>[0],
    );
    const subscription = await this.dependencies.events.findBusinessEventSubscription(
      record.subscriptionId,
    );
    if (subscription === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_SUBSCRIPTION_NOT_FOUND');
    const relation =
      event.scope === 'resource'
        ? await this.dependencies.relations.resolve(record, event, subscription)
        : undefined;
    if (relation !== undefined && relation.status !== 'complete')
      throw new TaskBusinessError('TASK_BUSINESS_RELATED_TASKS_INCOMPLETE');
    const ids = [...new Set(event.scope === 'task' ? [event.taskId] : (relation?.taskIds ?? []))];
    if (ids.length > 128) throw new TaskBusinessError('TASK_BUSINESS_RELATED_TASK_LIMIT');
    const prepared: TaskBusinessCommit[] = [];
    const signal = AbortSignal.timeout(30_000);
    for (const remoteTaskId of ids) {
      const binding = await this.dependencies.bindings.findByRemoteIdentity(
        subscription.providerId,
        remoteTaskId,
        subscription.deviceIdentity,
      );
      if (binding === undefined) continue;
      assertChannel(subscription, binding.deviceIdentity);
      const candidate = await this.dependencies.sync
        .prepare(binding.bindingId, record, signal)
        .catch((error: unknown) => {
          const code = error instanceof Error && 'code' in error ? String(error.code) : '';
          if (
            /^(TASK_BUSINESS_(SCHEMA_INVALID|IDENTITY_CONFLICT|EXECUTION_CONFLICT|OBJECT_CONFLICT|CONTEXT_CONFLICT|CONTENT_INVALID)|SMPP_BUSINESS_(SCHEMA_INVALID|IDENTITY_MISMATCH|OBJECT_HASH_MISMATCH))$/u.test(
              code,
            )
          )
            throw new BusinessEventTerminalProcessingError(
              code,
              'Frozen Task business identity or content conflicts; automatic read retries are stopped.',
            );
          throw error;
        });
      if (candidate !== 'unsupported') prepared.push(candidate);
    }
    await this.dependencies.impact.process(record);
    if ((await this.dependencies.repository.commitMany(prepared, record)) !== 'applied')
      throw new TaskBusinessError('TASK_BUSINESS_PROJECTION_CAS_FAILED');
    return { processedAtomically: true };
  }
}

function assertChannel(
  subscription: BusinessEventSubscription,
  actual: BusinessEventSubscription['deviceIdentity'],
): void {
  if (subscription.deviceIdentity === undefined) return;
  if (
    subscription.deviceIdentity === null
      ? actual != null
      : actual?.deviceId !== subscription.deviceIdentity.deviceId ||
        actual.smppServiceKey !== subscription.deviceIdentity.smppServiceKey
  )
    throw new TaskBusinessError('TASK_BUSINESS_DEVICE_OWNER_CONFLICT');
}
