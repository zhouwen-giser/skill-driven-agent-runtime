import { describe, expect, it, vi } from 'vitest';

import { createNodeCapabilityDefinition } from '../../node-control-domain/src/index.js';
import { NodeControlCapabilityService } from '../src/index.js';
import type {
  NodeControlCapabilityRepository,
  NodeControlCapabilitySchemaValidator,
} from '../src/ports.js';

describe('P06 Node Capability service', () => {
  it('resolves an exact active Plan Template Version through the authority port', async () => {
    const repository = memoryRepository();
    const exists = vi.fn(() => Promise.resolve(true));
    const service = new NodeControlCapabilityService({
      repository,
      catalog: { exists },
      schemas: validSchemas,
      clock: { now: () => '2026-08-02T02:00:00.000Z' },
      ids: { next: () => 'operation-p06' },
    });

    await expect(
      service.addImplementation({
        bindingId: 'binding.plan.p06',
        capabilityId: 'device.inspect.p06',
        capabilityVersion: 1,
        implementationType: 'plan_template',
        implementationId: 'artifact.plan.p06',
        implementationVersion: '7',
        role: 'alternative',
        priority: 10,
        status: 'active',
        revision: 1,
      }),
    ).resolves.toMatchObject({ implementationType: 'plan_template', implementationVersion: '7' });
    expect(exists).toHaveBeenCalledWith('plan_template', 'artifact.plan.p06', '7');
  });
});

const validSchemas: NodeControlCapabilitySchemaValidator = {
  checkSchema: () => ({ valid: true, errors: [] }),
};

function memoryRepository(): NodeControlCapabilityRepository {
  const capability = createNodeCapabilityDefinition({
    capabilityId: 'device.inspect.p06',
    version: 1,
    domain: 'device',
    name: 'Inspect device',
    description: 'Inspect a device.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    successCriteria: [{ type: 'completed' }],
    requiredEvidence: [{ type: 'provider_result' }],
    riskLevel: 'low',
    status: 'draft',
  });
  return {
    createDraft: (input) => Promise.resolve(input),
    find: () => Promise.resolve(capability),
    list: () => Promise.resolve([capability]),
    createImplementation: (binding) => Promise.resolve(binding),
    listImplementations: () => Promise.resolve([]),
    validate: (_prior, validating) => Promise.resolve(validating),
    findCommandReplay: () => Promise.resolve(undefined),
    transition: (_prior, _next, operation) => Promise.resolve(operation),
  };
}
