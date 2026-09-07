import { describe, it, expect } from 'vitest';
import { IsolatedDemoService, type IsolatedDemoRecord } from '../src/isolated-demo-service.js';

describe('isolated inert demonstration', () => {
  it('requires separate manual confirmation, preserves audit and never creates device identities', async () => {
    const records: IsolatedDemoRecord[] = [];
    const service = new IsolatedDemoService(
      {
        list: () => Promise.resolve(records),
        append: (record) => {
          if (
            !records.some((row) => row.requestId === record.requestId && row.phase === record.phase)
          )
            records.push(record);
          return Promise.resolve();
        },
      },
      () => '2026-09-07T00:00:00.000Z',
    );
    await service.request({
      requestId: 'demo-request',
      objectId: 'demo:indicator',
      state: 'active',
    });
    expect(records.map((row) => row.phase)).toEqual(['requested']);
    await expect(service.confirm('demo-request', '')).rejects.toThrow(
      'SOFTWARE_DEMO_MANUAL_ACK_REQUIRED',
    );
    await expect(service.confirm('missing', 'software-only')).rejects.toThrow(
      'SOFTWARE_DEMO_REQUEST_NOT_FOUND',
    );
    await service.confirm('demo-request', 'software-only');
    await service.confirm('demo-request', 'software-only');
    expect(records.map((row) => row.phase)).toEqual(['requested', 'confirmed']);
    await expect(
      service.request({ requestId: 'demo-request', objectId: 'demo:other', state: 'active' }),
    ).rejects.toThrow('SOFTWARE_DEMO_IDEMPOTENCY_CONFLICT');
    const view = await service.catalog();
    expect(view.deviceExecution).toBe('disabled');
    expect(view.executableCapability).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/missionId|externalExecutionId|physicalSuccess/);
  });
});
