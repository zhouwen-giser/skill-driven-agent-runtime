import type { WorkflowDefinition, WorkflowEdge } from './workflow.js';

export interface WorkflowRegionIssue {
  readonly code:
    | 'WORKFLOW_REFERENCE_INVALID'
    | 'WORKFLOW_HANDLER_DUPLICATE'
    | 'WORKFLOW_ROUTE_AMBIGUOUS'
    | 'WORKFLOW_ROUTE_MISSING'
    | 'WORKFLOW_PARALLEL_REGION_INVALID'
    | 'WORKFLOW_LOOP_REGION_INVALID'
    | 'WORKFLOW_UNBOUNDED_CYCLE'
    | 'WORKFLOW_UNREACHABLE_NODE';
  readonly path: string;
  readonly message: string;
}

export interface WorkflowEffectiveRoute {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly kind: 'normal' | 'error' | 'recovery';
  readonly outcome?: WorkflowEdge['outcome'];
}

export interface WorkflowLoopRegion {
  readonly loopNodeId: string;
  readonly bodyEntryNodeId: string;
  readonly bodyNodeIds: readonly string[];
  readonly maxIterations: number;
}

export interface WorkflowParallelRegion {
  readonly forkNodeId: string;
  readonly joinNodeId: string;
  readonly branches: readonly Readonly<{
    branchId: string;
    entryNodeId: string;
    nodeIds: readonly string[];
    arrivalNodeIds: readonly string[];
  }>[];
}

/** Structural analysis only. Scheduling remains exclusively in the LangGraph adapter. */
export function analyzeWorkflowRegions(definition: WorkflowDefinition) {
  const issues: WorkflowRegionIssue[] = [];
  const routes: WorkflowEffectiveRoute[] = [];
  const loops: WorkflowLoopRegion[] = [];
  const parallels: WorkflowParallelRegion[] = [];
  const nodes = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  const issue = (code: WorkflowRegionIssue['code'], nodeId: string, message: string) => {
    issues.push({ code, path: `nodes.${nodeId}`, message });
  };
  const add = (route: WorkflowEffectiveRoute) => {
    if (!nodes.has(route.sourceNodeId) || !nodes.has(route.targetNodeId)) {
      issue(
        'WORKFLOW_REFERENCE_INVALID',
        route.sourceNodeId,
        `Unknown route target ${route.targetNodeId}.`,
      );
      return;
    }
    if (
      !routes.some(
        (old) =>
          old.sourceNodeId === route.sourceNodeId &&
          old.targetNodeId === route.targetNodeId &&
          old.kind === route.kind &&
          old.outcome === route.outcome,
      )
    )
      routes.push(route);
  };
  if (nodes.size !== definition.nodes.length)
    issue('WORKFLOW_REFERENCE_INVALID', definition.entryNodeId, 'Node identities must be unique.');
  for (const id of [definition.entryNodeId, ...definition.exitNodeIds])
    if (!nodes.has(id))
      issue('WORKFLOW_REFERENCE_INVALID', id, 'Entry and exit references must exist.');
  const handled = new Set<string>();
  const joins = new Set<string>();
  for (const node of definition.nodes) {
    const outgoing = definition.edges.filter((edge) => edge.sourceNodeId === node.nodeId);
    const outcomes = outgoing.map((edge) => edge.outcome ?? 'default');
    if (new Set(outcomes).size !== outcomes.length)
      issue('WORKFLOW_ROUTE_AMBIGUOUS', node.nodeId, 'Each routing outcome must be unique.');
    if (node.type === 'parallel') {
      if (outgoing.length > 0)
        issue(
          'WORKFLOW_ROUTE_AMBIGUOUS',
          node.nodeId,
          'Parallel routes are declared by branchEntryNodeIds only.',
        );
      if (
        node.joinNodeId === undefined ||
        !nodes.has(node.joinNodeId) ||
        node.joinNodeId === node.nodeId ||
        node.mergeStrategy !== 'reject_conflicts' ||
        new Set(node.branchEntryNodeIds).size !== node.branchEntryNodeIds.length ||
        node.branchEntryNodeIds.includes(node.joinNodeId) ||
        joins.has(node.joinNodeId)
      )
        issue(
          'WORKFLOW_PARALLEL_REGION_INVALID',
          node.nodeId,
          'Parallel requires distinct branches, a unique explicit join and reject_conflicts.',
        );
      if (node.joinNodeId !== undefined) joins.add(node.joinNodeId);
      for (const targetNodeId of node.branchEntryNodeIds)
        add({ sourceNodeId: node.nodeId, targetNodeId, kind: 'normal' });
    } else {
      for (const edge of outgoing) add({ ...edge, kind: 'normal' });
      if (node.type === 'loop')
        add({
          sourceNodeId: node.nodeId,
          targetNodeId: node.bodyEntryNodeId,
          outcome: 'loop',
          kind: 'normal',
        });
    }
    if (node.type === 'error_handler') {
      if (handled.has(node.handledNodeId))
        issue('WORKFLOW_HANDLER_DUPLICATE', node.nodeId, 'A node can have only one error handler.');
      handled.add(node.handledNodeId);
      add({ sourceNodeId: node.handledNodeId, targetNodeId: node.nodeId, kind: 'error' });
      const options = node.recoveryOptions ?? [];
      // A singular goto is an ordinary structural route: forward recovery is finite,
      // while a backedge must pass the same bounded-cycle analysis as every other route.
      if (node.gotoNodeId !== undefined)
        add({ sourceNodeId: node.nodeId, targetNodeId: node.gotoNodeId, kind: 'normal' });
      const keys = options.map((option) => `${option.action}:${option.targetNodeId}`);
      if (
        new Set(keys).size !== keys.length ||
        options.some(
          (option) => !Number.isSafeInteger(option.maxAttempts) || option.maxAttempts < 1,
        )
      )
        issue(
          'WORKFLOW_ROUTE_AMBIGUOUS',
          node.nodeId,
          'Recovery options require unique identities and positive safe bounds.',
        );
      for (const option of options)
        add({ sourceNodeId: node.nodeId, targetNodeId: option.targetNodeId, kind: 'recovery' });
    }
    const terminal = definition.exitNodeIds.includes(node.nodeId) || node.type === 'result';
    if (terminal && (outgoing.length > 0 || node.type === 'parallel' || node.type === 'loop'))
      issue(
        'WORKFLOW_ROUTE_AMBIGUOUS',
        node.nodeId,
        'A terminal node cannot also dispatch normal successors.',
      );
    if (
      !terminal &&
      !['parallel', 'loop', 'condition', 'human_confirmation', 'error_handler'].includes(
        node.type,
      ) &&
      (outgoing.length !== 1 || outcomes[0] !== 'default')
    )
      issue(
        'WORKFLOW_ROUTE_MISSING',
        node.nodeId,
        'An action requires exactly one default successor or an explicit terminal declaration.',
      );
    if (
      node.type === 'human_confirmation' &&
      (outgoing.length !== 2 || !outcomes.includes('success') || !outcomes.includes('failure'))
    )
      issue(
        'WORKFLOW_ROUTE_MISSING',
        node.nodeId,
        'Confirmation requires success and failure routes.',
      );
    if (
      node.type === 'error_handler' &&
      (outgoing.length > 1 || (outgoing.length === 1 && outcomes[0] !== 'default'))
    )
      issue(
        'WORKFLOW_ROUTE_AMBIGUOUS',
        node.nodeId,
        'Handler continuation requires at most one default route.',
      );
  }
  for (const edge of definition.edges)
    if (!nodes.has(edge.sourceNodeId))
      issue('WORKFLOW_REFERENCE_INVALID', edge.sourceNodeId, 'Edge source does not exist.');
  const structural = routes.filter((route) => route.kind !== 'recovery');
  const outgoing = (id: string) => structural.filter((route) => route.sourceNodeId === id);
  const reach = (entry: string, stop?: string) => {
    const visited = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
      const id = pending.pop();
      if (id === undefined || id === stop || visited.has(id) || !nodes.has(id)) continue;
      visited.add(id);
      for (const route of outgoing(id)) pending.push(route.targetNodeId);
    }
    return visited;
  };
  const terminalBefore = (region: ReadonlySet<string>) =>
    [...region].some((id) => {
      const node = nodes.get(id);
      return (
        node?.type === 'result' ||
        definition.exitNodeIds.includes(id) ||
        (node?.type !== 'error_handler' && outgoing(id).length === 0)
      );
    });
  for (const node of definition.nodes) {
    if (node.type === 'loop') {
      const body = reach(node.bodyEntryNodeId, node.nodeId);
      if (
        body.size === 0 ||
        terminalBefore(body) ||
        !structural.some(
          (route) => body.has(route.sourceNodeId) && route.targetNodeId === node.nodeId,
        )
      )
        issue(
          'WORKFLOW_LOOP_REGION_INVALID',
          node.nodeId,
          'Every successful body path must return to its loop header.',
        );
      loops.push({
        loopNodeId: node.nodeId,
        bodyEntryNodeId: node.bodyEntryNodeId,
        bodyNodeIds: [...body],
        maxIterations: node.maxIterations,
      });
    }
    if (node.type === 'parallel' && node.joinNodeId !== undefined && nodes.has(node.joinNodeId)) {
      const branches = node.branchEntryNodeIds.map((entryNodeId) => {
        const members = reach(entryNodeId, node.joinNodeId);
        const arrivals = structural
          .filter(
            (route) => members.has(route.sourceNodeId) && route.targetNodeId === node.joinNodeId,
          )
          .map((route) => route.sourceNodeId);
        if (members.has(node.nodeId) || terminalBefore(members) || arrivals.length === 0)
          issue(
            'WORKFLOW_PARALLEL_REGION_INVALID',
            node.nodeId,
            'Each branch must reach its declared join without escaping the fork.',
          );
        for (const route of routes)
          if (
            (route.kind === 'recovery' &&
              members.has(route.sourceNodeId) &&
              !members.has(route.targetNodeId)) ||
            (members.has(route.targetNodeId) &&
              !members.has(route.sourceNodeId) &&
              !(route.sourceNodeId === node.nodeId && route.targetNodeId === entryNodeId))
          )
            issue(
              'WORKFLOW_PARALLEL_REGION_INVALID',
              node.nodeId,
              'An external route crosses a branch boundary.',
            );
        return {
          branchId: entryNodeId,
          entryNodeId,
          nodeIds: [...members],
          arrivalNodeIds: [...new Set(arrivals)],
        };
      });
      const seen = new Set<string>();
      for (const branch of branches)
        for (const id of branch.nodeIds) {
          if (seen.has(id))
            issue(
              'WORKFLOW_PARALLEL_REGION_INVALID',
              node.nodeId,
              'Branches share nodes before their explicit join.',
            );
          seen.add(id);
        }
      if (
        routes.some(
          (route) => route.targetNodeId === node.joinNodeId && !seen.has(route.sourceNodeId),
        )
      )
        issue(
          'WORKFLOW_PARALLEL_REGION_INVALID',
          node.nodeId,
          'The join cannot be entered from outside its fork branches.',
        );
      parallels.push({ forkNodeId: node.nodeId, joinNodeId: node.joinNodeId, branches });
    }
  }
  for (const loop of loops) {
    const body = new Set(loop.bodyNodeIds);
    for (const route of routes)
      if (
        (route.kind === 'recovery' &&
          body.has(route.sourceNodeId) &&
          !body.has(route.targetNodeId) &&
          route.targetNodeId !== loop.loopNodeId) ||
        (body.has(route.targetNodeId) &&
          !body.has(route.sourceNodeId) &&
          !(route.sourceNodeId === loop.loopNodeId && route.targetNodeId === loop.bodyEntryNodeId))
      )
        issue(
          'WORKFLOW_LOOP_REGION_INVALID',
          loop.loopNodeId,
          'Loop bodies can only be entered through their header.',
        );
  }
  // Bounded header backedges and bounded recovery jumps are the only permitted cycles.
  const acyclic = structural.filter(
    (route) =>
      !loops.some(
        (loop) =>
          route.targetNodeId === loop.loopNodeId && loop.bodyNodeIds.includes(route.sourceNodeId),
      ),
  );
  const indegrees = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (const route of acyclic)
    indegrees.set(route.targetNodeId, (indegrees.get(route.targetNodeId) ?? 0) + 1);
  const ready = [...indegrees].filter(([, count]) => count === 0).map(([id]) => id);
  let consumed = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    consumed++;
    for (const route of acyclic.filter((item) => item.sourceNodeId === id)) {
      const remaining = (indegrees.get(route.targetNodeId) ?? 0) - 1;
      indegrees.set(route.targetNodeId, remaining);
      if (remaining === 0) ready.push(route.targetNodeId);
    }
  }
  if (consumed !== nodes.size)
    issue(
      'WORKFLOW_UNBOUNDED_CYCLE',
      definition.entryNodeId,
      'Graph contains a cycle outside a bounded loop or recovery.',
    );
  const reachable = reach(definition.entryNodeId);
  // Recovery-only subgraphs are executable too; include them in reachability without redefining regions.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const route of routes)
      if (reachable.has(route.sourceNodeId) && !reachable.has(route.targetNodeId)) {
        reachable.add(route.targetNodeId);
        expanded = true;
      }
  }
  for (const id of nodes.keys())
    if (!reachable.has(id))
      issue('WORKFLOW_UNREACHABLE_NODE', id, 'Node cannot be activated from the declared entry.');
  return { issues, routes, loops, parallels };
}
