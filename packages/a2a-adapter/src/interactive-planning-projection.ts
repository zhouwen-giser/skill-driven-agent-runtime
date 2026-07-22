import type { InteractivePlanningSessionView } from '../../application/src/index.js';

/** Public A2A metadata projection; it exposes candidate evidence but no execution authority. */
export function projectInteractivePlanningInteraction(
  view: InteractivePlanningSessionView,
): Readonly<Record<string, unknown>> {
  return {
    kind: 'interactive_planning',
    sessionId: view.session.sessionId,
    state: view.session.state,
    version: view.session.version,
    currentCandidateId: view.session.currentCandidateId,
    currentCandidateRevision: view.session.currentCandidateRevision,
    allowedActions:
      view.session.state === 'plan_review' ? ['accept', 'patch', 'reject', 'cancel'] : [],
    candidate: view.candidate,
  };
}
