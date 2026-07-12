import type { SkillStatus } from './skill.js';

export interface SkillQualityObservation {
  readonly observationId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly evaluationRef: string;
  readonly score: number;
  readonly successful: boolean;
  readonly createdAt: string;
}

export type SkillQualityWarningKind = 'consecutive_low_score' | 'failure_rate_increase';

export interface SkillQualityWarning {
  readonly warningId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly kind: SkillQualityWarningKind;
  readonly observationIds: readonly string[];
  readonly observedValue: number;
  readonly threshold: number;
  readonly summary: string;
  readonly status: 'active';
  readonly skillStatusAtCreation: SkillStatus;
  readonly createdAt: string;
}
