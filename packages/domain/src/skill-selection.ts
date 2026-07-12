export interface SkillPerformanceMetrics {
  readonly sampleCount: number;
  readonly successRate: number;
  readonly averageDurationMs: number;
  readonly averageCost: number;
  readonly failureCount: number;
  readonly stabilityScore: number;
}

export interface SkillCandidateSnapshot {
  readonly skillId: string;
  readonly skillVersion: number;
  readonly name: string;
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly autoConfirmPlan: boolean;
  readonly createdAt: string;
  readonly semanticScore: number;
  readonly metrics: SkillPerformanceMetrics;
}

export interface SkillSelectionRecord {
  readonly selectionId: string;
  readonly goalDescription: string;
  readonly candidates: readonly SkillCandidateSnapshot[];
  readonly selectedSkillId: string;
  readonly selectedSkillVersion: number;
  readonly decisionSummary: string;
  readonly createdAt: string;
}

export interface SkillReplacementPlan {
  readonly replacementPlanId: string;
  readonly selectionId: string;
  readonly failedSkillId: string;
  readonly candidates: readonly SkillCandidateSnapshot[];
  readonly replacementSkillId: string;
  readonly replacementSkillVersion: number;
  readonly decisionSummary: string;
  readonly status: 'awaiting_confirmation';
  readonly createdAt: string;
}
