import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NodeControlFoundationService,
  NodeControlConfigurationService,
  type ConfigurationReference,
  type NodeControlConfigurationRepository,
  type NodeControlFoundationRepository,
} from '../../../packages/node-control-application/src/index.js';
import type {
  ControlAuditEvent,
  ConfigurationRevision,
  ManagementOperation,
  NodeProfile,
} from '../../../packages/node-control-domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { createNodeControlHttpApp } from '../src/http-endpoint.js';

const token = 'p01-node-control-contract-token-0000000000000000';
let server: Server | undefined;

afterEach(async () => {
  if (server !== undefined) await close(server);
  server = undefined;
});

describe('Node Control HTTP frozen contract', () => {
  it('exposes public liveness/discovery and authenticated Node/Audit projections', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-01T17:00:00.000Z' },
      ids: { next: () => 'audit-p01' },
    });
    await service.bootstrapNodeProfile({
      nodeId: 'node-p01',
      nodeType: 'sdar-runtime',
      displayName: 'P01 Node',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-01T17:00:00.000Z' },
      ids: { next: () => 'operation-p01' },
    });
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
    });
    server = await listen(app);
    const baseUrl = address(server);

    await expect(json(`${baseUrl}/health/live`)).resolves.toMatchObject({ status: 'live' });
    await expect(json(`${baseUrl}/.well-known/sdar-node`)).resolves.toMatchObject({
      schemaVersion: '1.0',
      nodeId: 'node-p01',
      contractVersions: { nodeControlApi: '1.0.0', nodeEvents: '1.0.0' },
    });

    const unauthenticated = await fetch(`${baseUrl}/api/v1/node`);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('content-type')).toContain('application/problem+json');
    await expect(unauthenticated.json()).resolves.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    });

    const profile = await json(`${baseUrl}/api/v1/node`, true);
    const profileSchema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/node-profile.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(profileSchema, profile)).toEqual({
      valid: true,
      errors: [],
    });
    await expect(json(`${baseUrl}/api/v1/node/health`, true)).resolves.toMatchObject({
      nodeId: 'node-p01',
      status: 'degraded',
    });
    await expect(json(`${baseUrl}/api/v1/audit-events`, true)).resolves.toMatchObject({
      items: [expect.objectContaining({ action: 'node.profile.bootstrap' })],
      totalEstimate: 1,
    });
  });
});

class MemoryRepository implements NodeControlFoundationRepository {
  profile: NodeProfile | undefined;
  readonly audits: ControlAuditEvent[] = [];

  migrate(): Promise<void> {
    return Promise.resolve();
  }
  probe(): Promise<boolean> {
    return Promise.resolve(true);
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

class MemoryConfigurationRepository implements NodeControlConfigurationRepository {
  createDraft(): Promise<ConfigurationRevision> {
    return Promise.reject(new Error('NOT_USED'));
  }
  find(): Promise<ConfigurationRevision | undefined> {
    return Promise.resolve(undefined);
  }
  list(): Promise<readonly ConfigurationRevision[]> {
    return Promise.resolve([]);
  }
  validate(): Promise<ConfigurationRevision> {
    return Promise.reject(new Error('NOT_USED'));
  }
  publish(): Promise<
    Readonly<{ revision: ConfigurationRevision; operation: ManagementOperation }>
  > {
    return Promise.reject(new Error('NOT_USED'));
  }
  rollback(): Promise<
    Readonly<{ revision: ConfigurationRevision; operation: ManagementOperation }>
  > {
    return Promise.reject(new Error('NOT_USED'));
  }
  latestPublished(): Promise<ConfigurationRevision | undefined> {
    return Promise.resolve(undefined);
  }
  acknowledge(): Promise<ConfigurationRevision> {
    return Promise.reject(new Error('NOT_USED'));
  }
  activeConfigurationRefs(): Promise<readonly ConfigurationReference[]> {
    return Promise.resolve([]);
  }
}

function listen(app: ReturnType<typeof createNodeControlHttpApp>): Promise<Server> {
  return new Promise((resolve, reject) => {
    const candidate = createServer(app);
    candidate.once('error', reject);
    candidate.listen(0, '127.0.0.1', () => {
      resolve(candidate);
    });
  });
}

function address(candidate: Server): string {
  const value = candidate.address();
  if (value === null || typeof value === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return `http://127.0.0.1:${String(value.port)}`;
}

async function json(url: string, authenticated = false): Promise<unknown> {
  const response = await fetch(url, {
    ...(authenticated ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });
  expect(response.status).toBe(200);
  return response.json();
}

function close(candidate: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    candidate.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
