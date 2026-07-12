import { describe, expect, it } from 'vitest';

import {
  createAgentTask,
  type AgentTask,
  type ImplicitFeedbackRecord,
} from '../../domain/src/index.js';
import { ImplicitFeedbackService, type ImplicitFeedbackRepository } from '../src/index.js';

const timestamp = '2026-07-13T00:00:00.000Z';

describe('ImplicitFeedbackService', () => {
  it('classifies accepted and repeated successor submissions with low confidence', async () => {
    const repository = new MemoryFeedbackRepository();
    const service = createService(repository);
    repository.previous = terminalTask('previous', 'Original request.');

    await service.observeSubmission(task('next', 'Different request.'));
    await service.observeSubmission(task('repeat', '  ORIGINAL   REQUEST. '));

    expect(
      repository.records.map(({ kind, sourceTaskId, triggerTaskId, confidence }) => ({
        kind,
        sourceTaskId,
        triggerTaskId,
        confidence,
      })),
    ).toEqual([
      {
        kind: 'accepted_result',
        sourceTaskId: 'previous',
        triggerTaskId: 'next',
        confidence: 0.35,
      },
      {
        kind: 'repeated_submission',
        sourceTaskId: 'previous',
        triggerTaskId: 'repeat',
        confidence: 0.35,
      },
    ]);
  });

  it('classifies continued modification, redo requests, and Skill switches', async () => {
    const repository = new MemoryFeedbackRepository();
    const service = createService(repository);
    const current = task('task-1', 'Do the work.');

    await service.observeRevision(current, 'Add a validation step.');
    await service.observeRevision(current, 'Please redo the plan.');
    await service.observeRevision(current, '\u8bf7\u91cd\u65b0\u89c4\u5212\u3002');
    await service.observeSkillSwitch(current, 'skill-old', 'skill-new');

    expect(repository.records.map((record) => record.kind)).toEqual([
      'continued_modification',
      'requested_redo',
      'requested_redo',
      'switched_skill',
    ]);
    expect(repository.records.every((record) => record.sourceTaskId === 'task-1')).toBe(true);
  });
});

function createService(repository: ImplicitFeedbackRepository): ImplicitFeedbackService {
  let sequence = 0;
  return new ImplicitFeedbackService({
    repository,
    clock: { now: () => timestamp },
    nextId: () => `feedback-${String(++sequence)}`,
  });
}

function task(taskId: string, requestText: string): AgentTask {
  return createAgentTask({
    taskId,
    contextId: 'context-1',
    userId: 'anonymous',
    requestText,
    requestMetadata: {},
    timestamp,
  });
}

function terminalTask(taskId: string, requestText: string): AgentTask {
  return { ...task(taskId, requestText), phase: 'completed' };
}

class MemoryFeedbackRepository implements ImplicitFeedbackRepository {
  previous: AgentTask | undefined;
  readonly records: ImplicitFeedbackRecord[] = [];
  findPreviousTerminal(): Promise<AgentTask | undefined> {
    return Promise.resolve(this.previous);
  }
  save(record: ImplicitFeedbackRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
  listByTask(taskId: string): Promise<readonly ImplicitFeedbackRecord[]> {
    return Promise.resolve(
      this.records.filter(
        (record) => record.sourceTaskId === taskId || record.triggerTaskId === taskId,
      ),
    );
  }
}
