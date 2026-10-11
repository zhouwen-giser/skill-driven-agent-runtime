import type { PoolClient } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { businessEventChildScope } from './gowm-business-event-scope.js';

/** Shared by the original worker and business projection transaction. No snapshot watermark is used. */
export async function markBusinessEventProcessedInTransaction(
  client: PoolClient,
  inboxId: string,
  processedAt: string,
  scope?: DeviceWorkScope,
  processingToken?: string,
): Promise<void> {
  const filter = businessEventChildScope(scope, 4, 'event');
  const ownerFilter = businessEventChildScope(scope, 2, 'event');
  const owner = await client.query<{ subscription_id: string }>(
    `SELECT subscription_id FROM business_event_inbox event WHERE inbox_id=$1 AND ${ownerFilter.predicate}`,
    [inboxId, ...ownerFilter.values],
  );
  const subscriptionId = owner.rows[0]?.subscription_id;
  if (subscriptionId === undefined)
    throw new BusinessEventCheckpointError('BUSINESS_EVENT_SCOPE_DENIED');
  await client.query(
    'SELECT subscription_id FROM business_event_subscription WHERE subscription_id=$1 FOR UPDATE',
    [subscriptionId],
  );
  const changed = await client.query(
    `UPDATE business_event_inbox event SET status='processed',processed_at=$2,error_code=NULL
     WHERE inbox_id=$1 AND ${filter.predicate} AND status IN ('admitted','processing','retryable_failed')
       AND (($3::text IS NOT NULL AND error_code=$3 AND split_part(error_code,':',2)::numeric > extract(epoch FROM clock_timestamp())*1000)
         OR ($3::text IS NULL AND (error_code IS NULL OR error_code NOT LIKE 'PROCESSING_LEASE:%')))`,
    [inboxId, processedAt, processingToken ?? null, ...filter.values],
  );
  if (changed.rowCount !== 1)
    throw new BusinessEventCheckpointError('BUSINESS_EVENT_PROCESSING_CAS_FAILED');
  await client.query(
    `UPDATE business_event_subscription subscription SET last_processed_sequence=GREATEST(last_processed_sequence,
       COALESCE((SELECT MAX(done.sequence) FROM business_event_inbox done
         WHERE done.subscription_id=subscription.subscription_id AND done.status='processed'
           AND done.sequence < COALESCE((SELECT MIN(hole.sequence) FROM business_event_inbox hole
             WHERE hole.subscription_id=subscription.subscription_id AND hole.status<>'processed'),
             subscription.last_durably_admitted_sequence+1)),last_processed_sequence)),
       lock_version=lock_version+1,updated_at=$2 WHERE subscription_id=$1`,
    [subscriptionId, processedAt],
  );
}
export class BusinessEventCheckpointError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BusinessEventCheckpointError';
  }
}
