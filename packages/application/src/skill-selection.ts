import type {
  SkillCandidateSnapshot,
  SkillPerformanceMetrics,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillVersion,
} from '../../domain/src/index.js';

import type {
  Clock,
  SkillGraphRepository,
  SkillRepository,
  SkillSelectionDecider,
  SkillSelectionRepository,
  SkillSemanticRetriever,
} from './ports.js';

const EMPTY_METRICS: SkillPerformanceMetrics = {
  sampleCount: 0,
  successRate: 0,
  averageDurationMs: 0,
  averageCost: 0,
  failureCount: 0,
  stabilityScore: 0,
};

export class SkillSelectionService {
  readonly #skills: SkillRepository;
  readonly #graph: SkillGraphRepository;
  readonly #records: SkillSelectionRepository;
  readonly #retriever: SkillSemanticRetriever;
  readonly #decider: SkillSelectionDecider;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextSelectionId(): string; nextReplacementPlanId(): string }>;

  constructor(
    dependencies: Readonly<{
      skills: SkillRepository;
      graph: SkillGraphRepository;
      records: SkillSelectionRepository;
      retriever: SkillSemanticRetriever;
      decider: SkillSelectionDecider;
      clock: Clock;
      ids: Readonly<{ nextSelectionId(): string; nextReplacementPlanId(): string }>;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#graph = dependencies.graph;
    this.#records = dependencies.records;
    this.#retriever = dependencies.retriever;
    this.#decider = dependencies.decider;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async select(goalDescription: string): Promise<SkillSelectionRecord> {
    const goal = requireGoal(goalDescription);
    const enabled = await this.#skills.listEnabledVersions();
    if (enabled.length === 0) {
      throw new SkillSelectionError(
        'SKILL_SELECTION_NO_CANDIDATES',
        'No enabled Skill candidates exist.',
      );
    }
    const candidates = await this.#candidateSnapshots(goal, enabled);
    const decision = await this.#decider.decide({
      goalDescription: goal,
      candidates,
      mode: 'initial',
    });
    const selected = requireSelectedCandidate(candidates, decision.selectedSkillId);
    const record: SkillSelectionRecord = {
      selectionId: this.#ids.nextSelectionId(),
      goalDescription: goal,
      candidates,
      selectedSkillId: selected.skillId,
      selectedSkillVersion: selected.skillVersion,
      decisionSummary: requireDecisionSummary(decision.decisionSummary),
      createdAt: this.#clock.now(),
    };
    await this.#records.saveSelection(record);
    return record;
  }

  async planReplacement(selectionId: string, failedSkillId: string): Promise<SkillReplacementPlan> {
    const selection = await this.#records.findSelection(selectionId);
    if (selection === undefined) {
      throw new SkillSelectionError('SKILL_SELECTION_NOT_FOUND', 'Skill selection was not found.');
    }
    if (selection.selectedSkillId !== failedSkillId) {
      throw new SkillSelectionError(
        'SKILL_SELECTION_FAILED_SKILL_MISMATCH',
        'Failed Skill does not match the selection.',
      );
    }
    const alternativeIds = new Set(
      (await this.#graph.listRelations())
        .filter(
          (relation) =>
            relation.relationType === 'alternative' && relation.sourceSkillId === failedSkillId,
        )
        .map((relation) => relation.targetSkillId),
    );
    const alternatives = (await this.#skills.listEnabledVersions()).filter((skill) =>
      alternativeIds.has(skill.skillId),
    );
    if (alternatives.length === 0) {
      throw new SkillSelectionError(
        'SKILL_SELECTION_NO_ALTERNATIVE',
        'No enabled alternative Skill exists.',
      );
    }
    const candidates = await this.#candidateSnapshots(selection.goalDescription, alternatives);
    const decision = await this.#decider.decide({
      goalDescription: selection.goalDescription,
      candidates,
      mode: 'replacement',
      failedSkillId,
    });
    const selected = requireSelectedCandidate(candidates, decision.selectedSkillId);
    const plan: SkillReplacementPlan = {
      replacementPlanId: this.#ids.nextReplacementPlanId(),
      selectionId,
      failedSkillId,
      candidates,
      replacementSkillId: selected.skillId,
      replacementSkillVersion: selected.skillVersion,
      decisionSummary: requireDecisionSummary(decision.decisionSummary),
      status: 'awaiting_confirmation',
      createdAt: this.#clock.now(),
    };
    await this.#records.saveReplacementPlan(plan);
    return plan;
  }

  async #candidateSnapshots(
    goalDescription: string,
    skills: readonly SkillVersion[],
  ): Promise<readonly SkillCandidateSnapshot[]> {
    const scores = await this.#retriever.score(goalDescription, skills);
    return Promise.all(
      skills.map(async (skill) => ({
        skillId: skill.skillId,
        skillVersion: skill.version,
        name: skill.name,
        summary: skill.summary,
        capabilities: skill.capabilities,
        createdAt: skill.createdAt,
        semanticScore: normalizedScore(scores[skill.skillId] ?? 0),
        metrics: validateMetrics((await this.#records.findMetrics(skill.skillId)) ?? EMPTY_METRICS),
      })),
    );
  }
}

function requireGoal(value: string): string {
  const goal = value.trim();
  if (goal === '')
    throw new SkillSelectionError('SKILL_SELECTION_GOAL_REQUIRED', 'Goal description is required.');
  return goal;
}

function requireSelectedCandidate(
  candidates: readonly SkillCandidateSnapshot[],
  skillId: string,
): SkillCandidateSnapshot {
  const selected = candidates.find((candidate) => candidate.skillId === skillId);
  if (selected === undefined) {
    throw new SkillSelectionError(
      'SKILL_SELECTION_INVALID_DECISION',
      'Decider selected a non-candidate Skill.',
    );
  }
  return selected;
}

function requireDecisionSummary(value: string): string {
  const summary = value.trim();
  if (summary === '') {
    throw new SkillSelectionError(
      'SKILL_SELECTION_INVALID_DECISION',
      'Decision summary is required.',
    );
  }
  return summary;
}

function normalizedScore(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new SkillSelectionError(
      'SKILL_SELECTION_METRICS_INVALID',
      'Semantic score must be between 0 and 1.',
    );
  }
  return value;
}

function validateMetrics(metrics: SkillPerformanceMetrics): SkillPerformanceMetrics {
  const values = Object.values(metrics);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new SkillSelectionError(
      'SKILL_SELECTION_METRICS_INVALID',
      'Skill metrics must be finite and nonnegative.',
    );
  }
  if (metrics.successRate > 1 || metrics.stabilityScore > 1) {
    throw new SkillSelectionError(
      'SKILL_SELECTION_METRICS_INVALID',
      'Rate metrics must be between 0 and 1.',
    );
  }
  return metrics;
}

export type SkillSelectionErrorCode =
  | 'SKILL_SELECTION_FAILED_SKILL_MISMATCH'
  | 'SKILL_SELECTION_GOAL_REQUIRED'
  | 'SKILL_SELECTION_INVALID_DECISION'
  | 'SKILL_SELECTION_METRICS_INVALID'
  | 'SKILL_SELECTION_NOT_FOUND'
  | 'SKILL_SELECTION_NO_ALTERNATIVE'
  | 'SKILL_SELECTION_NO_CANDIDATES';

export class SkillSelectionError extends Error {
  readonly code: SkillSelectionErrorCode;
  constructor(code: SkillSelectionErrorCode, message: string) {
    super(message);
    this.name = 'SkillSelectionError';
    this.code = code;
  }
}
