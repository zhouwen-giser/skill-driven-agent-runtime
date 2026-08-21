import { describe, expect, it, vi } from 'vitest';

import {
  NodeControlA2aExposureService,
  type NodeControlA2aExposureRepository,
  type RuntimeAgentCardDeployment,
} from '../src/a2a-exposure-service.js';
import {
  createA2aExposureVersion,
  createNodeCapabilityDefinition,
  type AgentCardRevision,
  type ManagementOperation,
} from '../../node-control-domain/src/index.js';

describe('NodeControlA2aExposureService', () => {
  it('serializes every managed Card rebuild in the single Node Control process', async () => {
    const now = '2026-08-02T15:00:00.000Z';
    let releaseFirstList: ((value: readonly never[]) => void) | undefined;
    const firstList = new Promise<readonly never[]>((resolve) => {
      releaseFirstList = resolve;
    });
    let listCalls = 0;
    let nextRevision = 0;
    let candidate: AgentCardRevision | undefined;
    let active: AgentCardRevision | undefined;
    const repository: NodeControlA2aExposureRepository = {
      find: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      create: (value) => Promise.resolve(value),
      findCommandReplay: () => Promise.resolve(undefined),
      transition: (_prior, _next, operation) => Promise.resolve(operation),
      listPublished: () => {
        listCalls += 1;
        return listCalls === 1 ? firstList : Promise.resolve([]);
      },
      nextAgentCardRevision: () => Promise.resolve((nextRevision += 1)),
      findActiveAgentCard: () => Promise.resolve(active),
      saveCandidate: (value) => {
        candidate = value.revision;
        return Promise.resolve(value.revision);
      },
      markAgentCard: (_revision, status, activatedAt) => {
        const updated = {
          ...(candidate ?? active),
          status,
          ...(activatedAt === undefined ? {} : { activatedAt }),
        } as AgentCardRevision;
        if (status === 'active') active = updated;
        return Promise.resolve(updated);
      },
      listAgentCards: () => Promise.resolve(active === undefined ? [] : [active]),
      findAgentCard: () => Promise.resolve(active),
      transitionOperation: (_operation, _command, completed) => Promise.resolve(completed),
    };
    const service = new NodeControlA2aExposureService({
      repository,
      runtime: {
        stage: () => Promise.resolve(),
        activate: () => Promise.resolve(),
        rollback: () => Promise.resolve(),
      },
      capabilities: { get: () => Promise.reject(new Error('UNIT_UNEXPECTED_CAPABILITY_READ')) },
      readiness: { get: () => Promise.reject(new Error('UNIT_UNEXPECTED_READINESS_READ')) },
      validator: { validate: () => undefined },
      clock: { now: () => now },
      nodeId: 'node.test',
      a2aUrl: 'http://127.0.0.1:9999/a2a',
    });

    const first = service.rebuild('p08-serialized-card-first', 'First rebuild.');
    await vi.waitFor(() => {
      expect(listCalls).toBe(1);
    });
    const second = service.rebuild('p08-serialized-card-second', 'Second rebuild.');
    await Promise.resolve();
    expect(listCalls).toBe(1);
    releaseFirstList?.([]);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(listCalls).toBe(2);
  });

  it('rolls Runtime back to the prior Active card when the Control ack fails', async () => {
    const now = '2026-08-02T15:00:00.000Z';
    const exposure = createA2aExposureVersion({
      exposureId: 'exposure.inspect',
      version: 1,
      capabilityId: 'device.inspect',
      capabilityVersion: 1,
      agentSkillId: 'capability.device.inspect',
      name: 'Inspect device',
      description: 'Inspect a declared device.',
      requestSchema: { type: 'object' },
      resultSchema: { type: 'object' },
      visibility: 'public',
      readinessPublicationPolicy: 'publish_when_available',
      status: 'published',
    });
    const prior: AgentCardRevision = {
      revision: 1,
      nodeId: 'node.test',
      contentHash: 'a'.repeat(64),
      capabilityCatalogHash: 'b'.repeat(64),
      status: 'active',
      generatedAt: now,
      activatedAt: now,
    };
    const rollbackCalls: [number, number | undefined][] = [];
    const statusChanges: AgentCardRevision['status'][] = [];
    let candidate: AgentCardRevision | undefined;
    const capability = createNodeCapabilityDefinition({
      capabilityId: 'device.inspect',
      version: 1,
      domain: 'device',
      name: 'Inspect device',
      description: 'Inspect a declared device.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'field_equals', field: 'verified', value: true }],
      requiredEvidence: [{ type: 'provider_result', field: 'condition' }],
      riskLevel: 'low',
      status: 'published',
    });
    const repository: NodeControlA2aExposureRepository = {
      find: () => Promise.resolve(exposure),
      list: () => Promise.resolve([exposure]),
      create: (value) => Promise.resolve(value),
      findCommandReplay: () => Promise.resolve(undefined),
      transition: (_prior, _next, operation) => Promise.resolve(operation),
      listPublished: () => Promise.resolve([exposure]),
      nextAgentCardRevision: () => Promise.resolve(2),
      findActiveAgentCard: () => Promise.resolve(prior),
      saveCandidate: (value) => {
        candidate = value.revision;
        return Promise.resolve(value.revision);
      },
      markAgentCard: (_revision, status, activatedAt, rejectionCode) => {
        statusChanges.push(status);
        if (status === 'active') return Promise.reject(new Error('CONTROL_ACK_FAILED'));
        return Promise.resolve({
          ...(candidate ?? prior),
          status,
          ...(activatedAt === undefined ? {} : { activatedAt }),
          ...(rejectionCode === undefined ? {} : { rejectionCode }),
        });
      },
      listAgentCards: () => Promise.resolve([prior]),
      findAgentCard: () => Promise.resolve(prior),
      transitionOperation: (_operation, _command, completed) => Promise.resolve(completed),
    };
    const runtime: RuntimeAgentCardDeployment = {
      stage: () => Promise.resolve(),
      activate: () => Promise.resolve(),
      rollback: (revision, priorRevision) => {
        rollbackCalls.push([revision, priorRevision]);
        return Promise.resolve();
      },
    };
    const service = new NodeControlA2aExposureService({
      repository,
      runtime,
      capabilities: {
        get: () => Promise.resolve(capability),
      },
      readiness: {
        get: () =>
          Promise.resolve({
            snapshot: {
              status: 'available',
              snapshotVersion: 1,
              validUntil: '2026-08-02T16:00:00.000Z',
            },
            snapshotHash: 'd'.repeat(64),
          }),
      },
      validator: { validate: () => undefined },
      clock: { now: () => now },
      nodeId: 'node.test',
      a2aUrl: 'http://127.0.0.1:9999/a2a',
    });

    const operation = await service.rebuild('p08-rollback-control-ack', 'Exercise rollback.');

    expect(operation).toMatchObject<Partial<ManagementOperation>>({
      status: 'failed',
      errorCode: 'CONTROL_ACK_FAILED',
      result: { revision: 2, status: 'rejected', rejectionCode: 'CONTROL_ACK_FAILED' },
    });
    expect(statusChanges).toEqual(['staged', 'active', 'rejected']);
    expect(rollbackCalls).toEqual([[2, 1]]);
  });
});
