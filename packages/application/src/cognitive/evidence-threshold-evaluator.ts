import {
  createPromotionEvidenceSummary,
  type PromotionDecision,
  type PromotionEvidenceSummary,
  type PromotionGateResult,
  type PromotionReplayReport,
  type PromotionShadowReport,
} from '../../../domain/src/index.js';
import type { PromotionCandidateRecord } from './promotion-ports.js';

export class EvidenceThresholdEvaluator {
  evaluate(
    input: Readonly<{
      candidate: PromotionCandidateRecord;
      evidence: PromotionEvidenceSummary;
      replay?: PromotionReplayReport;
      shadow?: PromotionShadowReport;
      humanApproved: boolean;
      policyAllowed: boolean;
    }>,
  ): PromotionDecision {
    const evidence = createPromotionEvidenceSummary({
      ...input.evidence,
      replayPassedCount: input.replay?.passedCount ?? input.evidence.replayPassedCount,
      replayFailedCount: input.replay?.failedCount ?? input.evidence.replayFailedCount,
      shadowImprovedCount: input.shadow?.improvedCount ?? input.evidence.shadowImprovedCount,
      shadowRegressedCount: input.shadow?.regressedCount ?? input.evidence.shadowRegressedCount,
    });
    const thresholds = policyFor(input.candidate.kind);
    const ratio = contradictionRatio(evidence);
    const gates: PromotionGateResult[] = [
      gate('unique_goals', evidence.uniqueGoalCount, thresholds.uniqueGoals),
      gate('successful_outcomes', evidence.successfulOutcomeCount, thresholds.successfulOutcomes),
      maximum('contradiction_ratio', ratio, thresholds.maximumContradictionRatio),
      gate('replay_passed', evidence.replayPassedCount, 1),
      maximum('replay_failed', evidence.replayFailedCount, 0),
      booleanGate('human_approval', input.humanApproved, true),
    ];
    if (thresholds.uniqueUsers > 0) {
      gates.push(gate('unique_users', evidence.uniqueUserCount, thresholds.uniqueUsers));
    }
    if (thresholds.shadowRequired || input.candidate.risk === 'high') {
      gates.push(booleanGate('shadow_required', input.shadow !== undefined, true));
      gates.push(gate('shadow_improved', evidence.shadowImprovedCount, 1));
      gates.push(maximum('shadow_regressed', evidence.shadowRegressedCount, 0));
    }
    if (input.candidate.kind === 'planning_heuristic') {
      gates.push(booleanGate('risk_not_high', input.candidate.risk !== 'high', true));
    }
    if (input.candidate.risk === 'high') {
      gates.push(booleanGate('policy_allow', input.policyAllowed, true));
    }
    return Object.freeze({
      passed: gates.every((item) => item.passed),
      gates: Object.freeze(gates),
      evidence,
    });
  }
}

function policyFor(kind: PromotionCandidateRecord['kind']) {
  if (kind === 'planning_heuristic') {
    return {
      uniqueGoals: 3,
      uniqueUsers: 0,
      successfulOutcomes: 2,
      maximumContradictionRatio: 0.25,
      shadowRequired: false,
    };
  }
  if (kind === 'task_type') {
    return {
      uniqueGoals: 5,
      uniqueUsers: 3,
      successfulOutcomes: 1,
      maximumContradictionRatio: 0.25,
      shadowRequired: true,
    };
  }
  return {
    uniqueGoals: 5,
    uniqueUsers: 0,
    successfulOutcomes: 1,
    maximumContradictionRatio: 0.25,
    shadowRequired: false,
  };
}

function contradictionRatio(evidence: PromotionEvidenceSummary): number {
  const support = evidence.supportingRefs.length;
  const contradiction = evidence.contradictingRefs.length;
  const total = support + contradiction;
  return total === 0 ? 0 : Number((contradiction / total).toFixed(6));
}

function gate(code: string, actual: number, required: number): PromotionGateResult {
  return Object.freeze({ code, passed: actual >= required, actual, required });
}

function maximum(code: string, actual: number, required: number): PromotionGateResult {
  return Object.freeze({ code, passed: actual <= required, actual, required });
}

function booleanGate(code: string, actual: boolean, required: boolean): PromotionGateResult {
  return Object.freeze({ code, passed: actual === required, actual, required });
}
