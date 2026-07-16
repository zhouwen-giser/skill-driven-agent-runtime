import { normalizeTaskTimestamp } from '../../domain/src/index.js';
import type {
  McpTaskExecutionSpec,
  ResolvedMcpTaskExecution,
  TaskExecutionTiming,
  WorkflowBoundValue,
} from '../../domain/src/index.js';
import { resolveWorkflowBoundValue, type WorkflowBindingContext } from './bound-value-resolver.js';

export function resolveMcpTaskExecution(
  spec: McpTaskExecutionSpec,
  context: WorkflowBindingContext,
): ResolvedMcpTaskExecution {
  const timing = spec.timing === undefined ? undefined : resolveTiming(spec.timing, context);
  return deepFreeze({
    mode: spec.mode,
    availabilityCheck:
      spec.availabilityCheck ?? (spec.mode === 'require_task' ? 'required' : 'best_effort'),
    ...(timing === undefined ? {} : { timing }),
  });
}

function resolveTiming(
  timing: NonNullable<McpTaskExecutionSpec['timing']>,
  context: WorkflowBindingContext,
): TaskExecutionTiming {
  const start =
    timing.start.mode === 'immediate'
      ? { mode: 'immediate' as const, startToleranceMs: timing.start.startToleranceMs }
      : {
          mode: 'scheduled' as const,
          scheduledAt: normalizeRfc3339(
            resolveWorkflowBoundValue(timing.start.scheduledAt, context),
          ),
          startToleranceMs: timing.start.startToleranceMs,
        };
  return { start, maxElapsedMs: timing.maxElapsedMs ?? null };
}

export function normalizeRfc3339(value: WorkflowBoundValue): string {
  if (typeof value !== 'string')
    throw new McpTaskTimingError(
      'MCP_TASK_SCHEDULED_AT_UNRESOLVED',
      'scheduledAt must resolve to an RFC 3339 string.',
    );
  try {
    return normalizeTaskTimestamp(value);
  } catch {
    throw new McpTaskTimingError(
      'MCP_TASK_TIMING_INVALID',
      'scheduledAt must be a real RFC 3339 timestamp with an explicit timezone.',
    );
  }
}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  for (const item of Object.values(value))
    if (typeof item === 'object' && item !== null) deepFreeze(item);
  return value;
}

export type McpTaskTimingErrorCode = 'MCP_TASK_TIMING_INVALID' | 'MCP_TASK_SCHEDULED_AT_UNRESOLVED';

export class McpTaskTimingError extends Error {
  readonly code: McpTaskTimingErrorCode;
  constructor(code: McpTaskTimingErrorCode, message: string) {
    super(message);
    this.name = 'McpTaskTimingError';
    this.code = code;
  }
}
