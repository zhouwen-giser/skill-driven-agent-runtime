import { describe, expect, it } from 'vitest';

import { ContextSerialExecutor } from '../src/index.js';

describe('ContextSerialExecutor', () => {
  it('serializes operations for one context while allowing another context to progress', async () => {
    const executor = new ContextSerialExecutor();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = executor.run('context-a', async () => {
      events.push('a1:start');
      await firstBlocked;
      events.push('a1:end');
    });
    const second = executor.run('context-a', () => {
      events.push('a2:start');
      events.push('a2:end');
      return Promise.resolve();
    });
    const other = executor.run('context-b', () => {
      events.push('b1:start');
      events.push('b1:end');
      return Promise.resolve();
    });

    await other;
    expect(events).toEqual(['a1:start', 'b1:start', 'b1:end']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['a1:start', 'b1:start', 'b1:end', 'a1:end', 'a2:start', 'a2:end']);
  });
});
