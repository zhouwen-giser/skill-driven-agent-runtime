import type { GatewayFeedbackEnvelope, JsonValue } from '../../../domain/src/index.js';

export interface GatewayFeedbackDimensions {
  readonly tenantId: string;
  readonly taskTypeId: string;
  readonly environmentClass: string;
}

export interface GatewayArtifactAttribution {
  readonly artifactRef: string;
  readonly selectedCount: number;
  readonly committedCount: number;
  readonly fallbackCount: number;
  readonly formalOutcomeSuccessCount: number;
  readonly formalOutcomeFailureCount: number;
  readonly correctionCount: number;
  readonly recoveryCount: number;
  readonly dimensions: readonly GatewayFeedbackDimensions[];
}

export interface GatewayDriftAssessment {
  readonly artifactRef: string;
  readonly severity: 'normal' | 'urgent' | 'critical';
  readonly reasonCodes: readonly string[];
  readonly sourceRefs: readonly string[];
}

export interface GatewayFeedbackAnalysis {
  readonly sampleCount: number;
  readonly selectedCount: number;
  readonly committedCount: number;
  readonly fallbackCount: number;
  readonly fastSuccessCount: number;
  readonly formalOutcomeSuccessCount: number;
  readonly artifacts: readonly GatewayArtifactAttribution[];
  readonly drift: readonly GatewayDriftAssessment[];
}

export interface GatewayDriftThresholds {
  readonly urgentFailureRate: number;
  readonly criticalFailureRate: number;
  readonly urgentCorrectionRate: number;
  readonly minimumOutcomeSamples: number;
}

const DEFAULT_THRESHOLDS: GatewayDriftThresholds = Object.freeze({
  urgentFailureRate: 0.15,
  criticalFailureRate: 0.35,
  urgentCorrectionRate: 0.2,
  minimumOutcomeSamples: 5,
});

/**
 * Read-only G18 attribution. It consumes immutable Gateway feedback, never
 * mutates Artifact status and never treats fallback success as fast success.
 */
export class GatewayFeedbackAnalyzer {
  readonly #thresholds: GatewayDriftThresholds;

  constructor(thresholds: Partial<GatewayDriftThresholds> = {}) {
    this.#thresholds = validateThresholds({ ...DEFAULT_THRESHOLDS, ...thresholds });
  }

  analyze(feedback: readonly GatewayFeedbackEnvelope[]): GatewayFeedbackAnalysis {
    if (feedback.length > 10_000) {
      throw new GatewayFeedbackAnalysisError(
        'GATEWAY_FEEDBACK_SAMPLE_BOUND_EXCEEDED',
        'Gateway feedback analysis accepts at most 10,000 envelopes.',
      );
    }
    const byArtifact = new Map<string, MutableArtifactAttribution>();
    let selectedCount = 0;
    let committedCount = 0;
    let fallbackCount = 0;
    let formalOutcomeSuccessCount = 0;

    for (const envelope of feedback) {
      assertEnvelopeSafe(envelope);
      const selected = envelope.selectedArtifactRefs.length > 0;
      const committed =
        selected &&
        envelope.feedbackType === 'formal_handoff' &&
        envelope.formalPlanRef !== undefined;
      const fallback = envelope.feedbackType === 'fallback';
      const outcomeStatus =
        envelope.feedbackType === 'outcome' ? stringPayload(envelope.payload, 'status') : undefined;
      if (selected && envelope.feedbackType === 'route_selected') selectedCount += 1;
      if (committed) committedCount += 1;
      if (fallback) fallbackCount += 1;
      if (outcomeStatus === 'succeeded') formalOutcomeSuccessCount += 1;

      for (const artifactRef of envelope.selectedArtifactRefs) {
        const attribution = byArtifact.get(artifactRef) ?? mutableAttribution(artifactRef);
        if (envelope.feedbackType === 'route_selected') attribution.selectedCount += 1;
        if (committed) attribution.committedCount += 1;
        if (fallback) attribution.fallbackCount += 1;
        if (outcomeStatus === 'succeeded') attribution.formalOutcomeSuccessCount += 1;
        if (outcomeStatus === 'failed' || outcomeStatus === 'canceled') {
          attribution.formalOutcomeFailureCount += 1;
        }
        if (envelope.feedbackType === 'correction') attribution.correctionCount += 1;
        if (envelope.feedbackType === 'recovery') attribution.recoveryCount += 1;
        const dimensions = feedbackDimensions(envelope.payload);
        if (dimensions !== undefined) {
          attribution.dimensions.set(dimensionKey(dimensions), dimensions);
        }
        for (const sourceRef of envelope.sourceRefs) attribution.sourceRefs.add(sourceRef);
        if (isCriticalSafetyFeedback(envelope)) attribution.criticalSafety = true;
        byArtifact.set(artifactRef, attribution);
      }
    }

    const artifacts = Object.freeze(
      [...byArtifact.values()]
        .sort((left, right) => left.artifactRef.localeCompare(right.artifactRef))
        .map(freezeAttribution),
    );
    const drift = Object.freeze(
      [...byArtifact.values()]
        .sort((left, right) => left.artifactRef.localeCompare(right.artifactRef))
        .map((attribution) => this.#assessDrift(attribution)),
    );
    const fastSuccessCount = artifacts.reduce(
      (sum, artifact) =>
        sum + Math.min(artifact.committedCount, artifact.formalOutcomeSuccessCount),
      0,
    );
    return Object.freeze({
      sampleCount: feedback.length,
      selectedCount,
      committedCount,
      fallbackCount,
      fastSuccessCount,
      formalOutcomeSuccessCount,
      artifacts,
      drift,
    });
  }

  #assessDrift(input: MutableArtifactAttribution): GatewayDriftAssessment {
    const outcomes = input.formalOutcomeSuccessCount + input.formalOutcomeFailureCount;
    const failureRate = outcomes === 0 ? 0 : input.formalOutcomeFailureCount / outcomes;
    const correctionRate = outcomes === 0 ? 0 : input.correctionCount / outcomes;
    const reasonCodes: string[] = [];
    let severity: GatewayDriftAssessment['severity'] = 'normal';
    if (input.criticalSafety) {
      severity = 'critical';
      reasonCodes.push('GATEWAY_DRIFT_CRITICAL_SAFETY');
    } else if (
      outcomes >= this.#thresholds.minimumOutcomeSamples &&
      failureRate >= this.#thresholds.criticalFailureRate
    ) {
      severity = 'critical';
      reasonCodes.push('GATEWAY_DRIFT_FAILURE_RATE_CRITICAL');
    } else if (
      outcomes >= this.#thresholds.minimumOutcomeSamples &&
      (failureRate >= this.#thresholds.urgentFailureRate ||
        correctionRate >= this.#thresholds.urgentCorrectionRate)
    ) {
      severity = 'urgent';
      if (failureRate >= this.#thresholds.urgentFailureRate) {
        reasonCodes.push('GATEWAY_DRIFT_FAILURE_RATE_URGENT');
      }
      if (correctionRate >= this.#thresholds.urgentCorrectionRate) {
        reasonCodes.push('GATEWAY_DRIFT_CORRECTION_RATE_URGENT');
      }
    } else {
      reasonCodes.push('GATEWAY_DRIFT_NORMAL');
    }
    return Object.freeze({
      artifactRef: input.artifactRef,
      severity,
      reasonCodes: Object.freeze(reasonCodes),
      sourceRefs: Object.freeze([...input.sourceRefs].sort()),
    });
  }
}

interface MutableArtifactAttribution {
  readonly artifactRef: string;
  selectedCount: number;
  committedCount: number;
  fallbackCount: number;
  formalOutcomeSuccessCount: number;
  formalOutcomeFailureCount: number;
  correctionCount: number;
  recoveryCount: number;
  criticalSafety: boolean;
  readonly dimensions: Map<string, GatewayFeedbackDimensions>;
  readonly sourceRefs: Set<string>;
}

function mutableAttribution(artifactRef: string): MutableArtifactAttribution {
  return {
    artifactRef,
    selectedCount: 0,
    committedCount: 0,
    fallbackCount: 0,
    formalOutcomeSuccessCount: 0,
    formalOutcomeFailureCount: 0,
    correctionCount: 0,
    recoveryCount: 0,
    criticalSafety: false,
    dimensions: new Map(),
    sourceRefs: new Set(),
  };
}

function freezeAttribution(input: MutableArtifactAttribution): GatewayArtifactAttribution {
  return Object.freeze({
    artifactRef: input.artifactRef,
    selectedCount: input.selectedCount,
    committedCount: input.committedCount,
    fallbackCount: input.fallbackCount,
    formalOutcomeSuccessCount: input.formalOutcomeSuccessCount,
    formalOutcomeFailureCount: input.formalOutcomeFailureCount,
    correctionCount: input.correctionCount,
    recoveryCount: input.recoveryCount,
    dimensions: Object.freeze(
      [...input.dimensions.values()].sort((left, right) =>
        dimensionKey(left).localeCompare(dimensionKey(right)),
      ),
    ),
  });
}

function feedbackDimensions(payload: JsonValue): GatewayFeedbackDimensions | undefined {
  if (!isJsonObject(payload)) return undefined;
  const tenantId = payload['tenantId'];
  const taskTypeId = payload['taskTypeId'];
  const environmentClass = payload['environmentClass'];
  if (
    typeof tenantId !== 'string' ||
    typeof taskTypeId !== 'string' ||
    typeof environmentClass !== 'string'
  ) {
    return undefined;
  }
  return Object.freeze({ tenantId, taskTypeId, environmentClass });
}

function stringPayload(payload: JsonValue, field: string): string | undefined {
  if (!isJsonObject(payload)) return undefined;
  const value = payload[field];
  return typeof value === 'string' ? value : undefined;
}

function isCriticalSafetyFeedback(envelope: GatewayFeedbackEnvelope): boolean {
  return (
    envelope.feedbackType === 'drift' &&
    (stringPayload(envelope.payload, 'severity') === 'critical' ||
      stringPayload(envelope.payload, 'kind') === 'unsafe_allow')
  );
}

function assertEnvelopeSafe(envelope: GatewayFeedbackEnvelope): void {
  if (
    JSON.stringify(envelope.payload).toLowerCase().includes('chain_of_thought') ||
    JSON.stringify(envelope.payload).toLowerCase().includes('private_reasoning')
  ) {
    throw new GatewayFeedbackAnalysisError(
      'GATEWAY_PRIVATE_REASONING_FORBIDDEN',
      'Gateway feedback must contain structured summaries, not private reasoning.',
    );
  }
}

function validateThresholds(input: GatewayDriftThresholds): GatewayDriftThresholds {
  if (
    ![input.urgentFailureRate, input.criticalFailureRate, input.urgentCorrectionRate].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    input.urgentFailureRate > input.criticalFailureRate ||
    !Number.isSafeInteger(input.minimumOutcomeSamples) ||
    input.minimumOutcomeSamples < 1
  ) {
    throw new GatewayFeedbackAnalysisError(
      'GATEWAY_DRIFT_THRESHOLD_INVALID',
      'Gateway drift thresholds are invalid.',
    );
  }
  return Object.freeze({ ...input });
}

function dimensionKey(input: GatewayFeedbackDimensions): string {
  return `${input.tenantId}\u0000${input.taskTypeId}\u0000${input.environmentClass}`;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class GatewayFeedbackAnalysisError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GatewayFeedbackAnalysisError';
    this.code = code;
  }
}
