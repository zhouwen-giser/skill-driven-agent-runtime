export type ExperienceEligibilityResult =
  | Readonly<{ eligible: true; reasonCodes: readonly string[] }>
  | Readonly<{ eligible: false; reasonCodes: readonly string[] }>;

export class ExperienceEligibilityPolicy {
  evaluate(facts: Readonly<Record<string, unknown>>): ExperienceEligibilityResult {
    const reasonCodes: string[] = [];
    if (!isRecord(facts['contract'])) reasonCodes.push('missing_goal_contract');
    if (!isRecord(facts['currentPlan'])) reasonCodes.push('missing_current_plan');
    if (!isRecord(facts['userGoalJudgment'])) reasonCodes.push('missing_user_goal_judgment');
    const terminal = facts['terminalOutcome'];
    if (!isRecord(terminal)) reasonCodes.push('missing_terminal_outcome');
    else if (terminal['authority'] !== 'user_goal_plan_controller') {
      reasonCodes.push('invalid_terminal_authority');
    }
    return reasonCodes.length === 0
      ? Object.freeze({ eligible: true as const, reasonCodes: Object.freeze([]) })
      : Object.freeze({ eligible: false as const, reasonCodes: Object.freeze(reasonCodes) });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
