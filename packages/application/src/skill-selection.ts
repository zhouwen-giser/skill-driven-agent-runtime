import {
  goalExecutionContractsEqual,
  createSkillUsageSummary,
  snapshotGoalExecutionContract,
  type GoalExecutionContract,
  type SkillCandidateSnapshot,
  type SkillPerformanceMetrics,
  type SkillReplacementPlan,
  type SkillSelectionRecord,
  type SkillUsageSelectionContext,
  type SkillVersion,
} from '../../domain/src/index.js';

import type {
  Clock,
  McpRegistryRepository,
  SkillGraphRepository,
  SkillRepository,
  SkillSelectionDecider,
  SkillSelectionRepository,
  SkillSemanticRetriever,
} from './ports.js';
import type { SkillUsageCandidateAssessor } from './skill-usage-selection.js';

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
  readonly #mcpWarnings: Pick<McpRegistryRepository, 'listDependencyWarnings'> | undefined;
  readonly #usage: SkillUsageCandidateAssessor | undefined;
  readonly #ids: Readonly<{ nextSelectionId(): string; nextReplacementPlanId(): string }>;

  constructor(
    dependencies: Readonly<{
      skills: SkillRepository;
      graph: SkillGraphRepository;
      records: SkillSelectionRepository;
      retriever: SkillSemanticRetriever;
      decider: SkillSelectionDecider;
      mcpWarnings?: Pick<McpRegistryRepository, 'listDependencyWarnings'>;
      usage?: SkillUsageCandidateAssessor;
      clock: Clock;
      ids: Readonly<{ nextSelectionId(): string; nextReplacementPlanId(): string }>;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#graph = dependencies.graph;
    this.#records = dependencies.records;
    this.#retriever = dependencies.retriever;
    this.#decider = dependencies.decider;
    this.#mcpWarnings = dependencies.mcpWarnings;
    this.#usage = dependencies.usage;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async select(
    goalContract: GoalExecutionContract,
    usageContext?: SkillUsageSelectionContext,
  ): Promise<SkillSelectionRecord> {
    const goal = requireGoalContract(goalContract);
    const enabled = await this.#skills.listEnabledVersions();
    return this.selectFromCandidates(goal, enabled, usageContext);
  }

  /**
   * Selects only from candidates already admitted by the owning execution policy.
   * Skill Goal compatibility belongs to the scheduler and must run before semantic/LLM selection.
   */
  async selectFromCandidates(
    goalContract: GoalExecutionContract,
    admittedSkills: readonly SkillVersion[],
    usageContext?: SkillUsageSelectionContext,
  ): Promise<SkillSelectionRecord> {
    const goal = requireGoalContract(goalContract);
    const enabled = admittedSkills.filter((skill) => skill.status === 'enabled');
    if (enabled.length === 0) {
      throw new SkillSelectionError(
        'SKILL_SELECTION_NO_CANDIDATES',
        'No admitted enabled Skill candidates exist.',
      );
    }
    const candidates = await this.#candidateSnapshots(goal, enabled, usageContext);
    if (candidates.length === 0)
      throw new SkillSelectionError(
        'SKILL_SELECTION_NO_CANDIDATES',
        'No applicable Skill candidates exist.',
      );
    const decision = await this.#decider.decide({
      goalContract: goal,
      candidates,
      mode: 'initial',
    });
    const selected = requireSelectedCandidate(candidates, decision.selectedSkillId);
    const record: SkillSelectionRecord = {
      selectionId: this.#ids.nextSelectionId(),
      goalContract: goal,
      goalDescription: goal.description,
      candidates,
      selectedSkillId: selected.skillId,
      selectedSkillVersion: selected.skillVersion,
      decisionSummary: requireDecisionSummary(decision.decisionSummary),
      createdAt: this.#clock.now(),
    };
    await this.#records.saveSelection(record);
    return record;
  }

  async planReplacement(
    selectionId: string,
    failedSkillId: string,
    goalContract: GoalExecutionContract,
    usageContext?: SkillUsageSelectionContext,
  ): Promise<SkillReplacementPlan> {
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
    const currentGoal = requireGoalContract(goalContract);
    if (!goalExecutionContractsEqual(selection.goalContract, currentGoal)) {
      throw new SkillSelectionError(
        'SKILL_SELECTION_GOAL_CONTRACT_STALE',
        'Replacement cannot reuse a selection from a different Goal contract version.',
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
    const candidates = await this.#candidateSnapshots(currentGoal, alternatives, usageContext);
    if (candidates.length === 0)
      throw new SkillSelectionError(
        'SKILL_SELECTION_NO_ALTERNATIVE',
        'No applicable alternative Skill exists.',
      );
    const decision = await this.#decider.decide({
      goalContract: currentGoal,
      candidates,
      mode: 'replacement',
      failedSkillId,
    });
    const selected = requireSelectedCandidate(candidates, decision.selectedSkillId);
    const plan: SkillReplacementPlan = {
      replacementPlanId: this.#ids.nextReplacementPlanId(),
      selectionId,
      goalContract: currentGoal,
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
    goalContract: GoalExecutionContract,
    skills: readonly SkillVersion[],
    usageContext?: SkillUsageSelectionContext,
  ): Promise<readonly SkillCandidateSnapshot[]> {
    if (this.#usage !== undefined && usageContext === undefined)
      throw new SkillSelectionError(
        'SKILL_SELECTION_USAGE_CONTEXT_REQUIRED',
        'Usage-aware Skill selection requires structured context and policy evidence.',
      );
    const selectableSkills = skills.filter(
      (skill) => createSkillUsageSummary(skill).visibility.userSelectable,
    );
    const scores = await this.#retriever.score(goalContract, selectableSkills);
    const candidates = await Promise.all(
      selectableSkills.map(async (skill) => {
        const serverIds = new Set(
          [...skill.toolPolicy.required, ...skill.toolPolicy.optional].map(
            (reference) => reference.serverId,
          ),
        );
        const warnings = (
          await Promise.all(
            [...serverIds].map(
              (serverId) =>
                this.#mcpWarnings?.listDependencyWarnings(serverId) ?? Promise.resolve([]),
            ),
          )
        )
          .flat()
          .filter(
            (warning) =>
              warning.skillId === skill.skillId &&
              warning.skillVersion === skill.version &&
              warning.acknowledgedAt === undefined,
          )
          .map((warning) => ({
            warningId: warning.warningId,
            serverId: warning.serverId,
            toolName: warning.toolName,
            reason: warning.reason,
            toolRevision: warning.toolRevision,
            createdAt: warning.createdAt,
          }));
        const usageCandidate =
          this.#usage === undefined || usageContext === undefined
            ? undefined
            : await this.#usage.assess(skill, usageContext);
        return {
          skillId: skill.skillId,
          skillVersion: skill.version,
          name: skill.name,
          summary: skill.summary,
          capabilities: skill.capabilities,
          inputSchemaSummary: summarizeSchema(skill.inputSchema),
          outputSchemaSummary: summarizeSchema(skill.outputSchema),
          toolPolicy: skill.toolPolicy,
          workflowGuidanceSummary: summarizeGuidance(skill.workflowGuidance),
          runtimePolicy: skill.runtimePolicy,
          usageSummary: createSkillUsageSummary(skill),
          ...(usageCandidate === undefined ? {} : { usageCandidate }),
          activeMcpDependencyWarnings: warnings,
          autoConfirmPlan: skill.runtimePolicy.autoConfirmPlan,
          createdAt: skill.createdAt,
          semanticScore: normalizedScore(scores[skill.skillId] ?? 0),
          metrics: validateMetrics(
            (await this.#records.findMetrics(skill.skillId)) ?? EMPTY_METRICS,
          ),
        };
      }),
    );
    return candidates.filter(
      (candidate) =>
        candidate.usageCandidate === undefined ||
        (candidate.usageCandidate.modeDecision.decision === 'selected' &&
          (candidate.usageCandidate.applicability.status === 'satisfied' ||
            candidate.usageCandidate.applicability.status === 'partial')),
    );
  }
}

function requireGoalContract(contract: GoalExecutionContract): GoalExecutionContract {
  if (
    contract.goalId.trim() === '' ||
    !Number.isSafeInteger(contract.version) ||
    contract.version < 1 ||
    contract.title.trim() === '' ||
    contract.description.trim() === ''
  )
    throw new SkillSelectionError(
      'SKILL_SELECTION_GOAL_REQUIRED',
      'A complete identified Goal execution contract is required.',
    );
  return snapshotGoalExecutionContract(contract);
}

function summarizeSchema(schema: unknown): SkillCandidateSnapshot['inputSchemaSummary'] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    return {
      type: 'unspecified',
      requiredFields: [],
      propertyNames: [],
      allowsAdditionalProperties: 'unspecified',
    };
  const record = schema as Readonly<Record<string, unknown>>;
  const properties =
    typeof record['properties'] === 'object' &&
    record['properties'] !== null &&
    !Array.isArray(record['properties'])
      ? Object.keys(record['properties']).sort()
      : [];
  const required = Array.isArray(record['required'])
    ? record['required'].filter((value): value is string => typeof value === 'string').sort()
    : [];
  return {
    type: typeof record['type'] === 'string' ? record['type'] : 'unspecified',
    requiredFields: required,
    propertyNames: properties,
    allowsAdditionalProperties:
      typeof record['additionalProperties'] === 'boolean'
        ? record['additionalProperties']
        : 'unspecified',
  };
}

function summarizeGuidance(value: string): string {
  const guidance = value.trim();
  return guidance.length <= 2_000 ? guidance : `${guidance.slice(0, 1_999)}…`;
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
  | 'SKILL_SELECTION_GOAL_CONTRACT_STALE'
  | 'SKILL_SELECTION_NO_ALTERNATIVE'
  | 'SKILL_SELECTION_NO_CANDIDATES'
  | 'SKILL_SELECTION_USAGE_CONTEXT_REQUIRED';

export class SkillSelectionError extends Error {
  readonly code: SkillSelectionErrorCode;
  constructor(code: SkillSelectionErrorCode, message: string) {
    super(message);
    this.name = 'SkillSelectionError';
    this.code = code;
  }
}
