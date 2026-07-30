import {
  caseSimilarity,
  createCaseAdaptationInput,
  createCaseRetrievalInput,
  createModelCascadeRun,
  createModelProfile,
  createModelRouteContext,
  createModelRouteDecision,
  evaluateArtifactCondition,
  hashModelProfileSnapshot,
  type CaseAdaptationInput,
  type CaseAdaptationResult,
  type CaseArtifactDefinition,
  type CaseMatch,
  type CaseRetrievalInput,
  type CaseRuntime,
  type CompiledArtifactType,
  type FormalPlanHandoffPort,
  type JsonValue,
  type ModelCascadeRun,
  type ModelProfile,
  type ModelRouteArtifactDefinition,
  type ModelRouteContext,
  type ModelRouteDecision,
  type ModelRouteRuntime,
  type RuntimeExecutionDecision,
  type RuntimeRequestContext,
  type UserGoalPlanCandidate,
} from '../../../domain/src/index.js';
import type { ArtifactRetrievalResult } from './artifact-retrieval.js';
import type {
  GatewayArtifactAdapter,
  GatewayArtifactAdapterOutcome,
  GatewayArtifactAdapterRegistry,
  GatewayStageExecution,
} from './fast-gateway.js';
import type { ModelRuntimeRepository, ModelTransportAdapter, SecretCipher } from '../ports.js';

export class TypeKeyedGatewayArtifactAdapterRegistry implements GatewayArtifactAdapterRegistry {
  readonly #adapters: ReadonlyMap<CompiledArtifactType, GatewayArtifactAdapter>;

  constructor(
    entries: readonly Readonly<{
      artifactType: CompiledArtifactType;
      adapter: GatewayArtifactAdapter;
    }>[],
  ) {
    const adapters = new Map<CompiledArtifactType, GatewayArtifactAdapter>();
    for (const entry of entries) {
      if (adapters.has(entry.artifactType))
        throw new Error(`GATEWAY_ADAPTER_DUPLICATE:${entry.artifactType}`);
      adapters.set(entry.artifactType, entry.adapter);
    }
    this.#adapters = adapters;
  }

  find(artifactType: CompiledArtifactType): GatewayArtifactAdapter | undefined {
    return this.#adapters.get(artifactType);
  }
}

export interface CaseGatewayRequestFactory {
  create(
    context: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
  ): Promise<
    Readonly<{
      retrievalInput: CaseRetrievalInput;
      adaptationInput: CaseAdaptationInput;
      toPlanCandidate(result: CaseAdaptationResult): Promise<UserGoalPlanCandidate>;
    }>
  >;
}

export interface CaseGatewayCurrentState {
  verify(
    input: Readonly<{
      caseRef: string;
      goalContextRef: string;
      policyDecisionRef: string;
      runtimeSnapshotHash: string;
    }>,
  ): Promise<boolean>;
}

export class CaseGatewayArtifactAdapter implements GatewayArtifactAdapter {
  readonly #runtime: CaseRuntime;
  readonly #requests: CaseGatewayRequestFactory;
  readonly #handoff: FormalPlanHandoffPort;
  readonly #current: CaseGatewayCurrentState;

  constructor(
    dependencies: Readonly<{
      runtime: CaseRuntime;
      requests: CaseGatewayRequestFactory;
      handoff: FormalPlanHandoffPort;
      current: CaseGatewayCurrentState;
    }>,
  ) {
    this.#runtime = dependencies.runtime;
    this.#requests = dependencies.requests;
    this.#handoff = dependencies.handoff;
    this.#current = dependencies.current;
  }

  async execute(
    context: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
    execution: GatewayStageExecution,
  ): Promise<GatewayArtifactAdapterOutcome> {
    assertGatewayStage(execution, 'CASE');
    assertSelectedPath(retrieval.decision, 'case_adapt');
    const request = await this.#requests.create(context, retrieval);
    const matches = await this.#runtime.retrieve(request.retrievalInput);
    assertGatewayStage(execution, 'CASE');
    const selectedRef = retrieval.decision.selectedArtifactRef;
    const match = matches.find((candidate) => candidate.caseRef === selectedRef);
    if (match === undefined)
      return Object.freeze({ disposition: 'fallback', resultRef: 'case:no-current-match' });
    if (match.failureBoundaryStatus === 'matched') {
      if (match.applicability === 'require_confirmation') {
        return Object.freeze({
          disposition: 'requires_confirmation',
          resultRef: `case-match:${match.caseRef}`,
          interactionRef: `case-confirmation:${context.requestId}`,
        });
      }
      return Object.freeze({
        disposition: 'fallback',
        resultRef: `case-boundary:${match.caseRef}`,
      });
    }
    const adaptation = await this.#runtime.adapt(request.adaptationInput);
    assertGatewayStage(execution, 'CASE');
    const candidate = await request.toPlanCandidate(adaptation);
    assertGatewayStage(execution, 'CASE');
    if (
      !(await this.#current.verify({
        caseRef: request.adaptationInput.caseRef,
        goalContextRef: request.adaptationInput.goalContextRef,
        policyDecisionRef: request.adaptationInput.policyDecisionRef,
        runtimeSnapshotHash: request.adaptationInput.runtimeSnapshotHash,
      }))
    ) {
      return Object.freeze({
        disposition: 'discarded_stale',
        resultRef: `case-stale:${adaptation.caseRef}`,
      });
    }
    assertGatewayStage(execution, 'CASE');
    const handoff = await this.#handoff.submit(candidate);
    assertGatewayStage(execution, 'CASE');
    if (handoff.disposition === 'confirmed_and_committed') {
      return Object.freeze({
        disposition: 'formal_handoff',
        resultRef: adaptation.caseRef,
        formalHandoffRef: handoff.handoffId,
        ...(handoff.formalPlanRef === undefined ? {} : { formalPlanRef: handoff.formalPlanRef }),
      });
    }
    if (
      handoff.disposition === 'requires_confirmation' ||
      handoff.disposition === 'submitted_to_planning_session'
    ) {
      return Object.freeze({
        disposition: 'requires_confirmation',
        resultRef: adaptation.caseRef,
        interactionRef:
          handoff.formalPlanningSessionRef ?? `case-confirmation:${context.requestId}`,
        formalHandoffRef: handoff.handoffId,
      });
    }
    if (handoff.disposition === 'discarded_stale')
      return Object.freeze({ disposition: 'discarded_stale', resultRef: handoff.handoffId });
    return Object.freeze({ disposition: 'fallback', resultRef: handoff.handoffId });
  }
}

export interface ModelRouteGatewayRequestFactory {
  create(
    context: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
  ): Promise<
    Readonly<{
      routeContext: ModelRouteContext;
      artifactRef: string;
      artifactHash: string;
    }>
  >;
}

export class ModelRouteGatewayArtifactAdapter implements GatewayArtifactAdapter {
  readonly #runtime: ModelRouteRuntime;
  readonly #cascade: Pick<ModelCascadeService, 'run'>;
  readonly #requests: ModelRouteGatewayRequestFactory;

  constructor(
    dependencies: Readonly<{
      runtime: ModelRouteRuntime;
      cascade: Pick<ModelCascadeService, 'run'>;
      requests: ModelRouteGatewayRequestFactory;
    }>,
  ) {
    this.#runtime = dependencies.runtime;
    this.#cascade = dependencies.cascade;
    this.#requests = dependencies.requests;
  }

  async execute(
    context: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
    execution: GatewayStageExecution,
  ): Promise<GatewayArtifactAdapterOutcome> {
    assertGatewayStage(execution, 'MODEL_ROUTE');
    assertSelectedPath(retrieval.decision, 'small_model');
    const request = await this.#requests.create(context, retrieval);
    const decision = await this.#runtime.evaluate(request.routeContext);
    assertGatewayStage(execution, 'MODEL_ROUTE');
    if (decision.selectedProfileRefs.length === 0) {
      return Object.freeze({
        disposition: 'fallback',
        resultRef: `model-route:${decision.decisionHash}`,
      });
    }
    const run = await this.#cascade.run({
      context: request.routeContext,
      decision,
      artifactRef: request.artifactRef,
      artifactHash: request.artifactHash,
      signal: execution.signal,
    });
    assertGatewayStage(execution, 'MODEL_ROUTE');
    if (run.status === 'completed' && run.selectedOutputRef !== undefined)
      return Object.freeze({ disposition: 'completed', resultRef: run.selectedOutputRef });
    if (run.status === 'cancelled' || run.status === 'timed_out')
      return Object.freeze({ disposition: 'discarded_stale', resultRef: run.cascadeRunId });
    return Object.freeze({ disposition: 'fallback', resultRef: run.cascadeRunId });
  }
}

export interface ActiveCaseProjection {
  readonly caseRef: string;
  readonly tenantId?: string;
  readonly taskTypeId: string;
  readonly artifactHash: string;
  readonly activePointerVersion: number;
  readonly definition: CaseArtifactDefinition;
}

export interface ActiveModelRouteProjection {
  readonly artifactRef: string;
  readonly tenantId?: string;
  readonly artifactHash: string;
  readonly activePointerVersion: number;
  readonly definition: ModelRouteArtifactDefinition;
}

export interface CaseModelArtifactReader {
  listActiveCases(
    input: Readonly<{ tenantId: string; taskTypeId: string }>,
  ): Promise<readonly ActiveCaseProjection[]>;
  findActiveCase(caseRef: string): Promise<ActiveCaseProjection | undefined>;
  findActiveModelRoute(input: ModelRouteContext): Promise<ActiveModelRouteProjection | undefined>;
}

export interface CaseBindingReader {
  read(
    input: CaseAdaptationInput,
  ): Promise<Readonly<Record<string, Readonly<{ value: JsonValue; trust: string }>>>>;
}

export interface CaseRuntimeEvidenceRepository {
  saveMatch(
    input: Readonly<{
      request: CaseRetrievalInput;
      matches: readonly CaseMatch[];
      createdAt: string;
    }>,
  ): Promise<void>;
  saveAdaptation(
    input: Readonly<{
      adaptationId: string;
      request: CaseAdaptationInput;
      result: CaseAdaptationResult;
      artifactHash: string;
      activePointerVersion: number;
      createdAt: string;
    }>,
  ): Promise<void>;
}

export interface ModelProfileReader {
  listCurrent(tenantId: string): Promise<readonly ModelProfile[]>;
}

export interface ProviderProfileMetadata {
  readonly modelVersion: string;
  readonly capabilityTags: readonly string[];
  readonly qualityTier: number;
  readonly latencyTier: number;
  readonly costTier: number;
  readonly contextWindow: number;
  readonly modalities: readonly string[];
  readonly structuredOutputSupport: boolean;
  readonly toolCallingSupport: boolean;
  readonly dataResidency: readonly string[];
  readonly dataClassificationAllowance: readonly string[];
  readonly profileVersion: number;
}

export interface ProviderProfileMetadataPort {
  read(providerId: string, modelId: string): Promise<ProviderProfileMetadata>;
}

export interface ProviderReadinessPort {
  read(providerId: string): Promise<
    Readonly<{
      readiness: ModelProfile['readiness'];
      health: number;
      capacityAvailable: boolean;
      remainingInvocations: number;
      observedAt: string;
    }>
  >;
}

/** Projects profiles from the existing Provider Registry and live readiness. */
export class ProviderRegistryModelProfileReader implements ModelProfileReader {
  readonly #repository: Pick<ModelRuntimeRepository, 'listProviders'>;
  readonly #metadata: ProviderProfileMetadataPort;
  readonly #readiness: ProviderReadinessPort;

  constructor(
    dependencies: Readonly<{
      repository: Pick<ModelRuntimeRepository, 'listProviders'>;
      metadata: ProviderProfileMetadataPort;
      readiness: ProviderReadinessPort;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#metadata = dependencies.metadata;
    this.#readiness = dependencies.readiness;
  }

  async listCurrent(tenantId: string): Promise<readonly ModelProfile[]> {
    void tenantId;
    const configurations = await this.#repository.listProviders();
    const profiles: ModelProfile[] = [];
    for (const configuration of configurations) {
      const [metadata, readiness] = await Promise.all([
        this.#metadata.read(configuration.providerId, configuration.model),
        this.#readiness.read(configuration.providerId),
      ]);
      profiles.push(
        createModelProfile({
          profileId: `${configuration.providerId}:${configuration.model}:${String(metadata.profileVersion)}`,
          providerId: configuration.providerId,
          modelId: configuration.model,
          modelVersion: metadata.modelVersion,
          capabilityTags: metadata.capabilityTags,
          qualityTier: metadata.qualityTier,
          latencyTier: metadata.latencyTier,
          costTier: metadata.costTier,
          contextWindow: metadata.contextWindow,
          modalities: metadata.modalities,
          structuredOutputSupport: metadata.structuredOutputSupport,
          toolCallingSupport: metadata.toolCallingSupport,
          dataResidency: metadata.dataResidency,
          dataClassificationAllowance: metadata.dataClassificationAllowance,
          rateCapacity: {
            available: configuration.enabled && readiness.capacityAvailable,
            remainingInvocations: readiness.remainingInvocations,
            observedAt: readiness.observedAt,
          },
          readiness: configuration.enabled ? readiness.readiness : 'disabled',
          health: readiness.health,
          profileVersion: metadata.profileVersion,
        }),
      );
    }
    return Object.freeze(
      profiles.sort((left, right) => left.profileId.localeCompare(right.profileId)),
    );
  }
}

export interface ModelRouteEvidenceRepository {
  saveDecision(
    input: Readonly<{
      routeDecisionRef: string;
      context: ModelRouteContext;
      artifactRef: string;
      artifactHash: string;
      activePointerVersion: number;
      decision: ModelRouteDecision;
      createdAt: string;
    }>,
  ): Promise<void>;
  saveCascade(
    input: Readonly<{
      run: ModelCascadeRun;
      decisionHash: string;
      steps: readonly ModelCascadeStepEvidence[];
    }>,
  ): Promise<void>;
}

export interface ModelCascadeInvocationPort {
  invoke(
    input: Readonly<{
      profile: ModelProfile;
      requestRef: string;
      outputSchemaRef: string;
      signal: AbortSignal;
      timeoutMs: number;
    }>,
  ): Promise<
    Readonly<{
      outputRef: string;
      output: JsonValue;
      inputTokens: number;
      outputTokens: number;
      costUnits: number;
    }>
  >;
}

export interface ModelCascadeRequestSource {
  read(
    requestRef: string,
    outputSchemaRef: string,
  ): Promise<
    Readonly<{
      instruction: string;
      responseSchema: unknown;
      correctionErrors: readonly string[];
      taskId?: string;
    }>
  >;
}

/**
 * Invokes only through the existing provider registry, encrypted credential
 * authority and transport adapter. No secret enters a Profile or evidence row.
 */
export class ProviderAuthorityModelCascadeInvocationAdapter implements ModelCascadeInvocationPort {
  readonly #repository: Pick<ModelRuntimeRepository, 'findProvider' | 'saveInvocation'>;
  readonly #transport: ModelTransportAdapter;
  readonly #cipher: SecretCipher;
  readonly #requests: ModelCascadeRequestSource;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #ids: Readonly<{ nextInvocationId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: Pick<ModelRuntimeRepository, 'findProvider' | 'saveInvocation'>;
      transport: ModelTransportAdapter;
      cipher: SecretCipher;
      requests: ModelCascadeRequestSource;
      clock: Readonly<{ now(): string }>;
      ids: Readonly<{ nextInvocationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#transport = dependencies.transport;
    this.#cipher = dependencies.cipher;
    this.#requests = dependencies.requests;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async invoke(
    input: Parameters<ModelCascadeInvocationPort['invoke']>[0],
  ): ReturnType<ModelCascadeInvocationPort['invoke']> {
    const provider = await this.#repository.findProvider(input.profile.providerId);
    if (
      provider?.configuration.enabled !== true ||
      provider.configuration.model !== input.profile.modelId
    ) {
      throw new ModelRouteApplicationError('MODEL_ROUTE_PROFILE_STALE');
    }
    const request = await this.#requests.read(input.requestRef, input.outputSchemaRef);
    const started = Date.now();
    const invocationController = new AbortController();
    const forwardAbort = (): void => {
      invocationController.abort(input.signal.reason);
    };
    if (input.signal.aborted) forwardAbort();
    else input.signal.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(
      () => {
        invocationController.abort('MODEL_CASCADE_STEP_TIMEOUT');
      },
      Math.max(1, input.timeoutMs),
    );
    try {
      const response = await this.#transport.generateStructured({
        configuration: provider.configuration,
        credentialHeaders: this.#cipher.decrypt(provider.encryptedCredential),
        instruction: request.instruction,
        responseSchema: request.responseSchema,
        correctionErrors: request.correctionErrors,
        signal: invocationController.signal,
      });
      const output = requireJson(response.structuredResult);
      const invocationId = this.#ids.nextInvocationId();
      const inputTokens = response.inputTokens ?? 0;
      const outputTokens = response.outputTokens ?? 0;
      await this.#repository.saveInvocation({
        invocationId,
        ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
        stage: 'execution_decision',
        providerId: provider.configuration.providerId,
        model: provider.configuration.model,
        operation: 'structured_generation',
        request: {
          requestRef: input.requestRef,
          outputSchemaRef: input.outputSchemaRef,
        },
        context: {
          profileRef: input.profile.profileId,
          profileVersion: input.profile.profileVersion,
        },
        rawResponse: response.rawResponse,
        structuredResult: output,
        inputTokens,
        outputTokens,
        durationMs: Math.max(0, Date.now() - started),
        status: 'succeeded',
        createdAt: this.#clock.now(),
      });
      return Object.freeze({
        outputRef: `model-output:${invocationId}`,
        output,
        inputTokens,
        outputTokens,
        costUnits: ((inputTokens + outputTokens) * input.profile.costTier) / 1_000,
      });
    } catch (error) {
      await this.#repository.saveInvocation({
        invocationId: this.#ids.nextInvocationId(),
        ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
        stage: 'execution_decision',
        providerId: provider.configuration.providerId,
        model: provider.configuration.model,
        operation: 'structured_generation',
        request: {
          requestRef: input.requestRef,
          outputSchemaRef: input.outputSchemaRef,
        },
        context: {
          profileRef: input.profile.profileId,
          profileVersion: input.profile.profileVersion,
        },
        durationMs: Math.max(0, Date.now() - started),
        status: 'failed',
        errorCode: providerErrorCode(error),
        errorMessage: error instanceof Error ? error.message : 'Model cascade invocation failed.',
        createdAt: this.#clock.now(),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener('abort', forwardAbort);
    }
  }
}

export interface ModelCascadeOutputValidator {
  validate(
    input: Readonly<{
      outputSchemaRef: string;
      output: JsonValue;
      profile: ModelProfile;
    }>,
  ): Promise<Readonly<{ accepted: boolean; reasonCode?: string }>>;
}

export interface ModelCascadeCurrentState {
  verify(
    input: Readonly<{
      artifactRef: string;
      artifactHash: string;
      policySnapshotHash: string;
      providerProfileSnapshotHash: string;
    }>,
  ): Promise<boolean>;
}

export interface ModelCascadeStepEvidence {
  readonly stepRef: string;
  readonly profileRef: string;
  readonly attempt: number;
  readonly status: 'accepted' | 'rejected' | 'failed' | 'discarded_stale';
  readonly reasonCode: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUnits: number;
  readonly outputRef?: string;
}

export class CaseRuntimeService implements CaseRuntime {
  readonly #artifacts: CaseModelArtifactReader;
  readonly #bindings: CaseBindingReader;
  readonly #evidence: CaseRuntimeEvidenceRepository;
  readonly #clock: Readonly<{ now(): string; nowMs(): number }>;

  constructor(
    dependencies: Readonly<{
      artifacts: CaseModelArtifactReader;
      bindings: CaseBindingReader;
      evidence: CaseRuntimeEvidenceRepository;
      clock: Readonly<{ now(): string; nowMs(): number }>;
    }>,
  ) {
    this.#artifacts = dependencies.artifacts;
    this.#bindings = dependencies.bindings;
    this.#evidence = dependencies.evidence;
    this.#clock = dependencies.clock;
  }

  async retrieve(untrusted: CaseRetrievalInput): Promise<readonly CaseMatch[]> {
    const input = createCaseRetrievalInput(untrusted);
    this.#assertDeadline(input.deadlineAt);
    const candidates = await this.#artifacts.listActiveCases({
      tenantId: input.tenantId,
      taskTypeId: input.taskTypeId,
    });
    const matches = candidates
      .map((candidate) => this.#match(input, candidate))
      .filter((match): match is CaseMatch => match !== undefined)
      .sort((left, right) => right.score - left.score || left.caseRef.localeCompare(right.caseRef));
    const frozen = Object.freeze(matches);
    await this.#evidence.saveMatch({
      request: input,
      matches: frozen,
      createdAt: this.#clock.now(),
    });
    return frozen;
  }

  async adapt(untrusted: CaseAdaptationInput): Promise<CaseAdaptationResult> {
    const input = createCaseAdaptationInput(untrusted);
    this.#assertDeadline(input.deadlineAt);
    const candidate = await this.#artifacts.findActiveCase(input.caseRef);
    if (candidate === undefined) throw new CaseRuntimeApplicationError('CASE_DISCARDED_STALE');
    const bindings = await this.#bindings.read(input);
    const safeBindings: Record<string, JsonValue> = {};
    const unknowns: string[] = [];
    for (const [name, binding] of Object.entries(bindings)) {
      if (binding.trust !== 'authoritative' && binding.trust !== 'trusted') {
        unknowns.push(name);
        continue;
      }
      assertSafeAdaptation(name, binding.value);
      safeBindings[name] = binding.value;
    }
    const planPatchCandidate = substitute(
      candidate.definition.solutionPattern.planPatchTemplate,
      safeBindings,
    );
    const recoveryPlanCandidate = substitute(
      candidate.definition.solutionPattern.recoveryPlanTemplate,
      safeBindings,
    );
    if (planPatchCandidate === undefined && recoveryPlanCandidate === undefined) {
      throw new CaseRuntimeApplicationError('CASE_ADAPTATION_EMPTY');
    }
    const result: CaseAdaptationResult = Object.freeze({
      caseRef: candidate.caseRef,
      parameterMappings: Object.freeze(safeBindings),
      ...(planPatchCandidate === undefined ? {} : { planPatchCandidate }),
      ...(recoveryPlanCandidate === undefined ? {} : { recoveryPlanCandidate }),
      confidence: Math.max(0, Math.min(1, candidate.definition.priorOutcomeSummary.successRate)),
      unknowns: Object.freeze(unknowns.sort()),
      validationRequired: true,
    });
    await this.#evidence.saveAdaptation({
      adaptationId: `case-adaptation:${stableSuffix({
        input,
        artifactHash: candidate.artifactHash,
        bindings: safeBindings,
      })}`,
      request: input,
      result,
      artifactHash: candidate.artifactHash,
      activePointerVersion: candidate.activePointerVersion,
      createdAt: this.#clock.now(),
    });
    return result;
  }

  #match(input: CaseRetrievalInput, candidate: ActiveCaseProjection): CaseMatch | undefined {
    if (candidate.tenantId !== undefined && candidate.tenantId !== input.tenantId) return undefined;
    if (candidate.taskTypeId !== input.taskTypeId) return undefined;
    const score = caseSimilarity(input, candidate.definition);
    if (score < candidate.definition.applicability.minimumSimilarity) return undefined;
    const matchedBoundary = candidate.definition.failureBoundaries.find(
      (boundary) =>
        evaluateArtifactCondition(boundary.condition, {
          taskTypeId: input.taskTypeId,
          goalFeatureHash: input.problemFingerprint.goalFeatureHash,
          entityClasses: input.problemFingerprint.entityClasses,
          environmentClasses: input.problemFingerprint.environmentClasses,
          capabilityState: input.problemFingerprint.capabilityState,
          failureTypes: input.problemFingerprint.failureTypes,
          riskLevel: candidate.definition.problemFingerprint.riskLevel,
        }).passed,
    );
    const failureBoundaryStatus = matchedBoundary === undefined ? 'clear' : 'matched';
    const applicability =
      matchedBoundary?.action === 'require_confirmation'
        ? 'require_confirmation'
        : matchedBoundary === undefined
          ? score === 1
            ? 'eligible'
            : 'requires_adaptation'
          : 'fallback';
    return Object.freeze({
      caseRef: candidate.caseRef,
      score,
      applicability,
      failureBoundaryStatus,
      reasonCodes: Object.freeze([
        'CASE_ACTIVE_MATCH',
        matchedBoundary !== undefined
          ? 'CASE_FAILURE_BOUNDARY_MATCHED'
          : 'CASE_FAILURE_BOUNDARY_CLEAR',
      ]),
    });
  }

  #assertDeadline(deadlineAt: string): void {
    if (this.#clock.nowMs() >= Date.parse(deadlineAt))
      throw new CaseRuntimeApplicationError('CASE_DEADLINE_EXPIRED');
  }
}

export class ModelRouteRuntimeService implements ModelRouteRuntime {
  readonly #artifacts: CaseModelArtifactReader;
  readonly #profiles: ModelProfileReader;
  readonly #evidence: ModelRouteEvidenceRepository;
  readonly #clock: Readonly<{ now(): string; nowMs(): number }>;

  constructor(
    dependencies: Readonly<{
      artifacts: CaseModelArtifactReader;
      profiles: ModelProfileReader;
      evidence: ModelRouteEvidenceRepository;
      clock: Readonly<{ now(): string; nowMs(): number }>;
    }>,
  ) {
    this.#artifacts = dependencies.artifacts;
    this.#profiles = dependencies.profiles;
    this.#evidence = dependencies.evidence;
    this.#clock = dependencies.clock;
  }

  async evaluate(untrusted: ModelRouteContext): Promise<ModelRouteDecision> {
    const input = createModelRouteContext(untrusted);
    if (this.#clock.nowMs() >= Date.parse(input.deadlineAt))
      throw new ModelRouteApplicationError('MODEL_ROUTE_DEADLINE_EXPIRED');
    const artifact = await this.#artifacts.findActiveModelRoute(input);
    if (artifact === undefined)
      throw new ModelRouteApplicationError('MODEL_ROUTE_ARTIFACT_MISSING');
    if (artifact.tenantId !== undefined && artifact.tenantId !== input.tenantId)
      throw new ModelRouteApplicationError('MODEL_ROUTE_TENANT_MISMATCH');
    if (
      artifact.definition.conditions.some(
        (condition) =>
          !evaluateArtifactCondition(condition, {
            tenantId: input.tenantId,
            operationType: input.operationType,
            riskLevel: input.riskLevel,
            dataClassification: input.dataClassification,
            taskTypeId: input.taskTypeId ?? '',
          }).passed,
      )
    ) {
      throw new ModelRouteApplicationError('MODEL_ROUTE_CONDITION_MISMATCH');
    }
    const profiles = (await this.#profiles.listCurrent(input.tenantId)).map(createModelProfile);
    if (hashModelProfileSnapshot(profiles) !== input.providerProfileSnapshotHash)
      throw new ModelRouteApplicationError('MODEL_ROUTE_PROFILE_STALE');
    const eligible = profiles
      .filter((profile) => profileEligible(profile, input, artifact.definition.route))
      .sort(compareProfiles);
    const budget = {
      maxTokens: Math.min(
        artifact.definition.budget.maxTokens,
        (input.budget.maxInputTokens ?? artifact.definition.budget.maxTokens) +
          (input.budget.maxOutputTokens ?? artifact.definition.budget.maxTokens),
      ),
      maxLatencyMs: Math.min(
        artifact.definition.budget.maxLatencyMs,
        Math.max(0, Date.parse(input.deadlineAt) - this.#clock.nowMs()),
      ),
      maxCostUnits: Math.min(artifact.definition.budget.maxCostUnits, input.budget.maxCostUnits),
    };
    const decision = createModelRouteDecision({
      route: artifact.definition.route,
      reasonCodes:
        eligible.length === 0 ? ['MODEL_ROUTE_NO_READY_PROFILE'] : ['MODEL_ROUTE_SELECTED'],
      budget,
      fallbackRoutes: artifact.definition.fallbackRoutes,
      selectedProfileRefs: eligible
        .slice(0, input.budget.maxInvocations)
        .map((profile) => profile.profileId),
    });
    const routeDecisionRef = `model-route-decision:${decision.decisionHash.slice(-24)}`;
    await this.#evidence.saveDecision({
      routeDecisionRef,
      context: input,
      artifactRef: artifact.artifactRef,
      artifactHash: artifact.artifactHash,
      activePointerVersion: artifact.activePointerVersion,
      decision,
      createdAt: this.#clock.now(),
    });
    return decision;
  }
}

export class ModelCascadeService {
  readonly #profiles: ModelProfileReader;
  readonly #invocations: ModelCascadeInvocationPort;
  readonly #validator: ModelCascadeOutputValidator;
  readonly #current: ModelCascadeCurrentState;
  readonly #evidence: ModelRouteEvidenceRepository;
  readonly #clock: Readonly<{ now(): string; nowMs(): number }>;

  constructor(
    dependencies: Readonly<{
      profiles: ModelProfileReader;
      invocations: ModelCascadeInvocationPort;
      validator: ModelCascadeOutputValidator;
      current: ModelCascadeCurrentState;
      evidence: ModelRouteEvidenceRepository;
      clock: Readonly<{ now(): string; nowMs(): number }>;
    }>,
  ) {
    this.#profiles = dependencies.profiles;
    this.#invocations = dependencies.invocations;
    this.#validator = dependencies.validator;
    this.#current = dependencies.current;
    this.#evidence = dependencies.evidence;
    this.#clock = dependencies.clock;
  }

  async run(
    input: Readonly<{
      context: ModelRouteContext;
      decision: ModelRouteDecision;
      artifactRef: string;
      artifactHash: string;
      signal: AbortSignal;
    }>,
  ): Promise<ModelCascadeRun> {
    const context = createModelRouteContext(input.context);
    const profiles = await this.#profiles.listCurrent(context.tenantId);
    const byRef = new Map(
      profiles.map((profile) => [profile.profileId, createModelProfile(profile)]),
    );
    const cascadeRunId = `model-cascade:${stableSuffix({
      requestRef: context.requestRef,
      decisionHash: input.decision.decisionHash,
    })}`;
    const steps: ModelCascadeStepEvidence[] = [];
    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let selectedOutputRef: string | undefined;
    let status: ModelCascadeRun['status'] = 'fallback';
    for (const [index, profileRef] of input.decision.selectedProfileRefs.entries()) {
      if (input.signal.aborted) {
        status = 'cancelled';
        break;
      }
      if (this.#clock.nowMs() >= Date.parse(context.deadlineAt)) {
        status = 'timed_out';
        break;
      }
      if (
        !(await this.#current.verify({
          artifactRef: input.artifactRef,
          artifactHash: input.artifactHash,
          policySnapshotHash: context.policySnapshotHash,
          providerProfileSnapshotHash: context.providerProfileSnapshotHash,
        }))
      ) {
        steps.push(step(profileRef, index, 'discarded_stale', 'MODEL_ROUTE_PROFILE_STALE'));
        status = 'failed';
        break;
      }
      const profile = byRef.get(profileRef);
      if (profile?.readiness !== 'ready') {
        steps.push(step(profileRef, index, 'discarded_stale', 'MODEL_ROUTE_PROFILE_STALE'));
        continue;
      }
      const remainingCost = input.decision.budget.maxCostUnits - cost;
      const remainingTokens = input.decision.budget.maxTokens - inputTokens - outputTokens;
      if (remainingCost <= 0 || remainingTokens <= 0) {
        status = 'budget_exhausted';
        break;
      }
      const controller = new AbortController();
      const onAbort = (): void => {
        controller.abort(input.signal.reason);
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const result = await this.#invocations.invoke({
          profile,
          requestRef: context.requestRef,
          outputSchemaRef: context.outputSchemaRef,
          signal: controller.signal,
          timeoutMs: Math.min(
            input.decision.budget.maxLatencyMs,
            Math.max(1, Date.parse(context.deadlineAt) - this.#clock.nowMs()),
          ),
        });
        if (
          isAborted(input.signal) ||
          this.#clock.nowMs() >= Date.parse(context.deadlineAt) ||
          !(await this.#current.verify({
            artifactRef: input.artifactRef,
            artifactHash: input.artifactHash,
            policySnapshotHash: context.policySnapshotHash,
            providerProfileSnapshotHash: context.providerProfileSnapshotHash,
          }))
        ) {
          steps.push(
            step(
              profileRef,
              index,
              'discarded_stale',
              'MODEL_CASCADE_LATE_RESULT_DISCARDED',
              result,
            ),
          );
          status = 'failed';
          break;
        }
        cost += result.costUnits;
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        if (
          cost > input.decision.budget.maxCostUnits ||
          inputTokens + outputTokens > input.decision.budget.maxTokens
        ) {
          steps.push(step(profileRef, index, 'rejected', 'MODEL_ROUTE_BUDGET_EXHAUSTED', result));
          status = 'budget_exhausted';
          break;
        }
        const validation = await this.#validator.validate({
          outputSchemaRef: context.outputSchemaRef,
          output: result.output,
          profile,
        });
        if (validation.accepted) {
          selectedOutputRef = result.outputRef;
          steps.push(step(profileRef, index, 'accepted', 'MODEL_CASCADE_OUTPUT_ACCEPTED', result));
          status = 'completed';
          break;
        }
        steps.push(
          step(
            profileRef,
            index,
            'rejected',
            validation.reasonCode ?? 'MODEL_CASCADE_OUTPUT_REJECTED',
            result,
          ),
        );
      } catch (error) {
        steps.push(step(profileRef, index, 'failed', providerErrorCode(error)));
      } finally {
        input.signal.removeEventListener('abort', onAbort);
        controller.abort('cascade_step_complete');
      }
    }
    const run = createModelCascadeRun({
      cascadeRunId,
      routeDecisionRef: `model-route-decision:${input.decision.decisionHash.slice(-24)}`,
      status,
      stepRefs: steps.map((candidate) => candidate.stepRef),
      ...(selectedOutputRef === undefined ? {} : { selectedOutputRef }),
      totalCostUnits: cost,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      completedAt: this.#clock.now(),
    });
    await this.#evidence.saveCascade({
      run,
      decisionHash: input.decision.decisionHash,
      steps: Object.freeze(steps),
    });
    return run;
  }
}

function profileEligible(
  profile: ModelProfile,
  context: ModelRouteContext,
  route: ModelRouteArtifactDefinition['route'],
): boolean {
  if (
    profile.readiness !== 'ready' ||
    !profile.rateCapacity.available ||
    profile.rateCapacity.remainingInvocations < 1
  )
    return false;
  const requiredResidencies = context.requiredCapabilities
    .filter((capability) => capability.startsWith('residency:'))
    .map((capability) => capability.slice('residency:'.length));
  const technicalCapabilities = context.requiredCapabilities.filter(
    (capability) => !capability.startsWith('residency:'),
  );
  if (!technicalCapabilities.every((capability) => profile.capabilityTags.includes(capability)))
    return false;
  if (
    requiredResidencies.length > 0 &&
    !requiredResidencies.every((residency) => profile.dataResidency.includes(residency))
  )
    return false;
  if (!profile.dataClassificationAllowance.includes(context.dataClassification)) return false;
  if (context.outputSchemaRef !== 'none' && !profile.structuredOutputSupport) return false;
  return route === 'none' || route === 'human' || profile.capabilityTags.includes(`route:${route}`);
}

function compareProfiles(left: ModelProfile, right: ModelProfile): number {
  return (
    right.qualityTier - left.qualityTier ||
    left.latencyTier - right.latencyTier ||
    left.costTier - right.costTier ||
    right.health - left.health ||
    left.profileId.localeCompare(right.profileId)
  );
}

function assertSafeAdaptation(name: string, value: JsonValue): void {
  const normalized = name.toLowerCase();
  if (
    normalized.includes('credential') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('api_key') ||
    normalized.includes('historical') ||
    normalized.endsWith('instance_id')
  ) {
    throw new CaseRuntimeApplicationError('CASE_CREDENTIAL_OR_HISTORICAL_ID_REJECTED');
  }
  if (isPiiField(normalized)) {
    throw new CaseRuntimeApplicationError('CASE_PII_REJECTED');
  }
  scanValue(value, 0);
}

function isPiiField(normalized: string): boolean {
  const tokens = normalized.split(/[^a-z0-9]+/u).filter((token) => token.length > 0);
  if (
    tokens.some((token) =>
      [
        'pii',
        'email',
        'phone',
        'mobile',
        'contact',
        'address',
        'passport',
        'ssn',
        'biometric',
      ].includes(token),
    )
  )
    return true;
  return (
    /(^|_)(first|last|full|legal)_?name($|_)/u.test(normalized) ||
    /(^|_)(user|person|customer|account|subject|national)_?id($|_)/u.test(normalized) ||
    /(^|_)(birth_?date|date_?of_?birth|dob|ip_?address)($|_)/u.test(normalized)
  );
}

function scanValue(value: JsonValue, depth: number): void {
  if (depth > 8) throw new CaseRuntimeApplicationError('CASE_ADAPTATION_VALUE_TOO_DEEP');
  if (isJsonArray(value)) {
    for (const item of value) scanValue(item, depth + 1);
    return;
  }
  if (isJsonRecord(value)) {
    const record: Readonly<Record<string, JsonValue>> = value;
    for (const key of Object.keys(record)) {
      const item: JsonValue | undefined = record[key];
      if (item === undefined) continue;
      assertSafeAdaptation(key, item);
      scanValue(item, depth + 1);
    }
  }
}

function substitute(
  template: JsonValue | undefined,
  bindings: Readonly<Record<string, JsonValue>>,
): JsonValue | undefined {
  if (template === undefined) return undefined;
  if (typeof template === 'string') {
    const exact = /^\{\{([A-Za-z0-9_.-]+)\}\}$/u.exec(template);
    if (exact !== null) return bindings[exact[1] ?? ''] ?? template;
    return template.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/gu, (source, name: string) => {
      const value = bindings[name];
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : source;
    });
  }
  if (isJsonArray(template))
    return Object.freeze(template.map((item) => substitute(item, bindings) ?? null));
  if (isJsonRecord(template)) {
    const record: Readonly<Record<string, JsonValue>> = template;
    return Object.freeze(
      Object.fromEntries(
        Object.keys(record).map((key) => [key, substitute(record[key] ?? null, bindings) ?? null]),
      ),
    );
  }
  return template;
}

function step(
  profileRef: string,
  index: number,
  status: ModelCascadeStepEvidence['status'],
  reasonCode: string,
  usage?: Readonly<{
    outputRef: string;
    inputTokens: number;
    outputTokens: number;
    costUnits: number;
  }>,
): ModelCascadeStepEvidence {
  return Object.freeze({
    stepRef: `model-cascade-step:${String(index + 1)}:${profileRef}`,
    profileRef,
    attempt: 1,
    status,
    reasonCode,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUnits: usage?.costUnits ?? 0,
    ...(usage === undefined ? {} : { outputRef: usage.outputRef }),
  });
}

function stableSuffix(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isJsonRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function assertGatewayStage(execution: GatewayStageExecution, adapter: string): void {
  if (execution.signal.aborted || !execution.mayCommitFormalAuthority())
    throw new Error(`${adapter}_GATEWAY_STAGE_EXPIRED`);
}

function requireJson(value: unknown, depth = 0): JsonValue {
  if (depth > 12) throw new ModelRouteApplicationError('MODEL_OUTPUT_NOT_JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ModelRouteApplicationError('MODEL_OUTPUT_NOT_JSON');
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((item) => requireJson(item, depth + 1)));
  if (typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, requireJson(item, depth + 1)]),
      ),
    );
  }
  throw new ModelRouteApplicationError('MODEL_OUTPUT_NOT_JSON');
}

function providerErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'MODEL_CASCADE_INVOCATION_FAILED';
}

function assertSelectedPath(
  decision: RuntimeExecutionDecision,
  expected: RuntimeExecutionDecision['path'],
): void {
  if (decision.path !== expected || decision.selectedArtifactRef === undefined)
    throw new Error(`P11_GATEWAY_PATH_INVALID:${expected}`);
}

export class CaseRuntimeApplicationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CaseRuntimeApplicationError';
    this.code = code;
  }
}

export class ModelRouteApplicationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ModelRouteApplicationError';
    this.code = code;
  }
}
