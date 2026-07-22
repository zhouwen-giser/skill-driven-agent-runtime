import type {
  GenericTaskUnderstandingRevision,
  InteractiveGoalTurn,
  MissingDimension,
} from '../../../domain/src/index.js';

export interface MissingDimensionQuestion {
  readonly dimensionId: string;
  readonly kind: MissingDimension['kind'];
  readonly question: string;
  readonly severity: MissingDimension['severity'];
  readonly criterionId: string;
  readonly blockingReason: string;
  readonly understandingRevision: number;
}

export class MissingDimensionQuestionService {
  nextQuestion(
    understanding: GenericTaskUnderstandingRevision,
    turns: readonly InteractiveGoalTurn[],
  ): MissingDimensionQuestion | undefined {
    const answered = new Set(
      turns
        .filter((turn) => turn.action === 'answer')
        .flatMap((turn) =>
          turn.binding.dimensionId === undefined ? [] : [turn.binding.dimensionId],
        ),
    );
    const dimension = [...understanding.missingDimensions]
      .filter((candidate) => !candidate.answered && !answered.has(candidate.dimensionId))
      .sort(
        (left, right) =>
          score(right) - score(left) || left.dimensionId.localeCompare(right.dimensionId),
      )[0];
    if (dimension === undefined) return undefined;
    return Object.freeze({
      dimensionId: dimension.dimensionId,
      kind: dimension.kind,
      question: dimension.question,
      severity: dimension.severity,
      criterionId: criterionFor(dimension),
      blockingReason: dimension.authorizationSensitive
        ? 'authorization_required'
        : `missing_${dimension.kind}`,
      understandingRevision: understanding.revision,
    });
  }
}

function score(dimension: MissingDimension): number {
  const severity =
    dimension.severity === 'blocking' ? 300 : dimension.severity === 'conditional' ? 200 : 100;
  const kind = dimension.authorizationSensitive
    ? 90
    : dimension.kind === 'target'
      ? 80
      : dimension.kind === 'criteria'
        ? 70
        : dimension.kind === 'scope'
          ? 60
          : 10;
  return severity + kind;
}

function criterionFor(dimension: MissingDimension): string {
  if (dimension.kind === 'criteria') return 'goal.success_criteria';
  if (dimension.kind === 'side_effect_authorization') return 'goal.authorization';
  return `goal.${dimension.kind}`;
}
