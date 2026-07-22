import {
  createOutcomeDecision,
  type OutcomeConfidence,
  type OutcomeDecision,
  type SkillGoal,
  type TaskGoalCompletionContract,
  type UserGoalCompletionContract,
  type WorkflowExecutionOutcome,
} from '../../domain/src/index.js';

export interface OutcomeJudgeIds {
  next(level: OutcomeDecision['level'], subjectId: string): string;
}

export class TaskGoalJudge {
  readonly #ids: OutcomeJudgeIds;
  readonly #now: () => string;

  constructor(dependencies: Readonly<{ ids: OutcomeJudgeIds; now: () => string }>) {
    this.#ids = dependencies.ids;
    this.#now = dependencies.now;
  }

  judge(contract: TaskGoalCompletionContract, outcome: WorkflowExecutionOutcome): OutcomeDecision {
    const complete = requirementsSatisfied(contract, outcome);
    const status = complete && outcome.confidence !== 'low' ? 'achieved' : 'unknown';
    return createOutcomeDecision({
      outcomeDecisionId: this.#ids.next('task_goal', contract.taskGoalContractId),
      level: 'task_goal',
      subjectId: contract.taskGoalContractId,
      status,
      confidence: outcome.confidence,
      ruleIds: [
        'task_goal.provider_terminal_is_not_goal_authority',
        'task_goal.required_effect_evidence_artifact_coverage',
        'task_goal.low_confidence_fail_closed',
      ],
      criterionRefs: [],
      effectRefs: outcome.effectRefs,
      evidenceRefs: outcome.evidenceRefs,
      artifactRefs: outcome.artifactRefs,
      summary:
        status === 'achieved'
          ? 'Task Goal requirements are satisfied by explicit outcome evidence.'
          : 'Task terminal status is insufficient to establish the Task Goal.',
      createdAt: this.#now(),
    });
  }
}

export class SkillGoalJudge {
  readonly #ids: OutcomeJudgeIds;
  readonly #now: () => string;

  constructor(dependencies: Readonly<{ ids: OutcomeJudgeIds; now: () => string }>) {
    this.#ids = dependencies.ids;
    this.#now = dependencies.now;
  }

  judge(
    skillGoal: SkillGoal,
    taskDecisions: readonly OutcomeDecision[],
    workflow: WorkflowExecutionOutcome,
  ): OutcomeDecision {
    const achievedTasks = taskDecisions.filter(
      (decision) => decision.level === 'task_goal' && decision.status === 'achieved',
    );
    const effects = union(
      workflow.effectRefs,
      achievedTasks.flatMap((item) => item.effectRefs),
    );
    const evidence = union(
      workflow.evidenceRefs,
      achievedTasks.flatMap((item) => item.evidenceRefs),
    );
    const artifacts = union(
      workflow.artifactRefs,
      achievedTasks.flatMap((item) => item.artifactRefs),
    );
    const confidence = minimumConfidence([
      workflow.confidence,
      ...achievedTasks.map((item) => item.confidence),
    ]);
    const complete =
      includesAll(effects, skillGoal.requiredEffectRefs) &&
      includesAll(evidence, skillGoal.evidenceRequirements) &&
      includesAll(artifacts, skillGoal.artifactRequirements);
    const status = complete && confidence !== 'low' ? 'achieved' : 'unknown';
    return createOutcomeDecision({
      outcomeDecisionId: this.#ids.next('skill_goal', skillGoal.skillGoalId),
      level: 'skill_goal',
      subjectId: skillGoal.skillGoalId,
      status,
      confidence,
      ruleIds: [
        'skill_goal.workflow_completed_is_not_goal_authority',
        'skill_goal.attempt_outcome_coverage',
        'skill_goal.low_confidence_fail_closed',
      ],
      criterionRefs: status === 'achieved' ? skillGoal.coveredCriterionIds : [],
      effectRefs: effects,
      evidenceRefs: evidence,
      artifactRefs: artifacts,
      summary:
        status === 'achieved'
          ? 'Skill Goal requirements are satisfied across its Attempt outcomes.'
          : 'Workflow completion is insufficient to establish the Skill Goal.',
      createdAt: this.#now(),
    });
  }
}

export class UserGoalJudge {
  readonly #ids: OutcomeJudgeIds;
  readonly #now: () => string;

  constructor(dependencies: Readonly<{ ids: OutcomeJudgeIds; now: () => string }>) {
    this.#ids = dependencies.ids;
    this.#now = dependencies.now;
  }

  judge(
    contract: UserGoalCompletionContract,
    skillDecisions: readonly OutcomeDecision[],
  ): OutcomeDecision {
    const achieved = skillDecisions.filter(
      (decision) => decision.level === 'skill_goal' && decision.status === 'achieved',
    );
    const criteria = union(
      [],
      achieved.flatMap((item) => item.criterionRefs),
    );
    const required = contract.criteria
      .filter((criterion) => criterion.required)
      .map((criterion) => criterion.criterionId);
    const confidence = minimumConfidence(achieved.map((item) => item.confidence));
    const complete = achieved.length > 0 && includesAll(criteria, required);
    const status = complete && confidence !== 'low' ? 'achieved' : 'unknown';
    return createOutcomeDecision({
      outcomeDecisionId: this.#ids.next('user_goal', contract.goalId),
      level: 'user_goal',
      subjectId: contract.goalId,
      status,
      confidence,
      ruleIds: [
        'user_goal.skill_goal_achieved_is_not_terminal_authority',
        'user_goal.required_criterion_coverage',
        'user_goal.low_confidence_fail_closed',
      ],
      criterionRefs: criteria,
      effectRefs: union(
        [],
        achieved.flatMap((item) => item.effectRefs),
      ),
      evidenceRefs: union(
        [],
        achieved.flatMap((item) => item.evidenceRefs),
      ),
      artifactRefs: union(
        [],
        achieved.flatMap((item) => item.artifactRefs),
      ),
      summary:
        status === 'achieved'
          ? 'Every required User Goal criterion is covered by achieved Skill Goals.'
          : 'The User Goal remains working because required criterion coverage is incomplete.',
      createdAt: this.#now(),
    });
  }
}

function requirementsSatisfied(
  contract: TaskGoalCompletionContract,
  outcome: WorkflowExecutionOutcome,
): boolean {
  return (
    includesAll(outcome.effectRefs, contract.requiredEffectRefs) &&
    includesAll(outcome.evidenceRefs, contract.evidenceRequirements) &&
    includesAll(outcome.artifactRefs, contract.artifactRequirements)
  );
}

function includesAll(values: readonly string[], required: readonly string[]): boolean {
  const available = new Set(values);
  return required.every((value) => available.has(value));
}

function union(first: readonly string[], second: readonly string[]): readonly string[] {
  return [...new Set([...first, ...second])].sort();
}

function minimumConfidence(values: readonly OutcomeConfidence[]): OutcomeConfidence {
  if (values.length === 0 || values.includes('low')) return 'low';
  return values.includes('medium') ? 'medium' : 'high';
}
