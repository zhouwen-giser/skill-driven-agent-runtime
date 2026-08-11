import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  createCapabilityImplementationBinding,
  createNodeCapabilityDefinition,
} from '../../node-control-domain/src/index.js';
import { PostgresNodeControlCapabilityRepository } from '../src/index.js';

describe('Node Control Capability implementation policy persistence', () => {
  it('maps SQL NULL as absent and preserves explicit JSON null and object policies', async () => {
    const objectPolicy = { selection: 'required', marker: { intact: true } };
    const query = vi.fn((statement: string) => {
      if (!statement.includes('sdar_control.capability_implementation_binding'))
        throw new Error('CAPABILITY_IMPLEMENTATION_SELECT_EXPECTED');
      return Promise.resolve({
        rows: [
          bindingRow('binding.absent', null, false, 0),
          bindingRow('binding.null', null, true, 1),
          bindingRow('binding.object', objectPolicy, true, 2),
        ],
      });
    });
    const repository = new PostgresNodeControlCapabilityRepository({
      query,
    } as unknown as Pool);

    const bindings = await repository.listImplementations('capability.persistence', 1, 10);

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'provider_policy_override IS NOT NULL AS has_provider_policy_override',
    );
    expect(Object.hasOwn(bindings[0] ?? {}, 'providerPolicyOverride')).toBe(false);
    expect(bindings[0]?.providerPolicyOverride).toBeUndefined();
    expect(Object.hasOwn(bindings[1] ?? {}, 'providerPolicyOverride')).toBe(true);
    expect(bindings[1]?.providerPolicyOverride).toBeNull();
    expect(Object.hasOwn(bindings[2] ?? {}, 'providerPolicyOverride')).toBe(true);
    expect(bindings[2]?.providerPolicyOverride).toEqual(objectPolicy);
  });

  it('binds SQL NULL only for absence and JSON text for explicit null and object policies', async () => {
    const capability = createNodeCapabilityDefinition({
      capabilityId: 'capability.persistence',
      version: 1,
      domain: 'test',
      name: 'Policy persistence',
      description: 'Verifies provider policy presence persistence.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'completed' }],
      requiredEvidence: [{ type: 'provider_result' }],
      riskLevel: 'low',
      status: 'draft',
    });
    const query = vi.fn((statement: string, parameters?: readonly unknown[]) => {
      if (statement.includes('FROM sdar_control.configuration_command_receipt')) {
        if (parameters === undefined) throw new Error('RECEIPT_PARAMETERS_REQUIRED');
        return Promise.resolve({ rows: [] });
      }
      if (statement.includes('FROM sdar_control.node_capability_definition_version'))
        return Promise.resolve({ rows: [capabilityRow(capability)] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const repository = new PostgresNodeControlCapabilityRepository({
      connect: vi.fn(() => Promise.resolve(client)),
    } as unknown as Pool);
    const objectPolicy = { selection: 'required', marker: { intact: true } };
    const policies = [undefined, null, objectPolicy] as const;

    for (const [index, policy] of policies.entries())
      await repository.createImplementation(
        createCapabilityImplementationBinding({
          bindingId: `binding.${String(index)}`,
          capabilityId: capability.capabilityId,
          capabilityVersion: capability.version,
          implementationType: 'skill',
          implementationId: 'skill.persistence',
          implementationVersion: '1',
          role: 'primary',
          priority: index,
          ...(policy === undefined ? {} : { providerPolicyOverride: policy }),
          status: 'active',
          revision: 1,
        }),
        {
          actorId: 'unit-test',
          reason: 'Verify provider policy SQL encoding.',
          idempotencyKeyHash: String(index).padStart(64, '0'),
          requestHash: String(index + 1).padStart(64, '0'),
          occurredAt: '2026-08-11T01:00:00.000Z',
        },
      );

    const insertedPolicies = query.mock.calls
      .filter(([statement]) =>
        statement.includes('INSERT INTO sdar_control.capability_implementation_binding'),
      )
      .map(([, parameters]) => parameters?.[10]);
    expect(insertedPolicies).toEqual([null, 'null', JSON.stringify(objectPolicy)]);
  });
});

function bindingRow(
  bindingId: string,
  providerPolicyOverride: unknown,
  hasProviderPolicyOverride: boolean,
  priority: number,
) {
  return {
    binding_id: bindingId,
    capability_id: 'capability.persistence',
    capability_version: '1',
    implementation_type: 'skill' as const,
    implementation_id: 'skill.persistence',
    implementation_version: '1',
    role: 'primary' as const,
    priority,
    activation_condition: null,
    provider_policy_override: providerPolicyOverride,
    has_provider_policy_override: hasProviderPolicyOverride,
    status: 'active' as const,
    revision: '1',
  };
}

function capabilityRow(capability: ReturnType<typeof createNodeCapabilityDefinition>) {
  return {
    capability_id: capability.capabilityId,
    version: String(capability.version),
    domain: capability.domain,
    name: capability.name,
    description: capability.description,
    input_schema: capability.inputSchema,
    output_schema: capability.outputSchema,
    success_criteria: capability.successCriteria,
    required_evidence: capability.requiredEvidence,
    effects: capability.effects ?? [],
    artifacts: capability.artifacts ?? [],
    constraints: capability.constraints ?? [],
    supported_modes: capability.supportedModes ?? [],
    risk_level: capability.riskLevel,
    status: capability.status,
    definition_hash: capability.definitionHash,
    previous_version: null,
    created_by: null,
    created_at: null,
  };
}
