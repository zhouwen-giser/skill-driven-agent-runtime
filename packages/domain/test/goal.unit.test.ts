import { describe, expect, it } from 'vitest';

import { snapshotGoalExecutionContract } from '../src/index.js';

describe('Goal execution contract snapshots', () => {
  it('copies and freezes list fields at the decision boundary', () => {
    const constraints = ['read-only'];
    const successCriteria = ['status returned'];
    const snapshot = snapshotGoalExecutionContract({
      goalId: 'goal-1',
      version: 1,
      title: 'Inspect',
      description: 'Inspect the device.',
      constraints,
      successCriteria,
    });

    constraints.push('caller mutation');
    successCriteria.push('caller mutation');

    expect(snapshot.constraints).toEqual(['read-only']);
    expect(snapshot.successCriteria).toEqual(['status returned']);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.constraints)).toBe(true);
    expect(Object.isFrozen(snapshot.successCriteria)).toBe(true);
  });
});
