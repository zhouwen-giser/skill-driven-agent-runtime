import {
  LIVE_RUNTIME_EXECUTION_CONTEXT,
  type SkillProviderPolicy,
  type SkillTaskBinding,
  type SkillTaskBindingReadiness,
  type SkillTaskProviderCandidateReadiness,
  type SkillTaskReadinessDisposition,
  type SkillTaskReadinessSummary,
  type TaskAvailabilityArguments,
  type TaskAvailabilityCheckResult,
  type TaskAvailabilityReadResult,
} from '../../domain/src/index.js';

import type {
  Clock,
  CurrentMcpProviderBindingAuthorityPort,
  SkillTaskOperationCandidateCatalog,
  SkillTaskReadinessPort,
  TaskAvailabilityBatchReader,
} from './ports.js';

export class FrozenSkillTaskReadinessAdapter implements SkillTaskReadinessPort {
  readonly #operations: SkillTaskOperationCandidateCatalog;
  readonly #availability: TaskAvailabilityBatchReader;
  readonly #clock: Clock;
  readonly #providerBindings: CurrentMcpProviderBindingAuthorityPort | undefined;
  readonly #resolveArguments:
    ((binding: SkillTaskBinding) => TaskAvailabilityArguments) | undefined;

  constructor(
    dependencies: Readonly<{
      operations: SkillTaskOperationCandidateCatalog;
      availability: TaskAvailabilityBatchReader;
      clock: Clock;
      providerBindings?: CurrentMcpProviderBindingAuthorityPort;
      resolveArguments?: (binding: SkillTaskBinding) => TaskAvailabilityArguments;
    }>,
  ) {
    this.#operations = dependencies.operations;
    this.#availability = dependencies.availability;
    this.#clock = dependencies.clock;
    this.#providerBindings = dependencies.providerBindings;
    this.#resolveArguments = dependencies.resolveArguments;
  }

  async inspect(input: Parameters<SkillTaskReadinessPort['inspect']>[0]) {
    const bindings = await Promise.all(
      input.taskBindings.map((binding) =>
        this.#inspectBinding(binding, input.allowPreferredProviderFallback, input.arguments),
      ),
    );
    return Object.freeze({
      overall: overallReadiness(bindings),
      bindings: Object.freeze(bindings),
    });
  }

  async #inspectBinding(
    binding: SkillTaskBinding,
    allowPreferredFallback: boolean,
    arguments_: TaskAvailabilityArguments | undefined,
  ): Promise<SkillTaskBindingReadiness> {
    const registered = await this.#operations.listTaskOperationCandidates(binding.taskType);
    const eligible = policyCandidates(registered, binding.providerPolicy, allowPreferredFallback);
    if (eligible.length === 0)
      return emptyBindingReadiness(binding, emptyReason(registered.length, binding.providerPolicy));
    const inspected = await Promise.all(
      eligible.map(async (candidate) => {
        const bindingAuthorityFailure = await this.#currentBindingFailure(candidate.providerId);
        if (bindingAuthorityFailure !== undefined)
          return candidateReadiness(
            candidate.providerId,
            candidate.operationName,
            'frozen_v1',
            candidate.attributes,
            { kind: 'provider_protocol', errorCode: bindingAuthorityFailure },
            binding.bindingId,
            this.#clock.now(),
          );
        const request = {
          nodeId: binding.bindingId,
          operationName: candidate.operationName,
          arguments: arguments_ ??
            this.#resolveArguments?.(binding) ?? {
              unresolved: true as const,
              knownArguments: {},
              unresolvedPaths: ['$'],
            },
        };
        const outcome = await this.#availability.checkTaskAvailability({
          serverId: candidate.providerId,
          requests: [request],
          executionContext: LIVE_RUNTIME_EXECUTION_CONTEXT,
        });
        return candidateReadiness(
          candidate.providerId,
          candidate.operationName,
          'frozen_v1',
          candidate.attributes,
          outcome,
          binding.bindingId,
          this.#clock.now(),
        );
      }),
    );
    const selected = selectCandidate(inspected, binding.providerPolicy);
    const candidates = inspected.map((candidate) =>
      Object.freeze({ ...candidate, selected: candidate === selected }),
    );
    const disposition = selected?.disposition ?? aggregateUnavailable(inspected);
    return Object.freeze({
      bindingId: binding.bindingId,
      taskType: binding.taskType,
      disposition,
      confirmationRequired: disposition === 'restricted' || disposition === 'unknown',
      reasonCodes: Object.freeze(
        selected?.reasonCodes ?? ['SKILL_TASK_PROVIDER_CANDIDATE_UNAVAILABLE'],
      ),
      ...(selected === undefined
        ? {}
        : {
            selectedProviderId: selected.providerId,
            selectedOperationName: selected.operationName,
            selectedProtocolMode: selected.protocolMode,
          }),
      candidates: Object.freeze(candidates),
    });
  }

  async #currentBindingFailure(localServerId: string): Promise<string | undefined> {
    if (this.#providerBindings === undefined) return undefined;
    try {
      const authority = await this.#providerBindings.loadCurrentMcpProviderBinding({
        localServerId,
      });
      if (
        authority.binding.localServerId !== localServerId ||
        Date.parse(authority.binding.availabilityValidUntil) <= Date.parse(this.#clock.now())
      )
        return 'MCP_PROVIDER_BINDING_NOT_CURRENT';
      return undefined;
    } catch {
      return 'MCP_PROVIDER_BINDING_NOT_CURRENT';
    }
  }
}

function policyCandidates(
  candidates: Awaited<
    ReturnType<SkillTaskOperationCandidateCatalog['listTaskOperationCandidates']>
  >,
  policy: SkillProviderPolicy,
  allowPreferredFallback: boolean,
) {
  const eligible = candidates.filter(
    (candidate) =>
      !policy.forbiddenProviderIds.includes(candidate.providerId) &&
      policy.requiredAttributes.every((attribute) => candidate.attributes.includes(attribute)),
  );
  if (policy.selection === 'required')
    return eligible.filter((candidate) => candidate.providerId === policy.requiredProviderId);
  if (policy.selection === 'preferred') {
    const preferred = policy.preferredProviderIds.flatMap((providerId) =>
      eligible.filter((candidate) => candidate.providerId === providerId),
    );
    return allowPreferredFallback
      ? [
          ...preferred,
          ...eligible.filter(
            (candidate) => !policy.preferredProviderIds.includes(candidate.providerId),
          ),
        ]
      : preferred;
  }
  return eligible;
}

function candidateReadiness(
  providerId: string,
  operationName: string,
  protocolMode: 'frozen_v1',
  attributes: readonly string[],
  outcome: TaskAvailabilityReadResult,
  bindingId: string,
  checkedAt: string,
): SkillTaskProviderCandidateReadiness {
  const exact =
    outcome.kind === 'results'
      ? outcome.results.find(
          (result) => result.nodeId === bindingId && result.operationName === operationName,
        )
      : undefined;
  const invalid = availabilityInvalidReason(exact, checkedAt);
  const result = exact ?? unknownResult(bindingId, operationName);
  const disposition =
    invalid !== undefined
      ? 'unknown'
      : result.availability === 'available'
        ? 'ready'
        : result.availability === 'restricted'
          ? 'restricted'
          : result.availability === 'disabled'
            ? 'unavailable'
            : 'unknown';
  const outcomeReason = outcome.kind === 'results' ? undefined : outcome.errorCode;
  return Object.freeze({
    providerId,
    operationName,
    protocolMode,
    attributes: Object.freeze([...attributes]),
    disposition,
    riskLevel: invalid === undefined ? result.riskLevel : 'high',
    ...(invalid === undefined && result.validUntil !== undefined
      ? { validUntil: result.validUntil }
      : {}),
    ...(invalid === undefined && result.earliestStartTime !== undefined
      ? { earliestStartTime: result.earliestStartTime }
      : {}),
    nextAvailableWindows: Object.freeze(
      invalid === undefined
        ? result.nextAvailableWindows.map((window) => Object.freeze({ ...window }))
        : [],
    ),
    reservationMode: invalid === undefined ? result.reservationMode : 'none',
    ...(invalid === undefined && result.reservationRef !== undefined
      ? { reservationRef: result.reservationRef }
      : {}),
    possibleEffects: Object.freeze([...result.possibleEffects]),
    selected: false,
    reasonCodes: Object.freeze(
      [invalid, outcomeReason, result.reasonCode].filter(
        (reason): reason is string => reason !== undefined,
      ),
    ),
  });
}

function availabilityInvalidReason(
  result: TaskAvailabilityCheckResult | undefined,
  checkedAt: string,
): string | undefined {
  if (result === undefined) return 'MCP_TASK_AVAILABILITY_RESPONSE_INVALID';
  if (result.validUntil !== undefined && Date.parse(result.validUntil) <= Date.parse(checkedAt))
    return 'MCP_TASK_AVAILABILITY_EXPIRED';
  if (
    result.availability === 'restricted' &&
    (result.validUntil === undefined ||
      (result.earliestStartTime === undefined && result.nextAvailableWindows.length === 0))
  )
    return 'MCP_TASK_AVAILABILITY_RESTRICTED_HINTS_MISSING';
  if (
    result.reservationMode === 'guaranteed' &&
    (result.reservationRef === undefined || result.reservationRef.trim() === '')
  )
    return 'MCP_TASK_AVAILABILITY_RESERVATION_INVALID';
  return undefined;
}

function selectCandidate(
  candidates: readonly SkillTaskProviderCandidateReadiness[],
  policy: SkillProviderPolicy,
): SkillTaskProviderCandidateReadiness | undefined {
  const acceptable = candidates.filter(
    (candidate) => candidate.disposition === 'ready' || candidate.disposition === 'restricted',
  );
  if (policy.selection === 'preferred') {
    for (const providerId of policy.preferredProviderIds) {
      const preferred = acceptable.find((candidate) => candidate.providerId === providerId);
      if (preferred !== undefined) return preferred;
    }
  }
  return acceptable.find((candidate) => candidate.disposition === 'ready') ?? acceptable[0];
}

function emptyBindingReadiness(
  binding: SkillTaskBinding,
  reason: string,
): SkillTaskBindingReadiness {
  return Object.freeze({
    bindingId: binding.bindingId,
    taskType: binding.taskType,
    disposition: 'unavailable',
    confirmationRequired: false,
    reasonCodes: Object.freeze([reason]),
    candidates: Object.freeze([]),
  });
}

function emptyReason(registeredCount: number, policy: SkillProviderPolicy): string {
  if (registeredCount === 0) return 'SKILL_TASK_TYPE_NOT_REGISTERED';
  if (policy.selection === 'required') return 'SKILL_TASK_REQUIRED_PROVIDER_UNAVAILABLE';
  if (policy.requiredAttributes.length > 0) return 'SKILL_TASK_PROVIDER_ATTRIBUTES_UNSATISFIED';
  return 'SKILL_TASK_PROVIDER_POLICY_EXCLUDED_ALL';
}

function aggregateUnavailable(
  candidates: readonly SkillTaskProviderCandidateReadiness[],
): SkillTaskReadinessDisposition {
  return candidates.some((candidate) => candidate.disposition === 'unknown')
    ? 'unknown'
    : 'unavailable';
}

function overallReadiness(
  bindings: readonly SkillTaskBindingReadiness[],
): SkillTaskReadinessSummary['overall'] {
  if (bindings.some((binding) => binding.disposition === 'unavailable')) return 'unavailable';
  if (bindings.some((binding) => binding.disposition === 'unknown')) return 'unknown';
  if (bindings.some((binding) => binding.disposition === 'restricted')) return 'restricted';
  return 'ready';
}

function unknownResult(nodeId: string, operationName: string): TaskAvailabilityCheckResult {
  return {
    nodeId,
    operationName,
    availability: 'unknown',
    riskLevel: 'high',
    nextAvailableWindows: [],
    reservationMode: 'none',
    possibleEffects: [],
  };
}
