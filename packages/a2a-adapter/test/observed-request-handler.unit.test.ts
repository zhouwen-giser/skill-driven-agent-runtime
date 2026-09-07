import { createHash } from 'node:crypto';
import { SendMessageRequest, TaskState, type StreamResponse } from '@a2a-js/sdk';
import {
  AgentEvent,
  InMemoryTaskStore,
  ServerCallContext,
  type AgentExecutor,
} from '@a2a-js/sdk/server';
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryTaskStateNotifier,
  ReadOnlyTaskProjectionService,
} from '../../application/src/index.js';
import { createAgentTask, type AgentTask } from '../../domain/src/index.js';
import { ObservedRequestHandler } from '../src/observed-request-handler.js';
import { buildAgentCard } from '../src/compatibility.js';
import { toA2ATask } from '../src/task-mapping.js';

function setup() {
  let task: AgentTask = {
    ...createAgentTask({
      taskId: 'task-observe',
      contextId: 'context-observe',
      userId: 'anonymous',
      requestText: 'Document summary',
      requestMetadata: {},
      timestamp: '2026-09-07T08:00:00.000Z',
    }),
    phase: 'executing',
  };
  let revision = 1;
  let interaction: Readonly<Record<string, unknown>> = { version: 1 };
  const notifier = new InMemoryTaskStateNotifier();
  const store = new InMemoryTaskStore();
  const writes = vi.spyOn(store, 'save');
  const executor: AgentExecutor = {
    execute: vi.fn<AgentExecutor['execute']>((request, bus) => {
      task = { ...task, taskId: request.taskId, contextId: request.contextId };
      bus.publish(AgentEvent.task(toA2ATask(task, interaction)));
      bus.finished();
      return Promise.resolve();
    }),
    cancelTask: vi.fn(() => Promise.resolve()),
  };
  const reader = new ReadOnlyTaskProjectionService({
    readState: () => Promise.resolve({ task, revision: String(revision) }),
    readInteraction: () => Promise.resolve(interaction),
    hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  });
  const handler = new ObservedRequestHandler([buildAgentCard([]), store, executor], {
    reader,
    notifier,
    waitTimeoutMs: 10,
    pollIntervalMs: 10,
  });
  return {
    handler,
    notifier,
    store,
    writes,
    executor,
    task: () => task,
    change: (next: Partial<AgentTask>, metadata?: Readonly<Record<string, unknown>>) => {
      task = { ...task, ...next };
      revision++;
      if (metadata !== undefined) interaction = metadata;
      notifier.publish(task);
    },
  };
}
const context = new ServerCallContext();
function request(taskId?: string) {
  return SendMessageRequest.fromJSON({
    message: {
      messageId: `message-${taskId ?? 'initial'}`,
      taskId,
      role: 'ROLE_USER',
      parts: [{ text: 'Summarize a document.' }],
    },
    configuration: { returnImmediately: false },
  });
}
async function collect(stream: AsyncGenerator<StreamResponse, void, undefined>) {
  const events: StreamResponse[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
describe('SDK public handler projection observer', () => {
  it('sends one initial Task and the complete artifact before final status, beyond the synchronous window', async () => {
    const s = setup();
    const stream = s.handler.sendMessageStream(request(), context);
    const first = await stream.next();
    if (first.done) throw new Error('INITIAL_TASK_MISSING');
    expect(first.value.payload?.$case).toBe('task');
    const remaining = collect(stream);
    await new Promise((resolve) => setTimeout(resolve, 30));
    s.change({
      phase: 'completed',
      phaseMessage: 'Document finished',
      output: { text: 'summary', structured: { pages: 2 } },
    });
    const events = [requiredFixture(first.value), ...(await remaining)];
    expect(events.map((event) => event.payload?.$case)).toEqual([
      'task',
      'artifactUpdate',
      'statusUpdate',
    ]);
    const artifact = events[1]?.payload;
    expect(
      artifact?.$case === 'artifactUpdate' ? artifact.value.artifact?.parts[1]?.content : undefined,
    ).toEqual({ $case: 'data', value: { pages: 2 } });
    const status = events[2]?.payload;
    expect(status?.$case === 'statusUpdate' ? status.value.status?.state : undefined).toBe(
      TaskState.TASK_STATE_COMPLETED,
    );
    expect(
      status?.$case === 'statusUpdate'
        ? status.value.status?.message?.parts[0]?.content
        : undefined,
    ).toEqual({ $case: 'text', value: 'Document finished' });
    s.notifier.close();
  });
  it('observes metadata-only changes in the same millisecond and keeps GET/resubscribe read-only', async () => {
    const s = setup();
    const submitted = await s.handler.sendMessage(
      {
        ...request(),
        configuration: { ...requiredFixture(request().configuration), returnImmediately: true },
      },
      context,
    );
    if (!('id' in submitted)) throw new Error('TASK_REQUIRED');
    const baseline = s.writes.mock.calls.length;
    const stream = s.handler.resubscribe({ id: submitted.id, tenant: '' }, context);
    await stream.next();
    const next = stream.next();
    s.change({}, { version: 2, prompt: 'Choose a format' });
    const event = await next;
    expect(
      event.value?.payload?.$case === 'statusUpdate'
        ? event.value.payload.value.metadata
        : undefined,
    ).toMatchObject({ 'io.sdar/interaction': { version: 2 } });
    await s.handler.getTask({ id: submitted.id, tenant: '', historyLength: undefined }, context);
    await stream.return();
    expect(s.writes).toHaveBeenCalledTimes(baseline);
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
    expect(s.executor.cancelTask).not.toHaveBeenCalled();
    s.notifier.close();
  });
  it('reconnects with independent observers and continues the same Task on follow-up', async () => {
    const s = setup();
    const initial = await s.handler.sendMessage(
      {
        ...request(),
        configuration: { ...requiredFixture(request().configuration), returnImmediately: true },
      },
      context,
    );
    if (!('id' in initial)) throw new Error('TASK_REQUIRED');
    const a = s.handler.resubscribe({ id: initial.id, tenant: '' }, context);
    await a.next();
    await a.return();
    const b = s.handler.resubscribe({ id: initial.id, tenant: '' }, context);
    const c = s.handler.resubscribe({ id: initial.id, tenant: '' }, context);
    await b.next();
    await c.next();
    const followup = s.handler.sendMessageStream(request(initial.id), context);
    expect((await followup.next()).value?.payload?.$case).toBe('task');
    const remainingFollowup = collect(followup);
    const remainingB = collect(b);
    const remainingC = collect(c);
    s.change({ phase: 'completed', output: { text: 'sum', structured: { total: 4 } } });
    expect((await remainingB).map((e) => e.payload?.$case)).toEqual([
      'artifactUpdate',
      'statusUpdate',
    ]);
    expect((await remainingC).map((e) => e.payload?.$case)).toEqual([
      'artifactUpdate',
      'statusUpdate',
    ]);
    expect((await remainingFollowup).map((e) => e.payload?.$case)).toEqual([
      'artifactUpdate',
      'statusUpdate',
    ]);
    expect(s.executor.execute).toHaveBeenCalledTimes(2);
    expect(s.executor.cancelTask).not.toHaveBeenCalled();
    s.notifier.close();
  });
});

function requiredFixture<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('REQUIRED_TEST_FIXTURE_MISSING');
  return value;
}
