import {
  DomainError,
  emptyWorkflowScopes,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowScopeState,
  type WorkflowParallelRegion,
  type WorkflowLoopRegion,
} from '../../domain/src/index.js';

type Regions = Readonly<{
  loops: readonly WorkflowLoopRegion[];
  parallels: readonly WorkflowParallelRegion[];
}>;
export function enterWorkflowScope(
  node: WorkflowNode,
  nodeRunId: string,
  scopes: WorkflowScopeState,
  regions: Regions,
): WorkflowScopeState {
  const update = emptyWorkflowScopes();
  const forks = { ...update.forks };
  for (const region of regions.parallels.filter((item) => item.joinNodeId === node.nodeId)) {
    const active = scopes.forks[region.forkNodeId];
    if (
      active === undefined ||
      active.closed ||
      active.branchIds.some((id) => active.arrivals[id] === undefined)
    )
      throw new DomainError(
        'WORKFLOW_JOIN_INCOMPLETE',
        'Join requires one arrival from every branch of the active fork invocation.',
      );
    forks[region.forkNodeId] = { ...active, closed: true };
  }
  if (node.type === 'parallel') {
    if (scopes.forks[node.nodeId]?.closed === false)
      throw new DomainError('WORKFLOW_FORK_REENTRY', 'An active fork cannot be entered twice.');
    forks[node.nodeId] = {
      invocationId: nodeRunId,
      forkNodeId: node.nodeId,
      branchIds: node.branchEntryNodeIds,
      arrivals: {},
      closed: false,
    };
  }
  return { ...update, forks };
}
export function branchArrival(
  region: WorkflowParallelRegion,
  branchId: string,
  scopes: WorkflowScopeState,
  nodeRunCounts: Readonly<Record<string, number>>,
): WorkflowScopeState {
  const active = scopes.forks[region.forkNodeId];
  const branch = region.branches.find((item) => item.branchId === branchId);
  if (
    active === undefined ||
    active.closed ||
    branch === undefined ||
    active.arrivals[branchId] !== undefined
  )
    throw new DomainError(
      'WORKFLOW_BRANCH_ARRIVAL_CONFLICT',
      'A branch can arrive only once during its active fork invocation.',
    );
  const arrival = `${active.invocationId}~branch~${encodeURIComponent(branchId)}`;
  if (!branch.arrivalNodeIds.some((id) => (nodeRunCounts[id] ?? 0) > 0))
    throw new DomainError('WORKFLOW_JOIN_INCOMPLETE', 'No branch predecessor completed.');
  return {
    ...emptyWorkflowScopes(),
    forks: { [region.forkNodeId]: { ...active, arrivals: { [branchId]: arrival } } },
  };
}
export function workflowOutputSources(
  nodeId: string,
  nodeRunId: string,
  scopes: WorkflowScopeState,
  regions: Regions,
): WorkflowScopeState['outputSources'] {
  const sources = regions.parallels.flatMap((region) => {
    const branch = region.branches.find((item) => item.nodeIds.includes(nodeId));
    if (branch === undefined) return [];
    const active = scopes.forks[region.forkNodeId];
    if (active === undefined || active.closed)
      throw new DomainError(
        'WORKFLOW_BRANCH_SCOPE_MISSING',
        'Branch output has no active fork invocation.',
      );
    return [{ forkInvocationId: active.invocationId, branchId: branch.branchId, nodeRunId }];
  });
  return sources.length === 0 ? {} : { [nodeId]: sources };
}

/** Conservative recursive work bound, including compiler gates and global bounded recoveries. */
export function scopedWorkflowStepLimit(
  definition: WorkflowDefinition,
  regions: Regions,
  ceiling = 100_000,
): number {
  if (!Number.isSafeInteger(ceiling) || ceiling < 1)
    throw new DomainError(
      'WORKFLOW_COMPLEXITY_LIMIT_INVALID',
      'Complexity ceiling must be a positive safe integer.',
    );
  const safe = (value: number) => {
    if (!Number.isSafeInteger(value) || value > ceiling)
      throw new DomainError(
        'WORKFLOW_COMPLEXITY_LIMIT_EXCEEDED',
        'Scoped Workflow exceeds its complexity ceiling.',
      );
    return value;
  };
  const cost = (members: ReadonlySet<string>): number => {
    let total = 0;
    const covered = new Set<string>();
    const children = regions.loops.filter(
      (loop) =>
        members.has(loop.loopNodeId) &&
        !regions.loops.some(
          (parent) =>
            parent.loopNodeId !== loop.loopNodeId &&
            members.has(parent.loopNodeId) &&
            parent.bodyNodeIds.includes(loop.loopNodeId),
        ),
    );
    for (const loop of children) {
      covered.add(loop.loopNodeId);
      for (const id of loop.bodyNodeIds) covered.add(id);
      total = safe(
        total + 1 + safe(loop.maxIterations * safe(1 + cost(new Set(loop.bodyNodeIds)))),
      );
    }
    for (const id of members)
      if (!covered.has(id)) {
        const parallel = regions.parallels.find((region) => region.forkNodeId === id);
        total = safe(total + 1 + 2 * (parallel?.branches.length ?? 0));
      }
    return total;
  };
  let recoveries = 1;
  for (const node of definition.nodes)
    if (node.type === 'error_handler')
      for (const option of node.recoveryOptions ?? [])
        recoveries = safe(recoveries + option.maxAttempts);
  return safe(safe(cost(new Set(definition.nodes.map((node) => node.nodeId))) + 2) * recoveries);
}
