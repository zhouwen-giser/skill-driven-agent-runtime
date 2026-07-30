import {
  createGatewayDecisionRecord,
  createGatewayFeedbackEnvelope,
  createRuntimeRequestContext,
  hashGatewayDecision,
  hashRuntimeRequestContext,
  type FastGateway,
  type GatewayDecisionRecord,
  type GatewayFeedbackEnvelope,
  type GatewayReasonCode,
  type GatewayStage,
  type GatewayStageResult,
  type JsonValue,
  type RuntimeExecutionDecision,
  type RuntimeRequestContext,
} from '../../../domain/src/index.js';
import type { ArtifactRetrievalResult } from './artifact-retrieval.js';

export interface GatewayPrecheckResult {
  readonly authenticated: boolean;
  readonly tenantAuthorized: boolean;
  readonly authorized: boolean;
  readonly featureEnabled: boolean;
  readonly killSwitchActive: boolean;
  readonly policyDecision: 'allow' | 'deny' | 'require_confirmation';
  readonly runtimeSnapshotHash: string;
}

export interface GatewayPrecheckPort {
  authenticate(input: RuntimeRequestContext): Promise<boolean>;
  authorizeTenant(input: RuntimeRequestContext): Promise<boolean>;
  authorizeRequest(input: RuntimeRequestContext): Promise<boolean>;
  readRuntimeState(
    input: RuntimeRequestContext,
  ): Promise<
    Pick<
      GatewayPrecheckResult,
      'featureEnabled' | 'killSwitchActive' | 'policyDecision' | 'runtimeSnapshotHash'
    >
  >;
}

export interface GatewayRetrievalPort {
  retrieve(
    input: RuntimeRequestContext,
    execution: GatewayStageExecution,
  ): Promise<ArtifactRetrievalResult>;
}

export type GatewayRuleOutcome =
  | Readonly<{ disposition: 'advice'; resultRef: string }>
  | Readonly<{ disposition: 'no_match'; resultRef: string }>
  | Readonly<{ disposition: 'require_confirmation'; resultRef: string; interactionRef?: string }>
  | Readonly<{ disposition: 'deny'; resultRef: string }>
  | Readonly<{ disposition: 'fallback'; resultRef: string }>
  | Readonly<{
      disposition: 'plan_patch_candidate';
      resultRef: string;
      formalHandoffRef?: string;
      formalGoalRef?: string;
      formalPlanRef?: string;
      interactionRef?: string;
    }>;

export interface GatewayRulePort {
  evaluate(
    input: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
    execution: GatewayStageExecution,
  ): Promise<GatewayRuleOutcome>;
}

export type GatewayTemplateOutcome =
  | Readonly<{
      disposition: 'formal_handoff';
      resultRef: string;
      formalHandoffRef: string;
      formalGoalRef?: string;
      formalPlanRef?: string;
    }>
  | Readonly<{
      disposition: 'requires_confirmation';
      resultRef: string;
      formalHandoffRef?: string;
      interactionRef: string;
    }>
  | Readonly<{ disposition: 'fallback' | 'discarded_stale' | 'failed'; resultRef: string }>
  | Readonly<{ disposition: 'deny'; resultRef: string }>;

export interface GatewayTemplatePort {
  instantiate(
    input: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
    execution: GatewayStageExecution,
  ): Promise<GatewayTemplateOutcome>;
}

export interface GatewayFallbackPort {
  start(
    input: RuntimeRequestContext,
    reasonCodes: readonly GatewayReasonCode[],
    remainingMs: number,
    execution: GatewayStageExecution,
  ): Promise<Readonly<{ fallbackRef: string }>>;
}

export interface GatewayCancellationPort {
  isCancelled(cancellationRef: string): Promise<boolean>;
}

export interface GatewayDecisionPersistence {
  findByIdempotencyKey(idempotencyKey: string): Promise<
    | Readonly<{
        requestHash: string;
        decision: RuntimeExecutionDecision;
        record: GatewayDecisionRecord;
      }>
    | undefined
  >;
  save(
    input: Readonly<{
      idempotencyKey: string;
      requestHash: string;
      context: RuntimeRequestContext;
      decision: RuntimeExecutionDecision;
      record: GatewayDecisionRecord;
    }>,
  ): Promise<void>;
  appendFeedback(input: GatewayFeedbackEnvelope): Promise<void>;
}

export interface GatewayDriftSignalPort {
  signal(
    input: Readonly<{
      gatewayDecisionRef: string;
      severity: 'normal' | 'urgent' | 'critical';
      selectedArtifactRefs: readonly string[];
      sourceRefs: readonly string[];
      createdAt: string;
    }>,
  ): Promise<void>;
}

/** P02 Artifact execution/feedback authority adapter for selected Artifacts. */
export interface GatewayArtifactFeedbackPort {
  record(input: GatewayFeedbackEnvelope): Promise<void>;
}

export interface GatewayStageExecution {
  readonly signal: AbortSignal;
  readonly deadlineAt: string;
  readonly budgetMs: number;
  mayCommitFormalAuthority(): boolean;
}

export interface FastGatewayEvaluation {
  readonly decision: RuntimeExecutionDecision;
  readonly record: GatewayDecisionRecord;
  readonly formalGoalRef?: string;
  readonly formalPlanRef?: string;
  readonly formalInteractionRef?: string;
}

export interface FastGatewayOptions {
  readonly fallbackReserveMs: number;
  readonly maxInFlight: number;
  readonly adapterConcurrency: number;
  readonly fallbackConcurrency: number;
  readonly fallbackStartTimeoutMs: number;
  readonly circuitFailureThreshold: number;
  readonly circuitWindowMs: number;
  readonly circuitOpenMs: number;
  readonly stageTimeoutMs: Readonly<Record<'retrieval' | 'rule' | 'template', number>>;
}

const DEFAULT_OPTIONS: FastGatewayOptions = Object.freeze({
  fallbackReserveMs: 250,
  maxInFlight: 64,
  adapterConcurrency: 16,
  fallbackConcurrency: 64,
  fallbackStartTimeoutMs: 1_000,
  circuitFailureThreshold: 5,
  circuitWindowMs: 30_000,
  circuitOpenMs: 10_000,
  stageTimeoutMs: Object.freeze({ retrieval: 500, rule: 300, template: 800 }),
});

/**
 * P10 is deliberately an orchestrator. It consumes P07/P09/P08 ports and does
 * not duplicate matching, Rule evaluation, Template compilation or formal
 * Goal/Plan authority.
 */
export class FastGatewayService implements FastGateway {
  readonly #precheck: GatewayPrecheckPort;
  readonly #retrieval: GatewayRetrievalPort;
  readonly #rule: GatewayRulePort;
  readonly #template: GatewayTemplatePort;
  readonly #fallback: GatewayFallbackPort;
  readonly #cancellation: GatewayCancellationPort;
  readonly #persistence: GatewayDecisionPersistence;
  readonly #drift: GatewayDriftSignalPort;
  readonly #artifactFeedback: GatewayArtifactFeedbackPort;
  readonly #clock: Readonly<{ now(): string; nowMs(): number }>;
  readonly #ids: Readonly<{
    nextGatewayDecisionId(): string;
  }>;
  readonly #options: FastGatewayOptions;
  readonly #bulkheads: Readonly<Record<'retrieval' | 'rule' | 'template', AdapterBulkhead>>;
  readonly #fallbackBulkhead: AdapterBulkhead;
  readonly #circuits: GatewayCircuitBreaker;
  readonly #pending = new Map<
    string,
    Readonly<{ requestHash: string; evaluation: Promise<FastGatewayEvaluation> }>
  >();
  #inFlight = 0;

  constructor(
    dependencies: Readonly<{
      precheck: GatewayPrecheckPort;
      retrieval: GatewayRetrievalPort;
      rule: GatewayRulePort;
      template: GatewayTemplatePort;
      fallback: GatewayFallbackPort;
      cancellation: GatewayCancellationPort;
      persistence: GatewayDecisionPersistence;
      drift: GatewayDriftSignalPort;
      artifactFeedback: GatewayArtifactFeedbackPort;
      clock: Readonly<{ now(): string; nowMs(): number }>;
      ids: Readonly<{
        nextGatewayDecisionId(): string;
      }>;
      options?: Partial<FastGatewayOptions>;
    }>,
  ) {
    this.#precheck = dependencies.precheck;
    this.#retrieval = dependencies.retrieval;
    this.#rule = dependencies.rule;
    this.#template = dependencies.template;
    this.#fallback = dependencies.fallback;
    this.#cancellation = dependencies.cancellation;
    this.#persistence = dependencies.persistence;
    this.#drift = dependencies.drift;
    this.#artifactFeedback = dependencies.artifactFeedback;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#options = validateOptions(dependencies.options);
    this.#bulkheads = Object.freeze({
      retrieval: new AdapterBulkhead(this.#options.adapterConcurrency),
      rule: new AdapterBulkhead(this.#options.adapterConcurrency),
      template: new AdapterBulkhead(this.#options.adapterConcurrency),
    });
    this.#fallbackBulkhead = new AdapterBulkhead(this.#options.fallbackConcurrency);
    this.#circuits = new GatewayCircuitBreaker(this.#options);
  }

  async evaluate(input: RuntimeRequestContext): Promise<RuntimeExecutionDecision> {
    return (await this.evaluateDetailed(input)).decision;
  }

  async evaluateDetailed(input: RuntimeRequestContext): Promise<FastGatewayEvaluation> {
    const context = createRuntimeRequestContext(input);
    const requestHash = hashRuntimeRequestContext(context);
    const pending = this.#pending.get(context.idempotencyKey);
    if (pending !== undefined) {
      if (pending.requestHash !== requestHash) {
        throw new FastGatewayApplicationError(
          'GATEWAY_IDEMPOTENCY_CONFLICT',
          'The idempotency key is already evaluating another RuntimeRequestContext.',
        );
      }
      return pending.evaluation;
    }
    const evaluation = this.#evaluateExclusive(context, requestHash);
    this.#pending.set(context.idempotencyKey, Object.freeze({ requestHash, evaluation }));
    try {
      return await evaluation;
    } finally {
      this.#pending.delete(context.idempotencyKey);
    }
  }

  async #evaluateExclusive(
    context: RuntimeRequestContext,
    requestHash: string,
  ): Promise<FastGatewayEvaluation> {
    const existing = await this.#persistence.findByIdempotencyKey(context.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw new FastGatewayApplicationError(
          'GATEWAY_IDEMPOTENCY_CONFLICT',
          'The idempotency key is already bound to another RuntimeRequestContext.',
        );
      }
      return Object.freeze({ decision: existing.decision, record: existing.record });
    }

    return this.#evaluateNew(context, requestHash);
  }

  async recordFeedback(
    input: Omit<GatewayFeedbackEnvelope, 'createdAt'>,
  ): Promise<GatewayFeedbackEnvelope> {
    const feedback = createGatewayFeedbackEnvelope({
      ...input,
      createdAt: this.#clock.now(),
    });
    await this.#persistence.appendFeedback(feedback);
    await this.#artifactFeedback.record(feedback);
    if (feedback.feedbackType === 'drift') {
      const severity = driftSeverity(feedback.payload);
      await this.#drift.signal({
        gatewayDecisionRef: feedback.gatewayDecisionRef,
        severity,
        selectedArtifactRefs: feedback.selectedArtifactRefs,
        sourceRefs: feedback.sourceRefs,
        createdAt: feedback.createdAt,
      });
    }
    return feedback;
  }

  async #evaluateNew(
    context: RuntimeRequestContext,
    requestHash: string,
  ): Promise<FastGatewayEvaluation> {
    const precheckStartedAt = this.#clock.now();
    const checked = await this.#runPrecheck(context);
    const precheck = checked.result;
    const precheckReasons = checked.reasonCodes;
    const precheckStage = stageResult(
      'precheck',
      'succeeded',
      precheckReasons,
      precheckStartedAt,
      this.#clock.now(),
    );

    const cancelled = await this.#cancellation.isCancelled(context.cancellationRef);
    if (cancelled || this.#clock.nowMs() >= Date.parse(context.deadlineAt)) {
      return this.#completeTerminal(
        context,
        requestHash,
        precheck,
        [precheckStage],
        cancelled ? 'cancelled' : 'timed_out',
      );
    }
    if (!precheck.authenticated || !precheck.tenantAuthorized || !precheck.authorized) {
      return this.#completeDenied(context, requestHash, precheck, [precheckStage], precheckReasons);
    }
    if (precheck.policyDecision === 'deny') {
      return this.#completeDenied(
        context,
        requestHash,
        precheck,
        [precheckStage],
        ['GATEWAY_POLICY_DENY', 'GATEWAY_DENIED'],
      );
    }
    if (precheck.policyDecision === 'require_confirmation') {
      return this.#completeInteraction(
        context,
        requestHash,
        precheck,
        [precheckStage],
        ['GATEWAY_POLICY_CONFIRM', 'GATEWAY_INTERACTION_REQUIRED'],
      );
    }
    if (!precheck.featureEnabled || precheck.killSwitchActive) {
      return this.#completeFallback(
        context,
        requestHash,
        precheck,
        [precheckStage],
        precheck.killSwitchActive ? ['GATEWAY_KILL_SWITCH_ACTIVE'] : ['GATEWAY_FEATURE_DISABLED'],
      );
    }

    if (this.#inFlight >= this.#options.maxInFlight) {
      return this.#completeFallback(
        context,
        requestHash,
        precheck,
        [precheckStage],
        ['GATEWAY_LOAD_SHED'],
      );
    }
    this.#inFlight += 1;
    try {
      const retrievalRun = await this.#runAdapterStage(context, 'retrieval', (execution) =>
        this.#retrieval.retrieve(context, execution),
      );
      const stages: GatewayStageResult[] = [precheckStage, retrievalRun.stage];
      if (retrievalRun.status !== 'succeeded') {
        return await this.#completeFallback(
          context,
          requestHash,
          precheck,
          stages,
          retrievalRun.reasonCodes,
        );
      }
      const retrieval = retrievalRun.value;
      if (retrieval.decision.path === 'denied') {
        return await this.#completeDenied(
          context,
          requestHash,
          precheck,
          stages,
          ['GATEWAY_DENIED'],
          retrieval.decision,
        );
      }
      if (retrieval.decision.path === 'human_input') {
        return await this.#completeInteraction(
          context,
          requestHash,
          precheck,
          stages,
          ['GATEWAY_ARTIFACT_AMBIGUOUS', 'GATEWAY_INTERACTION_REQUIRED'],
          retrieval.decision,
        );
      }
      if (
        retrieval.decision.path === 'cognitive_runtime' ||
        retrieval.decision.selectedArtifactRef === undefined
      ) {
        return await this.#completeFallback(
          context,
          requestHash,
          precheck,
          stages,
          ['GATEWAY_ARTIFACT_NO_MATCH'],
          retrieval.decision,
        );
      }

      const selected = retrieval.index.find(
        (candidate) => candidate.artifactRef === retrieval.decision.selectedArtifactRef,
      );
      if (selected?.artifactType === 'decision_rule') {
        return await this.#runRule(context, requestHash, precheck, stages, retrieval);
      }
      if (selected?.artifactType === 'plan_template') {
        return await this.#runTemplate(context, requestHash, precheck, stages, retrieval);
      }
      return await this.#completeFallback(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_ADAPTER_UNAVAILABLE'],
        retrieval.decision,
      );
    } finally {
      this.#inFlight -= 1;
    }
  }

  async #runRule(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: GatewayStageResult[],
    retrieval: ArtifactRetrievalResult,
  ): Promise<FastGatewayEvaluation> {
    const run = await this.#runAdapterStage(context, 'rule', (execution) =>
      this.#rule.evaluate(context, retrieval, execution),
    );
    stages.push(run.stage);
    if (run.status !== 'succeeded') {
      return this.#completeFallback(context, requestHash, precheck, stages, run.reasonCodes);
    }
    const outcome = run.value;
    if (outcome.disposition === 'deny') {
      return this.#completeDenied(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_RULE_DENY', 'GATEWAY_DENIED'],
        retrieval.decision,
      );
    }
    if (outcome.disposition === 'require_confirmation') {
      return this.#completeInteraction(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_RULE_CONFIRM', 'GATEWAY_INTERACTION_REQUIRED'],
        retrieval.decision,
        outcome.interactionRef,
      );
    }
    if (outcome.disposition === 'fallback' || outcome.disposition === 'no_match') {
      return this.#completeFallback(
        context,
        requestHash,
        precheck,
        stages,
        [
          outcome.disposition === 'no_match'
            ? 'GATEWAY_RULE_NO_MATCH'
            : 'GATEWAY_COGNITIVE_FALLBACK',
        ],
        retrieval.decision,
      );
    }
    if (outcome.disposition === 'advice') {
      return this.#completeFallback(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_RULE_SELECTED'],
        retrieval.decision,
      );
    }
    if (outcome.formalHandoffRef === undefined) {
      return this.#completeFallback(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_FORMAL_HANDOFF_FAILED'],
        retrieval.decision,
      );
    }
    return this.#completeSuccess(
      context,
      requestHash,
      precheck,
      stages,
      retrieval.decision,
      ['GATEWAY_RULE_PATCH', 'GATEWAY_FORMAL_HANDOFF_SUBMITTED'],
      outcome.formalHandoffRef,
      outcome.formalGoalRef,
      outcome.formalPlanRef,
      outcome.interactionRef,
    );
  }

  async #runTemplate(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: GatewayStageResult[],
    retrieval: ArtifactRetrievalResult,
  ): Promise<FastGatewayEvaluation> {
    const run = await this.#runAdapterStage(context, 'template', (execution) =>
      this.#template.instantiate(context, retrieval, execution),
    );
    stages.push(run.stage);
    if (run.status !== 'succeeded') {
      return this.#completeFallback(context, requestHash, precheck, stages, run.reasonCodes);
    }
    const outcome = run.value;
    if (outcome.disposition === 'deny') {
      return this.#completeDenied(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_DENIED'],
        retrieval.decision,
      );
    }
    if (outcome.disposition === 'requires_confirmation') {
      return this.#completeInteraction(
        context,
        requestHash,
        precheck,
        stages,
        ['GATEWAY_TEMPLATE_CONFIRM', 'GATEWAY_INTERACTION_REQUIRED'],
        retrieval.decision,
        outcome.interactionRef,
        outcome.formalHandoffRef,
      );
    }
    if (outcome.disposition !== 'formal_handoff') {
      return this.#completeFallback(
        context,
        requestHash,
        precheck,
        stages,
        [
          outcome.disposition === 'discarded_stale'
            ? 'GATEWAY_DISCARDED_STALE'
            : 'GATEWAY_TEMPLATE_FALLBACK',
        ],
        retrieval.decision,
      );
    }
    return this.#completeSuccess(
      context,
      requestHash,
      precheck,
      stages,
      retrieval.decision,
      ['GATEWAY_TEMPLATE_COMMITTED', 'GATEWAY_FORMAL_HANDOFF_COMMITTED'],
      outcome.formalHandoffRef,
      outcome.formalGoalRef,
      outcome.formalPlanRef,
    );
  }

  async #runAdapterStage<T>(
    context: RuntimeRequestContext,
    stage: 'retrieval' | 'rule' | 'template',
    operation: (execution: GatewayStageExecution) => Promise<T>,
  ): Promise<StageRun<T>> {
    const startedAt = this.#clock.now();
    if (await this.#cancellation.isCancelled(context.cancellationRef)) {
      return failedStage(stage, 'cancelled', 'GATEWAY_CANCELLED', startedAt, this.#clock.now());
    }
    const remaining = Date.parse(context.deadlineAt) - this.#clock.nowMs();
    const budgetMs = Math.min(
      this.#options.stageTimeoutMs[stage],
      remaining - this.#options.fallbackReserveMs,
    );
    if (budgetMs <= 0) {
      return failedStage(
        stage,
        'timed_out',
        'GATEWAY_DEADLINE_EXHAUSTED',
        startedAt,
        this.#clock.now(),
      );
    }
    const circuitKey = `${context.actor.tenantId}:${stage}`;
    if (!this.#circuits.allow(circuitKey, this.#clock.nowMs())) {
      return failedStage(stage, 'failed', 'GATEWAY_CIRCUIT_OPEN', startedAt, this.#clock.now());
    }
    const release = this.#bulkheads[stage].tryAcquire();
    if (release === undefined) {
      return failedStage(stage, 'failed', 'GATEWAY_LOAD_SHED', startedAt, this.#clock.now());
    }
    const controller = new AbortController();
    const execution: GatewayStageExecution = Object.freeze({
      signal: controller.signal,
      deadlineAt: context.deadlineAt,
      budgetMs,
      mayCommitFormalAuthority: () =>
        !controller.signal.aborted && this.#clock.nowMs() < Date.parse(context.deadlineAt),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort('GATEWAY_STAGE_TIMEOUT');
          reject(
            new FastGatewayApplicationError(
              'GATEWAY_STAGE_TIMEOUT',
              `${stage} exceeded its stage budget.`,
            ),
          );
        }, budgetMs);
      });
      const value = await Promise.race([operation(execution), timeout]);
      if (
        controller.signal.aborted ||
        this.#clock.nowMs() >= Date.parse(context.deadlineAt) ||
        (await this.#cancellation.isCancelled(context.cancellationRef))
      ) {
        controller.abort('GATEWAY_DISCARDED_LATE');
        return failedStage(
          stage,
          'discarded_stale',
          'GATEWAY_DISCARDED_LATE',
          startedAt,
          this.#clock.now(),
        );
      }
      this.#circuits.success(circuitKey);
      return Object.freeze({
        status: 'succeeded' as const,
        value,
        reasonCodes: Object.freeze([]),
        stage: stageResult(stage, 'succeeded', [], startedAt, this.#clock.now()),
      });
    } catch (error) {
      const reasonCode: GatewayReasonCode =
        error instanceof FastGatewayApplicationError && error.code === 'GATEWAY_STAGE_TIMEOUT'
          ? 'GATEWAY_STAGE_TIMEOUT'
          : 'GATEWAY_ADAPTER_UNAVAILABLE';
      this.#circuits.failure(circuitKey, reasonCode, this.#clock.nowMs());
      return failedStage(
        stage,
        reasonCode === 'GATEWAY_STAGE_TIMEOUT' ? 'timed_out' : 'failed',
        reasonCode,
        startedAt,
        this.#clock.now(),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release();
    }
  }

  async #runPrecheck(context: RuntimeRequestContext): Promise<
    Readonly<{
      result: GatewayPrecheckResult;
      reasonCodes: readonly GatewayReasonCode[];
    }>
  > {
    const snapshotHash = hashRuntimeRequestContext(context);
    const authenticated = await this.#precheck.authenticate(context);
    if (!authenticated || (await this.#requestStopped(context))) {
      return precheckResult(
        {
          authenticated,
          tenantAuthorized: false,
          authorized: false,
          featureEnabled: false,
          killSwitchActive: false,
          policyDecision: 'allow',
          runtimeSnapshotHash: snapshotHash,
        },
        [authenticated ? 'GATEWAY_AUTHENTICATED' : 'GATEWAY_AUTH_FAILED'],
      );
    }
    const tenantAuthorized = await this.#precheck.authorizeTenant(context);
    if (!tenantAuthorized || (await this.#requestStopped(context))) {
      return precheckResult(
        {
          authenticated,
          tenantAuthorized,
          authorized: false,
          featureEnabled: false,
          killSwitchActive: false,
          policyDecision: 'allow',
          runtimeSnapshotHash: snapshotHash,
        },
        ['GATEWAY_AUTHENTICATED', 'GATEWAY_TENANT_DENIED'],
      );
    }
    const authorized = await this.#precheck.authorizeRequest(context);
    if (!authorized || (await this.#requestStopped(context))) {
      return precheckResult(
        {
          authenticated,
          tenantAuthorized,
          authorized,
          featureEnabled: false,
          killSwitchActive: false,
          policyDecision: 'allow',
          runtimeSnapshotHash: snapshotHash,
        },
        ['GATEWAY_AUTHENTICATED', 'GATEWAY_TENANT_AUTHORIZED', 'GATEWAY_TENANT_DENIED'],
      );
    }
    const state = await this.#precheck.readRuntimeState(context);
    assertHash(state.runtimeSnapshotHash, 'runtimeSnapshotHash');
    const result: GatewayPrecheckResult = {
      authenticated,
      tenantAuthorized,
      authorized,
      ...state,
    };
    return precheckResult(result, precheckReasonCodes(result));
  }

  async #requestStopped(context: RuntimeRequestContext): Promise<boolean> {
    return (
      this.#clock.nowMs() >= Date.parse(context.deadlineAt) ||
      (await this.#cancellation.isCancelled(context.cancellationRef))
    );
  }

  async #completeDenied(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: readonly GatewayStageResult[],
    reasonCodes: readonly GatewayReasonCode[],
    base?: RuntimeExecutionDecision,
  ): Promise<FastGatewayEvaluation> {
    return this.#persist(
      context,
      requestHash,
      precheck,
      stages,
      decisionFrom(context, base, 'denied', reasonCodes, this.#clock.now()),
      reasonCodes,
    );
  }

  async #completeInteraction(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: readonly GatewayStageResult[],
    reasonCodes: readonly GatewayReasonCode[],
    base?: RuntimeExecutionDecision,
    interactionRef?: string,
    formalHandoffRef?: string,
  ): Promise<FastGatewayEvaluation> {
    const persisted = await this.#persist(
      context,
      requestHash,
      precheck,
      stages,
      decisionFrom(context, base, 'human_input', reasonCodes, this.#clock.now()),
      reasonCodes,
      formalHandoffRef,
    );
    return Object.freeze({
      ...persisted,
      ...(interactionRef === undefined ? {} : { formalInteractionRef: interactionRef }),
    });
  }

  async #completeFallback(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: readonly GatewayStageResult[],
    inputReasons: readonly GatewayReasonCode[],
    base?: RuntimeExecutionDecision,
  ): Promise<FastGatewayEvaluation> {
    const reasonCodes = uniqueReasons([...inputReasons, 'GATEWAY_COGNITIVE_FALLBACK']);
    const remainingMs = Math.max(0, Date.parse(context.deadlineAt) - this.#clock.nowMs());
    const release = this.#fallbackBulkhead.tryAcquire();
    const startedAt = this.#clock.now();
    if (release === undefined || remainingMs <= 0) {
      const overloadedReasons = uniqueReasons([
        ...reasonCodes,
        release === undefined ? 'GATEWAY_LOAD_SHED' : 'GATEWAY_DEADLINE_EXHAUSTED',
      ]);
      const completedAt = this.#clock.now();
      release?.();
      return this.#persist(
        context,
        requestHash,
        precheck,
        [...stages, stageResult('fallback', 'failed', overloadedReasons, startedAt, completedAt)],
        decisionFrom(context, base, 'cognitive_runtime', overloadedReasons, this.#clock.now()),
        overloadedReasons,
      );
    }
    const fallbackBudgetMs = Math.min(remainingMs, this.#options.fallbackStartTimeoutMs);
    const controller = new AbortController();
    const execution: GatewayStageExecution = Object.freeze({
      signal: controller.signal,
      deadlineAt: context.deadlineAt,
      budgetMs: fallbackBudgetMs,
      mayCommitFormalAuthority: () =>
        !controller.signal.aborted && this.#clock.nowMs() < Date.parse(context.deadlineAt),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort('GATEWAY_DEADLINE_EXHAUSTED');
          reject(
            new FastGatewayApplicationError(
              'GATEWAY_DEADLINE_EXHAUSTED',
              'Cognitive fallback did not start before the absolute deadline.',
            ),
          );
        }, fallbackBudgetMs);
      });
      const fallback = await Promise.race([
        this.#fallback.start(context, reasonCodes, fallbackBudgetMs, execution),
        timeout,
      ]);
      const completedAt = this.#clock.now();
      const fallbackStage = stageResult(
        'fallback',
        'succeeded',
        reasonCodes,
        startedAt,
        completedAt,
        fallback.fallbackRef,
      );
      return await this.#persist(
        context,
        requestHash,
        precheck,
        [...stages, fallbackStage],
        decisionFrom(context, base, 'cognitive_runtime', reasonCodes, this.#clock.now()),
        reasonCodes,
        undefined,
        fallback.fallbackRef,
      );
    } catch (error) {
      const failureReason: GatewayReasonCode =
        error instanceof FastGatewayApplicationError && error.code === 'GATEWAY_DEADLINE_EXHAUSTED'
          ? 'GATEWAY_DEADLINE_EXHAUSTED'
          : 'GATEWAY_ADAPTER_UNAVAILABLE';
      const failedReasons = uniqueReasons([...reasonCodes, failureReason]);
      const completedAt = this.#clock.now();
      return await this.#persist(
        context,
        requestHash,
        precheck,
        [
          ...stages,
          stageResult(
            'fallback',
            failureReason === 'GATEWAY_DEADLINE_EXHAUSTED' ? 'timed_out' : 'failed',
            failedReasons,
            startedAt,
            completedAt,
          ),
        ],
        decisionFrom(context, base, 'cognitive_runtime', failedReasons, this.#clock.now()),
        failedReasons,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release();
    }
  }

  async #completeSuccess(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: readonly GatewayStageResult[],
    base: RuntimeExecutionDecision,
    reasonCodes: readonly GatewayReasonCode[],
    formalHandoffRef?: string,
    formalGoalRef?: string,
    formalPlanRef?: string,
    formalInteractionRef?: string,
  ): Promise<FastGatewayEvaluation> {
    const persisted = await this.#persist(
      context,
      requestHash,
      precheck,
      stages,
      decisionFrom(context, base, base.path, reasonCodes, this.#clock.now()),
      reasonCodes,
      formalHandoffRef,
    );
    return Object.freeze({
      ...persisted,
      ...(formalGoalRef === undefined ? {} : { formalGoalRef }),
      ...(formalPlanRef === undefined ? {} : { formalPlanRef }),
      ...(formalInteractionRef === undefined ? {} : { formalInteractionRef }),
    });
  }

  async #completeTerminal(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: readonly GatewayStageResult[],
    disposition: 'cancelled' | 'timed_out',
  ): Promise<FastGatewayEvaluation> {
    const reason: GatewayReasonCode =
      disposition === 'cancelled' ? 'GATEWAY_CANCELLED' : 'GATEWAY_DEADLINE_EXHAUSTED';
    const now = this.#clock.now();
    return this.#persist(
      context,
      requestHash,
      precheck,
      [
        ...stages,
        stageResult(
          'fallback',
          disposition === 'cancelled' ? 'cancelled' : 'timed_out',
          [reason],
          now,
          now,
        ),
      ],
      decisionFrom(context, undefined, 'cognitive_runtime', [reason], this.#clock.now()),
      [reason],
    );
  }

  async #persist(
    context: RuntimeRequestContext,
    requestHash: string,
    precheck: GatewayPrecheckResult,
    stages: readonly GatewayStageResult[],
    decision: RuntimeExecutionDecision,
    reasonCodes: readonly GatewayReasonCode[],
    formalHandoffRef?: string,
    fallbackRef?: string,
  ): Promise<FastGatewayEvaluation> {
    const decisionInput = {
      requestId: context.requestId,
      runtimeDecisionRef: decision.decisionId,
      stageResults: Object.freeze([...stages]),
      ...(formalHandoffRef === undefined ? {} : { formalHandoffRef }),
      ...(fallbackRef === undefined ? {} : { fallbackRef }),
      reasonCodes: uniqueReasons(reasonCodes),
      runtimeSnapshotHash: precheck.runtimeSnapshotHash,
    };
    const record = createGatewayDecisionRecord({
      gatewayDecisionId: this.#ids.nextGatewayDecisionId(),
      ...decisionInput,
      decisionHash: hashGatewayDecision(decisionInput),
      createdAt: this.#clock.now(),
    });
    await this.#persistence.save({
      idempotencyKey: context.idempotencyKey,
      requestHash,
      context,
      decision,
      record,
    });
    return Object.freeze({ decision, record });
  }
}

type StageRun<T> =
  | Readonly<{
      status: 'succeeded';
      value: T;
      reasonCodes: readonly GatewayReasonCode[];
      stage: GatewayStageResult;
    }>
  | Readonly<{
      status: 'failed';
      reasonCodes: readonly GatewayReasonCode[];
      stage: GatewayStageResult;
    }>;

function failedStage<T>(
  stage: GatewayStage,
  status: Exclude<GatewayStageResult['status'], 'not_run' | 'succeeded' | 'skipped'>,
  reasonCode: GatewayReasonCode,
  startedAt: string,
  completedAt: string,
): StageRun<T> {
  return Object.freeze({
    status: 'failed' as const,
    reasonCodes: Object.freeze([reasonCode]),
    stage: stageResult(stage, status, [reasonCode], startedAt, completedAt),
  });
}

function stageResult(
  stage: GatewayStage,
  status: GatewayStageResult['status'],
  reasonCodes: readonly GatewayReasonCode[],
  startedAt: string,
  completedAt: string,
  resultRef?: string,
): GatewayStageResult {
  return Object.freeze({
    stage,
    status,
    ...(resultRef === undefined ? {} : { resultRef }),
    reasonCodes: uniqueReasons(reasonCodes),
    startedAt,
    completedAt,
  });
}

function precheckReasonCodes(input: GatewayPrecheckResult): readonly GatewayReasonCode[] {
  return uniqueReasons([
    input.authenticated ? 'GATEWAY_AUTHENTICATED' : 'GATEWAY_AUTH_FAILED',
    input.tenantAuthorized ? 'GATEWAY_TENANT_AUTHORIZED' : 'GATEWAY_TENANT_DENIED',
    ...(input.authorized ? [] : ['GATEWAY_TENANT_DENIED' as const]),
    ...(input.featureEnabled ? [] : ['GATEWAY_FEATURE_DISABLED' as const]),
    ...(input.killSwitchActive ? ['GATEWAY_KILL_SWITCH_ACTIVE' as const] : []),
    ...(input.policyDecision === 'deny' ? ['GATEWAY_POLICY_DENY' as const] : []),
    ...(input.policyDecision === 'require_confirmation' ? ['GATEWAY_POLICY_CONFIRM' as const] : []),
  ]);
}

function precheckResult(
  result: GatewayPrecheckResult,
  reasonCodes: readonly GatewayReasonCode[],
): Readonly<{
  result: GatewayPrecheckResult;
  reasonCodes: readonly GatewayReasonCode[];
}> {
  return Object.freeze({
    result: Object.freeze(result),
    reasonCodes: uniqueReasons(reasonCodes),
  });
}

function decisionFrom(
  context: RuntimeRequestContext,
  base: RuntimeExecutionDecision | undefined,
  path: RuntimeExecutionDecision['path'],
  reasonCodes: readonly GatewayReasonCode[],
  createdAt: string,
): RuntimeExecutionDecision {
  const baseReasons = base?.reasonCodes ?? [];
  return Object.freeze({
    decisionId: base?.decisionId ?? `gateway-runtime-decision:${context.requestId}`,
    requestId: context.requestId,
    path,
    ...(base?.selectedArtifactRef === undefined
      ? {}
      : { selectedArtifactRef: base.selectedArtifactRef }),
    parameterBindings: base?.parameterBindings ?? Object.freeze({}),
    missingParameters: base?.missingParameters ?? Object.freeze([]),
    requiredConfirmations:
      path === 'human_input'
        ? Object.freeze([
            ...(base?.requiredConfirmations ?? []),
            ...reasonCodes.filter(
              (reason) =>
                reason === 'GATEWAY_POLICY_CONFIRM' ||
                reason === 'GATEWAY_RULE_CONFIRM' ||
                reason === 'GATEWAY_TEMPLATE_CONFIRM',
            ),
          ])
        : (base?.requiredConfirmations ?? Object.freeze([])),
    reasonCodes: Object.freeze([
      ...baseReasons,
      ...reasonCodes.filter((reason) => !baseReasons.includes(reason)),
    ]),
    matcherSnapshotHash: base?.matcherSnapshotHash ?? hashRuntimeRequestContext(context),
    policySnapshotHash: base?.policySnapshotHash ?? hashRuntimeRequestContext(context),
    createdAt,
  });
}

function uniqueReasons(values: readonly GatewayReasonCode[]): readonly GatewayReasonCode[] {
  return Object.freeze([...new Set(values)].sort());
}

function driftSeverity(payload: JsonValue): 'normal' | 'urgent' | 'critical' {
  if (isJsonObject(payload)) {
    const severity = payload['severity'];
    if (severity === 'critical' || severity === 'urgent') return severity;
  }
  return 'normal';
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateOptions(input: Partial<FastGatewayOptions> | undefined): FastGatewayOptions {
  const options = {
    ...DEFAULT_OPTIONS,
    ...input,
    stageTimeoutMs: { ...DEFAULT_OPTIONS.stageTimeoutMs, ...input?.stageTimeoutMs },
  };
  const values = [
    options.fallbackReserveMs,
    options.maxInFlight,
    options.adapterConcurrency,
    options.fallbackConcurrency,
    options.fallbackStartTimeoutMs,
    options.circuitFailureThreshold,
    options.circuitWindowMs,
    options.circuitOpenMs,
    ...Object.values(options.stageTimeoutMs),
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new FastGatewayApplicationError(
      'GATEWAY_CONFIGURATION_INVALID',
      'Gateway numeric options must be positive safe integers.',
    );
  }
  return Object.freeze({
    ...options,
    stageTimeoutMs: Object.freeze({ ...options.stageTimeoutMs }),
  });
}

function assertHash(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new FastGatewayApplicationError(
      'GATEWAY_PRECHECK_INVALID',
      `${field} must be sha256:<64 lowercase hex>.`,
    );
  }
}

class AdapterBulkhead {
  readonly #limit: number;
  #active = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  tryAcquire(): (() => void) | undefined {
    if (this.#active >= this.#limit) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}

class GatewayCircuitBreaker {
  readonly #options: Pick<
    FastGatewayOptions,
    'circuitFailureThreshold' | 'circuitWindowMs' | 'circuitOpenMs'
  >;
  readonly #states = new Map<string, { failures: number[]; openedUntil?: number }>();

  constructor(options: FastGatewayOptions) {
    this.#options = options;
  }

  allow(key: string, now: number): boolean {
    for (const [failureKey, state] of this.#states) {
      if (!failureKey.startsWith(`${key}:`)) continue;
      if (state.openedUntil !== undefined && state.openedUntil > now) return false;
      if (state.openedUntil !== undefined) this.#states.delete(failureKey);
    }
    return true;
  }

  success(key: string): void {
    for (const failureKey of this.#states.keys()) {
      if (failureKey.startsWith(`${key}:`)) this.#states.delete(failureKey);
    }
  }

  failure(key: string, failureType: GatewayReasonCode, now: number): void {
    const failureKey = `${key}:${failureType}`;
    const current = this.#states.get(failureKey);
    const failures = [...(current?.failures ?? []), now].filter(
      (timestamp) => timestamp >= now - this.#options.circuitWindowMs,
    );
    this.#states.set(failureKey, {
      failures,
      ...(failures.length >= this.#options.circuitFailureThreshold
        ? { openedUntil: now + this.#options.circuitOpenMs }
        : {}),
    });
  }
}

export class FastGatewayApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FastGatewayApplicationError';
    this.code = code;
  }
}
