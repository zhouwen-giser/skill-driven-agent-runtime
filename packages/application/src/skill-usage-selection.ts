import {
  type SkillApplicabilityAssessment,
  type SkillApplicabilityStatus,
  type SkillContextObservation,
  type SkillContextRequirement,
  type SkillContextRequirementResolution,
  type SkillContextResolutionSummary,
  type SkillContextSource,
  type SkillExecutionMode,
  type SkillModeDecision,
  type SkillModeSystemPolicy,
  type SkillTaskBinding,
  type SkillTaskBindingReadiness,
  type SkillTaskProviderCandidateReadiness,
  type SkillTaskReadinessDisposition,
  type SkillTaskReadinessSummary,
  type SkillUsageCandidateSnapshot,
  type SkillUsageSelectionContext,
  type SkillUsageSpecification,
  type TaskAvailabilityArguments,
  type SkillVersion,
} from '../../domain/src/index.js';

import type { SkillTaskReadinessPort } from './ports.js';

const MODES = ['guidance', 'template', 'procedure'] as const;

export class SkillContextRequirementResolver {
  resolve(
    requirements: readonly SkillContextRequirement[],
    observations: readonly SkillContextObservation[],
  ): SkillContextResolutionSummary {
    const byKey = new Map<string, SkillContextObservation>();
    for (const observation of observations) {
      if (
        ![
          'authoritative_context',
          'read_only_query',
          'deterministic_derivation',
          'user_input',
        ].includes(observation.source) ||
        !['available', 'absent', 'unknown'].includes(observation.status)
      )
        throw new SkillUsageDecisionError(
          'SKILL_CONTEXT_EVIDENCE_INVALID',
          'Context observation source or status is unsupported.',
        );
      const key = `${observation.requirementId}\u0000${observation.source}`;
      if (byKey.has(key))
        throw new SkillUsageDecisionError(
          'SKILL_CONTEXT_EVIDENCE_INVALID',
          'Context observations must be unique by requirement and source.',
        );
      if (observation.status === 'available' && !present(observation.evidenceRef))
        throw new SkillUsageDecisionError(
          'SKILL_CONTEXT_EVIDENCE_INVALID',
          'Available context requires a bounded evidence reference.',
        );
      if (observation.status !== 'available' && observation.evidenceRef !== undefined)
        throw new SkillUsageDecisionError(
          'SKILL_CONTEXT_EVIDENCE_INVALID',
          'Unavailable context cannot claim an evidence reference.',
        );
      byKey.set(key, observation);
    }
    const knownRequirements = new Set(requirements.map((item) => item.requirementId));
    if (observations.some((item) => !knownRequirements.has(item.requirementId)))
      throw new SkillUsageDecisionError(
        'SKILL_CONTEXT_EVIDENCE_INVALID',
        'Context observation references an undeclared requirement.',
      );
    const resolutions = requirements.map((requirement) =>
      this.#resolveRequirement(requirement, byKey),
    );
    return freezeContextSummary(resolutions);
  }

  #resolveRequirement(
    requirement: SkillContextRequirement,
    observations: ReadonlyMap<string, SkillContextObservation>,
  ): SkillContextRequirementResolution {
    const attempted: SkillContextSource[] = [];
    let sawUnknown = false;
    let sawMissing = false;
    for (const source of requirement.sourceOrder) {
      attempted.push(source);
      const observation = observations.get(`${requirement.requirementId}\u0000${source}`);
      if (observation === undefined) {
        sawMissing = true;
        continue;
      }
      if (observation.status === 'available') {
        const evidenceRef = observation.evidenceRef;
        if (!present(evidenceRef))
          throw new SkillUsageDecisionError(
            'SKILL_CONTEXT_EVIDENCE_INVALID',
            'Available context requires a bounded evidence reference.',
          );
        return Object.freeze({
          requirementId: requirement.requirementId,
          required: requirement.required,
          status: 'satisfied' as const,
          source,
          evidenceRef,
          attemptedSources: Object.freeze([...attempted]),
        });
      }
      if (observation.status === 'unknown') sawUnknown = true;
    }
    const status = requirement.sourceOrder.includes('user_input')
      ? ('input_required' as const)
      : sawUnknown || sawMissing
        ? ('unknown' as const)
        : ('unsatisfied' as const);
    return Object.freeze({
      requirementId: requirement.requirementId,
      required: requirement.required,
      status,
      attemptedSources: Object.freeze([...attempted]),
    });
  }
}

export class SkillApplicabilityAssessor {
  readonly #contexts: SkillContextRequirementResolver;
  readonly #readiness: SkillTaskReadinessPort;

  constructor(
    dependencies: Readonly<{
      contexts: SkillContextRequirementResolver;
      readiness: SkillTaskReadinessPort;
    }>,
  ) {
    this.#contexts = dependencies.contexts;
    this.#readiness = dependencies.readiness;
  }

  async assess(
    skill: SkillVersion,
    observations: readonly SkillContextObservation[],
    arguments_?: TaskAvailabilityArguments,
    executionContext?: SkillUsageSelectionContext['runtimeExecutionContext'],
  ): Promise<SkillApplicabilityAssessment> {
    const usage = resolveUsage(skill);
    const requirementIds = new Set(usage.contextRequirements.map((item) => item.requirementId));
    const context = this.#contexts.resolve(
      usage.contextRequirements,
      observations.filter((item) => requirementIds.has(item.requirementId)),
    );
    const reported = await this.#readiness.inspect({
      skillId: skill.skillId,
      skillVersion: skill.version,
      taskBindings: usage.taskBindings,
      allowPreferredProviderFallback: usage.adaptive.allowPreferredProviderFallback,
      ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
      ...(executionContext === undefined ? {} : { executionContext }),
    });
    const readiness = validateReadiness(usage.taskBindings, reported);
    const status = applicabilityStatus(context, readiness);
    const reasonCodes = applicabilityReasons(status, context, readiness);
    return Object.freeze({
      skillId: skill.skillId,
      skillVersion: skill.version,
      status,
      reasonCodes: Object.freeze(reasonCodes),
      context,
      readiness,
    });
  }
}

export class SkillModeSelector {
  select(
    skill: SkillVersion,
    applicability: SkillApplicabilityAssessment,
    context: SkillUsageSelectionContext,
  ): SkillModeDecision {
    const usage = resolveUsage(skill);
    const policy = validateModePolicy(context.systemPolicy);
    if (
      !['low', 'medium', 'high', 'critical'].includes(context.risk) ||
      !['not_requested', 'pending', 'confirmed', 'declined'].includes(context.humanConfirmation)
    )
      throw new SkillUsageDecisionError(
        'SKILL_MODE_POLICY_INVALID',
        'Risk or human-confirmation state is unsupported.',
      );
    if (context.humanConfirmation === 'declined') return blocked('human_confirmation_declined');
    if (applicability.status === 'unsatisfied') return blocked('skill_unsatisfied');
    if (applicability.status === 'unknown') return blocked('skill_applicability_unknown');
    const allowed = usage.modes.supported.filter((mode) => policy.allowedModes.includes(mode));
    if (allowed.length === 0) return blocked('no_policy_allowed_mode');
    if (applicability.status === 'partial') {
      if (!policy.allowGuidanceWithIncompleteContext || !allowed.includes('guidance'))
        return blocked('incomplete_context_mode_blocked');
      return selected('guidance', true, context.humanConfirmation, 'incomplete_context_guidance');
    }
    const elevated =
      context.risk === 'high' ||
      context.risk === 'critical' ||
      applicability.readiness.overall === 'restricted';
    let mode: SkillExecutionMode | undefined;
    if (elevated && policy.requireProcedureForHighRisk) {
      if (!allowed.includes('procedure')) return blocked('required_procedure_unavailable');
      mode = 'procedure';
    } else {
      mode =
        (policy.preferredMode !== undefined && allowed.includes(policy.preferredMode)
          ? policy.preferredMode
          : undefined) ??
        (allowed.includes(usage.modes.defaultMode) ? usage.modes.defaultMode : allowed[0]);
    }
    if (mode === undefined) return blocked('no_supported_mode');
    const confirmationRequired =
      elevated ||
      usage.normative.requiredConfirmations.length > 0 ||
      applicability.readiness.bindings.some((item) => item.confirmationRequired);
    return selected(
      mode,
      confirmationRequired,
      context.humanConfirmation,
      elevated ? 'elevated_policy_mode' : 'default_or_preferred_mode',
    );
  }
}

export class SkillUsageCandidateAssessor {
  readonly #applicability: SkillApplicabilityAssessor;
  readonly #modes: SkillModeSelector;

  constructor(
    dependencies: Readonly<{
      applicability: SkillApplicabilityAssessor;
      modes: SkillModeSelector;
    }>,
  ) {
    this.#applicability = dependencies.applicability;
    this.#modes = dependencies.modes;
  }

  async assess(
    skill: SkillVersion,
    context: SkillUsageSelectionContext,
  ): Promise<SkillUsageCandidateSnapshot> {
    const applicability = await this.#applicability.assess(
      skill,
      context.observations,
      context.taskAvailabilityArguments,
      context.runtimeExecutionContext,
    );
    return Object.freeze({
      skillId: skill.skillId,
      skillVersion: skill.version,
      applicability,
      modeDecision: this.#modes.select(skill, applicability, context),
    });
  }
}

function resolveUsage(skill: SkillVersion): SkillUsageSpecification {
  if (skill.usageSpecification === undefined)
    throw new SkillUsageDecisionError(
      'SKILL_USAGE_REQUIRED',
      `Skill ${skill.skillId}@${String(skill.version)} requires a native usage specification.`,
    );
  return skill.usageSpecification;
}

function freezeContextSummary(
  requirements: readonly SkillContextRequirementResolution[],
): SkillContextResolutionSummary {
  const inputRequiredIds = requirements
    .filter((item) => item.required && item.status === 'input_required')
    .map((item) => item.requirementId);
  const unsatisfiedIds = requirements
    .filter((item) => item.required && item.status === 'unsatisfied')
    .map((item) => item.requirementId);
  const unknownIds = requirements
    .filter((item) => item.required && item.status === 'unknown')
    .map((item) => item.requirementId);
  return Object.freeze({
    requirements: Object.freeze([...requirements]),
    satisfied: requirements.filter((item) => item.status === 'satisfied').length,
    total: requirements.length,
    complete: requirements.every((item) => !item.required || item.status === 'satisfied'),
    inputRequiredIds: Object.freeze(inputRequiredIds),
    unsatisfiedIds: Object.freeze(unsatisfiedIds),
    unknownIds: Object.freeze(unknownIds),
  });
}

function validateReadiness(
  bindings: readonly SkillTaskBinding[],
  reported: SkillTaskReadinessSummary,
): SkillTaskReadinessSummary {
  const declared = new Map(bindings.map((item) => [item.bindingId, item]));
  if (reported.bindings.length !== declared.size)
    throw new SkillUsageDecisionError(
      'SKILL_TASK_READINESS_INVALID',
      'Readiness must cover every declared Task binding exactly once.',
    );
  const seen = new Set<string>();
  const snapshots: SkillTaskBindingReadiness[] = reported.bindings.map((item) => {
    const binding = declared.get(item.bindingId);
    if (binding === undefined || seen.has(item.bindingId) || binding.taskType !== item.taskType)
      throw new SkillUsageDecisionError(
        'SKILL_TASK_READINESS_INVALID',
        'Readiness references an unknown, duplicate, or mismatched Task binding.',
      );
    if (!isReadiness(item.disposition))
      throw new SkillUsageDecisionError(
        'SKILL_TASK_READINESS_INVALID',
        'Readiness disposition is unsupported.',
      );
    if (typeof item.confirmationRequired !== 'boolean' || !Array.isArray(item.reasonCodes))
      throw new SkillUsageDecisionError(
        'SKILL_TASK_READINESS_INVALID',
        'Readiness confirmation and reason evidence is invalid.',
      );
    const candidates = item.candidates?.map(validateProviderCandidate);
    const selected = candidates?.filter((candidate) => candidate.selected) ?? [];
    if (
      selected.length > 1 ||
      (selected.length === 1 &&
        (item.selectedProviderId !== selected[0]?.providerId ||
          item.selectedOperationName !== selected[0]?.operationName)) ||
      (selected.length === 0 &&
        (item.selectedProviderId !== undefined || item.selectedOperationName !== undefined))
    )
      throw new SkillUsageDecisionError(
        'SKILL_TASK_READINESS_INVALID',
        'Selected Provider identity does not match candidate evidence.',
      );
    seen.add(item.bindingId);
    return Object.freeze({
      ...item,
      reasonCodes: Object.freeze(item.reasonCodes.map(requireCode)),
      ...(candidates === undefined ? {} : { candidates: Object.freeze(candidates) }),
    });
  });
  const overall = overallReadiness(snapshots);
  if (reported.overall !== overall)
    throw new SkillUsageDecisionError(
      'SKILL_TASK_READINESS_INVALID',
      'Reported overall readiness does not match binding evidence.',
    );
  return Object.freeze({ overall, bindings: Object.freeze(snapshots) });
}

function validateProviderCandidate(
  candidate: SkillTaskProviderCandidateReadiness,
): SkillTaskProviderCandidateReadiness {
  if (
    !present(candidate.providerId) ||
    !present(candidate.operationName) ||
    !isReadiness(candidate.disposition) ||
    !['low', 'medium', 'high', 'critical'].includes(candidate.riskLevel) ||
    !['none', 'best_effort', 'guaranteed'].includes(candidate.reservationMode) ||
    typeof candidate.selected !== 'boolean' ||
    (candidate.reservationMode === 'guaranteed' && !present(candidate.reservationRef))
  )
    throw new SkillUsageDecisionError(
      'SKILL_TASK_READINESS_INVALID',
      'Provider candidate readiness evidence is invalid.',
    );
  return Object.freeze({
    ...candidate,
    attributes: Object.freeze(candidate.attributes.map(requireCode)),
    nextAvailableWindows: Object.freeze(
      candidate.nextAvailableWindows.map((window) => Object.freeze({ ...window })),
    ),
    possibleEffects: Object.freeze([...candidate.possibleEffects]),
    reasonCodes: Object.freeze(candidate.reasonCodes.map(requireCode)),
  });
}

function overallReadiness(
  bindings: readonly SkillTaskBindingReadiness[],
): SkillTaskReadinessDisposition {
  if (bindings.some((item) => item.disposition === 'unavailable')) return 'unavailable';
  if (bindings.some((item) => item.disposition === 'unknown')) return 'unknown';
  if (bindings.some((item) => item.disposition === 'restricted')) return 'restricted';
  return 'ready';
}

function applicabilityStatus(
  context: SkillContextResolutionSummary,
  readiness: SkillTaskReadinessSummary,
): SkillApplicabilityStatus {
  if (context.unsatisfiedIds.length > 0 || readiness.overall === 'unavailable')
    return 'unsatisfied';
  if (context.unknownIds.length > 0 || readiness.overall === 'unknown') return 'unknown';
  if (
    context.inputRequiredIds.length > 0 ||
    context.requirements.some((item) => !item.required && item.status !== 'satisfied')
  )
    return 'partial';
  return 'satisfied';
}

function applicabilityReasons(
  status: SkillApplicabilityStatus,
  context: SkillContextResolutionSummary,
  readiness: SkillTaskReadinessSummary,
): string[] {
  return [
    `applicability_${status}`,
    ...(context.inputRequiredIds.length > 0 ? ['context_input_required'] : []),
    ...(context.unsatisfiedIds.length > 0 ? ['required_context_unsatisfied'] : []),
    ...(context.unknownIds.length > 0 ? ['required_context_unknown'] : []),
    ...(readiness.overall === 'restricted' ? ['task_readiness_restricted'] : []),
    ...(readiness.overall === 'unavailable' ? ['task_readiness_unavailable'] : []),
    ...(readiness.overall === 'unknown' ? ['task_readiness_unknown'] : []),
  ];
}

function validateModePolicy(policy: SkillModeSystemPolicy): SkillModeSystemPolicy {
  if (
    typeof policy.requireProcedureForHighRisk !== 'boolean' ||
    typeof policy.allowGuidanceWithIncompleteContext !== 'boolean' ||
    !Array.isArray(policy.allowedModes) ||
    policy.allowedModes.length === 0 ||
    new Set(policy.allowedModes).size !== policy.allowedModes.length ||
    policy.allowedModes.some((mode) => !isMode(mode)) ||
    (policy.preferredMode !== undefined && !isMode(policy.preferredMode))
  )
    throw new SkillUsageDecisionError(
      'SKILL_MODE_POLICY_INVALID',
      'System mode policy contains unsupported or duplicate modes.',
    );
  return policy;
}

function selected(
  mode: SkillExecutionMode,
  confirmationRequired: boolean,
  confirmation: SkillUsageSelectionContext['humanConfirmation'],
  reason: string,
): SkillModeDecision {
  return Object.freeze({
    decision: 'selected',
    mode,
    confirmationRequired,
    confirmationSatisfied: !confirmationRequired || confirmation === 'confirmed',
    reasonCodes: Object.freeze([
      reason,
      ...(confirmationRequired && confirmation !== 'confirmed'
        ? ['human_confirmation_pending']
        : []),
    ]),
  });
}

function blocked(reason: string): SkillModeDecision {
  return Object.freeze({ decision: 'blocked', reasonCodes: Object.freeze([reason]) });
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.length <= 512;
}

function requireCode(value: string): string {
  if (!present(value))
    throw new SkillUsageDecisionError(
      'SKILL_TASK_READINESS_INVALID',
      'Readiness reason codes must be bounded non-empty strings.',
    );
  return value;
}

function isReadiness(value: unknown): value is SkillTaskReadinessDisposition {
  return ['ready', 'restricted', 'unavailable', 'unknown'].includes(String(value));
}

function isMode(value: unknown): value is SkillExecutionMode {
  return typeof value === 'string' && MODES.some((mode) => mode === value);
}

export type SkillUsageDecisionErrorCode =
  | 'SKILL_CONTEXT_EVIDENCE_INVALID'
  | 'SKILL_MODE_POLICY_INVALID'
  | 'SKILL_TASK_READINESS_INVALID'
  | 'SKILL_USAGE_REQUIRED';

export class SkillUsageDecisionError extends Error {
  readonly code: SkillUsageDecisionErrorCode;
  constructor(code: SkillUsageDecisionErrorCode, message: string) {
    super(message);
    this.name = 'SkillUsageDecisionError';
    this.code = code;
  }
}
