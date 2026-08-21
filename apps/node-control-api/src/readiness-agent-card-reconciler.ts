import { createHash } from 'node:crypto';

interface ExpiredReadinessRecord {
  readonly snapshot: Readonly<{
    capabilityId: string;
    capabilityVersion: number;
    snapshotVersion: number;
  }>;
  readonly snapshotHash: string;
}

export interface ExpiredReadinessEvaluator {
  evaluateExpired(): Promise<readonly ExpiredReadinessRecord[]>;
}

export interface ManagedAgentCardRebuilder {
  rebuild(idempotencyKey: string, reason: string): Promise<Readonly<{ status: string }>>;
}

export async function reconcileExpiredReadinessAgentCard(
  readiness: ExpiredReadinessEvaluator,
  agentCards: ManagedAgentCardRebuilder,
): Promise<Readonly<{ evaluatedCount: number; cardRebuilt: boolean }>> {
  const refreshed = await readiness.evaluateExpired();
  if (refreshed.length === 0) return Object.freeze({ evaluatedCount: 0, cardRebuilt: false });

  const authority = refreshed
    .map(({ snapshot, snapshotHash }) =>
      [
        snapshot.capabilityId,
        String(snapshot.capabilityVersion),
        String(snapshot.snapshotVersion),
        snapshotHash,
      ].join('\u0000'),
    )
    .sort();
  const fingerprint = createHash('sha256').update(JSON.stringify(authority)).digest('hex');
  const operation = await agentCards.rebuild(
    `readiness-expiry-card-${fingerprint}`,
    'Rebuild the managed Agent Card after Runtime readiness expiry reconciliation.',
  );
  if (operation.status !== 'succeeded') throw new Error('READINESS_AGENT_CARD_REBUILD_FAILED');
  return Object.freeze({ evaluatedCount: refreshed.length, cardRebuilt: true });
}
