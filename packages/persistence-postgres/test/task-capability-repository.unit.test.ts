import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTaskCapabilityRepository } from '../src/index.js';

describe('PostgresTaskCapabilityRepository Provider Binding policy snapshot', () => {
  it('describes only the active registered Card contract without a readiness join', async () => {
    const row = resolutionRow(exactSingleBindingPolicy('binding', 'server', 'read_state'));
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(repository.describeExposure('home-lab-living-room-read', 1)).resolves.toEqual({
      exposureId: row.exposure_id,
      exposureVersion: row.exposure_version,
      requestedCapabilityId: row.capability_id,
      capabilityVersion: row.capability_version,
      requestSchema: row.request_schema,
    });
    const statement = String(query.mock.calls[0]?.[0]);
    expect(statement).toContain("card.status='active'");
    expect(statement).not.toContain('capability_readiness_snapshot');
    expect(query.mock.calls[0]?.[1]).toEqual(['home-lab-living-room-read', 1]);
  });

  it('resolves registered Task contracts even when latest readiness has no available implementations', async () => {
    const row = resolutionRow(exactSingleBindingPolicy('binding', 'server', 'read_state'));
    row.available_implementations = [];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [{ tool_policy: { required: [], optional: [] }, runtime_policy: { maxLlmCalls: 0 } }],
      });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(
      repository.resolveExposure('home-lab-living-room-read', 1, '2026-08-26T12:00:00.000Z'),
    ).resolves.toMatchObject({
      implementationRefs: ['skill:home.living-room.get-state:1'],
      providerBindingRequirements: [{ bindingId: 'binding', localServerId: 'server' }],
    });
    const statement = String(query.mock.calls[0]?.[0]);
    expect(statement).toContain('ORDER BY snapshot_version DESC LIMIT 1');
    expect(statement).not.toContain("status IN ('available','degraded')");
    expect(statement).not.toContain('valid_until>');
  });

  it.each(['suspended', 'kill-switch', 'maintenance'] as const)(
    'retains explicit registration and governance rejection for %s',
    async (state) => {
      const row = resolutionRow(exactSingleBindingPolicy('binding', 'server', 'read_state'));
      if (state === 'suspended') row.evaluation_input.definition.status = 'suspended';
      else if (state === 'kill-switch') row.evaluation_input.killSwitch = true;
      else row.evaluation_input.maintenanceMode = true;
      const query = vi.fn().mockResolvedValueOnce({ rows: [row] });
      const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);
      await expect(
        repository.resolveExposure('home-lab-living-room-read', 1, '2026-08-26T12:00:00.000Z'),
      ).resolves.toBeUndefined();
      expect(query).toHaveBeenCalledOnce();
    },
  );

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
            definition: {
              status: 'published',
              successCriteria: [],
              requiredEvidence: [],
              constraints: [],
            },
            maintenanceMode: false,
            killSwitch: false,
            implementations: [
              {
                bindingId: 'capability-binding-home-light-read-v1',
                implementationType: 'skill',
                implementationId: 'home.light.get-state',
                implementationVersion: '1',
                status: 'active',
                role: 'primary',
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

  it('freezes both exact required_all Binding authorities for one Skill implementation', async () => {
    const providerPolicyOverride = exactTwoBindingPolicy();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [resolutionRow(providerPolicyOverride)] })
      .mockResolvedValueOnce({
        rows: [
          {
            tool_policy: {
              required: [
                { serverId: 'home-lab-light-mcp', toolName: 'light_get_state' },
                { serverId: 'home-lab-climate-mcp', toolName: 'climate_get_state' },
              ],
              optional: [],
            },
            runtime_policy: { maxLlmCalls: 0, maxMcpCalls: 2 },
          },
        ],
      });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    const resolution = await repository.resolveExposure(
      'home-lab-living-room-read',
      1,
      '2026-08-11T00:00:00.000Z',
    );

    expect(resolution).toBeDefined();
    if (resolution === undefined) throw new Error('TEST_RESOLUTION_MISSING');
    expect(resolution.providerBindingRefs).toEqual([
      'mcp-binding-ha-climate-lab',
      'mcp-binding-ha-light-lab',
    ]);
    expect(resolution.providerBindingRequirements).toEqual([
      {
        bindingId: 'mcp-binding-ha-climate-lab',
        localServerId: 'home-lab-climate-mcp',
      },
      { bindingId: 'mcp-binding-ha-light-lab', localServerId: 'home-lab-light-mcp' },
    ]);
    expect(resolution.providerPolicySnapshot).toEqual(
      expect.objectContaining({
        implementations: [
          expect.objectContaining({
            providerBindingRequirements: [
              { bindingId: 'mcp-binding-ha-light-lab', localServerId: 'home-lab-light-mcp' },
              {
                bindingId: 'mcp-binding-ha-climate-lab',
                localServerId: 'home-lab-climate-mcp',
              },
            ],
          }),
        ],
      }),
    );
  });

  it('rejects required_all when the Skill required tools do not match both policies', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [resolutionRow(exactTwoBindingPolicy())] })
      .mockResolvedValueOnce({
        rows: [
          {
            tool_policy: {
              required: [{ serverId: 'home-lab-light-mcp', toolName: 'light_get_state' }],
              optional: [],
            },
            runtime_policy: { maxLlmCalls: 0, maxMcpCalls: 2 },
          },
        ],
      });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(
      repository.resolveExposure('home-lab-living-room-read', 1, '2026-08-11T00:00:00.000Z'),
    ).rejects.toThrow('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
  });

  it('rejects required_all when the Skill injects an optional tool', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [resolutionRow(exactTwoBindingPolicy())] })
      .mockResolvedValueOnce({
        rows: [
          {
            tool_policy: {
              required: [
                { serverId: 'home-lab-light-mcp', toolName: 'light_get_state' },
                { serverId: 'home-lab-climate-mcp', toolName: 'climate_get_state' },
              ],
              optional: [{ serverId: 'home-lab-light-mcp', toolName: 'light_set_power' }],
            },
            runtime_policy: { maxLlmCalls: 0, maxMcpCalls: 2 },
          },
        ],
      });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(
      repository.resolveExposure('home-lab-living-room-read', 1, '2026-08-11T00:00:00.000Z'),
    ).rejects.toThrow('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
  });

  it('deduplicates the same Binding authority across available implementations', async () => {
    const sharedPolicy = exactSingleBindingPolicy(
      'mcp-binding-ha-shared-lab',
      'home-lab-shared-mcp',
      'read_state',
    );
    const row = resolutionRowWithImplementations([
      skillImplementation(
        'capability-binding-home-living-room-read-v1-a',
        'home.living-room.get-state-a',
        sharedPolicy,
      ),
      skillImplementation(
        'capability-binding-home-living-room-read-v1-b',
        'home.living-room.get-state-b',
        sharedPolicy,
      ),
    ]);
    const skillPolicy = {
      rows: [
        {
          tool_policy: { required: [], optional: [] },
          runtime_policy: { maxLlmCalls: 0, maxMcpCalls: 1 },
        },
      ],
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce(skillPolicy)
      .mockResolvedValueOnce(skillPolicy);
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    const resolution = await repository.resolveExposure(
      'home-lab-living-room-read',
      1,
      '2026-08-11T00:00:00.000Z',
    );

    expect(resolution?.providerBindingRefs).toEqual(['mcp-binding-ha-shared-lab']);
    expect(resolution?.providerBindingRequirements).toEqual([
      { bindingId: 'mcp-binding-ha-shared-lab', localServerId: 'home-lab-shared-mcp' },
    ]);
    expect(resolution?.providerPolicySnapshot).toEqual(
      expect.objectContaining({
        implementations: [
          expect.objectContaining({
            providerBindingRequirement: {
              bindingId: 'mcp-binding-ha-shared-lab',
              localServerId: 'home-lab-shared-mcp',
            },
          }),
          expect.objectContaining({
            providerBindingRequirement: {
              bindingId: 'mcp-binding-ha-shared-lab',
              localServerId: 'home-lab-shared-mcp',
            },
          }),
        ],
      }),
    );
  });

  it('fails closed when available implementations assign one Binding id to different servers', async () => {
    const row = resolutionRowWithImplementations([
      skillImplementation(
        'capability-binding-home-living-room-read-v1-a',
        'home.living-room.get-state-a',
        exactSingleBindingPolicy(
          'mcp-binding-ha-shared-lab',
          'home-lab-light-mcp',
          'light_get_state',
        ),
      ),
      skillImplementation(
        'capability-binding-home-living-room-read-v1-b',
        'home.living-room.get-state-b',
        exactSingleBindingPolicy(
          'mcp-binding-ha-shared-lab',
          'home-lab-climate-mcp',
          'climate_get_state',
        ),
      ),
    ]);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [
          {
            tool_policy: { required: [], optional: [] },
            runtime_policy: { maxLlmCalls: 0, maxMcpCalls: 1 },
          },
        ],
      });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(
      repository.resolveExposure('home-lab-living-room-read', 1, '2026-08-11T00:00:00.000Z'),
    ).rejects.toThrow('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a declared Binding policy is null', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [resolutionRow(null)] });
    const repository = new PostgresTaskCapabilityRepository({ query } as unknown as Pool);

    await expect(
      repository.resolveExposure('home-lab-living-room-read', 1, '2026-08-11T00:00:00.000Z'),
    ).rejects.toThrow('TASK_CAPABILITY_PROVIDER_BINDING_POLICY_INVALID');
    expect(query).toHaveBeenCalledTimes(1);
  });
});

function exactTwoBindingPolicy() {
  const hard = {
    selection: 'required',
    requireActive: true,
    requireAvailable: true,
    requireUnexpiredFreshness: true,
    denyFallback: true,
  } as const;
  return {
    selection: 'required_all',
    requirements: [
      {
        ...hard,
        mcpProviderBindingId: 'mcp-binding-ha-light-lab',
        localServerId: 'home-lab-light-mcp',
        mcpToolName: 'light_get_state',
      },
      {
        ...hard,
        mcpProviderBindingId: 'mcp-binding-ha-climate-lab',
        localServerId: 'home-lab-climate-mcp',
        mcpToolName: 'climate_get_state',
      },
    ],
  } as const;
}

function exactSingleBindingPolicy(
  mcpProviderBindingId: string,
  localServerId: string,
  mcpToolName: string,
) {
  return {
    selection: 'required',
    mcpProviderBindingId,
    localServerId,
    mcpToolName,
    requireActive: true,
    requireAvailable: true,
    requireUnexpiredFreshness: true,
    denyFallback: true,
  } as const;
}

function skillImplementation(
  bindingId: string,
  implementationId: string,
  providerPolicyOverride: unknown,
) {
  return {
    bindingId,
    status: 'active',
    role: 'primary',
    implementationType: 'skill',
    implementationId,
    implementationVersion: '1',
    providerPolicyOverride,
  };
}

function resolutionRow(providerPolicyOverride: unknown) {
  return resolutionRowWithImplementations([
    skillImplementation(
      'capability-binding-home-living-room-read-v1',
      'home.living-room.get-state',
      providerPolicyOverride,
    ),
  ]);
}

function resolutionRowWithImplementations(
  implementations: readonly Readonly<Record<string, unknown>>[],
) {
  return {
    exposure_id: 'home-lab-living-room-read',
    exposure_version: 1,
    capability_id: 'home.living-room.read-state',
    capability_version: 1,
    request_schema: { type: 'object' },
    requester_policy: null,
    evaluation_input: {
      definition: {
        status: 'published',
        successCriteria: [],
        requiredEvidence: [],
        constraints: [],
      },
      maintenanceMode: false,
      killSwitch: false,
      implementations,
    },
    available_implementations: implementations.map((implementation) =>
      String(implementation['bindingId']),
    ),
    catalog_hash: 'a'.repeat(64),
    policy_hash: 'b'.repeat(64),
    snapshot_hash: 'c'.repeat(64),
  };
}
