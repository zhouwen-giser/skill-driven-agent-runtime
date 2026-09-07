import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyTaskProjectionService } from '../src/task-projection.js';
import { createAgentTask } from '../../domain/src/index.js';
const task = createAgentTask({
  taskId: 'projection',
  contextId: 'context',
  userId: 'anonymous',
  requestText: 'sum',
  requestMetadata: {},
  timestamp: '2026-09-07T09:00:00.000Z',
});
describe('Read-only Task projection', () => {
  it('retries a changing revision and projects the committed result with its interaction', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ task, revision: '1' })
      .mockResolvedValue({
        task: { ...task, output: { text: 'sum', structured: { total: 3 } } },
        revision: '2',
      });
    const service = new ReadOnlyTaskProjectionService({
      readState: read,
      readInteraction: () => Promise.resolve({ version: 3 }),
      hash: JSON.stringify,
    });
    expect(await service.read(task.taskId)).toMatchObject({
      revision: '2',
      interactionVersion: '{"version":3}',
      resultHash: '{"text":"sum","structured":{"total":3}}',
    });
    expect(read).toHaveBeenCalledTimes(4);
  });
  it('bounds reads on continuously changing source state', async () => {
    let revision = 0;
    const read = vi.fn(() => Promise.resolve({ task, revision: String(++revision) }));
    const service = new ReadOnlyTaskProjectionService({
      readState: read,
      readInteraction: () => Promise.resolve(undefined),
      hash: JSON.stringify,
    });
    await expect(service.read(task.taskId)).rejects.toMatchObject({
      code: 'TASK_PROJECTION_CHANGED_DURING_READ',
    });
    expect(read).toHaveBeenCalledTimes(6);
  });
});
