import { describe, expect, it } from 'vitest';

import { requireHomeLabReadOnlyTerminalPreparation } from '../src/runtime.js';

describe('home-lab Runtime profile terminal preparation', () => {
  it('keeps ordinary and Temporary Skill terminal preparation unchanged while the profile is off', () => {
    expect(
      requireHomeLabReadOnlyTerminalPreparation(
        undefined,
        { temporarySkillId: 'temporary-skill-1' },
        {
          status: 'failed',
          errors: { execution: { code: 'FAILED', message: 'Ordinary failure.' } },
        },
      ),
    ).toBeUndefined();
  });

  it('rejects Temporary Skills before any home-lab terminal processing', () => {
    expect(() =>
      requireHomeLabReadOnlyTerminalPreparation(
        'home_lab_read_only',
        { temporarySkillId: 'temporary-skill-1' },
        { status: 'succeeded', errors: {} },
      ),
    ).toThrow('HOME_LAB_READ_ONLY_TEMPORARY_SKILL_FORBIDDEN');
  });

  it('requires a succeeded, error-free Workflow instance for the exact profile', () => {
    expect(() =>
      requireHomeLabReadOnlyTerminalPreparation(
        'home_lab_read_only',
        {},
        { status: 'failed', errors: {} },
      ),
    ).toThrow('HOME_LAB_READ_ONLY_TERMINAL_INSTANCE_NOT_SUCCEEDED');
    expect(() =>
      requireHomeLabReadOnlyTerminalPreparation(
        'home_lab_read_only',
        {},
        {
          status: 'succeeded',
          errors: { execution: { code: 'PROVIDER_ERROR', message: 'Provider failed.' } },
        },
      ),
    ).toThrow('HOME_LAB_READ_ONLY_TERMINAL_INSTANCE_ERRORS_PRESENT');
    expect(
      requireHomeLabReadOnlyTerminalPreparation(
        'home_lab_read_only',
        {},
        { status: 'succeeded', errors: {} },
      ),
    ).toEqual([]);
  });
});
