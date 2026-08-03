import { Message } from '@a2a-js/sdk';
import { describe, expect, it } from 'vitest';

import { toSubmitTaskCommand, toTaskFollowUp } from '../src/task-mapping.js';

describe('A2A Task submission mapping', () => {
  it('preserves explicit Capability metadata and one structured input part', () => {
    const message = Message.fromJSON({
      messageId: 'message-capability',
      role: 'ROLE_USER',
      parts: [
        { text: 'Inspect device alpha.', mediaType: 'text/plain' },
        { data: { deviceId: 'alpha' }, mediaType: 'application/json' },
      ],
      metadata: {
        user_id: 'operator-1',
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-1',
        },
      },
    });

    expect(toSubmitTaskCommand(message, 'task-1', 'context-1')).toEqual({
      taskId: 'task-1',
      contextId: 'context-1',
      userId: 'operator-1',
      messageText: 'Inspect device alpha.',
      capabilityInput: { deviceId: 'alpha' },
      metadata: {
        user_id: 'operator-1',
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-1',
        },
      },
    });
  });

  it('rejects more than one structured Capability input part', () => {
    const message = Message.fromJSON({
      messageId: 'message-capability-invalid',
      role: 'ROLE_USER',
      parts: [{ text: 'Inspect.' }, { data: { one: true } }, { data: { two: true } }],
    });
    expect(() => toSubmitTaskCommand(message, 'task-1', 'context-1')).toThrow(
      expect.objectContaining({ code: 'A2A_INPUT_CONTENT_INVALID' }),
    );
  });
});

describe('A2A Task follow-up mapping', () => {
  it('extracts one structured provide_input data part into a protocol-neutral command', () => {
    const command = toTaskFollowUp(
      followUpMessage({
        parts: [
          { text: 'Approve the operation.', mediaType: 'text/plain' },
          {
            data: { approval: { action: 'accept', content: { approved: true } } },
            mediaType: 'application/json',
          },
        ],
        metadata: {
          sdar_action: 'provide_input',
          input_request_id: 'input-request-1',
          user_id: 'operator-1',
        },
      }),
    );

    expect(command).toEqual({
      action: 'provide_input',
      messageText: 'Approve the operation.',
      inputRequestId: 'input-request-1',
      inputContent: { approval: { action: 'accept', content: { approved: true } } },
    });
  });

  it('keeps a single text provide_input compatible while exposing it as inputContent', () => {
    expect(
      toTaskFollowUp(
        followUpMessage({
          parts: [{ text: 'approved', mediaType: 'text/plain' }],
          metadata: { sdar_action: 'provide_input' },
        }),
      ),
    ).toEqual({ action: 'provide_input', messageText: 'approved', inputContent: 'approved' });
  });

  it('accepts data-only provide_input without inventing display text', () => {
    expect(
      toTaskFollowUp(
        followUpMessage({
          parts: [{ data: { approval: { action: 'decline' } } }],
          metadata: { sdar_action: 'provide_input' },
        }),
      ),
    ).toEqual({
      action: 'provide_input',
      messageText: '',
      inputContent: { approval: { action: 'decline' } },
    });
  });

  it('rejects multiple data parts, data on other actions and over-sized JSON', () => {
    expect(() =>
      toTaskFollowUp(
        followUpMessage({
          parts: [{ data: { one: true } }, { data: { two: true } }],
          metadata: { sdar_action: 'provide_input' },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_INPUT_CONTENT_INVALID' }));
    expect(() =>
      toTaskFollowUp(
        followUpMessage({
          parts: [{ text: 'Confirm.', mediaType: 'text/plain' }, { data: { unsafe: true } }],
          metadata: { sdar_action: 'confirm_plan' },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_INPUT_CONTENT_INVALID' }));
    expect(() =>
      toTaskFollowUp(
        followUpMessage({
          parts: [{ data: { value: 'x'.repeat(1_048_576) } }],
          metadata: { sdar_action: 'provide_input' },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_INPUT_CONTENT_INVALID' }));
  });

  it('rejects missing, malformed and unknown follow-up metadata', () => {
    expect(() =>
      toTaskFollowUp(
        followUpMessage({ parts: [{ text: 'Input.' }], metadata: { sdar_action: 'unknown' } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_ACTION_INVALID' }));
    expect(() =>
      toTaskFollowUp(
        followUpMessage({
          parts: [{ text: 'Input.' }],
          metadata: { sdar_action: 'provide_input', input_request_id: 42 },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_METADATA_INVALID' }));
    expect(() =>
      toTaskFollowUp(
        followUpMessage({
          parts: [{ text: 'Input.' }],
          metadata: { sdar_action: 'provide_input', unexpected: true },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'A2A_METADATA_INVALID' }));
  });
});

function followUpMessage(
  input: Readonly<{ parts: readonly unknown[]; metadata: unknown }>,
): Message {
  return Message.fromJSON({
    messageId: 'message-follow-up',
    taskId: 'task-1',
    contextId: 'context-1',
    role: 'ROLE_USER',
    parts: input.parts,
    metadata: input.metadata,
  });
}
