import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type {
  BusinessEventSubscription,
  BusinessEventInboxRecord,
} from '../../domain/src/user-goal-runtime.js';
import { PostgresUserGoalRuntimeRepository } from '../src/user-goal-runtime-repository.js';

export async function verifyGowmBusinessEventCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const all = new PostgresUserGoalRuntimeRepository(pool, scope);
  const a = new PostgresUserGoalRuntimeRepository(pool, {
    ...scope,
    allowedDeviceIds: scope.allowedDeviceIds.slice(0, 1),
  });
  const empty = new PostgresUserGoalRuntimeRepository(pool, { ...scope, allowedDeviceIds: [] });
  const subscriptions: BusinessEventSubscription[] = [];
  const events: BusinessEventInboxRecord[] = [];
  const now = new Date().toISOString();
  const providerId = `${run}-synthetic-server`;
  for (const [index, deviceId] of scope.allowedDeviceIds.entries()) {
    const subscription: BusinessEventSubscription = {
      subscriptionId: `${run}-sub-${String(index)}`,
      providerId,
      deviceIdentity: { deviceId, smppServiceKey: run },
      streamId: `${run}-stream`,
      generation: 1,
      status: 'current',
      lastDurablyAdmittedSequence: '0',
      lastProcessedSequence: '0',
      createdAt: now,
      updatedAt: now,
    };
    await all.saveBusinessEventSubscription(subscription);
    assert.equal(
      (await all.findCurrentBusinessEventSubscription(providerId, subscription.deviceIdentity))
        ?.subscriptionId,
      subscription.subscriptionId,
    );
    const event: BusinessEventInboxRecord = {
      inboxId: `${run}-event-${String(index)}`,
      subscriptionId: subscription.subscriptionId,
      eventId: 'same-event',
      sequence: '1',
      envelopeHash: `sha256:${'a'.repeat(64)}`,
      envelope: { fixture: true },
      status: 'admitted',
      admittedAt: now,
    };
    await all.admitBusinessEvent(event);
    assert.equal((await all.admitBusinessEvent(event)).created, false);
    subscriptions.push(subscription);
    events.push(event);
  }
  const first = subscriptions[0];
  const second = subscriptions[1];
  const firstEvent = events[0];
  const secondEvent = events[1];
  assert.ok(first && second && firstEvent && secondEvent);
  assert.ok(second.deviceIdentity);
  await assert.rejects(
    all.findLatestBusinessEventSubscription(providerId),
    /BUSINESS_EVENT_DEVICE_IDENTITY_REQUIRED/u,
  );
  await assert.rejects(
    a.saveBusinessEventSubscription(second),
    /BUSINESS_EVENT_SUBSCRIPTION_SCOPE_OR_IDENTITY_CONFLICT/u,
  );
  await assert.rejects(
    all.saveBusinessEventSubscription({ ...first, deviceIdentity: second.deviceIdentity }),
    /BUSINESS_EVENT_SUBSCRIPTION_SCOPE_OR_IDENTITY_CONFLICT/u,
  );
  assert.equal(await a.findBusinessEventSubscription(second.subscriptionId), undefined);
  assert.equal(
    await a.findLatestBusinessEventSubscription(providerId, second.deviceIdentity),
    undefined,
  );
  assert.deepEqual(await empty.listBusinessEventSubscriptions(100), []);
  assert.deepEqual(await empty.claimBusinessEventInbox(100), []);
  assert.equal((await a.listBusinessEventSubscriptions(100)).length, 1);
  assert.deepEqual(
    (await a.claimBusinessEventInbox(100)).map((event) => event.inboxId),
    [firstEvent.inboxId],
  );
  await assert.rejects(a.admitBusinessEvent(secondEvent), /BUSINESS_EVENT_SUBSCRIPTION_NOT_FOUND/u);
  await assert.rejects(
    a.markBusinessEventProcessed(secondEvent.inboxId, now),
    /Business Event was not in a processable state/u,
  );
  await a.markBusinessEventProcessed(firstEvent.inboxId, now);
  assert.equal(
    (await all.findBusinessEventSubscription(first.subscriptionId))?.lastProcessedSequence,
    '1',
  );
  assert.equal(
    (await all.findBusinessEventSubscription(second.subscriptionId))?.lastProcessedSequence,
    '0',
  );
  await assert.rejects(
    a.transitionBusinessEventSubscription(second.subscriptionId, 'retired', now),
    /Business Event subscription does not exist/u,
  );
  await a.transitionBusinessEventSubscription(first.subscriptionId, 'retired', now);
  await all.saveBusinessEventSubscription({
    ...first,
    subscriptionId: `${run}-sub-a-2`,
    streamId: `${run}-stream-2`,
    generation: 2,
  });
  assert.equal(
    (await all.findCurrentBusinessEventSubscription(providerId, first.deviceIdentity))?.generation,
    2,
  );
  assert.equal(
    (await all.findCurrentBusinessEventSubscription(providerId, second.deviceIdentity))?.generation,
    1,
  );
  for (const [index, subscription] of subscriptions.entries()) {
    const inbox = events[index];
    assert.ok(inbox);
    const projection = {
      relationProjectionId: `${run}-relation-${String(index)}`,
      inboxId: inbox.inboxId,
      status: 'complete' as const,
      relationHash: `sha256:${'b'.repeat(64)}`,
      taskIds: [],
      total: 0,
      createdAt: now,
    };
    const assessment = {
      assessmentId: `${run}-assessment-${String(index)}`,
      inboxId: inbox.inboxId,
      classification: 'none' as const,
      confidence: 'high' as const,
      criterionIds: [],
      relatedBindingIds: [],
      ruleIds: ['fixture'],
      action: 'record_only' as const,
      createdAt: now,
    };
    const incident = {
      incidentId: `${run}-incident-${String(index)}`,
      subscriptionId: subscription.subscriptionId,
      providerId,
      streamId: subscription.streamId,
      dedupeKey: `sha256:${createHash('sha256')
        .update(`${run}:${String(index)}`)
        .digest('hex')}`,
      incidentKind: 'continuity_loss' as const,
      summary: 'Scoped fixture',
      relatedGoalIds: [],
      createdAt: now,
    };
    await all.saveBusinessEventRelationProjection(projection);
    await all.saveEventImpactAssessment(assessment);
    assert.equal((await all.saveEventIncident(incident)).created, true);
    assert.equal((await all.saveEventIncident(incident)).created, false);
    if (index === 1) {
      await assert.rejects(
        a.saveBusinessEventRelationProjection(projection),
        /BUSINESS_EVENT_INBOX_SCOPE_DENIED/u,
      );
      await assert.rejects(
        a.saveEventImpactAssessment(assessment),
        /BUSINESS_EVENT_INBOX_SCOPE_DENIED/u,
      );
      await assert.rejects(a.saveEventIncident(incident), /BUSINESS_EVENT_INCIDENT_SCOPE_DENIED/u);
      assert.equal(await a.findEventIncidentByDedupeKey(incident.dedupeKey), undefined);
    } else {
      const taskId = `${run}-task-0`;
      await assert.rejects(
        all.attachEventIncidentTask(incident.dedupeKey, `${run}-task-1`, {
          ...incident,
          agentTaskId: `${run}-task-1`,
        }),
        /BUSINESS_EVENT_INCIDENT_SCOPE_DENIED/u,
      );
      await a.attachEventIncidentTask(incident.dedupeKey, taskId, {
        ...incident,
        agentTaskId: taskId,
      });
      assert.equal((await a.findEventIncidentByDedupeKey(incident.dedupeKey))?.agentTaskId, taskId);
    }
  }
  assert.equal((await a.listEventImpactAssessments(100)).length, 1);
  assert.equal((await a.listEventIncidents(100)).length, 1);
  assert.deepEqual(await empty.listEventImpactAssessments(100), []);
  assert.deepEqual(await empty.listEventIncidents(100), []);
  return [
    'Business Event subscriptions, inbox, relations, assessments and incidents isolate devices, reject cross-scope mutations/attachments and advance independent generations',
  ];
}
