import { describe, expect, it } from 'vitest';

import type {
  ControlAuditEvent,
  ManagementOperation,
  NodeProfile,
} from '../../node-control-domain/src/index.js';
import {
  NodeControlFoundationService,
  type NodeControlFoundationRepository,
} from '../src/index.js';

class MemoryFoundationRepository implements NodeControlFoundationRepository {
  profile: NodeProfile | undefined;
  audits: ControlAuditEvent[] = [];
  ready = true;

  migrate(): Promise<void> {
    return Promise.resolve();
  }
  probe(): Promise<boolean> {
    return Promise.resolve(this.ready);
  }
  findNodeProfile(): Promise<NodeProfile | undefined> {
    return Promise.resolve(this.profile);
  }
  bootstrapNodeProfile(profile: NodeProfile, audit: ControlAuditEvent): Promise<boolean> {
    if (this.profile !== undefined) return Promise.resolve(false);
    this.profile = profile;
    this.audits.push(audit);
    return Promise.resolve(true);
  }
  listManagementOperations(): Promise<readonly ManagementOperation[]> {
    return Promise.resolve([]);
  }
  findManagementOperation(): Promise<ManagementOperation | undefined> {
    return Promise.resolve(undefined);
  }
  listAuditEvents(): Promise<readonly ControlAuditEvent[]> {
    return Promise.resolve(this.audits);
  }
}

describe('NodeControlFoundationService', () => {
  it('bootstraps one stable Node identity and records an audit event', async () => {
    const repository = new MemoryFoundationRepository();
    const service = serviceFor(repository);
    const input = {
      nodeId: 'node-1',
      nodeType: 'sdar-runtime',
      displayName: 'Node One',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    };
    await expect(service.bootstrapNodeProfile(input)).resolves.toMatchObject({ nodeId: 'node-1' });
    await service.bootstrapNodeProfile(input);
    expect(repository.audits).toHaveLength(1);
  });

  it('reports not-ready without a profile and degraded health before P02 runtime control', async () => {
    const repository = new MemoryFoundationRepository();
    const service = serviceFor(repository);
    await expect(service.getReadiness()).resolves.toMatchObject({ status: 'not_ready' });
    await service.bootstrapNodeProfile({
      nodeId: 'node-1',
      nodeType: 'sdar-runtime',
      displayName: 'Node One',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    });
    await expect(service.getNodeHealth()).resolves.toMatchObject({
      status: 'degraded',
      components: expect.arrayContaining([
        expect.objectContaining({
          component: 'runtime_control',
          status: 'disabled',
          reasonCode: 'P02_RUNTIME_CONTROL_NOT_CONFIGURED',
        }),
      ]),
    });
  });
});

function serviceFor(repository: MemoryFoundationRepository): NodeControlFoundationService {
  return new NodeControlFoundationService({
    repository,
    clock: { now: () => '2026-08-01T17:00:00.000Z' },
    ids: { next: () => 'audit-1' },
  });
}
