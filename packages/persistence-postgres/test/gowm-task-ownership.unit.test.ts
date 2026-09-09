import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createAgentTask } from '../../domain/src/task.js';
import { PostgresAgentTaskRepository } from '../src/repositories.js';
import { PostgresTaskCapabilityRepository } from '../src/task-capability-repository.js';

const scope = { allowedDeviceIds: ['a', 'b'], sdarServiceKey: 'sdar', includeNonDevice: false };
const owner = { deviceId: 'a', bindingId: 'binding-a', sdarServiceKey: 'sdar' };

describe('GOWM Task and initial admission ownership boundary', () => {
  it('persists all three ownership fields on initial Task INSERT', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const tasks = new PostgresAgentTaskRepository(
      { query } as unknown as Pool,
      undefined,
      undefined,
      scope,
    );
    await tasks.save(
      createAgentTask({
        taskId: 't',
        contextId: 'c',
        userId: 'u',
        requestText: 'read',
        requestMetadata: {},
        timestamp: '2026-09-08T00:00:00Z',
        deviceOwnership: owner,
      }),
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'device_id,gowm_binding_id,sdar_service_key',
    );
    expect((query.mock.calls[0]?.[1] as unknown[]).slice(-3)).toEqual(['a', 'binding-a', 'sdar']);
  });

  it('rejects missing ownership before a shared Task write and never silently drops it in standalone', async () => {
    const query = vi.fn();
    const task = createAgentTask({
      taskId: 't',
      contextId: 'c',
      userId: 'u',
      requestText: 'read',
      requestMetadata: {},
      timestamp: '2026-09-08T00:00:00Z',
    });
    await expect(
      new PostgresAgentTaskRepository(
        { query } as unknown as Pool,
        undefined,
        undefined,
        scope,
      ).save(task),
    ).rejects.toThrow('DEVICE_SCOPE_DENIED');
    await expect(
      new PostgresAgentTaskRepository({ query } as unknown as Pool).save({
        ...task,
        deviceOwnership: owner,
      }),
    ).rejects.toThrow('DEVICE_STORAGE_NOT_CONFIGURED');
    expect(query).not.toHaveBeenCalled();
  });

  it('puts the scope in Task SELECT rather than filtering after retrieval', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const tasks = new PostgresAgentTaskRepository(
      { query } as unknown as Pool,
      undefined,
      undefined,
      scope,
    );
    await tasks.findWithRevision('t');
    expect(String(query.mock.calls[0]?.[0])).toContain('agent_task.device_id=ANY($2::text[])');
    expect(query.mock.calls[0]?.[1]).toEqual(['t', ['a', 'b'], 'sdar', false]);
  });

  it('looks up the same caller key independently for each device and service', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const admissions = new PostgresTaskCapabilityRepository(
      { query } as unknown as Pool,
      undefined,
      undefined,
      scope,
    );
    await admissions.findByIdempotencyKey('same-key', owner);
    await admissions.findByIdempotencyKey('same-key', { ...owner, deviceId: 'b' });
    expect(query.mock.calls[0]?.[1]).toEqual(['same-key', 'a', 'sdar']);
    expect(query.mock.calls[1]?.[1]).toEqual(['same-key', 'b', 'sdar']);
    expect(String(query.mock.calls[0]?.[0])).toContain('SELECT admission_id,');
    await expect(
      admissions.findByIdempotencyKey('same-key', { ...owner, deviceId: 'outside' }),
    ).rejects.toThrow('DEVICE_SCOPE_DENIED');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
