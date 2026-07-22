import { describe, expect, it } from 'vitest';

import { matchSkillEvidence } from '../src/index.js';

describe('Skill evidence matcher', () => {
  it('matches objective Provider evidence by type and emits local validated evidence', () => {
    const matched = matchSkillEvidence({
      requirements: [
        {
          requirementId: 'final-position',
          evidenceType: 'position.observation',
          required: true,
          hardGate: true,
        },
        {
          requirementId: 'optional-photo',
          evidenceType: 'image.capture',
          required: false,
          hardGate: false,
        },
      ],
      runtimeRevision: '7',
      result: {
        content: [],
        structuredContent: { final: { x: 3 } },
        isError: false,
        evidence: [
          {
            evidenceId: 'provider-position',
            evidenceType: 'position.observation',
            observedAt: '2026-07-19T02:00:00.000Z',
            payloadRef: { kind: 'structured_content', jsonPointer: '/final' },
          },
        ],
      },
    });

    expect(matched.validatedEvidence).toEqual({ 'final-position': true, 'optional-photo': false });
    expect(matched.result.validatedEvidence).toEqual(matched.validatedEvidence);
    expect(matched.matches[0]).toMatchObject({
      requirementId: 'final-position',
      evidenceId: 'provider-position',
      resolvedValue: { x: 3 },
      runtimeRevision: '7',
    });
  });

  it('requires a SHA-256 digest for hard-gate URI evidence but not optional URI evidence', () => {
    const evidence = [
      {
        evidenceId: 'provider-photo',
        evidenceType: 'image.capture',
        observedAt: '2026-07-19T02:00:00.000Z',
        payloadRef: { kind: 'uri' as const, uri: 'https://provider.test/photo' },
      },
    ];
    const result = { content: [], isError: false, evidence };
    expect(
      matchSkillEvidence({
        requirements: [
          {
            requirementId: 'hard-photo',
            evidenceType: 'image.capture',
            required: true,
            hardGate: true,
          },
        ],
        result,
      }).validatedEvidence,
    ).toEqual({ 'hard-photo': false });
    expect(
      matchSkillEvidence({
        requirements: [
          {
            requirementId: 'optional-photo',
            evidenceType: 'image.capture',
            required: false,
            hardGate: false,
          },
        ],
        result,
      }).validatedEvidence,
    ).toEqual({ 'optional-photo': true });
  });
});
