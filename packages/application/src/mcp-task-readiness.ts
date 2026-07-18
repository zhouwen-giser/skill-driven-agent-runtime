import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  LIVE_RUNTIME_EXECUTION_CONTEXT,
  normalizeTaskTimestamp,
  type DslExecutionReadiness,
  type DslRiskAction,
  type DslRiskDecision,
  type McpTaskExecutionSpec,
  type McpTaskOperationSemantics,
  type ResolvedMcpTaskExecution,
  type RuntimeExecutionContext,
  type TaskAvailabilityArguments,
  type TaskAvailabilityCheckRequest,
  type TaskAvailabilityCheckResult,
  type TaskAvailabilityReadResult,
  type TaskAvailabilitySnapshot,
  type TaskExecutionTiming,
  type WorkflowBoundValue,
  type WorkflowDefinition,
} from '../../domain/src/index.js';
import type {
  Clock,
  McpTaskOperationCatalog,
  StructuredModelProvider,
  TaskAvailabilityBatchReader,
  TaskAvailabilityEvidenceRepository,
} from './ports.js';

const RiskDecisionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('proceed'),
      acceptedRiskNodeIds: z.array(z.string().min(1)).max(128),
      summary: z.string().min(1).max(4_096),
    })
    .strict(),
  z
    .object({
      action: z.literal('reschedule'),
      nodeId: z.string().min(1),
      selectedStartTime: z.string().min(1),
      summary: z.string().min(1).max(4_096),
    })
    .strict(),
  z.object({ action: z.literal('revise_dsl'), summary: z.string().min(1).max(4_096) }).strict(),
  z
    .object({
      action: z.literal('request_confirmation'),
      riskNodeIds: z.array(z.string().min(1)).max(128),
      summary: z.string().min(1).max(4_096),
    })
    .strict(),
  z.object({ action: z.literal('abort'), summary: z.string().min(1).max(4_096) }).strict(),
]);

export const DSL_RISK_DECISION_SCHEMA = Object.freeze({
  oneOf: [
    decisionObject('proceed', {
      acceptedRiskNodeIds: {
        type: 'array',
        maxItems: 128,
        items: { type: 'string', minLength: 1 },
      },
    }),
    decisionObject('reschedule', {
      nodeId: { type: 'string', minLength: 1 },
      selectedStartTime: { type: 'string', minLength: 1 },
    }),
    decisionObject('revise_dsl'),
    decisionObject('request_confirmation', {
      riskNodeIds: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1 } },
    }),
    decisionObject('abort'),
  ],
});

export interface TaskRiskDecider {
  decide(
    input: Readonly<{
      planId: string;
      attempt: number;
      snapshots: readonly TaskAvailabilitySnapshot[];
      permittedActions: readonly DslRiskAction[];
      taskId?: string;
    }>,
  ): Promise<DslRiskDecision>;
}

export class StructuredTaskRiskDecider implements TaskRiskDecider {
  readonly #model: StructuredModelProvider;
  constructor(model: StructuredModelProvider) {
    this.#model = model;
  }

  async decide(input: Parameters<TaskRiskDecider['decide']>[0]): Promise<DslRiskDecision> {
    const raw = await this.#model.generateStructured({
      stage: 'execution_decision',
      instruction: JSON.stringify({
        operation: 'mcp_task_availability_risk_decision',
        policy:
          'Choose exactly one permitted action. Forecasts are not locks. Disabled is never overridable. Do not provide private reasoning.',
        planId: input.planId,
        attempt: input.attempt,
        permittedActions: input.permittedActions,
        snapshots: input.snapshots.map((snapshot) => ({
          nodeId: snapshot.nodeId,
          operationName: snapshot.operationName,
          availability: snapshot.result.availability,
          riskLevel: snapshot.result.riskLevel,
          validUntil: snapshot.result.validUntil,
          earliestStartTime: snapshot.result.earliestStartTime,
          nextAvailableWindows: snapshot.result.nextAvailableWindows,
          reservationMode: snapshot.result.reservationMode,
          possibleEffects: snapshot.result.possibleEffects,
        })),
      }),
      responseSchema: DSL_RISK_DECISION_SCHEMA,
      correctionErrors: [],
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    });
    const parsed = RiskDecisionSchema.safeParse(raw);
    if (!parsed.success || !input.permittedActions.includes(parsed.data.action))
      throw new TaskReadinessError(
        'DSL_RISK_DECISION_INVALID',
        'Model risk decision was invalid or selected an action outside the deterministic allowlist.',
      );
    return parsed.data;
  }
}

export type WorkflowCandidateReadinessAssessment =
  | Readonly<{ accepted: true; readiness: DslExecutionReadiness }>
  | Readonly<{
      accepted: false;
      readiness: DslExecutionReadiness;
      correctionErrors: readonly string[];
      terminal: boolean;
    }>;

export interface WorkflowCandidateReadinessPolicy {
  assess(
    input: Readonly<{
      planId: string;
      attempt: number;
      definition: WorkflowDefinition;
      executionContext?: RuntimeExecutionContext;
      taskId?: string;
    }>,
  ): Promise<WorkflowCandidateReadinessAssessment>;
}

interface CandidateRequest {
  readonly nodeId: string;
  readonly serverId: string;
  readonly semantics: McpTaskOperationSemantics;
  readonly request: TaskAvailabilityCheckRequest;
}

export class McpTaskReadinessService implements WorkflowCandidateReadinessPolicy {
  readonly #operations: McpTaskOperationCatalog;
  readonly #provider: TaskAvailabilityBatchReader;
  readonly #evidence: TaskAvailabilityEvidenceRepository;
  readonly #riskDecider: TaskRiskDecider;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextReadinessId(): string; nextSnapshotId(): string }>;

  constructor(
    dependencies: Readonly<{
      operations: McpTaskOperationCatalog;
      provider: TaskAvailabilityBatchReader;
      evidence: TaskAvailabilityEvidenceRepository;
      riskDecider: TaskRiskDecider;
      clock: Clock;
      ids: Readonly<{ nextReadinessId(): string; nextSnapshotId(): string }>;
    }>,
  ) {
    this.#operations = dependencies.operations;
    this.#provider = dependencies.provider;
    this.#evidence = dependencies.evidence;
    this.#riskDecider = dependencies.riskDecider;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async assess(input: Parameters<WorkflowCandidateReadinessPolicy['assess']>[0]) {
    const createdAt = this.#clock.now();
    const readinessId = this.#ids.nextReadinessId();
    const prepared = await this.#preparePlanningRequests(input.definition);
    if (prepared.blockerCodes.length > 0) {
      const readiness = this.#readiness({
        readinessId,
        input,
        createdAt,
        disposition: 'blocked',
        permittedActions: ['revise_dsl', 'abort'],
        guardAction: 'abort',
        guardReasonCodes: prepared.blockerCodes,
        confirmationRequired: false,
      });
      await this.#evidence.saveEvaluation(readiness, []);
      return {
        accepted: false,
        readiness,
        correctionErrors: prepared.blockerCodes,
        terminal: false,
      } as const;
    }
    if (prepared.requests.length === 0) {
      const readiness = this.#readiness({
        readinessId,
        input,
        createdAt,
        disposition: 'ready',
        permittedActions: ['proceed'],
        guardAction: 'proceed',
        guardReasonCodes: [],
        confirmationRequired: false,
      });
      await this.#evidence.saveEvaluation(readiness, []);
      return { accepted: true, readiness } as const;
    }

    const outcomes = await this.#readGroups(
      prepared.requests,
      input.executionContext ?? LIVE_RUNTIME_EXECUTION_CONTEXT,
    );
    const snapshots = this.#snapshots({
      readinessId,
      planId: input.planId,
      planAttempt: input.attempt,
      phase: 'planning',
      checkedAt: createdAt,
      requests: prepared.requests,
      outcomes,
    });
    const hardBlockers = hardBlockerCodes(outcomes, snapshots);
    if (hardBlockers.length > 0) {
      const readiness = this.#readiness({
        readinessId,
        input,
        createdAt,
        disposition: 'blocked',
        permittedActions: ['revise_dsl', 'abort'],
        guardAction: 'abort',
        guardReasonCodes: hardBlockers,
        confirmationRequired: false,
      });
      await this.#evidence.saveEvaluation(readiness, snapshots);
      return {
        accepted: false,
        readiness,
        correctionErrors: hardBlockers,
        terminal: false,
      } as const;
    }

    const risky = snapshots.filter((snapshot) => snapshot.result.availability !== 'available');
    if (risky.length === 0) {
      const readiness = this.#readiness({
        readinessId,
        input,
        createdAt,
        disposition: 'ready',
        permittedActions: ['proceed'],
        guardAction: 'proceed',
        guardReasonCodes: [],
        confirmationRequired: false,
      });
      await this.#evidence.saveEvaluation(readiness, snapshots);
      return { accepted: true, readiness } as const;
    }

    const includesUnknown = risky.some((snapshot) => snapshot.result.availability === 'unknown');
    const permittedActions: readonly DslRiskAction[] = includesUnknown
      ? ['revise_dsl', 'request_confirmation', 'abort']
      : ['proceed', 'reschedule', 'revise_dsl', 'request_confirmation', 'abort'];
    let decision: DslRiskDecision;
    try {
      decision = await this.#riskDecider.decide({
        planId: input.planId,
        attempt: input.attempt,
        snapshots: risky,
        permittedActions,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      });
    } catch (error: unknown) {
      const code = stableCode(error, 'DSL_RISK_DECISION_INVALID');
      const readiness = this.#readiness({
        readinessId,
        input,
        createdAt,
        disposition: 'blocked',
        permittedActions,
        guardAction: 'abort',
        guardReasonCodes: [code],
        confirmationRequired: false,
      });
      await this.#evidence.saveEvaluation(readiness, snapshots);
      return { accepted: false, readiness, correctionErrors: [code], terminal: false } as const;
    }

    const guarded = guardPlanningDecision(decision, risky);
    const readiness = this.#readiness({
      readinessId,
      input,
      createdAt,
      disposition: guarded.disposition,
      permittedActions,
      modelDecision: decision,
      guardAction: guarded.action,
      guardReasonCodes: guarded.reasonCodes,
      confirmationRequired: guarded.disposition === 'confirmation_required',
    });
    await this.#evidence.saveEvaluation(readiness, snapshots);
    return guarded.disposition === 'ready' || guarded.disposition === 'confirmation_required'
      ? ({ accepted: true, readiness } as const)
      : ({
          accepted: false,
          readiness,
          correctionErrors: guarded.reasonCodes,
          terminal: guarded.action === 'abort',
        } as const);
  }

  async assertPreInvocation(
    input: Readonly<{
      planId: string;
      planAttempt: number;
      definition: WorkflowDefinition;
      planConfirmed: boolean;
      workflowInstanceId: string;
      workflowNodeId: string;
      workflowNodeRunId: string;
      serverId: string;
      operationName: string;
      arguments: Readonly<Record<string, unknown>>;
      taskExecution: ResolvedMcpTaskExecution;
      executionContext: RuntimeExecutionContext;
      signal?: AbortSignal;
    }>,
  ): Promise<ResolvedMcpTaskExecution> {
    const semantics = await this.#operations.getTaskOperationSemantics({
      serverId: input.serverId,
      toolName: input.operationName,
    });
    const capabilityErrors = validateCapabilities(semantics, input.taskExecution);
    const checkedAt = this.#clock.now();
    const readinessId = this.#ids.nextReadinessId();
    const base = {
      planId: input.planId,
      attempt: input.planAttempt,
      definition: input.definition,
    };
    if (capabilityErrors.length > 0) {
      const readiness = this.#readiness({
        readinessId,
        input: base,
        createdAt: checkedAt,
        disposition: 'blocked',
        permittedActions: ['abort'],
        guardAction: 'abort',
        guardReasonCodes: capabilityErrors,
        confirmationRequired: false,
        checkPhase: 'pre_invocation',
        workflowInstanceId: input.workflowInstanceId,
        workflowNodeRunId: input.workflowNodeRunId,
      });
      await this.#evidence.saveEvaluation(readiness, []);
      throw new TaskReadinessError('MCP_TASK_PRECALL_NOT_READY', capabilityErrors.join('; '));
    }
    if (semantics === undefined)
      throw new TaskReadinessError(
        'MCP_TASK_PRECALL_NOT_READY',
        'WORKFLOW_TASK_EXECUTION_UNSUPPORTED',
      );
    const request: TaskAvailabilityCheckRequest = {
      nodeId: input.workflowNodeId,
      operationName: input.operationName,
      arguments: { unresolved: false, value: input.arguments },
      ...(input.taskExecution.timing === undefined ? {} : { timing: input.taskExecution.timing }),
    };
    const outcome = await this.#provider.checkTaskAvailability({
      serverId: input.serverId,
      requests: [request],
      executionContext: input.executionContext,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const snapshots = this.#snapshots({
      readinessId,
      planId: input.planId,
      planAttempt: input.planAttempt,
      phase: 'pre_invocation',
      workflowInstanceId: input.workflowInstanceId,
      workflowNodeRunId: input.workflowNodeRunId,
      checkedAt,
      requests: [
        {
          nodeId: input.workflowNodeId,
          serverId: input.serverId,
          semantics,
          request,
        },
      ],
      outcomes: new Map([[input.serverId, outcome]]),
    });
    const result = snapshots[0]?.result;
    const planningEvidence = await this.#evidence.findLatestPlanning(input.planId);
    const planningResult = planningEvidence?.snapshots.find(
      (snapshot) => snapshot.nodeId === input.workflowNodeId,
    )?.result;
    const restrictedCoveredByConfirmation =
      result?.availability === 'restricted' &&
      input.planConfirmed &&
      planningResult?.availability === 'restricted' &&
      !hasIncreasedRisk(planningResult, result);
    const allowed = result?.availability === 'available' || restrictedCoveredByConfirmation;
    const reasonCodes =
      result === undefined
        ? [
            outcome.kind === 'results'
              ? 'MCP_TASK_AVAILABILITY_RESPONSE_INVALID'
              : outcome.errorCode,
          ]
        : result.availability === 'restricted' && !restrictedCoveredByConfirmation
          ? ['MCP_TASK_AVAILABILITY_RECONFIRM_REQUIRED']
          : result.availability === 'disabled'
            ? ['MCP_TASK_AVAILABILITY_DISABLED']
            : result.availability === 'unknown'
              ? ['MCP_TASK_AVAILABILITY_UNKNOWN']
              : [];
    const readiness = this.#readiness({
      readinessId,
      input: base,
      createdAt: checkedAt,
      disposition: allowed ? 'ready' : 'blocked',
      permittedActions: allowed ? ['proceed'] : ['abort'],
      guardAction: allowed ? 'proceed' : 'abort',
      guardReasonCodes: reasonCodes,
      confirmationRequired: false,
      checkPhase: 'pre_invocation',
      workflowInstanceId: input.workflowInstanceId,
      workflowNodeRunId: input.workflowNodeRunId,
    });
    await this.#evidence.saveEvaluation(readiness, snapshots);
    if (!allowed)
      throw new TaskReadinessError('MCP_TASK_PRECALL_NOT_READY', reasonCodes.join('; '));
    return deepFreeze({
      ...input.taskExecution,
      ...(result.reservationMode === 'guaranteed' && result.reservationRef !== undefined
        ? { reservationRef: result.reservationRef }
        : {}),
    });
  }

  async #preparePlanningRequests(definition: WorkflowDefinition): Promise<
    Readonly<{
      requests: readonly CandidateRequest[];
      blockerCodes: readonly string[];
    }>
  > {
    const requests: CandidateRequest[] = [];
    const blockerCodes: string[] = [];
    for (const node of definition.nodes) {
      if (node.type !== 'mcp_tool') continue;
      const semantics = await this.#operations.getTaskOperationSemantics(node.tool);
      if (node.taskExecution === undefined && semantics?.execution !== 'task_required') continue;
      const execution = planningExecution(node.taskExecution, semantics);
      const errors = validateCapabilities(semantics, execution);
      if (errors.length > 0) {
        blockerCodes.push(...errors.map((code) => `${code}:${node.nodeId}`));
        continue;
      }
      if (semantics === undefined || execution === undefined) continue;
      requests.push({
        nodeId: node.nodeId,
        serverId: node.tool.serverId,
        semantics,
        request: {
          nodeId: node.nodeId,
          operationName: node.tool.toolName,
          arguments: partitionArguments(node.arguments),
          ...(execution.timing === undefined ? {} : { timing: execution.timing }),
        },
      });
    }
    return { requests, blockerCodes };
  }

  async #readGroups(
    requests: readonly CandidateRequest[],
    executionContext: RuntimeExecutionContext,
  ): Promise<ReadonlyMap<string, TaskAvailabilityReadResult>> {
    const groups = new Map<string, CandidateRequest[]>();
    for (const request of requests)
      groups.set(request.serverId, [...(groups.get(request.serverId) ?? []), request]);
    const outcomes = await Promise.all(
      [...groups].map(
        async ([serverId, group]) =>
          [
            serverId,
            await this.#provider.checkTaskAvailability({
              serverId,
              requests: group.map((item) => item.request),
              executionContext,
            }),
          ] as const,
      ),
    );
    return new Map(outcomes);
  }

  #snapshots(
    input: Readonly<{
      readinessId: string;
      planId: string;
      planAttempt: number;
      phase: DslExecutionReadiness['checkPhase'];
      workflowInstanceId?: string;
      workflowNodeRunId?: string;
      checkedAt: string;
      requests: readonly CandidateRequest[];
      outcomes: ReadonlyMap<string, TaskAvailabilityReadResult>;
    }>,
  ): readonly TaskAvailabilitySnapshot[] {
    return input.requests.map((candidate) => {
      const outcome = input.outcomes.get(candidate.serverId);
      const exact =
        outcome?.kind === 'results'
          ? outcome.results.find(
              (result) =>
                result.nodeId === candidate.request.nodeId &&
                result.operationName === candidate.request.operationName,
            )
          : undefined;
      const normalized = normalizeAvailability(
        exact ?? syntheticUnknown(candidate.request, outcome),
        input.checkedAt,
      );
      return deepFreeze({
        snapshotId: this.#ids.nextSnapshotId(),
        readinessId: input.readinessId,
        workflowPlanId: input.planId,
        planAttempt: input.planAttempt,
        checkPhase: input.phase,
        ...(input.workflowInstanceId === undefined
          ? {}
          : { workflowInstanceId: input.workflowInstanceId }),
        ...(input.workflowNodeRunId === undefined
          ? {}
          : { workflowNodeRunId: input.workflowNodeRunId }),
        nodeId: candidate.request.nodeId,
        serverId: candidate.serverId,
        operationName: candidate.request.operationName,
        arguments: candidate.request.arguments,
        argumentsHash: canonicalHash(candidate.request.arguments),
        ...(candidate.request.timing === undefined ? {} : { timing: candidate.request.timing }),
        result: normalized.result,
        sourceRevision:
          outcome?.kind === 'results'
            ? `${outcome.protocolRevision}/${outcome.availabilitySchemaRevision}`
            : (outcome?.kind ?? 'missing'),
        checkedAt: input.checkedAt,
        normalizationReasonCodes: normalized.reasonCodes,
      });
    });
  }

  #readiness(
    input: Readonly<{
      readinessId: string;
      input: Readonly<{ planId: string; attempt: number; definition: WorkflowDefinition }>;
      createdAt: string;
      disposition: DslExecutionReadiness['disposition'];
      permittedActions: readonly DslRiskAction[];
      modelDecision?: DslRiskDecision;
      guardAction: DslRiskAction;
      guardReasonCodes: readonly string[];
      confirmationRequired: boolean;
      checkPhase?: DslExecutionReadiness['checkPhase'];
      workflowInstanceId?: string;
      workflowNodeRunId?: string;
    }>,
  ): DslExecutionReadiness {
    return deepFreeze({
      readinessId: input.readinessId,
      workflowPlanId: input.input.planId,
      planAttempt: input.input.attempt,
      checkPhase: input.checkPhase ?? 'planning',
      ...(input.workflowInstanceId === undefined
        ? {}
        : { workflowInstanceId: input.workflowInstanceId }),
      ...(input.workflowNodeRunId === undefined
        ? {}
        : { workflowNodeRunId: input.workflowNodeRunId }),
      dslHash: canonicalHash(input.input.definition),
      disposition: input.disposition,
      permittedActions: input.permittedActions,
      ...(input.modelDecision === undefined ? {} : { modelDecision: input.modelDecision }),
      guardAction: input.guardAction,
      guardReasonCodes: input.guardReasonCodes,
      confirmationRequired: input.confirmationRequired,
      createdAt: input.createdAt,
    });
  }
}

function planningExecution(
  spec: McpTaskExecutionSpec | undefined,
  semantics: McpTaskOperationSemantics | undefined,
): ResolvedMcpTaskExecution | undefined {
  if (spec === undefined) {
    return semantics?.execution === 'task_required'
      ? { mode: 'require_task', availabilityCheck: 'required' }
      : undefined;
  }
  const timing = planningTiming(spec);
  if (spec.protocolMode === 'frozen_v1')
    return {
      protocolMode: 'frozen_v1',
      availabilityCheck: spec.availabilityCheck ?? 'best_effort',
      ...(timing === undefined ? {} : { timing }),
      ...(spec.reservationRef === undefined ? {} : { reservationRef: spec.reservationRef }),
    };
  return {
    mode: spec.mode,
    availabilityCheck:
      spec.availabilityCheck ?? (spec.mode === 'require_task' ? 'required' : 'best_effort'),
    ...(timing === undefined ? {} : { timing }),
    ...(spec.reservationRef === undefined ? {} : { reservationRef: spec.reservationRef }),
  };
}

function planningTiming(spec: McpTaskExecutionSpec): TaskExecutionTiming | undefined {
  if (spec.timing === undefined) return undefined;
  if (spec.timing.start.mode === 'scheduled') {
    if (typeof spec.timing.start.scheduledAt !== 'string') return undefined;
    return {
      start: {
        mode: 'scheduled',
        scheduledAt: normalizeTaskTimestamp(spec.timing.start.scheduledAt),
        startToleranceMs: spec.timing.start.startToleranceMs,
      },
      maxElapsedMs: spec.timing.maxElapsedMs ?? null,
    };
  }
  return {
    start: {
      mode: 'immediate',
      startToleranceMs: spec.timing.start.startToleranceMs,
    },
    maxElapsedMs: spec.timing.maxElapsedMs ?? null,
  };
}

function validateCapabilities(
  semantics: McpTaskOperationSemantics | undefined,
  execution: ResolvedMcpTaskExecution | undefined,
): readonly string[] {
  if (execution === undefined) return [];
  if (semantics === undefined || semantics.execution === 'unknown')
    return ['WORKFLOW_TASK_EXECUTION_UNSUPPORTED'];
  if (
    execution.protocolMode !== 'frozen_v1' &&
    execution.mode === 'require_task' &&
    semantics.execution === 'synchronous'
  )
    return ['WORKFLOW_TASK_EXECUTION_UNSUPPORTED'];
  if (execution.timing?.start.mode === 'scheduled' && !semantics.supportsScheduling)
    return ['WORKFLOW_TASK_SCHEDULING_UNSUPPORTED'];
  if (
    execution.timing?.maxElapsedMs !== null &&
    execution.timing?.maxElapsedMs !== undefined &&
    !semantics.supportsMaxElapsed
  )
    return ['WORKFLOW_TASK_MAX_ELAPSED_UNSUPPORTED'];
  if (semantics.availability !== 'dynamic' && execution.availabilityCheck === 'required')
    return ['MCP_TASK_AVAILABILITY_CAPABILITY_REQUIRED'];
  return [];
}

function partitionArguments(value: WorkflowBoundValue): TaskAvailabilityArguments {
  const unresolvedPaths: string[] = [];
  const known = partitionValue(value, '$', unresolvedPaths);
  if (unresolvedPaths.length === 0 && isRecord(known)) return { unresolved: false, value: known };
  return {
    unresolved: true,
    knownArguments: isRecord(known) ? known : {},
    unresolvedPaths,
  };
}

const OMIT = Symbol('omit');
function partitionValue(
  value: WorkflowBoundValue,
  path: string,
  unresolvedPaths: string[],
): WorkflowBoundValue | typeof OMIT {
  if (isReference(value)) {
    unresolvedPaths.push(path);
    return OMIT;
  }
  if (isWorkflowBoundArray(value)) {
    const output: WorkflowBoundValue[] = [];
    for (const [index, item] of value.entries()) {
      const partitioned = partitionValue(item, `${path}[${String(index)}]`, unresolvedPaths);
      if (partitioned === OMIT) return OMIT;
      output.push(partitioned);
    }
    return output;
  }
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const partitioned = partitionValue(item, `${path}.${key}`, unresolvedPaths);
        return partitioned === OMIT ? [] : [[key, partitioned]];
      }),
    );
  return value;
}

function isWorkflowBoundArray(value: WorkflowBoundValue): value is readonly WorkflowBoundValue[] {
  return Array.isArray(value);
}

function isReference(
  value: WorkflowBoundValue,
): value is Readonly<{ op: 'ref'; path: readonly string[] }> {
  return isRecord(value) && value.op === 'ref' && Array.isArray(value.path);
}

function normalizeAvailability(
  result: TaskAvailabilityCheckResult,
  checkedAt: string,
): Readonly<{ result: TaskAvailabilityCheckResult; reasonCodes: readonly string[] }> {
  const reasons: string[] = [];
  if (
    result.availability === 'restricted' &&
    (result.validUntil === undefined ||
      (result.earliestStartTime === undefined && result.nextAvailableWindows.length === 0))
  )
    reasons.push('MCP_TASK_AVAILABILITY_RESTRICTED_HINTS_MISSING');
  if (result.validUntil !== undefined && Date.parse(result.validUntil) <= Date.parse(checkedAt))
    reasons.push('MCP_TASK_AVAILABILITY_EXPIRED');
  if (reasons.length === 0) return { result, reasonCodes: [] };
  return {
    result: {
      ...result,
      availability: 'unknown',
      riskLevel: 'high',
      reasonCode: reasons[0] ?? 'MCP_TASK_AVAILABILITY_UNKNOWN',
      reservationMode: 'none',
      nextAvailableWindows: [],
      possibleEffects: result.possibleEffects,
    },
    reasonCodes: reasons,
  };
}

function syntheticUnknown(
  request: TaskAvailabilityCheckRequest,
  outcome: TaskAvailabilityReadResult | undefined,
): TaskAvailabilityCheckResult {
  return {
    nodeId: request.nodeId,
    operationName: request.operationName,
    availability: 'unknown',
    riskLevel: 'high',
    reasonCode:
      outcome === undefined || outcome.kind === 'results'
        ? 'MCP_TASK_AVAILABILITY_RESPONSE_INVALID'
        : outcome.errorCode,
    nextAvailableWindows: [],
    reservationMode: 'none',
    possibleEffects: [],
  };
}

function hardBlockerCodes(
  outcomes: ReadonlyMap<string, TaskAvailabilityReadResult>,
  snapshots: readonly TaskAvailabilitySnapshot[],
): readonly string[] {
  const codes: string[] = [];
  for (const outcome of outcomes.values())
    if (
      outcome.kind === 'contract_invalid' ||
      outcome.kind === 'provider_protocol' ||
      outcome.kind === 'capability_missing'
    )
      codes.push(outcome.errorCode);
  for (const snapshot of snapshots) {
    if (snapshot.result.availability === 'disabled')
      codes.push(`MCP_TASK_AVAILABILITY_DISABLED:${snapshot.nodeId}`);
    if (
      snapshot.result.reservationMode === 'guaranteed' &&
      (snapshot.result.reservationRef === undefined || snapshot.result.reservationRef.trim() === '')
    )
      codes.push(`MCP_TASK_AVAILABILITY_RESERVATION_INVALID:${snapshot.nodeId}`);
  }
  return [...new Set(codes)];
}

function guardPlanningDecision(
  decision: DslRiskDecision,
  snapshots: readonly TaskAvailabilitySnapshot[],
): Readonly<{
  disposition: DslExecutionReadiness['disposition'];
  action: DslRiskAction;
  reasonCodes: readonly string[];
}> {
  const riskIds = new Set(snapshots.map((snapshot) => snapshot.nodeId));
  if (decision.action === 'abort')
    return { disposition: 'blocked', action: 'abort', reasonCodes: ['DSL_RISK_ABORTED'] };
  if (decision.action === 'revise_dsl')
    return {
      disposition: 'revision_required',
      action: 'revise_dsl',
      reasonCodes: ['DSL_EXECUTION_REQUIRES_REVISION'],
    };
  if (decision.action === 'reschedule') {
    const snapshot = snapshots.find((item) => item.nodeId === decision.nodeId);
    if (snapshot === undefined || !isAllowedStart(decision.selectedStartTime, snapshot.result))
      return {
        disposition: 'blocked',
        action: 'abort',
        reasonCodes: ['DSL_RISK_RESCHEDULE_INVALID'],
      };
    return {
      disposition: 'revision_required',
      action: 'reschedule',
      reasonCodes: [
        `DSL_RISK_RESCHEDULE:${decision.nodeId}:${normalizeTaskTimestamp(decision.selectedStartTime)}`,
      ],
    };
  }
  const selectedIds =
    decision.action === 'proceed' ? decision.acceptedRiskNodeIds : decision.riskNodeIds;
  if (selectedIds.length !== riskIds.size || selectedIds.some((nodeId) => !riskIds.has(nodeId)))
    return { disposition: 'blocked', action: 'abort', reasonCodes: ['DSL_RISK_NODE_SET_INVALID'] };
  return {
    disposition: 'confirmation_required',
    action: 'request_confirmation',
    reasonCodes: snapshots.map(
      (snapshot) => `MCP_TASK_RISK_CONFIRMATION_REQUIRED:${snapshot.nodeId}`,
    ),
  };
}

function isAllowedStart(value: string, result: TaskAvailabilityCheckResult): boolean {
  let normalized: string;
  try {
    normalized = normalizeTaskTimestamp(value);
  } catch {
    return false;
  }
  if (
    result.earliestStartTime !== undefined &&
    normalized === normalizeTaskTimestamp(result.earliestStartTime)
  )
    return true;
  const milliseconds = Date.parse(normalized);
  return result.nextAvailableWindows.some(
    (window) =>
      milliseconds >= Date.parse(window.startTime) && milliseconds < Date.parse(window.endTime),
  );
}

function hasIncreasedRisk(
  planned: TaskAvailabilityCheckResult,
  current: TaskAvailabilityCheckResult,
): boolean {
  const riskRank = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  const reservationRank = { none: 0, best_effort: 1, guaranteed: 2 } as const;
  if (riskRank[current.riskLevel] > riskRank[planned.riskLevel]) return true;
  if (reservationRank[current.reservationMode] < reservationRank[planned.reservationMode])
    return true;
  if (current.possibleEffects.some((effect) => !planned.possibleEffects.includes(effect)))
    return true;
  if (
    planned.validUntil !== undefined &&
    (current.validUntil === undefined ||
      Date.parse(current.validUntil) < Date.parse(planned.validUntil))
  )
    return true;
  if (
    planned.earliestStartTime !== undefined &&
    (current.earliestStartTime === undefined ||
      Date.parse(current.earliestStartTime) > Date.parse(planned.earliestStartTime))
  )
    return true;
  return false;
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function decisionObject(action: DslRiskAction, properties: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action', ...Object.keys(properties), 'summary'],
    properties: {
      action: { const: action },
      ...properties,
      summary: { type: 'string', minLength: 1, maxLength: 4_096 },
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableCode(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : fallback;
}

export type TaskReadinessErrorCode = 'DSL_RISK_DECISION_INVALID' | 'MCP_TASK_PRECALL_NOT_READY';

export class TaskReadinessError extends Error {
  readonly code: TaskReadinessErrorCode;
  constructor(code: TaskReadinessErrorCode, message: string) {
    super(message);
    this.name = 'TaskReadinessError';
    this.code = code;
  }
}
