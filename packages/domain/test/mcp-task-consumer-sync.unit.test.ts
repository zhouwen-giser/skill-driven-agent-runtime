import { describe, expect, it } from 'vitest';

import {
  createMcpLogicalInvocationIdentity,
  createRemoteTaskProviderExecutionLink,
} from '../src/index.js';

describe('MCP Task consumer sync domain', () => {
  it('derives one restart-stable logical invocation identity from immutable authority', () => {
    const first = createMcpLogicalInvocationIdentity(identityInput());
    const replay = createMcpLogicalInvocationIdentity(identityInput());
    expect(replay).toEqual(first);
    expect(first.logicalInvocationId).toMatch(/^mcp-logical-[a-f0-9]{64}$/u);
    expect(first.identityHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      createMcpLogicalInvocationIdentity({ ...identityInput(), workflowNodeRunId: 'node-run-2' }),
    ).not.toEqual(first);
  });

  it('keeps Provider execution and optional Mission identity separate', () => {
    const unresolved = createRemoteTaskProviderExecutionLink({
      bindingId: 'binding-1',
      logicalInvocationId: 'mcp-logical-1',
      remoteTaskId: 'remote-task-1',
      providerId: 'provider-1',
      runtimeServerId: 'runtime-server-1',
      operationName: 'vehicle_navigate',
      executionStatus: 'unresolved',
      missionStatus: 'unresolved',
      provenance: 'committed_receipt',
      sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
      sourceRevision: 'runtime:1/catalog:1',
      observedAt: '2026-08-31T06:32:42.000Z',
    });
    expect(unresolved).not.toHaveProperty('externalExecutionId');
    expect(unresolved).not.toHaveProperty('deviceMissionId');

    const exact = createRemoteTaskProviderExecutionLink({
      ...unresolved,
      executionStatus: 'exact',
      externalExecutionId: 'execution-1',
      missionStatus: 'exact',
      deviceMissionId: 'mission-1',
      provenance: 'reconcile_found_exact',
    });
    expect(exact.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects fabricated external or Mission identity', () => {
    expect(() =>
      createRemoteTaskProviderExecutionLink({
        bindingId: 'binding-1',
        logicalInvocationId: 'mcp-logical-1',
        remoteTaskId: 'remote-task-1',
        providerId: 'provider-1',
        runtimeServerId: 'runtime-server-1',
        operationName: 'vehicle_navigate',
        executionStatus: 'unresolved',
        externalExecutionId: 'fabricated',
        missionStatus: 'unresolved',
        provenance: 'committed_receipt',
        sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
        sourceRevision: 'runtime:1/catalog:1',
        observedAt: '2026-08-31T06:32:42.000Z',
      }),
    ).toThrow(/externalExecutionId/u);
    expect(() =>
      createRemoteTaskProviderExecutionLink({
        bindingId: 'binding-1',
        logicalInvocationId: 'mcp-logical-1',
        remoteTaskId: 'remote-task-1',
        providerId: 'provider-1',
        runtimeServerId: 'runtime-server-1',
        operationName: 'vehicle_navigate',
        executionStatus: 'unresolved',
        missionStatus: 'exact',
        deviceMissionId: 'fabricated',
        provenance: 'committed_receipt',
        sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
        sourceRevision: 'runtime:1/catalog:1',
        observedAt: '2026-08-31T06:32:42.000Z',
      }),
    ).toThrow(/Mission/u);
  });
});

function identityInput() {
  return {
    taskId: 'task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'definition-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'node-run-1',
    serverId: 'server-1',
    providerBindingId: 'binding-provider-1',
    providerId: 'provider-1',
    operationName: 'vehicle_navigate',
    argumentsHash: 'a'.repeat(64),
    executionContext: { mode: 'simulation' as const, simulationId: 'sim-1' },
  };
}
