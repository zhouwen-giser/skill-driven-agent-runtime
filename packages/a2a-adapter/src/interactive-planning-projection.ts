import type {
  InteractiveGoalSessionView,
  InteractivePlanningSessionView,
} from '../../application/src/index.js';

type A2AInteractiveSessionView = InteractiveGoalSessionView | InteractivePlanningSessionView;

/**
 * Public A2A interaction metadata. Candidate, Provider and outcome evidence remain
 * internal and are intentionally excluded from this routing-only projection.
 */
export class A2AInteractionProjection {
  toInputRequired(view: A2AInteractiveSessionView): Readonly<Record<string, unknown>> {
    if (view.session.state === 'understand' || view.session.state === 'goal_review') {
      const questionId =
        isGoalSessionView(view) && view.question !== undefined
          ? view.question.dimensionId
          : undefined;
      return {
        kind: 'interactive_goal',
        sessionId: view.session.sessionId,
        interactionType:
          view.session.state === 'understand' ? 'goal_clarification' : 'goal_confirmation',
        state: view.session.state,
        expectedVersion: view.session.version,
        ...(questionId === undefined ? {} : { questionId }),
        allowedActions:
          view.session.state === 'understand'
            ? ['answer', 'restart_understanding', 'cancel']
            : ['accept', 'patch', 'reject', 'restart_understanding', 'cancel'],
      };
    }
    return {
      kind: 'interactive_planning',
      sessionId: view.session.sessionId,
      interactionType: 'plan_confirmation',
      state: view.session.state,
      expectedVersion: view.session.version,
      allowedActions:
        view.session.state === 'plan_review' ? ['accept', 'patch', 'reject', 'cancel'] : [],
    };
  }
}

function isGoalSessionView(view: A2AInteractiveSessionView): view is InteractiveGoalSessionView {
  return 'question' in view;
}

/** Compatibility function retained for the existing composition root. */
export function projectInteractivePlanningInteraction(
  view: InteractivePlanningSessionView,
): Readonly<Record<string, unknown>> {
  return new A2AInteractionProjection().toInputRequired(view);
}
