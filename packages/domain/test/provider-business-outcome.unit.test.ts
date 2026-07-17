import { describe, expect, it } from 'vitest';

import {
  classifyProviderBusinessOutcome,
  createProviderBusinessNodeError,
  type InternalToolResult,
} from '../src/index.js';

describe('Provider business outcome classification', () => {
  it.each([
    ['start_window_missed', 'START_WINDOW_MISSED', true, 'MCP_TASK_START_WINDOW_MISSED', {}],
    ['deadline_reached', 'MAX_ELAPSED_TIME_REACHED', true, 'MCP_TASK_DEADLINE_REACHED', {}],
    [
      'partial_completion',
      'PROVIDER_PARTIAL_RESULT',
      false,
      'MCP_TASK_PARTIAL_COMPLETION',
      { partialResult: { completed: 2, requested: 3 }, alternatives: ['retry_remaining'] },
    ],
    [
      'business_failure',
      'BUSINESS_RULE_REJECTED',
      false,
      'MCP_TASK_BUSINESS_FAILURE',
      { alternatives: [{ action: 'revise_input' }] },
    ],
  ] as const)(
    'classifies declared %s evidence and creates a structured node error',
    (outcome, reasonCode, retryable, expectedCode, extras) => {
      const structuredContent = { outcome, reasonCode, retryable, ...extras };
      const classified = classifyProviderBusinessOutcome(errorResult(structuredContent));

      expect(classified).toMatchObject({
        outcome,
        reasonCode,
        retryable,
        classification: 'declared',
        ...extras,
        structuredEvidence: structuredContent,
      });
      expect(createProviderBusinessNodeError(classified)).toMatchObject({
        code: expectedCode,
        details: {
          category: 'provider_business',
          outcome,
          reasonCode,
          retryable,
          classification: 'declared',
          ...extras,
          structuredEvidence: structuredContent,
        },
      });
    },
  );

  it('maps an unknown bounded outcome to an explicit business_failure fallback', () => {
    const classified = classifyProviderBusinessOutcome(
      errorResult({
        outcome: 'provider_specific_rejection',
        reasonCode: 'RESOURCE_BUSY',
        retryable: true,
      }),
    );

    expect(classified).toMatchObject({
      outcome: 'business_failure',
      declaredOutcome: 'provider_specific_rejection',
      reasonCode: 'RESOURCE_BUSY',
      retryable: true,
      classification: 'fallback',
    });
    expect(createProviderBusinessNodeError(classified)).toMatchObject({
      code: 'MCP_TASK_BUSINESS_FAILURE',
      details: {
        outcome: 'business_failure',
        declaredOutcome: 'provider_specific_rejection',
        classification: 'fallback',
      },
    });
  });

  it('maps missing classification fields to a conservative business_failure fallback', () => {
    expect(classifyProviderBusinessOutcome(errorResult({ reason: 'rejected' }))).toMatchObject({
      outcome: 'business_failure',
      reasonCode: 'UNCLASSIFIED_PROVIDER_BUSINESS_FAILURE',
      retryable: false,
      classification: 'fallback',
      structuredEvidence: { reason: 'rejected' },
    });
  });

  it.each([
    { outcome: 'deadline_reached', retryable: true },
    { outcome: 'start_window_missed', reasonCode: 'START_WINDOW_MISSED', retryable: 'yes' },
    { outcome: 'deadline_reached', reasonCode: 'deadline reached', retryable: false },
    { outcome: 'partial_completion', reasonCode: 'PARTIAL_RESULT', retryable: false },
    { outcome: 'DeadlineReached', reasonCode: 'DEADLINE_REACHED', retryable: false },
  ])('rejects malformed declared timing or partial evidence: %j', (structuredContent) => {
    expect(() => classifyProviderBusinessOutcome(errorResult(structuredContent))).toThrow(
      expect.objectContaining({ code: 'PROVIDER_BUSINESS_OUTCOME_INVALID' }),
    );
  });

  it('rejects non-error Tool results instead of inventing a business failure', () => {
    expect(() => classifyProviderBusinessOutcome({ content: [], isError: false })).toThrow(
      expect.objectContaining({ code: 'PROVIDER_BUSINESS_OUTCOME_EXPECTED' }),
    );
  });

  it('rejects non-JSON and over-sized structured evidence', () => {
    expect(() =>
      classifyProviderBusinessOutcome(errorResult({ outcome: 'business_failure', value: NaN })),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_BUSINESS_OUTCOME_INVALID' }));
    expect(() =>
      classifyProviderBusinessOutcome(errorResult({ value: 'x'.repeat(65_536) })),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_BUSINESS_OUTCOME_JSON_TOO_LARGE' }));
  });
});

function errorResult(structuredContent: unknown): InternalToolResult {
  return { content: [], structuredContent, isError: true };
}
