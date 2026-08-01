import type {
  GatewayArtifactFeedbackPort,
  GatewayRetrievalPort,
  GatewayRuleOutcome,
  GatewayRulePort,
  GatewayStageExecution,
  GatewayTemplateOutcome,
  GatewayTemplatePort,
} from './fast-gateway.js';
import type { RuleUsageRepository } from './decision-rule-runtime.js';
import type {
  ArtifactRetrievalRequest,
  ArtifactRetrievalResult,
  ArtifactRetrievalService,
} from './artifact-retrieval.js';
import type { DecisionRuleRuntimeService, RuleDecisionRequest } from './decision-rule-runtime.js';
import type { TemplateRuntimeRequest, TemplateRuntimeService } from './template-runtime.js';
import type { RuntimeRequestContext } from '../../../domain/src/index.js';

export interface GatewayArtifactRetrievalRequestFactory {
  create(input: RuntimeRequestContext): Promise<ArtifactRetrievalRequest>;
}

export class P07GatewayRetrievalAdapter implements GatewayRetrievalPort {
  readonly #runtime: Pick<ArtifactRetrievalService, 'retrieve'>;
  readonly #requests: GatewayArtifactRetrievalRequestFactory;

  constructor(
    runtime: Pick<ArtifactRetrievalService, 'retrieve'>,
    requests: GatewayArtifactRetrievalRequestFactory,
  ) {
    this.#runtime = runtime;
    this.#requests = requests;
  }

  async retrieve(
    input: RuntimeRequestContext,
    execution: GatewayStageExecution,
  ): Promise<ArtifactRetrievalResult> {
    assertStageActive(execution, 'P07');
    const request = await this.#requests.create(input);
    assertStageActive(execution, 'P07');
    const result = await this.#runtime.retrieve(request);
    assertStageActive(execution, 'P07');
    return result;
  }
}

export interface GatewayRuleDecisionRequestFactory {
  create(
    input: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
  ): Promise<RuleDecisionRequest>;
}

export class P09GatewayRuleAdapter implements GatewayRulePort {
  readonly #runtime: Pick<DecisionRuleRuntimeService, 'evaluateDecisionRules'>;
  readonly #requests: GatewayRuleDecisionRequestFactory;

  constructor(
    runtime: Pick<DecisionRuleRuntimeService, 'evaluateDecisionRules'>,
    requests: GatewayRuleDecisionRequestFactory,
  ) {
    this.#runtime = runtime;
    this.#requests = requests;
  }

  async evaluate(
    input: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
    execution: GatewayStageExecution,
  ): Promise<GatewayRuleOutcome> {
    assertStageActive(execution, 'P09');
    const request = await this.#requests.create(input, retrieval);
    const result = await this.#runtime.evaluateDecisionRules({
      ...request,
      commitGuard: execution,
    });
    assertStageActive(execution, 'P09');
    const decision = result.decision;
    if (decision.disposition === 'require_confirmation') {
      return Object.freeze({
        disposition: 'require_confirmation',
        resultRef: decision.decisionId,
        ...(result.formalHandoff?.formalPlanningSessionRef === undefined
          ? {}
          : { interactionRef: result.formalHandoff.formalPlanningSessionRef }),
      });
    }
    if (decision.disposition === 'deny') {
      return Object.freeze({ disposition: 'deny', resultRef: decision.decisionId });
    }
    if (
      decision.disposition === 'fallback' ||
      decision.disposition === 'discarded_stale' ||
      decision.disposition === 'failed'
    ) {
      return Object.freeze({ disposition: 'fallback', resultRef: decision.decisionId });
    }
    if (decision.disposition === 'no_match') {
      return Object.freeze({ disposition: 'no_match', resultRef: decision.decisionId });
    }
    if (decision.disposition === 'advice') {
      return Object.freeze({ disposition: 'advice', resultRef: decision.decisionId });
    }
    return Object.freeze({
      disposition: 'plan_patch_candidate',
      resultRef: decision.decisionId,
      ...(result.formalHandoff === undefined
        ? {}
        : {
            formalHandoffRef: result.formalHandoff.handoffId,
            ...(result.formalHandoff.formalPlanRef === undefined
              ? {}
              : { formalPlanRef: result.formalHandoff.formalPlanRef }),
            ...(result.formalHandoff.formalPlanningSessionRef === undefined
              ? {}
              : { interactionRef: result.formalHandoff.formalPlanningSessionRef }),
          }),
    });
  }
}

export interface GatewayTemplateRuntimeRequestFactory {
  create(
    input: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
  ): Promise<TemplateRuntimeRequest>;
}

export class P08GatewayTemplateAdapter implements GatewayTemplatePort {
  readonly #runtime: Pick<TemplateRuntimeService, 'instantiate'>;
  readonly #requests: GatewayTemplateRuntimeRequestFactory;

  constructor(
    runtime: Pick<TemplateRuntimeService, 'instantiate'>,
    requests: GatewayTemplateRuntimeRequestFactory,
  ) {
    this.#runtime = runtime;
    this.#requests = requests;
  }

  async instantiate(
    input: RuntimeRequestContext,
    retrieval: ArtifactRetrievalResult,
    execution: GatewayStageExecution,
  ): Promise<GatewayTemplateOutcome> {
    assertStageActive(execution, 'P08');
    const request = await this.#requests.create(input, retrieval);
    const outcome = await this.#runtime.instantiate({
      ...request,
      commitGuard: execution,
    });
    assertStageActive(execution, 'P08');
    const handoff = outcome.formalHandoff;
    if (handoff?.disposition === 'confirmed_and_committed') {
      return Object.freeze({
        disposition: 'formal_handoff',
        resultRef: outcome.result.instantiationId,
        formalHandoffRef: handoff.handoffId,
        ...(handoff.formalPlanRef === undefined ? {} : { formalPlanRef: handoff.formalPlanRef }),
      });
    }
    if (
      handoff?.disposition === 'requires_confirmation' ||
      outcome.result.disposition === 'requires_confirmation'
    ) {
      return Object.freeze({
        disposition: 'requires_confirmation',
        resultRef: outcome.result.instantiationId,
        ...(handoff === undefined ? {} : { formalHandoffRef: handoff.handoffId }),
        interactionRef:
          handoff?.formalPlanningSessionRef ??
          `template-interaction:${outcome.result.instantiationId}`,
      });
    }
    if (outcome.result.disposition === 'discarded_stale') {
      return Object.freeze({
        disposition: 'discarded_stale',
        resultRef: outcome.result.instantiationId,
      });
    }
    return Object.freeze({
      disposition: 'fallback',
      resultRef: outcome.result.instantiationId,
    });
  }
}

function assertStageActive(execution: GatewayStageExecution, adapter: string): void {
  if (execution.signal.aborted || !execution.mayCommitFormalAuthority()) {
    throw new Error(`${adapter}_GATEWAY_STAGE_EXPIRED`);
  }
}

/**
 * Projects selected-Artifact feedback into P02's canonical execution/feedback
 * rows. The Gateway envelope remains correlation evidence only.
 */
export class P02GatewayArtifactFeedbackAdapter implements GatewayArtifactFeedbackPort {
  readonly #usage: Pick<RuleUsageRepository, 'appendFeedbackOnce'>;

  constructor(usage: Pick<RuleUsageRepository, 'appendFeedbackOnce'>) {
    this.#usage = usage;
  }

  async record(input: Parameters<GatewayArtifactFeedbackPort['record']>[0]): Promise<void> {
    if (input.selectedArtifactRefs.length === 0) return;
    if (input.selectedArtifactRefs.length !== 1) {
      throw new Error('GATEWAY_MULTI_ARTIFACT_FEEDBACK_UNSUPPORTED');
    }
    const executionRef = input.sourceRefs.find((ref) => ref.startsWith('artifact_execution:'));
    if (executionRef === undefined) {
      throw new Error('GATEWAY_ARTIFACT_EXECUTION_REF_REQUIRED');
    }
    const artifactRef = input.selectedArtifactRefs[0];
    if (artifactRef === undefined) throw new Error('GATEWAY_ARTIFACT_REF_REQUIRED');
    const separator = artifactRef.lastIndexOf(':');
    const artifactId = separator < 1 ? artifactRef : artifactRef.slice(0, separator);
    await this.#usage.appendFeedbackOnce({
      feedbackId: `p10-artifact-feedback:${input.feedbackId}`,
      artifactExecutionId: executionRef.slice('artifact_execution:'.length),
      artifactId,
      feedbackType: `gateway_${input.feedbackType}`,
      reasonCode: `GATEWAY_${input.feedbackType.toUpperCase()}`,
      summary: 'P10 linked Gateway feedback to the canonical Artifact execution.',
      impact: {
        gatewayDecisionRef: input.gatewayDecisionRef,
        payload: input.payload,
        sourceRefs: input.sourceRefs,
      },
      ...(input.formalOutcomeRef === undefined ? {} : { outcomeRef: input.formalOutcomeRef }),
      createdAt: input.createdAt,
    });
  }
}
