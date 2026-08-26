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
  type NodeCapabilityStatus,
  type RuntimeAgentCardCandidate,
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
      capabilities: {
        get: () => Promise.reject(new Error('UNIT_UNEXPECTED_CAPABILITY_READ')),
        hasPublishedImplementation: () =>
          Promise.reject(new Error('UNIT_UNEXPECTED_IMPLEMENTATION_READ')),
      },
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
        hasPublishedImplementation: () => Promise.resolve(true),
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

  it('keeps registered declarations and their hashes stable without reading readiness or its TTL', async () => {
    const fixture = publicationFixture();

    await fixture.service.rebuild('registered-card-first', 'Publish registered Skill.');
    const original = fixture.candidates[0];
    expect(original).toBeDefined();
    expect(original?.card).toMatchObject({
      skills: [{ id: 'capability.device.inspect', tags: ['capability:device.inspect'] }],
    });
    expect(JSON.stringify(original?.card)).not.toMatch(/readiness|validUntil|snapshotHash/u);

    // Time can advance far beyond every Provider/readiness lease without changing registration.
    fixture.setNow('2027-08-02T15:00:00.000Z');
    await fixture.service.rebuild('registered-card-after-ttl', 'Recheck registered Skill.');

    expect(fixture.candidates).toHaveLength(1);
    expect(fixture.stage).toHaveBeenCalledOnce();
    expect(fixture.active()).toMatchObject({
      revision: original?.revision.revision,
      contentHash: original?.revision.contentHash,
      capabilityCatalogHash: original?.revision.capabilityCatalogHash,
    });
  });

  it('removes explicitly disabled Skills but not merely unhealthy Providers', async () => {
    const fixture = publicationFixture();
    await fixture.service.rebuild('registered-enabled-card', 'Publish enabled Skill.');
    expect(fixture.candidates[0]?.card['skills']).toHaveLength(1);

    fixture.setRegistered(false);
    await fixture.service.rebuild('registered-disabled-card', 'Reflect explicit Skill disable.');

    expect(fixture.candidates[1]?.card['skills']).toEqual([]);
    expect(fixture.candidates[1]?.revision.exposureRefs).toEqual([]);
    expect(fixture.active()?.revision).toBe(2);
  });

  it.each(['draft', 'validating', 'suspended', 'deprecated', 'retired'] as const)(
    'does not publish a %s Capability even when its Skill is registered',
    async (status) => {
      const fixture = publicationFixture();
      fixture.setCapabilityStatus(status);

      await fixture.service.rebuild(`registered-${status}-card`, 'Check publication lifecycle.');

      expect(fixture.candidates[0]?.card['skills']).toEqual([]);
      expect(fixture.candidates[0]?.revision.exposureRefs).toEqual([]);
    },
  );

  it('removes an explicitly withdrawn Exposure on the next registration rebuild', async () => {
    const fixture = publicationFixture();
    await fixture.service.rebuild('registered-exposure-enabled', 'Publish Exposure.');
    fixture.withdrawExposure();

    await fixture.service.rebuild('registered-exposure-withdrawn', 'Withdraw Exposure.');

    expect(fixture.candidates[1]?.card['skills']).toEqual([]);
    expect(fixture.candidates[1]?.revision.exposureRefs).toEqual([]);
  });

  it('periodically reconciles registration without writing a revision or receipt for unchanged state', async () => {
    const fixture = publicationFixture();

    await expect(fixture.service.reconcileRegistration()).resolves.toEqual({ changed: true });
    fixture.setNow('2027-08-02T15:00:00.000Z');
    await expect(fixture.service.reconcileRegistration()).resolves.toEqual({ changed: false });
    await expect(fixture.service.reconcileRegistration()).resolves.toEqual({ changed: false });

    expect(fixture.candidates).toHaveLength(1);
    expect(fixture.stage).toHaveBeenCalledOnce();
    expect(fixture.transitionOperation).toHaveBeenCalledOnce();
  });

  it('does not take over the public Card when no managed Exposure or active Card exists yet', async () => {
    const fixture = publicationFixture();
    fixture.withdrawExposure();

    await expect(fixture.service.reconcileRegistration()).resolves.toEqual({ changed: false });

    expect(fixture.candidates).toEqual([]);
    expect(fixture.stage).not.toHaveBeenCalled();
    expect(fixture.transitionOperation).not.toHaveBeenCalled();
    expect(fixture.validate).not.toHaveBeenCalled();
  });

  it('re-publishes a re-enabled declaration with a fresh idempotency identity after A to B to A', async () => {
    const fixture = publicationFixture();

    await fixture.service.reconcileRegistration();
    fixture.setRegistered(false);
    await fixture.service.reconcileRegistration();
    fixture.setRegistered(true);
    await fixture.service.reconcileRegistration();

    expect(fixture.candidates).toHaveLength(3);
    expect(fixture.candidates[2]?.revision.contentHash).toBe(
      fixture.candidates[0]?.revision.contentHash,
    );
    expect(fixture.candidates[2]?.revision.capabilityCatalogHash).toBe(
      fixture.candidates[0]?.revision.capabilityCatalogHash,
    );
    const keys = fixture.stage.mock.calls.map(([, command]) => command.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(fixture.active()?.revision).toBe(3);
  });

  it('retries a failed registration deployment with the last attempted revision in its identity', async () => {
    const fixture = publicationFixture();
    fixture.stage.mockRejectedValueOnce(new Error('RUNTIME_CARD_UNREACHABLE'));

    await expect(fixture.service.reconcileRegistration()).rejects.toThrow(
      'AGENT_CARD_REGISTRATION_APPLY_FAILED',
    );
    await expect(fixture.service.reconcileRegistration()).resolves.toEqual({ changed: true });

    const keys = fixture.stage.mock.calls.map(([, command]) => command.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(fixture.active()?.revision).toBe(2);
  });
});

function publicationFixture() {
  let now = '2026-08-02T15:00:00.000Z';
  let registered = true;
  let published = true;
  let capabilityStatus: NodeCapabilityStatus = 'published';
  let nextRevision = 0;
  let active: AgentCardRevision | undefined;
  const candidates: RuntimeAgentCardCandidate[] = [];
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
  const transitionOperation = vi.fn<NodeControlA2aExposureRepository['transitionOperation']>(
    (_operation, _command, completed) => Promise.resolve(completed),
  );
  const repository: NodeControlA2aExposureRepository = {
    find: () => Promise.resolve(exposure),
    list: () => Promise.resolve([exposure]),
    create: (value) => Promise.resolve(value),
    findCommandReplay: () => Promise.resolve(undefined),
    transition: (_prior, _next, operation) => Promise.resolve(operation),
    listPublished: () => Promise.resolve(published ? [exposure] : []),
    nextAgentCardRevision: () => Promise.resolve((nextRevision += 1)),
    findActiveAgentCard: () => Promise.resolve(active),
    saveCandidate: (value) => {
      candidates.push(value);
      return Promise.resolve(value.revision);
    },
    markAgentCard: (revision, status, activatedAt) => {
      const candidate = candidates.find((value) => value.revision.revision === revision);
      if (candidate === undefined) throw new Error('UNIT_AGENT_CARD_CANDIDATE_NOT_FOUND');
      const updated = {
        ...candidate.revision,
        status,
        ...(activatedAt === undefined ? {} : { activatedAt }),
      };
      if (status === 'active') active = updated;
      return Promise.resolve(updated);
    },
    listAgentCards: () => Promise.resolve([...candidates].reverse().map((value) => value.revision)),
    findAgentCard: () => Promise.resolve(active),
    transitionOperation,
  };
  const stage = vi.fn<RuntimeAgentCardDeployment['stage']>(() => Promise.resolve());
  const validate = vi.fn(() => undefined);
  const service = new NodeControlA2aExposureService({
    repository,
    runtime: {
      stage,
      activate: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    },
    capabilities: {
      get: () =>
        Promise.resolve(
          createNodeCapabilityDefinition({
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
            status: capabilityStatus,
          }),
        ),
      hasPublishedImplementation: () => Promise.resolve(registered),
    },
    validator: { validate },
    clock: { now: () => now },
    nodeId: 'node.test',
    a2aUrl: 'http://127.0.0.1:9999/a2a',
  });
  return {
    service,
    candidates,
    stage,
    transitionOperation,
    validate,
    active: () => active,
    setNow(value: string) {
      now = value;
    },
    setRegistered(value: boolean) {
      registered = value;
    },
    setCapabilityStatus(value: NodeCapabilityStatus) {
      capabilityStatus = value;
    },
    withdrawExposure() {
      published = false;
    },
  };
}
