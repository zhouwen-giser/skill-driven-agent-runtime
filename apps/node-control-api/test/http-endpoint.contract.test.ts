import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NodeControlFoundationService,
  NodeControlConfigurationService,
  NodeControlRuntimeGovernanceService,
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
import {
  createManagementOperation,
  transitionManagementOperation,
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

  it('proxies frozen Skill and Plan Template governance without copying content authority', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-02T00:00:00.000Z' },
      ids: { next: () => 'audit-p10' },
    });
    await service.bootstrapNodeProfile({
      nodeId: 'node-p10',
      nodeType: 'sdar-runtime',
      displayName: 'P10 Node',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-02T00:00:00.000Z' },
      ids: { next: () => 'operation-p10' },
    });
    let runtimeCommands = 0;
    let runtimePlanTarget: string | undefined;
    let runtimePlanArtifactKey: unknown;
    let runtimePlanLookups = 0;
    const runtimeGovernance = new NodeControlRuntimeGovernanceService({
      runtime: {
        listSkills: () => Promise.resolve([skillView(), skillView('skill.p10.second')]),
        listSkillVersions: () => Promise.resolve([skillView()]),
        getSkillVersion: () => Promise.resolve(skillView()),
        listPlanTemplates: () => {
          runtimePlanLookups += 1;
          return Promise.resolve([planTemplateView()]);
        },
        importSkill: (command) => Promise.resolve(runtimeOperation('skill.import', command.reason)),
        governSkill: (_operation, _skillId, _version, command) => {
          runtimeCommands += 1;
          return Promise.resolve(runtimeOperation('skill.publish', command.reason));
        },
        governPlanTemplate: (_operation, artifactId, _version, command) => {
          runtimePlanTarget = artifactId;
          runtimePlanArtifactKey = (command.payload as Record<string, unknown>)['artifactKey'];
          return Promise.resolve(runtimeOperation('plan-template.publish', command.reason));
        },
      },
      operations: repository,
      clock: { now: () => '2026-08-02T00:00:00.000Z' },
      actorId: 'node-control:node-p10',
    });
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      runtimeGovernance,
    });
    server = await listen(app);
    const baseUrl = address(server);

    const skills = (await json(`${baseUrl}/api/v1/skills`, true)) as { items: unknown[] };
    const skillSchema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/skill-version.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(skillSchema, skills.items[0])).toEqual({
      valid: true,
      errors: [],
    });
    const templates = (await json(`${baseUrl}/api/v1/plan-templates`, true)) as {
      items: unknown[];
    };
    const templateSchema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/plan-template-version.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(templateSchema, templates.items[0])).toEqual({
      valid: true,
      errors: [],
    });
    expect(templates.items[0]).not.toHaveProperty('authorityArtifactId');

    const firstSkillPage = (await json(`${baseUrl}/api/v1/skills?pageSize=1`, true)) as {
      items: unknown[];
      nextPageToken: string;
      totalEstimate: number;
    };
    expect(firstSkillPage).toMatchObject({ totalEstimate: 2 });
    expect(firstSkillPage.items).toHaveLength(1);
    const secondSkillPage = (await json(
      `${baseUrl}/api/v1/skills?pageSize=1&pageToken=${encodeURIComponent(firstSkillPage.nextPageToken)}`,
      true,
    )) as { items: unknown[]; nextPageToken?: string };
    expect(secondSkillPage.items).toHaveLength(1);
    expect(secondSkillPage.nextPageToken).toBeUndefined();

    const planVersions = (await json(
      `${baseUrl}/api/v1/plan-templates/plan.p10/versions`,
      true,
    )) as { items: unknown[] };
    expect(planVersions.items).toEqual([
      expect.objectContaining({ artifactId: 'plan.p10', version: '1' }),
    ]);
    const publishPlan = () =>
      fetch(`${baseUrl}/api/v1/plan-templates/plan.p10/versions/1/publish`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'p10-plan-publish-idempotency',
        },
        body: JSON.stringify({
          reason: 'Publish exact Plan Template version.',
          expectedRevision: 0,
          payload: {
            expectedLockVersion: 0,
            validationSummaryHash: `sha256:${'e'.repeat(64)}`,
          },
        }),
      });
    const planPublish = await publishPlan();
    expect(planPublish.status).toBe(202);
    const planPublishBody = await planPublish.json();
    const planLookupsAfterFirstCommand = runtimePlanLookups;
    const planReplay = await publishPlan();
    expect(planReplay.status).toBe(202);
    expect(await planReplay.json()).toEqual(planPublishBody);
    expect(runtimePlanLookups).toBe(planLookupsAfterFirstCommand);
    expect(runtimePlanTarget).toBe('artifact.p10');
    expect(runtimePlanArtifactKey).toBe('plan.p10');

    const publish = () =>
      fetch(`${baseUrl}/api/v1/skills/skill.p10/versions/1/publish`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'p10-publish-idempotency',
        },
        body: JSON.stringify({ reason: 'Publish exact validated version.', expectedRevision: 0 }),
      });
    const first = await publish();
    const replay = await publish();
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual(await first.json());
    expect(runtimeCommands).toBe(1);
    expect(
      repository.operations.filter((operation) => operation.operationType === 'skill.publish'),
    ).toHaveLength(1);
    expect(repository.audits.some((audit) => audit.action === 'skill.publish')).toBe(true);
  });
});

class MemoryRepository implements NodeControlFoundationRepository {
  profile: NodeProfile | undefined;
  readonly audits: ControlAuditEvent[] = [];
  readonly operations: ManagementOperation[] = [];

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
    return Promise.resolve(this.operations);
  }
  findManagementOperation(): Promise<ManagementOperation | undefined> {
    return Promise.resolve(undefined);
  }
  listAuditEvents(): Promise<readonly ControlAuditEvent[]> {
    return Promise.resolve(this.audits);
  }
  findGovernanceOperationReplay(
    operationType: string,
    idempotencyKeyHash: string,
  ): Promise<ManagementOperation | undefined> {
    return Promise.resolve(
      this.operations.find(
        (operation) =>
          operation.operationType === operationType &&
          operation.idempotencyKeyHash === idempotencyKeyHash,
      ),
    );
  }
  recordGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const existing = this.operations.find(
      (candidate) =>
        candidate.operationType === operation.operationType &&
        candidate.idempotencyKeyHash === operation.idempotencyKeyHash,
    );
    if (existing !== undefined) return Promise.resolve(existing);
    this.operations.push(operation);
    this.audits.push(audit);
    return Promise.resolve(operation);
  }
}

function skillView(skillId = 'skill.p10') {
  return Object.freeze({
    skillId,
    version: '1',
    name: 'P10 Skill',
    description: 'Governed exact Skill version.',
    status: 'published' as const,
    inputSchema: Object.freeze({ type: 'object' }),
    outputSchema: Object.freeze({ type: 'object' }),
    checksum: 'a'.repeat(64),
    createdAt: '2026-08-02T00:00:00.000Z',
  });
}

function planTemplateView() {
  return Object.freeze({
    artifactId: 'plan.p10',
    authorityArtifactId: 'artifact.p10',
    version: '1',
    name: 'P10 Plan Template',
    status: 'active' as const,
    checksum: 'b'.repeat(64),
    activePointer: true,
    createdAt: '2026-08-02T00:00:00.000Z',
  });
}

function runtimeOperation(operationType: string, reason: string): ManagementOperation {
  const accepted = createManagementOperation(
    {
      operationId: `runtime-${operationType}`,
      operationType,
      target: { type: 'skill_version', id: 'skill.p10', version: '1' },
      actorId: 'runtime',
      reason,
      idempotencyKeyHash: 'c'.repeat(64),
      inputHash: 'd'.repeat(64),
    },
    '2026-08-02T00:00:00.000Z',
  );
  return transitionManagementOperation(
    transitionManagementOperation(accepted, 'running', '2026-08-02T00:00:00.000Z'),
    'succeeded',
    '2026-08-02T00:00:00.000Z',
    { result: { accepted: true } },
  );
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
