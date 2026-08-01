import { describe, expect, it } from 'vitest';

import { GatewayFeedbackAnalysisError, GatewayFeedbackAnalyzer } from '../src/index.js';
import type { GatewayFeedbackEnvelope, GatewayFeedbackType } from '../../domain/src/index.js';

describe('P10 G18 Gateway feedback attribution and drift', () => {
  it('does not count fallback success as fast success', () => {
    const analysis = new GatewayFeedbackAnalyzer().analyze([
      feedback('fallback', [], { status: 'succeeded' }),
      feedback('outcome', [], { status: 'succeeded' }),
    ]);
    expect(analysis).toMatchObject({
      fallbackCount: 1,
      formalOutcomeSuccessCount: 1,
      fastSuccessCount: 0,
    });
  });

  it('distinguishes selected, committed and formal outcome success', () => {
    const analysis = new GatewayFeedbackAnalyzer().analyze([
      feedback('route_selected', ['artifact-1:1'], dimensions()),
      feedback('formal_handoff', ['artifact-1:1'], dimensions(), {
        formalPlanRef: 'plan-1',
      }),
      feedback(
        'outcome',
        ['artifact-1:1'],
        { ...dimensions(), status: 'succeeded' },
        {
          formalPlanRef: 'plan-1',
          formalOutcomeRef: 'outcome-1',
        },
      ),
    ]);
    expect(analysis).toMatchObject({
      selectedCount: 1,
      committedCount: 1,
      formalOutcomeSuccessCount: 1,
      fastSuccessCount: 1,
      artifacts: [
        expect.objectContaining({
          artifactRef: 'artifact-1:1',
          selectedCount: 1,
          committedCount: 1,
          formalOutcomeSuccessCount: 1,
        }),
      ],
    });
  });

  it('aggregates Artifact, Tenant, Task Type and Environment dimensions', () => {
    const analysis = new GatewayFeedbackAnalyzer().analyze([
      feedback('route_selected', ['artifact-1:1'], dimensions()),
      feedback('route_selected', ['artifact-1:1'], {
        tenantId: 'tenant-2',
        taskTypeId: 'inspect',
        environmentClass: 'lab',
      }),
    ]);
    expect(analysis.artifacts[0]?.dimensions).toEqual([
      { tenantId: 'tenant-1', taskTypeId: 'inspect', environmentClass: 'lab' },
      { tenantId: 'tenant-2', taskTypeId: 'inspect', environmentClass: 'lab' },
    ]);
  });

  it('raises urgent drift only after the minimum outcome sample bound', () => {
    const analyzer = new GatewayFeedbackAnalyzer({
      minimumOutcomeSamples: 4,
      urgentFailureRate: 0.25,
      criticalFailureRate: 0.75,
    });
    const analysis = analyzer.analyze([
      feedback('outcome', ['artifact-1:1'], { status: 'succeeded' }),
      feedback('outcome', ['artifact-1:1'], { status: 'succeeded' }),
      feedback('outcome', ['artifact-1:1'], { status: 'succeeded' }),
      feedback('outcome', ['artifact-1:1'], { status: 'failed' }),
    ]);
    expect(analysis.drift).toEqual([
      expect.objectContaining({
        severity: 'urgent',
        reasonCodes: ['GATEWAY_DRIFT_FAILURE_RATE_URGENT'],
      }),
    ]);
  });

  it('raises critical drift for explicit unsafe evidence regardless of sample size', () => {
    const analysis = new GatewayFeedbackAnalyzer().analyze([
      feedback('drift', ['artifact-1:1'], {
        severity: 'critical',
        kind: 'unsafe_allow',
      }),
    ]);
    expect(analysis.drift[0]).toMatchObject({
      severity: 'critical',
      reasonCodes: ['GATEWAY_DRIFT_CRITICAL_SAFETY'],
    });
  });

  it('preserves correction and recovery attribution', () => {
    const analysis = new GatewayFeedbackAnalyzer().analyze([
      feedback('correction', ['artifact-1:1'], { kind: 'user_patch' }),
      feedback('recovery', ['artifact-1:1'], { kind: 'resume' }),
    ]);
    expect(analysis.artifacts[0]).toMatchObject({ correctionCount: 1, recoveryCount: 1 });
  });

  it('rejects private reasoning payloads', () => {
    expect(() =>
      new GatewayFeedbackAnalyzer().analyze([
        feedback('performance', [], { chain_of_thought: 'must not persist' }),
      ]),
    ).toThrow(GatewayFeedbackAnalysisError);
  });

  it('enforces bounded analysis and valid thresholds', () => {
    expect(
      () => new GatewayFeedbackAnalyzer({ urgentFailureRate: 0.9, criticalFailureRate: 0.5 }),
    ).toThrow(/threshold/u);
    const repeated = Array.from({ length: 10_001 }, (_, index) =>
      feedback('performance', [], { index }),
    );
    expect(() => new GatewayFeedbackAnalyzer().analyze(repeated)).toThrow(/10,000/u);
  });
});

function feedback(
  feedbackType: GatewayFeedbackType,
  selectedArtifactRefs: readonly string[],
  payload: GatewayFeedbackEnvelope['payload'],
  refs: Readonly<{
    formalPlanRef?: string;
    formalOutcomeRef?: string;
  }> = {},
): GatewayFeedbackEnvelope {
  return {
    feedbackId: `feedback-${feedbackType}-${JSON.stringify(payload)}`,
    requestId: 'request-1',
    gatewayDecisionRef: 'gateway-decision-1',
    selectedArtifactRefs,
    ...refs,
    feedbackType,
    payload,
    sourceRefs: ['gateway-decision:gateway-decision-1'],
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}

function dimensions() {
  return {
    tenantId: 'tenant-1',
    taskTypeId: 'inspect',
    environmentClass: 'lab',
  } as const;
}
