import { describe, expect, it } from 'vitest';

import {
  assertNodeCapabilityPublishable,
  createCapabilityImplementationBinding,
  createNodeCapabilityDefinition,
  hashNodeCapabilityDefinition,
  type NodeCapabilityDefinitionVersion,
} from '../src/index.js';

describe('P06 Node Capability authority', () => {
  it('computes a stable hash over business promises and not lifecycle status', () => {
    const draft = definition('draft');
    const reversed = {
      ...draft,
      inputSchema: { required: ['deviceId'], type: 'object' },
      status: 'validating' as const,
    };
    expect(hashNodeCapabilityDefinition(draft)).toBe(hashNodeCapabilityDefinition(reversed));
    expect(createNodeCapabilityDefinition(draft).definitionHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('requires evidence and an executable primary or alternative path before publish', () => {
    const validating = createNodeCapabilityDefinition(definition('validating'));
    expect(() => {
      assertNodeCapabilityPublishable(validating, []);
    }).toThrow('At least one active primary or alternative implementation is required.');
    const implementation = createCapabilityImplementationBinding({
      bindingId: 'binding.inspect.v1',
      capabilityId: validating.capabilityId,
      capabilityVersion: validating.version,
      implementationType: 'skill',
      implementationId: 'skill.inspect',
      implementationVersion: '1',
      role: 'primary',
      priority: 0,
      status: 'active',
      revision: 1,
    });
    expect(() => {
      assertNodeCapabilityPublishable(validating, [implementation]);
    }).not.toThrow();
  });

  it('rejects Resource as an implementation type', () => {
    expect(() => {
      createCapabilityImplementationBinding({
        bindingId: 'binding.resource',
        capabilityId: 'device.inspect',
        capabilityVersion: 1,
        implementationType: 'resource' as 'skill',
        implementationId: 'implementation.invalid',
        implementationVersion: '1',
        role: 'primary',
        priority: 0,
        status: 'active',
        revision: 1,
      });
    }).toThrow('implementationType must be skill or plan_template.');
  });
});

function definition(status: NodeCapabilityDefinitionVersion['status']) {
  return {
    capabilityId: 'device.inspect',
    version: 1,
    domain: 'device',
    name: 'Inspect device',
    description: 'Read and verify the current device condition.',
    inputSchema: { type: 'object', required: ['deviceId'] },
    outputSchema: { type: 'object', required: ['condition'] },
    successCriteria: [{ type: 'field_equals', field: 'verified', value: true }],
    requiredEvidence: [{ type: 'provider_result', field: 'condition' }],
    effects: ['device.condition_observed'],
    artifacts: ['inspection.report'],
    constraints: [{ type: 'authorization', level: 'read' }],
    supportedModes: ['interactive', 'queued'],
    riskLevel: 'low' as const,
    status,
    createdBy: 'p06-test',
    createdAt: '2026-08-02T00:00:00.000Z',
  };
}
