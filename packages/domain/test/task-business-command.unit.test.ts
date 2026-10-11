import { describe, expect, it } from 'vitest';
import {
  parseTaskBusinessCommandRecord,
  taskBusinessIntentContentHash,
  taskBusinessMutationRequestSchema,
  assertTaskBusinessCommandScope,
} from '../src/task-business-command.js';
import { businessCommandFixture, businessControlScope } from './task-business-command-fixture.js';

describe('native immutable business command content', () => {
  it('binds full identity, original versions, payload and commandId while excluding leases', () => {
    const command = businessCommandFixture();
    const intent = command.intent;
    expect(parseTaskBusinessCommandRecord(command)).toEqual(command);
    expect(taskBusinessIntentContentHash({ ...intent, createdAt: '2026-10-11T00:00:00Z' })).toBe(
      intent.contentHash,
    );
    for (const changed of [
      { ...intent, goalVersion: 2 },
      { ...intent, identity: { ...intent.identity, executionId: 'other' } },
      { ...intent, request: { ...intent.request, commandId: 'other' } },
      { ...intent, authority: { ...intent.authority, skillVersion: 2 } },
    ])
      expect(taskBusinessIntentContentHash(changed)).not.toBe(intent.contentHash);
    expect(() =>
      parseTaskBusinessCommandRecord({ ...command, intent: { ...intent, goalVersion: 2 } }),
    ).toThrow(expect.objectContaining({ code: 'TASK_BUSINESS_COMMAND_HASH_CONFLICT' }));
  });
  it('rejects invented actor authority and firing decisions in the original Input response', () => {
    const command = businessCommandFixture('input_response');
    expect(
      taskBusinessMutationRequestSchema.safeParse({
        ...command.intent.request,
        respondedBy: 'human',
      }).success,
    ).toBe(false);
    expect(
      taskBusinessMutationRequestSchema.safeParse({
        ...command.intent.request,
        response: { action: 'accept', content: { decision: 'fire' } },
      }).success,
    ).toBe(false);
    expect(
      taskBusinessMutationRequestSchema.safeParse({
        ...command.intent.request,
        response: { action: 'cancel' },
      }).success,
    ).toBe(true);
  });
  it('rejects any change of original Capability attempt or Provider scope', () => {
    for (const actual of [
      { ...businessControlScope, capabilityAttemptId: 'other' },
      { ...businessControlScope, providerBindingId: 'other' },
      { ...businessControlScope, planHash: 'c'.repeat(64) },
    ])
      expect(() => {
        assertTaskBusinessCommandScope(actual, businessControlScope);
      }).toThrow(expect.objectContaining({ code: 'TASK_BUSINESS_CONTROL_AUTHORITY_CHANGED' }));
  });
});
