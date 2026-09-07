import { DomainError } from './errors.js';

export interface WorkflowLoopInvocation {
  readonly invocationId: string;
  readonly iteration: number;
  readonly active: boolean;
}
export interface WorkflowForkInvocation {
  readonly invocationId: string;
  readonly forkNodeId: string;
  readonly branchIds: readonly string[];
  readonly arrivals: Readonly<Record<string, string>>;
  readonly closed: boolean;
}
export interface WorkflowOutputSource {
  readonly forkInvocationId: string;
  readonly branchId: string;
  readonly nodeRunId: string;
}
export interface WorkflowScopeState {
  readonly loops: Readonly<Record<string, WorkflowLoopInvocation>>;
  readonly forks: Readonly<Record<string, WorkflowForkInvocation>>;
  readonly outputSources: Readonly<Record<string, readonly WorkflowOutputSource[]>>;
}
export function emptyWorkflowScopes(): WorkflowScopeState {
  return { loops: {}, forks: {}, outputSources: {} };
}
export function mergeWorkflowScopes(
  left: WorkflowScopeState,
  right: WorkflowScopeState,
): WorkflowScopeState {
  const forks = { ...left.forks };
  for (const [id, next] of Object.entries(right.forks)) {
    const previous = forks[id];
    if (previous?.invocationId !== next.invocationId) {
      if (previous !== undefined && !previous.closed)
        throw new DomainError('WORKFLOW_FORK_REENTRY', 'An active fork cannot be reentered.');
      forks[id] = next;
    } else {
      for (const [branch, arrival] of Object.entries(next.arrivals))
        if (previous.arrivals[branch] !== undefined && previous.arrivals[branch] !== arrival)
          throw new DomainError(
            'WORKFLOW_BRANCH_ARRIVAL_CONFLICT',
            'A branch has conflicting arrival identities.',
          );
      forks[id] = {
        ...next,
        closed: previous.closed || next.closed,
        arrivals: { ...previous.arrivals, ...next.arrivals },
      };
    }
  }
  const outputSources = { ...left.outputSources };
  for (const [slot, sources] of Object.entries(right.outputSources)) {
    const merged = [...(outputSources[slot] ?? [])];
    for (const source of sources) {
      if (
        merged.some(
          (old) =>
            old.forkInvocationId === source.forkInvocationId && old.branchId !== source.branchId,
        )
      )
        throw new DomainError(
          'WORKFLOW_OUTPUT_CONFLICT',
          `Parallel branches both wrote output slot ${slot}.`,
        );
      if (
        !merged.some(
          (old) =>
            old.forkInvocationId === source.forkInvocationId &&
            old.branchId === source.branchId &&
            old.nodeRunId === source.nodeRunId,
        )
      )
        merged.push(source);
    }
    outputSources[slot] = merged;
  }
  return { loops: { ...left.loops, ...right.loops }, forks, outputSources };
}

export function snapshotWorkflowScopes(value: unknown): WorkflowScopeState {
  const invalid = (): never => {
    throw new DomainError(
      'WORKFLOW_CONTINUATION_STATE_INVALID',
      'Invalid invocation-scoped continuation state.',
    );
  };
  const record = (input: unknown): Record<string, unknown> => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
    return input as Record<string, unknown>;
  };
  const id = (input: unknown): string =>
    typeof input === 'string' && input.length > 0 && input.length <= 1024 ? input : invalid();
  const root = record(value);
  if (Object.keys(root).some((key) => !['loops', 'forks', 'outputSources'].includes(key)))
    invalid();
  const loops = Object.fromEntries(
    Object.entries(record(root['loops'])).map(([key, raw]) => {
      const item = record(raw);
      if (
        Object.keys(item).length !== 3 ||
        typeof item['iteration'] !== 'number' ||
        !Number.isSafeInteger(item['iteration']) ||
        item['iteration'] < 0 ||
        typeof item['active'] !== 'boolean'
      )
        return invalid();
      return [
        id(key),
        Object.freeze({
          invocationId: id(item['invocationId']),
          iteration: item['iteration'],
          active: item['active'],
        }),
      ];
    }),
  );
  const forks = Object.fromEntries(
    Object.entries(record(root['forks'])).map(([key, raw]) => {
      const item = record(raw);
      if (
        Object.keys(item).length !== 5 ||
        typeof item['closed'] !== 'boolean' ||
        !Array.isArray(item['branchIds'])
      )
        return invalid();
      const branchIds = item['branchIds'].map(id);
      if (
        branchIds.length < 2 ||
        new Set(branchIds).size !== branchIds.length ||
        item['forkNodeId'] !== key
      )
        return invalid();
      const arrivals = Object.fromEntries(
        Object.entries(record(item['arrivals'])).map(([branch, arrival]) => {
          if (!branchIds.includes(branch)) return invalid();
          return [branch, id(arrival)];
        }),
      );
      if (item['closed'] && branchIds.some((branch) => arrivals[branch] === undefined)) invalid();
      return [
        id(key),
        Object.freeze({
          invocationId: id(item['invocationId']),
          forkNodeId: key,
          branchIds: Object.freeze(branchIds),
          arrivals: Object.freeze(arrivals),
          closed: item['closed'],
        }),
      ];
    }),
  );
  const outputSources = Object.fromEntries(
    Object.entries(record(root['outputSources'])).map(([key, raw]) => {
      if (!Array.isArray(raw)) return invalid();
      const sources = raw.map((source: unknown) => {
        const item = record(source);
        if (Object.keys(item).length !== 3) return invalid();
        return Object.freeze({
          forkInvocationId: id(item['forkInvocationId']),
          branchId: id(item['branchId']),
          nodeRunId: id(item['nodeRunId']),
        });
      });
      return [id(key), Object.freeze(sources)];
    }),
  );
  const state = {
    loops: Object.freeze(loops),
    forks: Object.freeze(forks),
    outputSources: Object.freeze(outputSources),
  };
  mergeWorkflowScopes(emptyWorkflowScopes(), state);
  return Object.freeze(state);
}
