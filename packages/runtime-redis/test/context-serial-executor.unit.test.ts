import { describe, expect, it, vi } from 'vitest';

import { ContextSerialExecutor, DEFAULT_CONTEXT_WORKER_CONCURRENCY } from '../src/index.js';

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

  it('supports ten active contexts without cross-context state while serializing each tail', async () => {
    expect(DEFAULT_CONTEXT_WORKER_CONCURRENCY).toBe(10);
    const executor = new ContextSerialExecutor();
    const activeByContext = new Map<string, number>();
    const events = new Map<string, string[]>();
    let active = 0;
    let maximumActive = 0;
    let releaseFirstWave: () => void = () => undefined;
    const firstWaveBlocked = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });

    const operations = Array.from({ length: 10 }, (_, index) => {
      const contextId = `context-${String(index)}`;
      events.set(contextId, []);
      const run = (sequence: number, block: boolean) =>
        executor.run(contextId, async () => {
          const contextActive = (activeByContext.get(contextId) ?? 0) + 1;
          activeByContext.set(contextId, contextActive);
          expect(contextActive).toBe(1);
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          events.get(contextId)?.push(`${String(sequence)}:start`);
          if (block) await firstWaveBlocked;
          events.get(contextId)?.push(`${String(sequence)}:end`);
          active -= 1;
          activeByContext.set(contextId, contextActive - 1);
          return `${contextId}:${String(sequence)}`;
        });
      return [run(1, true), run(2, false)] as const;
    });

    await vi.waitFor(() => {
      expect(active).toBe(10);
    });
    expect(maximumActive).toBe(10);
    expect([...events.values()].every((value) => value.length === 1)).toBe(true);
    releaseFirstWave();
    const results = await Promise.all(operations.flat());

    expect(new Set(results)).toHaveLength(20);
    expect(active).toBe(0);
    expect([...activeByContext.values()].every((value) => value === 0)).toBe(true);
    expect(
      [...events.values()].every((value) => value.join(',') === '1:start,1:end,2:start,2:end'),
    ).toBe(true);
  });
});
