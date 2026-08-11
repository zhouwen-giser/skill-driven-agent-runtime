import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTaskCapabilityRepository } from '../src/index.js';

describe('PostgresTaskCapabilityRepository Provider Binding policy snapshot', () => {
  it('rejects a declared but incomplete exact Provider Binding policy', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          exposure_id: 'home-lab-light-read',
          exposure_version: 1,
          capability_id: 'home.light.read-state',
          capability_version: 1,
          request_schema: { type: 'object' },
          requester_policy: null,
          evaluation_input: {
            definition: { successCriteria: [], requiredEvidence: [], constraints: [] },
            implementations: [
              {
                bindingId: 'capability-binding-home-light-read-v1',
                implementationType: 'skill',
                implementationId: 'home.light.get-state',
                implementationVersion: '1',
                providerPolicyOverride: {
                  selection: 'required',
                  mcpProviderBindingId: 'mcp-binding-ha-light-lab',
                  localServerId: 'home-lab-light-mcp',
                },
              },
            ],
          },
          available_implementations: ['capability-binding-home-light-read-v1'],
          catalog_hash: 'a'.repeat(64),
          policy_hash: 'b'.repeat(64),
          snapshot_hash: 'c'.repeat(64),
        },
      ],
    });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(
      repository.resolveExposure('home-lab-light-read', 1, '2026-08-11T00:00:00.000Z'),
    ).rejects.toThrow('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
