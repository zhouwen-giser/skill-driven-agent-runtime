import { createHash } from 'node:crypto';

import {
  applyConservativeRulePlanPatch,
  evaluateDecisionRule,
  hashRuleRuntimeValue,
  parseRuleRuntimeDsl,
  planPatchCandidateFromAction,
  resolveRuleConflicts,
  ruleSpecificity,
  type CognitiveSourceRef,
  type CompiledArtifact,
  type FormalPlanHandoffResult,
  type Goal,
  type RuleConflictCandidate,
  type RuleConflictResolution,
  type RuleDecisionContext,
  type RuleDecisionResult,
  type RuleOperandObservation,
  type RulePlanPatchCandidate,
  type RuleRuntime,
  type UserGoalCompletionContract,
  type UserGoalPlan,
} from '../../../domain/src/index.js';
import type {
  ArtifactExecutionCompletion,
  ArtifactExecutionRecord,
  ArtifactExecutionStart,
  ArtifactFeedbackInput,
} from './artifact-persistence.js';
import type {
  InteractivePlanningSessionView,
  MaterializedPlanningCandidateInput,
} from '../cognitive/interactive-planning-session-service.js';
import type { UserGoalPlanCandidateValidator } from '../cognitive/user-goal-plan-candidate-validator.js';

export const RULE_RUNTIME_EVALUATOR_VERSION = 'p09-evaluator.1' as const;
export const RULE_RUNTIME_RESOLVER_VERSION = 'p09-resolver.1' as const;
export const RULE_RUNTIME_REASON_CODE_VERSION = 'decision-rule-runtime/1.1' as const;

export const P09_REASON_CODES = Object.freeze([
  'RULE_ACTIVE',
  'RULE_NON_ACTIVE',
  'RULE_STALE',
  'RULE_TENANT_MISMATCH',
  'RULE_KILL_SWITCH_ACTIVE',
  'RULE_GOAL_VERSION_STALE',
  'RULE_PLAN_VERSION_STALE',
  'RULE_POLICY_CHANGED',
  'RULE_CATALOG_CHANGED',
  'RULE_READINESS_CHANGED',
  'RULE_REQUIRED_TRUE',
  'RULE_REQUIRED_FALSE',
  'RULE_REQUIRED_UNKNOWN',
  'RULE_FORBIDDEN_TRUE',
  'RULE_FORBIDDEN_FALSE',
  'RULE_CONFIRMATION_TRUE',
  'RULE_CONFIRMATION_UNKNOWN',
  'RULE_ADVISORY_TRUE',
  'RULE_OPERATOR_TYPE_MISMATCH',
  'RULE_EVALUATION_BOUND_EXCEEDED',
  'RULE_CONFLICT_DENY_OVERRIDES',
  'RULE_CONFLICT_CONFIRMATION_OVERRIDES',
  'RULE_CONFLICT_MORE_SPECIFIC',
  'RULE_CONFLICT_PRIORITY',
  'RULE_CONFLICT_COMPATIBLE_COMBINATION',
  'RULE_CONFLICT_AMBIGUOUS',
  'RULE_POLICY_ALLOW',
  'RULE_POLICY_DENY',
  'RULE_POLICY_CONFIRM',
  'RULE_AUTHORIZED',
  'RULE_AUTHORIZATION_MISSING',
  'RULE_AUTHORIZATION_STALE',
  'RULE_DECISION_ADVICE',
  'RULE_DECISION_CONFIRM',
  'RULE_DECISION_DENY',
  'RULE_DECISION_FALLBACK',
  'RULE_DECISION_NO_MATCH',
  'RULE_PARAMETER_SUGGESTED',
  'RULE_PLAN_PATCH_PROPOSED',
  'RULE_PLAN_PATCH_VALIDATOR_REJECTED',
  'RULE_FORMAL_HANDOFF_SUBMITTED',
  'RULE_FORMAL_HANDOFF_COMMITTED',
  'RULE_FORMAL_HANDOFF_FAILED',
  'RULE_DISCARDED_STALE',
] as const);

export interface RuleRuntimeCurrentState {
  readonly artifact: CompiledArtifact;
  readonly activePointerVersion: number;
  readonly tenantId: string;
  readonly goalContractRef?: string;
  readonly goalVersion?: number;
  readonly goalHash?: string;
  readonly planRef?: string;
  readonly planVersion?: number;
  readonly planHash?: string;
  readonly requestSnapshotRef: string;
  readonly worldStateSnapshotRef?: string;
  readonly businessEventRefs: readonly string[];
  readonly parameterBindingRef: string;
  readonly capabilityReadinessRef: string;
  readonly policyDecisionRef: string;
  readonly dependencyValidationRef: string;
  readonly authorizationRefs: readonly string[];
  readonly capabilityCatalogHash: string;
  readonly policySnapshotHash: string;
  readonly readinessHash: string;
  readonly killSwitchActive: boolean;
  readonly operands: readonly RuleOperandObservation[];
  readonly formalPlanning?: Readonly<{
    readonly goal: Goal;
    readonly contract: UserGoalCompletionContract;
    readonly plan: UserGoalPlan;
  }>;
}

export interface RuleRuntimeStateReader {
  read(input: RuleDecisionContext): Promise<RuleRuntimeCurrentState>;
}

export interface RulePolicyAuthorityDecision {
  readonly decision: 'allow' | 'deny' | 'require_confirmation';
  readonly decisionRef: string;
  readonly snapshotHash: string;
  readonly reasonCodes: readonly string[];
}

/** Thin read-only adapter to the existing policy authority; it owns no policy rules. */
export interface RulePolicyAuthorityPort {
  decide(
    input: Readonly<{
      context: RuleDecisionContext;
      artifact: CompiledArtifact;
      policyDecisionRef: string;
      policySnapshotHash: string;
    }>,
  ): Promise<RulePolicyAuthorityDecision>;
}

export interface RuleAuthorizationDecision {
  readonly authorized: boolean;
  readonly stale: boolean;
  readonly checkRef: string;
  readonly authorizationRefs: readonly string[];
  readonly tenantId: string;
  readonly reasonCodes: readonly string[];
}

/** Trusted identity/authorization facts are injected; request actor fields are never accepted. */
export interface RuleAuthorizationPort {
  check(
    input: Readonly<{
      context: RuleDecisionContext;
      artifact: CompiledArtifact;
      requiredAuthorizationRefs: readonly string[];
    }>,
  ): Promise<RuleAuthorizationDecision>;
}

/**
 * P09 usage storage is an idempotent adapter over P02's canonical
 * artifact_execution/artifact_feedback records.
 */
export interface RuleUsageRepository {
  startOrLoad(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord>;
  completeOnce(input: ArtifactExecutionCompletion): Promise<void>;
  appendFeedbackOnce(input: ArtifactFeedbackInput): Promise<void>;
}

export interface RuleRevalidationSignalPort {
  signal(
    input: Readonly<{
      triggerId: string;
      artifactId: string;
      artifactVersion: number;
      artifactRef: string;
      severity: 'normal' | 'urgent' | 'critical';
      sourceRefs: readonly string[];
      createdAt: string;
    }>,
  ): Promise<void>;
}

export interface RulePlanValidatorPort {
  validate(
    contract: UserGoalCompletionContract,
    plan: UserGoalPlan,
  ): Readonly<{ valid: boolean; errorCodes: readonly string[] }>;
}

export interface RulePlanningAuthorityPort {
  submit(
    input: Readonly<{
      taskId: string;
      userId: string;
      goalSessionId: string;
      confirmedContractCandidateId: string;
      sourceRefs: readonly CognitiveSourceRef[];
      goal: Goal;
      contract: UserGoalCompletionContract;
      plan: UserGoalPlan;
      patchCandidate: RulePlanPatchCandidate;
      requiresManualConfirmation: true;
      createdAt: string;
    }>,
  ): Promise<FormalPlanHandoffResult>;
}

export interface RuleFormalHandoffContext {
  readonly taskId: string;
  readonly userId: string;
  readonly goalSessionId: string;
  readonly confirmedContractCandidateId: string;
  readonly sourceRefs: readonly CognitiveSourceRef[];
}

export interface RuleDecisionRequest {
  readonly contexts: readonly RuleDecisionContext[];
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly formalHandoff?: RuleFormalHandoffContext;
  /** P10 supplies this only on the request path; P09 remains usable standalone. */
  readonly commitGuard?: Readonly<{ mayCommitFormalAuthority(): boolean }>;
}

export interface RuleDecision {
  readonly decisionId: string;
  readonly requestRef: string;
  readonly disposition:
    | 'advice'
    | 'require_confirmation'
    | 'deny'
    | 'fallback'
    | 'plan_patch_candidate'
    | 'no_match'
    | 'discarded_stale'
    | 'failed';
  readonly selectedRuleRefs: readonly string[];
  readonly advice?: unknown;
  readonly planPatchCandidateRef?: string;
  readonly policyDecisionRef: string;
  readonly authorizationCheckRef: string;
  readonly reasonCodes: readonly string[];
  readonly runtimeSnapshotHash: string;
  readonly createdAt: string;
}

export interface RuleDecisionOutcome {
  readonly evaluations: readonly RuleDecisionResult[];
  readonly resolution: RuleConflictResolution;
  readonly decision: RuleDecision;
  readonly planPatchCandidate?: RulePlanPatchCandidate;
  readonly formalHandoff?: FormalPlanHandoffResult;
}

export type RuleDriftKind =
  | 'false_positive'
  | 'false_negative'
  | 'unsafe_allow'
  | 'missed_confirmation'
  | 'user_correction'
  | 'plan_patch_rejection'
  | 'fallback'
  | 'outcome_regression'
  | 'environment_novelty'
  | 'policy_change'
  | 'readiness_change';

interface EvaluationWork {
  readonly context: RuleDecisionContext;
  readonly state: RuleRuntimeCurrentState;
  readonly evaluation: RuleDecisionResult;
  readonly policy: RulePolicyAuthorityDecision;
  readonly authorization: RuleAuthorizationDecision;
  readonly executionId: string;
}

/**
 * Internal P09 application service. P10 may orchestrate this port, but P09
 * deliberately exposes no HTTP/A2A/Fast-Gateway request entry.
 */
export class DecisionRuleRuntimeService implements RuleRuntime {
  readonly #states: RuleRuntimeStateReader;
  readonly #policy: RulePolicyAuthorityPort;
  readonly #authorization: RuleAuthorizationPort;
  readonly #usage: RuleUsageRepository;
  readonly #validator: RulePlanValidatorPort;
  readonly #planning: RulePlanningAuthorityPort;
  readonly #revalidation: RuleRevalidationSignalPort;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      states: RuleRuntimeStateReader;
      policy: RulePolicyAuthorityPort;
      authorization: RuleAuthorizationPort;
      usage: RuleUsageRepository;
      validator: RulePlanValidatorPort;
      planning: RulePlanningAuthorityPort;
      revalidation: RuleRevalidationSignalPort;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#states = dependencies.states;
    this.#policy = dependencies.policy;
    this.#authorization = dependencies.authorization;
    this.#usage = dependencies.usage;
    this.#validator = dependencies.validator;
    this.#planning = dependencies.planning;
    this.#revalidation = dependencies.revalidation;
    this.#clock = dependencies.clock;
  }

  async evaluate(input: RuleDecisionContext): Promise<RuleDecisionResult> {
    const work = await this.#evaluateOne(input, input.requestRef, input.requestRef);
    await this.#recordEvaluationFeedback(work, undefined);
    return work.evaluation;
  }

  async evaluateDecisionRules(input: RuleDecisionRequest): Promise<RuleDecisionOutcome> {
    if (input.contexts.length === 0 || input.contexts.length > 256) {
      throw new RuleRuntimeApplicationError(
        'RULE_EVALUATION_BOUND_EXCEEDED',
        'Rule decision request must contain a bounded non-empty context set.',
      );
    }
    if (input.idempotencyKey.trim() === '') {
      throw new RuleRuntimeApplicationError(
        'RULE_IDEMPOTENCY_KEY_REQUIRED',
        'Rule decision idempotency key is required.',
      );
    }
    const requestRef = input.contexts[0]?.requestRef;
    if (
      requestRef === undefined ||
      input.contexts.some((context) => context.requestRef !== requestRef)
    ) {
      throw new RuleRuntimeApplicationError(
        'RULE_REQUEST_CONTEXT_MISMATCH',
        'All Rule contexts must belong to one request.',
      );
    }
    const work = await Promise.all(
      input.contexts.map((context) =>
        this.#evaluateOne(context, input.taskId, input.idempotencyKey),
      ),
    );
    const policyDecision = strongestPolicy(work.map((item) => item.policy.decision));
    const resolution = this.resolveRuleConflicts(
      work.map((item) => ({
        evaluation: item.evaluation,
        priority: decisionRulePriority(item.state.artifact),
        specificity: ruleSpecificity(item.state.artifact, parseRuleRuntimeDsl(item.state.artifact)),
        artifactVersion: item.state.artifact.version,
        ...decisionRuleConflictGroup(item.state.artifact),
      })),
      policyDecision,
    );
    let decision = materializeDecision(work, resolution, this.#clock.now());
    let planPatchCandidate: RulePlanPatchCandidate | undefined;
    let formalHandoff: FormalPlanHandoffResult | undefined;

    const selected = work.find((item) =>
      resolution.selectedRuleRefs.includes(item.evaluation.ruleRef),
    );
    if (
      selected?.evaluation.proposedAction === 'propose_plan_patch' &&
      decision.disposition !== 'deny' &&
      decision.disposition !== 'require_confirmation'
    ) {
      const planning = selected.state.formalPlanning;
      if (planning === undefined) {
        decision = withDecisionFailure(decision, 'RULE_PLAN_PATCH_VALIDATOR_REJECTED', 'fallback');
      } else {
        try {
          planPatchCandidate = planPatchCandidateFromAction(selected.evaluation.actionPayload, {
            goalContractRef:
              selected.context.goalContractRef ??
              selected.state.formalPlanning?.contract.goalId ??
              '',
            goalVersion: planning.contract.goalVersion,
            planRef: planning.plan.planId,
            planVersion: planning.plan.revision,
            sourceRuleRefs: resolution.selectedRuleRefs,
          });
          const revisedPlan = applyConservativeRulePlanPatch(
            planning.plan,
            planPatchCandidate,
            this.#clock.now(),
          );
          const validation = this.#validator.validate(planning.contract, revisedPlan);
          if (!validation.valid) {
            throw new RuleRuntimeApplicationError(
              'RULE_PLAN_PATCH_VALIDATOR_REJECTED',
              validation.errorCodes.join(','),
            );
          }
          decision = {
            ...decision,
            disposition: 'plan_patch_candidate',
            planPatchCandidateRef: planPatchCandidate.patchCandidateId,
            reasonCodes: unique([...decision.reasonCodes, 'RULE_PLAN_PATCH_PROPOSED']),
          };
          if (input.formalHandoff !== undefined) {
            if (input.commitGuard?.mayCommitFormalAuthority() === false) {
              throw new RuleRuntimeApplicationError(
                'RULE_FORMAL_HANDOFF_FAILED',
                'Gateway deadline or cancellation expired before formal Rule handoff.',
              );
            }
            const current = await this.#recheckForHandoff(selected);
            if (input.commitGuard?.mayCommitFormalAuthority() === false) {
              throw new RuleRuntimeApplicationError(
                'RULE_FORMAL_HANDOFF_FAILED',
                'Gateway deadline or cancellation expired during Rule recheck.',
              );
            }
            formalHandoff = await this.submitRulePlanPatchToFormalAuthority({
              handoff: input.formalHandoff,
              current,
              patchCandidate: planPatchCandidate,
              revisedPlan,
            });
            decision = {
              ...decision,
              reasonCodes: unique([
                ...decision.reasonCodes,
                'RULE_FORMAL_HANDOFF_SUBMITTED',
                ...(formalHandoff.disposition === 'confirmed_and_committed'
                  ? ['RULE_FORMAL_HANDOFF_COMMITTED']
                  : []),
              ]),
            };
          }
        } catch (error) {
          const code = errorCode(error, 'RULE_PLAN_PATCH_VALIDATOR_REJECTED');
          decision = withDecisionFailure(decision, code, 'fallback');
          if (planPatchCandidate !== undefined) {
            await this.recordDrift({
              executionId: selected.executionId,
              artifact: selected.state.artifact,
              artifactRef: selected.evaluation.ruleRef,
              kind: 'plan_patch_rejection',
              sourceRefs: [code],
            });
          }
        }
      }
    }

    await Promise.all(work.map((item) => this.#recordEvaluationFeedback(item, resolution)));
    return Object.freeze({
      evaluations: Object.freeze(work.map((item) => item.evaluation)),
      resolution,
      decision: Object.freeze(decision),
      ...(planPatchCandidate === undefined ? {} : { planPatchCandidate }),
      ...(formalHandoff === undefined ? {} : { formalHandoff }),
    });
  }

  resolveRuleConflicts(
    candidates: readonly RuleConflictCandidate[],
    policyDecision: RulePolicyAuthorityDecision['decision'],
  ): RuleConflictResolution {
    return resolveRuleConflicts(candidates, {
      policyDecision,
      resolverVersion: RULE_RUNTIME_RESOLVER_VERSION,
    });
  }

  async submitRulePlanPatchToFormalAuthority(
    input: Readonly<{
      handoff: RuleFormalHandoffContext;
      current: EvaluationWork;
      patchCandidate: RulePlanPatchCandidate;
      revisedPlan: UserGoalPlan;
    }>,
  ): Promise<FormalPlanHandoffResult> {
    const planning = input.current.state.formalPlanning;
    if (planning === undefined) {
      throw new RuleRuntimeApplicationError(
        'RULE_PLAN_PATCH_VALIDATOR_REJECTED',
        'Formal planning state is unavailable.',
      );
    }
    try {
      const result = await this.#planning.submit({
        ...input.handoff,
        goal: planning.goal,
        contract: planning.contract,
        plan: input.revisedPlan,
        patchCandidate: input.patchCandidate,
        requiresManualConfirmation: true,
        createdAt: this.#clock.now(),
      });
      await this.#usage.appendFeedbackOnce({
        feedbackId: `p09-feedback-${shortHash(
          `${input.current.executionId}:${input.patchCandidate.contentHash}:handoff`,
        )}`,
        artifactExecutionId: input.current.executionId,
        artifactId: input.current.state.artifact.artifactId,
        feedbackType: 'rule_runtime_event',
        reasonCode: 'RULE_FORMAL_HANDOFF_SUBMITTED',
        summary: 'P09 submitted a bounded Rule plan patch to the existing planning authority.',
        impact: {
          eventType: 'artifact.rule_handoff_submitted',
          patchCandidateId: input.patchCandidate.patchCandidateId,
          handoffId: result.handoffId,
          disposition: result.disposition,
        },
        createdAt: this.#clock.now(),
      });
      return result;
    } catch (error) {
      throw new RuleRuntimeApplicationError(
        'RULE_FORMAL_HANDOFF_FAILED',
        error instanceof Error ? error.message : 'Formal handoff failed.',
      );
    }
  }

  async linkFormalOutcome(
    input: Readonly<{
      executionId: string;
      artifactId: string;
      outcomeRef: string;
      decisionRef: string;
      correctionRefs?: readonly string[];
    }>,
  ): Promise<void> {
    await this.#usage.appendFeedbackOnce({
      feedbackId: `p09-feedback-${shortHash(`${input.executionId}:${input.outcomeRef}:outcome`)}`,
      artifactExecutionId: input.executionId,
      artifactId: input.artifactId,
      feedbackType: 'rule_outcome_link',
      reasonCode: 'RULE_OUTCOME_OBSERVED',
      summary: 'P09 linked Rule usage to an existing formal Outcome without copying it.',
      impact: {
        eventType: 'artifact.rule_outcome_observed',
        decisionRef: input.decisionRef,
        correctionRefs: input.correctionRefs ?? [],
      },
      outcomeRef: input.outcomeRef,
      createdAt: this.#clock.now(),
    });
  }

  async recordDrift(
    input: Readonly<{
      executionId: string;
      artifact: CompiledArtifact;
      artifactRef: string;
      kind: RuleDriftKind;
      sourceRefs: readonly string[];
    }>,
  ): Promise<void> {
    const severity = driftSeverity(input.kind);
    const triggerId = `p09-revalidation-${shortHash(
      `${input.artifactRef}:${input.kind}:${input.sourceRefs.join(':')}`,
    )}`;
    await this.#usage.appendFeedbackOnce({
      feedbackId: `p09-feedback-${shortHash(`${input.executionId}:${triggerId}`)}`,
      artifactExecutionId: input.executionId,
      artifactId: input.artifact.artifactId,
      feedbackType: 'rule_drift',
      reasonCode: `RULE_DRIFT_${input.kind.toLocaleUpperCase()}`,
      summary: 'P09 recorded a Rule drift signal; P06 remains lifecycle authority.',
      impact: {
        eventType: 'artifact.rule_drift_detected',
        kind: input.kind,
        severity,
        triggerId,
        sourceRefs: input.sourceRefs,
      },
      createdAt: this.#clock.now(),
    });
    await this.#revalidation.signal({
      triggerId,
      artifactId: input.artifact.artifactId,
      artifactVersion: input.artifact.version,
      artifactRef: input.artifactRef,
      severity,
      sourceRefs: input.sourceRefs,
      createdAt: this.#clock.now(),
    });
  }

  async #evaluateOne(
    context: RuleDecisionContext,
    taskId: string,
    idempotencyKey: string,
  ): Promise<EvaluationWork> {
    const before = await this.#states.read(context);
    assertCurrentContext(context, before);
    const policy = await this.#policy.decide({
      context,
      artifact: before.artifact,
      policyDecisionRef: before.policyDecisionRef,
      policySnapshotHash: before.policySnapshotHash,
    });
    const authorization = await this.#authorization.check({
      context,
      artifact: before.artifact,
      requiredAuthorizationRefs: before.authorizationRefs,
    });
    assertAuthorityContext(context, before, policy, authorization);

    let evaluation = before.killSwitchActive
      ? blockedEvaluation(context, 'deny', 'RULE_KILL_SWITCH_ACTIVE', this.#clock.now())
      : policy.decision === 'deny'
        ? blockedEvaluation(context, 'deny', 'RULE_POLICY_DENY', this.#clock.now())
        : !authorization.authorized || authorization.stale
          ? blockedEvaluation(
              context,
              'deny',
              authorization.stale ? 'RULE_AUTHORIZATION_STALE' : 'RULE_AUTHORIZATION_MISSING',
              this.#clock.now(),
            )
          : evaluateDecisionRule({
              context,
              artifact: before.artifact,
              dsl: parseRuleRuntimeDsl(before.artifact),
              operands: before.operands,
              evaluatorVersion: RULE_RUNTIME_EVALUATOR_VERSION,
              createdAt: this.#clock.now(),
            });
    if (policy.decision === 'require_confirmation' && evaluation.proposedAction !== 'deny') {
      evaluation = overrideEvaluation(evaluation, 'require_confirmation', 'RULE_POLICY_CONFIRM');
    }

    const executionId = `p09-execution-${shortHash(
      `${idempotencyKey}:${context.artifactRef}:${context.artifactHash}:${context.runtimeSnapshotHash}`,
    )}`;
    const execution = await this.#usage.startOrLoad({
      artifactExecutionId: executionId,
      artifactId: before.artifact.artifactId,
      version: before.artifact.version,
      taskId,
      ...(before.goalContractRef === undefined ? {} : { goalId: before.goalContractRef }),
      ...(before.goalVersion === undefined ? {} : { goalVersion: before.goalVersion }),
      mode: 'decision_rule_evaluation',
      decisionSnapshot: {
        p09: true,
        idempotencyKeyHash: hashRuleRuntimeValue(idempotencyKey),
        context,
        evaluation,
        policy,
        authorizationCheckRef: authorization.checkRef,
      },
      startedAt: evaluation.createdAt,
    });

    const after = await this.#states.read(context);
    const afterPolicy = await this.#policy.decide({
      context,
      artifact: after.artifact,
      policyDecisionRef: after.policyDecisionRef,
      policySnapshotHash: after.policySnapshotHash,
    });
    const afterAuthorization = await this.#authorization.check({
      context,
      artifact: after.artifact,
      requiredAuthorizationRefs: after.authorizationRefs,
    });
    const stale =
      hashRuleRuntimeState(before) !== hashRuleRuntimeState(after) ||
      canonical(policy) !== canonical(afterPolicy) ||
      canonical(authorization) !== canonical(afterAuthorization);
    if (stale) {
      evaluation = blockedEvaluation(
        context,
        'fallback',
        'RULE_DISCARDED_STALE',
        evaluation.createdAt,
      );
    } else {
      assertCurrentContext(context, after);
      assertAuthorityContext(context, after, afterPolicy, afterAuthorization);
    }
    if (execution.status === 'started') {
      await this.#usage.completeOnce({
        artifactExecutionId: executionId,
        status: 'completed',
        ...(stale ? { fallbackReasonCode: 'RULE_DISCARDED_STALE' } : {}),
        completedAt: this.#clock.now(),
      });
    }
    return {
      context,
      state: after,
      evaluation,
      policy: afterPolicy,
      authorization: afterAuthorization,
      executionId,
    };
  }

  async #recheckForHandoff(work: EvaluationWork): Promise<EvaluationWork> {
    const context = contextFromState(work);
    const current = await this.#states.read(context);
    assertCurrentContext(context, current);
    const policy = await this.#policy.decide({
      context,
      artifact: current.artifact,
      policyDecisionRef: current.policyDecisionRef,
      policySnapshotHash: current.policySnapshotHash,
    });
    const authorization = await this.#authorization.check({
      context,
      artifact: current.artifact,
      requiredAuthorizationRefs: current.authorizationRefs,
    });
    assertAuthorityContext(context, current, policy, authorization);
    if (
      policy.decision !== 'allow' ||
      !authorization.authorized ||
      authorization.stale ||
      current.killSwitchActive ||
      hashRuleRuntimeState(current) !== hashRuleRuntimeState(work.state)
    ) {
      throw new RuleRuntimeApplicationError(
        'RULE_DISCARDED_STALE',
        'Rule, policy, authorization or runtime state changed before formal handoff.',
      );
    }
    return { ...work, state: current, policy, authorization };
  }

  async #recordEvaluationFeedback(
    work: EvaluationWork,
    resolution: RuleConflictResolution | undefined,
  ): Promise<void> {
    const eventType =
      work.evaluation.proposedAction === 'deny'
        ? 'artifact.rule_denied'
        : work.evaluation.proposedAction === 'require_confirmation'
          ? 'artifact.rule_confirmation_requested'
          : work.evaluation.proposedAction === 'propose_plan_patch'
            ? 'artifact.rule_patch_proposed'
            : work.evaluation.proposedAction === 'no_match'
              ? 'artifact.rule_no_match'
              : 'artifact.rule_evaluated';
    await this.#usage.appendFeedbackOnce({
      feedbackId: `p09-feedback-${shortHash(
        `${work.executionId}:${work.evaluation.resultHash}:${resolution?.resultHash ?? 'single'}`,
      )}`,
      artifactExecutionId: work.executionId,
      artifactId: work.state.artifact.artifactId,
      feedbackType: 'rule_runtime_event',
      reasonCode: reasonForAction(work.evaluation.proposedAction),
      summary: 'P09 deterministic Rule evaluation and conflict evidence.',
      impact: {
        eventType,
        evaluationId: work.evaluation.evaluationId,
        resultHash: work.evaluation.resultHash,
        runtimeSnapshotHash: work.evaluation.runtimeSnapshotHash,
        ...(resolution === undefined
          ? {}
          : {
              resolutionId: resolution.resolutionId,
              resolutionHash: resolution.resultHash,
              selected: resolution.selectedRuleRefs.includes(work.evaluation.ruleRef),
            }),
      },
      createdAt: this.#clock.now(),
    });
  }
}

/**
 * Existing validator adapter. It delegates all DAG/coverage/policy/no-replay
 * checks and introduces no Rule-owned validation rules.
 */
export class ExistingRulePlanValidatorAdapter implements RulePlanValidatorPort {
  readonly #validator: Pick<UserGoalPlanCandidateValidator, 'validate'>;

  constructor(validator: Pick<UserGoalPlanCandidateValidator, 'validate'>) {
    this.#validator = validator;
  }

  validate(
    contract: UserGoalCompletionContract,
    plan: UserGoalPlan,
  ): Readonly<{ valid: boolean; errorCodes: readonly string[] }> {
    const result = this.#validator.validate(contract, plan, 'manual_all');
    return Object.freeze({
      valid: result.valid,
      errorCodes: Object.freeze([...result.errorCodes]),
    });
  }
}

export interface ExistingRulePlanningSessionPort {
  startWithMaterializedCandidate(
    input: MaterializedPlanningCandidateInput,
  ): Promise<InteractivePlanningSessionView>;
}

/**
 * Existing P08/formal planning-session adapter. It never commits a plan by
 * itself; the existing session, confirmation and ConfirmedPlanHandoff do.
 */
export class ExistingRulePlanningAuthorityAdapter implements RulePlanningAuthorityPort {
  readonly #planning: ExistingRulePlanningSessionPort;

  constructor(planning: ExistingRulePlanningSessionPort) {
    this.#planning = planning;
  }

  async submit(
    input: Parameters<RulePlanningAuthorityPort['submit']>[0],
  ): Promise<FormalPlanHandoffResult> {
    const session = await this.#planning.startWithMaterializedCandidate({
      taskId: input.taskId,
      userId: input.userId,
      goalSessionId: input.goalSessionId,
      confirmedContractCandidateId: input.confirmedContractCandidateId,
      goal: input.goal,
      contract: input.contract,
      plan: input.plan,
      sourceRefs: input.sourceRefs,
      experienceHints: [
        `p09-rule-patch:${input.patchCandidate.patchCandidateId}`,
        ...input.patchCandidate.sourceRuleRefs.map((ruleRef) => `p09-rule:${ruleRef}`),
      ],
      requiresManualConfirmation: true,
      confirmationPolicy: 'manual_all',
      planningMetadata: { priorities: {}, parallelGroups: {} },
    });
    return Object.freeze({
      handoffId: `p09-handoff-${shortHash(
        `${input.patchCandidate.contentHash}:${session.session.sessionId}`,
      )}`,
      planCandidateRef: input.patchCandidate.patchCandidateId,
      disposition:
        session.session.state === 'confirmed' ? 'confirmed_and_committed' : 'requires_confirmation',
      formalPlanningSessionRef: session.session.sessionId,
      ...(session.session.state === 'confirmed'
        ? {
            formalPlanRef: input.plan.planId,
            formalPlanVersion: input.plan.revision,
            goalLockRef: `goal-lock:${input.goal.goalId}:${String(input.goal.version)}`,
          }
        : {}),
      validationRef: `p09-validation:${input.plan.contentHash}`,
      reasonCodes: Object.freeze([
        'RULE_FORMAL_HANDOFF_SUBMITTED',
        ...(session.session.state === 'confirmed' ? ['RULE_FORMAL_HANDOFF_COMMITTED'] : []),
      ]),
      completedAt: input.createdAt,
    });
  }
}

export class RuleRuntimeApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuleRuntimeApplicationError';
    this.code = code;
  }
}

export function hashRuleRuntimeState(state: RuleRuntimeCurrentState): string {
  return hashRuleRuntimeValue({
    artifactRef: `${state.artifact.artifactId}:${String(state.artifact.version)}`,
    artifactHash: state.artifact.contentHash,
    artifactStatus: state.artifact.status,
    activePointerVersion: state.activePointerVersion,
    tenantId: state.tenantId,
    goalContractRef: state.goalContractRef,
    goalVersion: state.goalVersion,
    goalHash: state.goalHash,
    planRef: state.planRef,
    planVersion: state.planVersion,
    planHash: state.planHash,
    requestSnapshotRef: state.requestSnapshotRef,
    worldStateSnapshotRef: state.worldStateSnapshotRef,
    businessEventRefs: [...state.businessEventRefs].sort(),
    parameterBindingRef: state.parameterBindingRef,
    capabilityReadinessRef: state.capabilityReadinessRef,
    policyDecisionRef: state.policyDecisionRef,
    dependencyValidationRef: state.dependencyValidationRef,
    authorizationRefs: [...state.authorizationRefs].sort(),
    capabilityCatalogHash: state.capabilityCatalogHash,
    policySnapshotHash: state.policySnapshotHash,
    readinessHash: state.readinessHash,
    killSwitchActive: state.killSwitchActive,
    operands: [...state.operands].sort((left, right) =>
      left.operandRef.localeCompare(right.operandRef),
    ),
    formalPlanHash: state.formalPlanning?.plan.contentHash,
  });
}

function assertCurrentContext(context: RuleDecisionContext, state: RuleRuntimeCurrentState): void {
  const artifactRef = `${state.artifact.artifactId}:${String(state.artifact.version)}`;
  if (state.artifact.artifactType !== 'decision_rule' || state.artifact.status !== 'active') {
    throw new RuleRuntimeApplicationError(
      'RULE_NON_ACTIVE',
      'P09 evaluates only active decision_rule Artifacts.',
    );
  }
  if (
    context.artifactRef !== artifactRef ||
    context.artifactVersion !== state.artifact.version ||
    context.artifactHash !== state.artifact.contentHash ||
    context.activePointerVersion !== state.activePointerVersion
  ) {
    throw new RuleRuntimeApplicationError(
      'RULE_STALE',
      'Rule hash, version or active pointer changed.',
    );
  }
  if (
    context.tenantId !== state.tenantId ||
    (state.artifact.scope.tenantId !== undefined &&
      state.artifact.scope.tenantId !== context.tenantId)
  ) {
    throw new RuleRuntimeApplicationError(
      'RULE_TENANT_MISMATCH',
      'Rule tenant does not match current authority.',
    );
  }
  if (
    context.goalContractRef !== state.goalContractRef ||
    context.goalVersion !== state.goalVersion
  ) {
    throw new RuleRuntimeApplicationError(
      'RULE_GOAL_VERSION_STALE',
      'Goal contract or version changed.',
    );
  }
  if (context.planRef !== state.planRef || context.planVersion !== state.planVersion) {
    throw new RuleRuntimeApplicationError(
      'RULE_PLAN_VERSION_STALE',
      'Plan identity or version changed.',
    );
  }
  if (
    context.requestSnapshotRef !== state.requestSnapshotRef ||
    context.worldStateSnapshotRef !== state.worldStateSnapshotRef ||
    canonical(context.businessEventRefs) !== canonical(state.businessEventRefs) ||
    context.parameterBindingRef !== state.parameterBindingRef ||
    context.capabilityReadinessRef !== state.capabilityReadinessRef ||
    context.policyDecisionRef !== state.policyDecisionRef ||
    context.dependencyValidationRef !== state.dependencyValidationRef
  ) {
    throw new RuleRuntimeApplicationError('RULE_STALE', 'Rule input references changed.');
  }
  if (state.artifact.dependencySnapshot.capabilityCatalogHash !== state.capabilityCatalogHash) {
    throw new RuleRuntimeApplicationError(
      'RULE_CATALOG_CHANGED',
      'Capability Catalog no longer matches the active Rule.',
    );
  }
  if (context.runtimeSnapshotHash !== hashRuleRuntimeState(state)) {
    throw new RuleRuntimeApplicationError('RULE_STALE', 'Runtime snapshot hash changed.');
  }
}

function assertAuthorityContext(
  context: RuleDecisionContext,
  state: RuleRuntimeCurrentState,
  policy: RulePolicyAuthorityDecision,
  authorization: RuleAuthorizationDecision,
): void {
  if (
    policy.decisionRef !== context.policyDecisionRef ||
    policy.decisionRef !== state.policyDecisionRef ||
    policy.snapshotHash !== state.policySnapshotHash
  ) {
    throw new RuleRuntimeApplicationError(
      'RULE_POLICY_CHANGED',
      'Policy decision or hash changed.',
    );
  }
  if (
    context.authorizationRefs.length === 0 ||
    state.authorizationRefs.length === 0 ||
    authorization.authorizationRefs.length === 0 ||
    authorization.tenantId !== context.tenantId ||
    canonical([...authorization.authorizationRefs].sort()) !==
      canonical([...context.authorizationRefs].sort()) ||
    canonical([...state.authorizationRefs].sort()) !==
      canonical([...context.authorizationRefs].sort())
  ) {
    throw new RuleRuntimeApplicationError(
      'RULE_AUTHORIZATION_STALE',
      'Authorization facts changed or crossed tenant.',
    );
  }
}

function blockedEvaluation(
  context: RuleDecisionContext,
  action: 'deny' | 'fallback',
  reasonCode: string,
  createdAt: string,
): RuleDecisionResult {
  const stable = {
    ruleRef: context.artifactRef,
    ruleHash: context.artifactHash,
    matched: action === 'deny',
    unknown: reasonCode === 'RULE_DISCARDED_STALE',
    conditionResults: Object.freeze([]),
    proposedAction: action,
    evaluatorVersion: RULE_RUNTIME_EVALUATOR_VERSION,
    runtimeSnapshotHash: context.runtimeSnapshotHash,
  };
  const resultHash = hashRuleRuntimeValue({ ...stable, reasonCode });
  return Object.freeze({
    evaluationId: `p09-evaluation-${shortHash(resultHash)}`,
    ...stable,
    resultHash,
    createdAt,
  });
}

function overrideEvaluation(
  evaluation: RuleDecisionResult,
  action: 'require_confirmation',
  reasonCode: string,
): RuleDecisionResult {
  const { actionPayload: _discardedPayload, ...withoutPayload } = evaluation;
  void _discardedPayload;
  const stable = {
    ...withoutPayload,
    proposedAction: action,
  };
  return Object.freeze({
    ...stable,
    resultHash: hashRuleRuntimeValue({
      ruleHash: evaluation.ruleHash,
      runtimeSnapshotHash: evaluation.runtimeSnapshotHash,
      evaluatorVersion: evaluation.evaluatorVersion,
      proposedAction: action,
      conditionResults: evaluation.conditionResults,
      reasonCode,
    }),
  });
}

function materializeDecision(
  work: readonly EvaluationWork[],
  resolution: RuleConflictResolution,
  createdAt: string,
): RuleDecision {
  const first = work[0];
  if (first === undefined) {
    throw new RuleRuntimeApplicationError('RULE_DECISION_FAILED', 'No Rule work exists.');
  }
  const selected = work.find((item) =>
    resolution.selectedRuleRefs.includes(item.evaluation.ruleRef),
  );
  const stale = work.some(
    (item) => item.evaluation.proposedAction === 'fallback' && item.evaluation.unknown,
  );
  const action =
    resolution.disposition === 'ambiguous_fallback'
      ? 'fallback'
      : (selected?.evaluation.proposedAction ?? 'no_match');
  const disposition: RuleDecision['disposition'] = stale
    ? 'discarded_stale'
    : action === 'deny'
      ? 'deny'
      : action === 'require_confirmation'
        ? 'require_confirmation'
        : action === 'fallback'
          ? 'fallback'
          : action === 'propose_plan_patch'
            ? 'plan_patch_candidate'
            : action === 'no_match'
              ? 'no_match'
              : 'advice';
  const reasonCodes = unique([
    ...resolution.reasonCodes,
    reasonForAction(action),
    ...work.flatMap((item) => item.policy.reasonCodes),
    ...work.flatMap((item) => item.authorization.reasonCodes),
  ]);
  const runtimeSnapshotHash = hashRuleRuntimeValue({
    evaluationHashes: work.map((item) => item.evaluation.resultHash).sort(),
    resolutionHash: resolution.resultHash,
  });
  return Object.freeze({
    decisionId: `p09-decision-${shortHash(runtimeSnapshotHash)}`,
    requestRef: first.context.requestRef,
    disposition,
    selectedRuleRefs: resolution.selectedRuleRefs,
    ...(selected?.evaluation.actionPayload === undefined
      ? {}
      : { advice: selected.evaluation.actionPayload }),
    policyDecisionRef: first.policy.decisionRef,
    authorizationCheckRef: first.authorization.checkRef,
    reasonCodes,
    runtimeSnapshotHash,
    createdAt,
  });
}

function withDecisionFailure(
  decision: RuleDecision,
  reasonCode: string,
  disposition: RuleDecision['disposition'],
): RuleDecision {
  return Object.freeze({
    ...decision,
    disposition,
    reasonCodes: unique([...decision.reasonCodes, reasonCode]),
  });
}

function contextFromState(work: EvaluationWork): RuleDecisionContext {
  return work.context;
}

function decisionRulePriority(artifact: CompiledArtifact): number {
  return 'priority' in artifact.definition && typeof artifact.definition.priority === 'number'
    ? artifact.definition.priority
    : 0;
}

function decisionRuleConflictGroup(
  artifact: CompiledArtifact,
): Readonly<{ conflictGroup?: string }> {
  return 'conflictGroup' in artifact.definition &&
    typeof artifact.definition.conflictGroup === 'string'
    ? { conflictGroup: artifact.definition.conflictGroup }
    : {};
}

function strongestPolicy(
  values: readonly RulePolicyAuthorityDecision['decision'][],
): RulePolicyAuthorityDecision['decision'] {
  if (values.includes('deny')) return 'deny';
  if (values.includes('require_confirmation')) return 'require_confirmation';
  return 'allow';
}

function reasonForAction(action: RuleDecisionResult['proposedAction']): string {
  if (action === 'deny') return 'RULE_DECISION_DENY';
  if (action === 'require_confirmation') return 'RULE_DECISION_CONFIRM';
  if (action === 'fallback') return 'RULE_DECISION_FALLBACK';
  if (action === 'no_match') return 'RULE_DECISION_NO_MATCH';
  if (action === 'suggest_parameter') return 'RULE_PARAMETER_SUGGESTED';
  if (action === 'propose_plan_patch') return 'RULE_PLAN_PATCH_PROPOSED';
  return 'RULE_DECISION_ADVICE';
}

function driftSeverity(kind: RuleDriftKind): 'normal' | 'urgent' | 'critical' {
  if (kind === 'unsafe_allow' || kind === 'missed_confirmation') return 'critical';
  if (
    kind === 'false_positive' ||
    kind === 'false_negative' ||
    kind === 'plan_patch_rejection' ||
    kind === 'outcome_regression' ||
    kind === 'policy_change' ||
    kind === 'readiness_change'
  ) {
    return 'urgent';
  }
  return 'normal';
}

function errorCode(error: unknown, fallback: string): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : fallback;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
