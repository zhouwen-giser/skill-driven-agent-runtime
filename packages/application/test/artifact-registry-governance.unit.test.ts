import { describe, expect, it, vi } from 'vitest';

import {
  ArtifactOutboxConsumer,
  ArtifactRegistryProjectionEventHandler,
  ArtifactRegistryService,
  ConfiguredOperatorIdentityPort,
  InMemoryArtifactActiveIndexProjection,
  artifactIndexEntryCacheKey,
  parseArtifactFeatureFlags,
  type ArtifactIndexEntry,
  type ArtifactOutboxConsumerRepository,
  type ArtifactOutboxCursor,
  type ArtifactOutboxEvent,
  type ArtifactRepository,
} from '../src/index.js';

const INDEX_ENTRY: ArtifactIndexEntry = Object.freeze({
  artifactId: 'artifact.plan.inspect.1',
  artifactKey: 'plan.inspect',
  artifactVersion: 1,
  artifactType: 'plan_template',
  tenantId: 'tenant-a',
  domain: 'operations',
  riskLevel: 'medium',
  contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  dependencySnapshot: Object.freeze({
    capabilityCatalogHash:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    policyVersionRefs: Object.freeze(['policy.read_only@1.0']),
    taskTypeVersionRefs: Object.freeze(['task_type.inspect@1']),
    schemaVersionRefs: Object.freeze(['artifact.contract@1.1']),
    requiredSkillVersionRefs: Object.freeze([]),
    compilerVersion: 'compiler.1.0',
  }),
  pointerLockVersion: 1,
  activatedAt: '2026-07-26T00:00:00.000Z',
});

describe('ArtifactRegistryService', () => {
  it('loads from PostgreSQL authority, caches, invalidates dependencies and rebuilds', async () => {
    const findActiveIndex = vi.fn().mockResolvedValue(Object.freeze([INDEX_ENTRY]));
    const repository = {
      findActiveIndex,
      getDefinition: vi.fn(),
      saveCandidate: vi.fn(),
      activate: vi.fn(),
      deprecate: vi.fn(),
    } satisfies ArtifactRepository;
    const service = new ArtifactRegistryService({
      repository,
      projection: new InMemoryArtifactActiveIndexProjection(),
    });

    await expect(service.queryActiveIndex({ tenantId: 'tenant-a' })).resolves.toEqual([
      INDEX_ENTRY,
    ]);
    await expect(service.queryActiveIndex({ tenantId: 'tenant-a' })).resolves.toEqual([
      INDEX_ENTRY,
    ]);
    expect(findActiveIndex).toHaveBeenCalledTimes(1);
    await service.queryActiveIndex({ tenantId: 'tenant-b' });
    expect(findActiveIndex).toHaveBeenCalledTimes(2);

    await service.invalidateDependency('policy.read_only@1.0');
    await service.queryActiveIndex({ tenantId: 'tenant-a' });
    expect(findActiveIndex).toHaveBeenCalledTimes(3);

    await expect(service.rebuildProjection()).resolves.toEqual([INDEX_ENTRY]);
    expect(findActiveIndex).toHaveBeenCalledTimes(4);
    expect(artifactIndexEntryCacheKey(INDEX_ENTRY)).toContain('policy.read_only@1.0');
  });

  it('parses only the frozen feature-flag vocabulary', () => {
    expect(
      parseArtifactFeatureFlags({
        SDAR_V13_ARTIFACT_MODE: 'advisory',
        SDAR_V13_TEMPLATE_ENABLED: 'true',
        SDAR_V13_TENANT_ALLOWLIST: 'tenant-a, tenant-b',
      }),
    ).toEqual(
      expect.objectContaining({
        artifactMode: 'advisory',
        templateEnabled: true,
        ruleEnabled: false,
      }),
    );
    expect(() => parseArtifactFeatureFlags({ SDAR_V13_ARTIFACT_MODE: 'unbounded' })).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_FEATURE_FLAG_INVALID' }),
    );
    expect(() => parseArtifactFeatureFlags({ SDAR_V13_RULE_ENABLED: '1' })).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_FEATURE_FLAG_INVALID' }),
    );
  });
});

describe('Artifact Outbox projection consumer', () => {
  it('advances a durable cursor only after idempotent projection handling', async () => {
    const event = Object.freeze({
      eventId: 'artifact-event-1',
      eventType: 'artifact.activated',
      aggregateId: INDEX_ENTRY.artifactId,
      aggregateVersion: 1,
      payload: Object.freeze({ artifactId: INDEX_ENTRY.artifactId }),
      occurredAt: '2026-07-26T00:00:00.000Z',
    }) satisfies ArtifactOutboxEvent;
    const repository = new InMemoryArtifactOutboxRepository([event]);
    const rebuildProjection = vi.fn().mockResolvedValue([]);
    const handler = new ArtifactRegistryProjectionEventHandler({
      invalidateDependency: vi.fn(),
      rebuildProjection,
    });
    const consumer = new ArtifactOutboxConsumer({
      consumerName: 'artifact-active-index',
      repository,
      handler,
      clock: { now: () => '2026-07-26T00:01:00.000Z' },
    });

    await expect(consumer.consume()).resolves.toBe(1);
    await expect(consumer.consume()).resolves.toBe(0);
    await handler.apply(event);
    expect(rebuildProjection).toHaveBeenCalledTimes(1);
    await expect(repository.loadCursor('artifact-active-index')).resolves.toEqual({
      lastEventId: event.eventId,
      version: 1,
    });
  });
});

describe('ConfiguredOperatorIdentityPort', () => {
  it('fails closed in production without an external identity provider', () => {
    expect(() => new ConfiguredOperatorIdentityPort({ environment: 'production' })).toThrow(
      expect.objectContaining({ code: 'OPERATOR_IDENTITY_PROVIDER_REQUIRED' }),
    );
  });

  it('requires explicit local identity and enforces RBAC and tenant scope', async () => {
    const identityPort = new ConfiguredOperatorIdentityPort({ environment: 'test' });
    await expect(identityPort.requireIdentity({})).rejects.toMatchObject({
      code: 'OPERATOR_IDENTITY_REQUIRED',
    });
    const identity = await identityPort.requireIdentity({
      operatorId: 'operator-a',
      tenantId: 'tenant-a',
      permissions: ['artifact.approve'],
    });
    await expect(
      identityPort.requirePermission(identity, 'artifact.approve'),
    ).resolves.toBeUndefined();
    await expect(
      identityPort.requirePermission(identity, 'artifact.activate'),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_PERMISSION_DENIED',
    });
    await expect(identityPort.getTenantScope(identity)).resolves.toBe('tenant-a');
  });
});

class InMemoryArtifactOutboxRepository implements ArtifactOutboxConsumerRepository {
  readonly #events: readonly ArtifactOutboxEvent[];
  #cursor: ArtifactOutboxCursor = { version: 0 };

  constructor(events: readonly ArtifactOutboxEvent[]) {
    this.#events = events;
  }

  loadCursor(_consumerName: string): Promise<ArtifactOutboxCursor> {
    void _consumerName;
    return Promise.resolve(this.#cursor);
  }

  readAfter(lastEventId: string | undefined): Promise<readonly ArtifactOutboxEvent[]> {
    const index =
      lastEventId === undefined
        ? 0
        : this.#events.findIndex((event) => event.eventId === lastEventId) + 1;
    return Promise.resolve(Object.freeze(this.#events.slice(index)));
  }

  advanceCursor(_consumerName: string, expectedVersion: number, eventId: string): Promise<void> {
    if (this.#cursor.version !== expectedVersion) {
      return Promise.reject(new Error('ARTIFACT_OUTBOX_CURSOR_CAS_CONFLICT'));
    }
    this.#cursor = Object.freeze({ lastEventId: eventId, version: expectedVersion + 1 });
    return Promise.resolve();
  }
}
