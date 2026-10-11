import type { TaskBusinessProjection } from '../../domain/src/task-business.js';

/** Model facts remain bounded. Exact objects/content are retained in the native repository. */
export function taskBusinessAgentFacts(projections: readonly TaskBusinessProjection[]) {
  const budget = 65_536;
  const items: Readonly<Record<string, unknown>>[] = [];
  let bytes = 0;
  let omitted = 0;
  for (const projection of projections) {
    const candidate = {
      bindingId: projection.bindingId,
      identity: projection.identity,
      status: projection.status,
      contextRevision: projection.contextRevision,
      projectionRevision: projection.projectionRevision,
      effectivePlanRevision: projection.effectivePlanRevision,
      executionSummary: projection.executionSummary,
      quality: projection.quality,
      businessOutcome: projection.businessOutcome,
      geometry: projection.geometry?.slice(0, 64),
      sourceTime: projection.sourceTime,
      sourceTimeBasis: projection.sourceTimeBasis,
      sourceTimeFieldPath: projection.sourceTimeFieldPath,
      sdarReceivedAt: projection.sdarReceivedAt,
      objects: projection.objects.slice(0, 128),
      omittedObjectRefs: Math.max(0, projection.objects.length - 128),
      interactionRequests: projection.interactionRequests.slice(0, 32).map((item) => ({
        requestId: item['requestId'],
        requestKey: item['requestKey'],
        revision: item['revision'],
        state: item['state'],
        deadlineAt: item['deadlineAt'],
      })),
      allowedInterventions: projection.allowedInterventions.slice(0, 32).map((item) => ({
        interventionId: item['interventionId'],
        interventionType: item['interventionType'],
        revision: item['revision'],
        state: item['state'],
        validUntil: item['validUntil'],
      })),
    };
    const size = Buffer.byteLength(JSON.stringify(candidate));
    if (bytes + size > budget) {
      omitted += 1;
      continue;
    }
    bytes += size;
    items.push(candidate);
  }
  return {
    items,
    omittedProjectionCount: omitted,
    completeness: omitted === 0 ? 'all_projection_summaries' : 'bounded_partial',
    byteBudget: budget,
  } as const;
}
