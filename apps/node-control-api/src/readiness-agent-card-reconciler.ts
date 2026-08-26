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

/** Refresh execution admission only; health observations cannot mutate registered Agent Cards. */
export async function reconcileExpiredReadiness(
  readiness: ExpiredReadinessEvaluator,
): Promise<Readonly<{ evaluatedCount: number }>> {
  const refreshed = await readiness.evaluateExpired();
  return Object.freeze({ evaluatedCount: refreshed.length });
}
