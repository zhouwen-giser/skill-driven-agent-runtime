import { describe, expect, it } from 'vitest';

import { createNodeCapabilityDefinition } from '../../../packages/node-control-domain/src/index.js';
import {
  buildPointCapabilitySuccessor,
  isPointProviderAuthorityCurrent,
} from '../src/ugv-point-navigation-authority-successor-driver.js';

describe('UGV point-navigation authority successor', () => {
  it('advances immutable lineage and replaces only the frozen Provider authority', () => {
    const prior = createNodeCapabilityDefinition({
      capabilityId: 'embodied.move',
      version: 4,
      previousVersion: 3,
      domain: 'embodied',
      name: 'Move to point',
      description: 'Move one vehicle to one exact WGS84 point.',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'goal_terminal' }],
      requiredEvidence: [{ type: 'vehicle.position.observation' }],
      constraints: [
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'ugv-smpp-real-integration-r2-binding',
          localServerId: 'ugv-smpp-real-integration-r2',
          mcpToolName: 'vehicle_navigate',
          bindingRevision: 1,
          catalogRevision: '2.0.0-rc.1:1',
          catalogChecksum: '6'.repeat(64),
        },
        { type: 'runtime_execution_mode_policy', allowedModes: ['live'] },
      ],
      supportedModes: ['procedure'],
      riskLevel: 'high',
      status: 'published',
      createdBy: 'existing-authority',
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    const binding = {
      bindingId: 'ugv-smpp-real-integration-r2-binding',
      localServerId: 'ugv-smpp-real-integration-r2',
      revision: 2,
      registryRevision: 2,
      registryChecksum: '1'.repeat(64),
      catalogRevision: '2.0.0-rc.1:2',
      catalogChecksum: 'a8748237d2f70036a5abf320db0637cb34e2b018cb200292a4adf25c22d3014a',
      operationCount: 10,
      status: 'active',
      availabilityStatus: 'available',
      availabilityValidUntil: '2026-09-01T02:00:00.000Z',
    } as const;
    const tool = {
      serverId: 'ugv-smpp-real-integration-r2',
      toolName: 'vehicle_navigate',
      taskExecutionProfile: { taskBehavior: 'task_required' },
      executionSemantics: {
        effect: 'side_effecting',
        execution: 'task_required',
        cancellation: 'supported',
        idempotency: 'required',
        replay: 'forbidden',
        source: 'provider_declared',
      },
    } as const;

    const successor = buildPointCapabilitySuccessor(prior, 5, binding, tool);
    const providerPolicy = successor.constraints?.find(
      (constraint) => constraint['type'] === 'provider_binding_policy',
    );

    expect(successor.version).toBe(5);
    expect(successor.previousVersion).toBe(4);
    expect(successor.status).toBe('draft');
    expect(successor.definitionHash).not.toBe(prior.definitionHash);
    expect(providerPolicy).toMatchObject({
      bindingRevision: 2,
      registryRevision: 2,
      catalogRevision: '2.0.0-rc.1:2',
      catalogChecksum: binding.catalogChecksum,
      fallback: 'deny',
    });
    expect(successor.constraints).toContainEqual({
      type: 'runtime_execution_mode_policy',
      allowedModes: ['live'],
    });
  });

  it('produces the same semantic hash when comparing the already-current version', () => {
    const current = createNodeCapabilityDefinition({
      capabilityId: 'embodied.move',
      version: 5,
      previousVersion: 4,
      domain: 'embodied',
      name: 'Move to point',
      description: 'Move one vehicle to one exact WGS84 point.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'goal_terminal' }],
      requiredEvidence: [{ type: 'vehicle.position.observation' }],
      constraints: [
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'binding-r2',
          localServerId: 'server-r2',
          mcpToolName: 'vehicle_navigate',
          allowedResourceIds: ['vehicle:ugv1'],
          bindingRevision: 2,
          registryRevision: 2,
          registryChecksum: '1'.repeat(64),
          catalogRevision: '2.0.0-rc.1:2',
          catalogChecksum: '2'.repeat(64),
          taskBehavior: 'task_required',
          executionSemantics: {
            effect: 'side_effecting',
            execution: 'task_required',
            cancellation: 'supported',
            idempotency: 'required',
            replay: 'forbidden',
            source: 'provider_declared',
          },
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
      ],
      riskLevel: 'high',
      status: 'published',
      createdBy: 'prior-run',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const currentAuthority = isPointProviderAuthorityCurrent(
      current,
      {
        bindingId: 'binding-r2',
        localServerId: 'server-r2',
        revision: 2,
        registryRevision: 2,
        registryChecksum: '1'.repeat(64),
        catalogRevision: '2.0.0-rc.1:2',
        catalogChecksum: '2'.repeat(64),
        operationCount: 10,
        status: 'active',
        availabilityStatus: 'available',
        availabilityValidUntil: '2026-09-01T02:00:00.000Z',
      },
      {
        serverId: 'server-r2',
        toolName: 'vehicle_navigate',
        taskExecutionProfile: { taskBehavior: 'task_required' },
        executionSemantics: {
          effect: 'side_effecting',
          execution: 'task_required',
          cancellation: 'supported',
          idempotency: 'required',
          replay: 'forbidden',
          source: 'provider_declared',
        },
      },
    );

    expect(currentAuthority).toBe(true);
  });
});
