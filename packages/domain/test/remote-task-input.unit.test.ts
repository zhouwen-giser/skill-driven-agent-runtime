import { describe, expect, it } from 'vitest';

import {
  createRemoteTaskInputLink,
  normalizeRemoteTaskInputResponses,
  snapshotRemoteTaskInputValue,
  transitionRemoteTaskInputLink,
} from '../src/remote-task-input.js';

describe('Remote Task input domain', () => {
  it('creates an immutable waiting link with bounded Provider input evidence', () => {
    const requests = {
      approval: {
        method: 'elicitation/create',
        params: { message: 'Approve?', requestedSchema: { type: 'object' } },
      },
    };
    const link = createRemoteTaskInputLink({
      inputRequestId: 'input-request-1',
      controlEventId: 'control-event-1',
      bindingId: 'binding-1',
      remoteTaskId: 'remote-task-1',
      workflowInstanceId: 'workflow-instance-1',
      workflowNodeId: 'node-1',
      workflowNodeRunId: 'workflow-instance-1:node-1:1',
      remoteRevision: 'remote-revision-1',
      resultHash: 'a'.repeat(64),
      inputRequests: requests,
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    requests.approval.params.message = 'mutated';

    expect(link).toMatchObject({
      status: 'waiting',
      inputRequests: { approval: { params: { message: 'Approve?' } } },
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(Object.isFrozen(link)).toBe(true);
    expect(Object.isFrozen(link.inputRequests)).toBe(true);
  });

  it('normalizes one text response and exact-key structured responses', () => {
    const requests = { approval: { method: 'elicitation/create' } };

    expect(normalizeRemoteTaskInputResponses(requests, 'approved')).toEqual({
      approval: 'approved',
    });
    expect(
      normalizeRemoteTaskInputResponses(requests, {
        approval: { action: 'accept', content: { approved: true } },
      }),
    ).toEqual({ approval: { action: 'accept', content: { approved: true } } });
  });

  it('rejects ambiguous text and missing or unknown response keys', () => {
    const requests = {
      approval: { method: 'elicitation/create' },
      roots: { method: 'roots/list' },
    };

    expect(() => normalizeRemoteTaskInputResponses(requests, 'ambiguous')).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_INPUT_RESPONSE_INVALID' }),
    );
    expect(() =>
      normalizeRemoteTaskInputResponses(requests, { approval: { action: 'decline' } }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_INPUT_RESPONSE_INVALID' }));
    expect(() =>
      normalizeRemoteTaskInputResponses(requests, {
        approval: { action: 'decline' },
        roots: { roots: [] },
        unexpected: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_INPUT_RESPONSE_INVALID' }));
  });

  it('rejects sampling, roots and URL elicitation instead of guessing an A2A answer', () => {
    expect(() => createLinkWithRequests({ roots: { method: 'roots/list', params: {} } })).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_INPUT_REQUEST_UNSUPPORTED' }),
    );
    expect(() =>
      createLinkWithRequests({
        url: {
          method: 'elicitation/create',
          params: {
            mode: 'url',
            message: 'Open the approval page.',
            requestedSchema: { type: 'object' },
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_INPUT_REQUEST_UNSUPPORTED' }));
  });

  it('rejects empty, malformed, cyclic, deep and over-sized input JSON', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    let deep: unknown = 'leaf';
    for (let index = 0; index < 34; index += 1) deep = { nested: deep };

    expect(() => createLinkWithRequests({})).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_INPUT_KEYS_INVALID' }),
    );
    expect(() => createLinkWithRequests({ ['x'.repeat(257)]: true })).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_INPUT_KEYS_INVALID' }),
    );
    expect(() => snapshotRemoteTaskInputValue(cyclic)).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_INPUT_JSON_INVALID' }),
    );
    expect(() => snapshotRemoteTaskInputValue(deep)).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_INPUT_JSON_INVALID' }),
    );
    expect(() => snapshotRemoteTaskInputValue({ value: 'x'.repeat(1_048_576) })).toThrow(
      expect.objectContaining({
        code: expect.stringMatching(/REMOTE_TASK_INPUT_JSON_(?:INVALID|TOO_LARGE)/u),
      }),
    );
  });

  it('allows only monotonic lifecycle transitions', () => {
    const waiting = createLinkWithRequests({
      approval: {
        method: 'elicitation/create',
        params: { message: 'Approve?', requestedSchema: { type: 'object' } },
      },
    });
    const answered = transitionRemoteTaskInputLink(waiting, 'answered', '2026-07-17T00:01:00.000Z');
    const uncertain = transitionRemoteTaskInputLink(
      answered,
      'update_uncertain',
      '2026-07-17T00:02:00.000Z',
    );
    const advanced = transitionRemoteTaskInputLink(
      uncertain,
      'provider_advanced',
      '2026-07-17T00:03:00.000Z',
    );

    expect(advanced.status).toBe('provider_advanced');
    expect(() =>
      transitionRemoteTaskInputLink(advanced, 'answered', '2026-07-17T00:04:00.000Z'),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_INPUT_STATUS_TRANSITION_INVALID' }));
    expect(() =>
      transitionRemoteTaskInputLink(answered, 'update_acknowledged', '2026-07-16T23:59:00.000Z'),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_INPUT_STATUS_TRANSITION_INVALID' }));
  });
});

function createLinkWithRequests(inputRequests: Readonly<Record<string, unknown>>) {
  return createRemoteTaskInputLink({
    inputRequestId: 'input-request-1',
    controlEventId: 'control-event-1',
    bindingId: 'binding-1',
    remoteTaskId: 'remote-task-1',
    workflowInstanceId: 'workflow-instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'workflow-instance-1:node-1:1',
    remoteRevision: 'remote-revision-1',
    resultHash: 'a'.repeat(64),
    inputRequests,
    createdAt: '2026-07-17T00:00:00.000Z',
  });
}
