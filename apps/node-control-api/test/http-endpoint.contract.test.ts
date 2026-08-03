import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NodeControlFoundationService,
  NodeControlConfigurationService,
  NodeControlEventService,
  NodeControlRuntimeGovernanceService,
  type NodeControlTelemetryExportService,
  type ConfigurationReference,
  type NodeControlConfigurationRepository,
  type NodeControlFoundationRepository,
  type ConfigurationMutationContext,
} from '../../../packages/node-control-application/src/index.js';
import type {
  ControlAuditEvent,
  ConfigurationRevision,
  ManagementOperation,
  NodeEventEnvelope,
  NodeProfile,
} from '../../../packages/node-control-domain/src/index.js';
import {
  createManagementOperation,
  transitionManagementOperation,
} from '../../../packages/node-control-domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { createNodeControlHttpApp } from '../src/http-endpoint.js';

const token = 'p01-node-control-contract-token-0000000000000000';
const organizationToken = 'p12-organization-read-token-000000000000000';
const operatorToken = 'p13-operator-token-000000000000000000000000';
const viewerToken = 'p13-viewer-token-00000000000000000000000000';
const securityToken = 'p13-security-token-000000000000000000000000';
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

  it('exposes only the frozen output-side Telemetry Export routes', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-03T00:00:00.000Z' },
      ids: { next: () => 'audit-p11' },
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-03T00:00:00.000Z' },
      ids: { next: () => 'operation-p11' },
    });
    const telemetryConfiguration = Object.freeze({
      exportId: 'export-p11',
      endpointRef: 'https://telemetry.example.test/ingest',
      sourceId: 'runtime-p11',
      nodeId: 'node-p11',
      credentialRef: 'env:P11_TELEMETRY_TOKEN',
      recordFamilies: Object.freeze(['runtime_event']),
      batchPolicy: Object.freeze({ maxRecords: 100 }),
      retryPolicy: Object.freeze({ maxDelaySeconds: 300 }),
      outboxPolicy: Object.freeze({ maxPendingRecords: 10_000 }),
      status: 'active' as const,
      revision: 1,
      applyMode: 'hot_reload' as const,
    });
    const operation = runtimeOperation('telemetry-export.apply', 'Apply P11 telemetry export.');
    const telemetryExport = {
      current: () =>
        Promise.resolve({ configuration: telemetryConfiguration, etag: '"telemetry:p11:1"' }),
      create: () =>
        Promise.resolve({
          configuration: { ...telemetryConfiguration, status: 'draft' as const },
          etag: '"telemetry:p11:1"',
        }),
      validate: () =>
        Promise.resolve({
          configuration: { ...telemetryConfiguration, status: 'draft' as const },
          etag: '"telemetry:p11:1:validated"',
        }),
      publish: () => Promise.resolve(operation),
      test: () => Promise.resolve(operation),
      status: () =>
        Promise.resolve({
          exportId: 'export-p11',
          status: 'degraded' as const,
          activeRevision: 1,
          pendingRecords: 2,
          lastErrorCode: 'TELEMETRY_ENDPOINT_UNAVAILABLE',
          lastErrorAt: '2026-08-03T00:00:00.000Z',
          observedAt: '2026-08-03T00:00:00.000Z',
        }),
    } as unknown as NodeControlTelemetryExportService;
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      telemetryExport,
    });
    server = await listen(app);
    const baseUrl = address(server);

    const current = await fetch(`${baseUrl}/api/v1/telemetry-export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(current.status).toBe(200);
    expect(current.headers.get('etag')).toBe('"telemetry:p11:1"');
    const body = await current.json();
    const schema = JSON.parse(
      await readFile(
        'protocol/node-control/v1/schemas/telemetry-export-config.schema.json',
        'utf8',
      ),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(schema, body)).toEqual({
      valid: true,
      errors: [],
    });
    const status = await json(`${baseUrl}/api/v1/telemetry-export/status`, true);
    expect(status).toMatchObject({ status: 'degraded', pendingRecords: 2 });

    const forbiddenQuery = await fetch(`${baseUrl}/api/v1/telemetry-export/query`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(forbiddenQuery.status).toBe(404);
  });

  it('enforces the organization read profile and streams resumable hint-only Node Events', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-02T08:00:00.000Z' },
      ids: { next: () => 'audit-p12' },
    });
    await service.bootstrapNodeProfile({
      nodeId: 'node-p12',
      nodeType: 'sdar-runtime',
      displayName: 'P12 Node',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-02T08:00:00.000Z' },
      ids: { next: () => 'operation-p12' },
    });
    const cursors: (string | undefined)[] = [];
    const event: NodeEventEnvelope = Object.freeze({
      eventId: 'evt-p12-new',
      eventType: 'node.profile.changed',
      occurredAt: '2026-08-02T08:00:00.000Z',
      nodeId: 'node-p12',
      aggregateType: 'node_profile',
      aggregateId: 'node-p12',
      aggregateRevision: 2,
      correlationId: 'corr-p12',
      dataClassification: 'internal',
      payload: Object.freeze({
        resourceRef: Object.freeze({ type: 'node_profile', id: 'node-p12', revision: 2 }),
        changeCode: 'NODE_PROFILE_CHANGED',
      }),
    });
    const nodeEvents = new NodeControlEventService({
      listAfter: (lastEventId) => {
        cursors.push(lastEventId);
        return Promise.resolve({ items: cursors.length === 1 ? [event] : [] });
      },
    });
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      operatorBearerToken: operatorToken,
      viewerBearerToken: viewerToken,
      securityBearerToken: securityToken,
      organizationBearerToken: organizationToken,
      organizationTenantId: 'organization-p12',
      rateLimitPerMinute: 10,
      requestBodyLimitKb: 1,
      providerEndpointAllowlist: [
        '127.0.0.1',
        'localhost',
        '10.20.0.0/16',
        '127.0.0.1.evil.example',
      ],
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      nodeEvents,
      taskSummaries: {
        list: () =>
          Promise.resolve([
            Object.freeze({
              taskId: 'task-p12',
              contextId: 'context-p12',
              phase: 'working',
              updatedAt: '2026-08-02T08:00:00.000Z',
              controlledActions: Object.freeze({ cancel: false }),
            }),
          ]),
        get: (taskId) =>
          Promise.resolve(
            taskId === 'task-p12'
              ? Object.freeze({
                  taskId,
                  contextId: 'context-p12',
                  phase: 'working',
                  updatedAt: '2026-08-02T08:00:00.000Z',
                  controlledActions: Object.freeze({ cancel: false }),
                })
              : undefined,
          ),
      },
    });
    server = await listen(app);
    const baseUrl = address(server);
    const organizationHeaders = { authorization: `Bearer ${organizationToken}` };

    const initial = await fetch(`${baseUrl}/api/v1/node`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const draft = await fetch(`${baseUrl}/api/v1/node/draft`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': initial.headers.get('etag') ?? '',
        'idempotency-key': 'p12-profile-draft',
      },
      body: JSON.stringify({
        nodeId: 'node-p12',
        nodeType: 'sdar-runtime',
        displayName: 'P12 Organization Node',
        environment: 'test',
        runtimeEndpointRef: 'http://127.0.0.1:9998',
        status: 'draft',
        revision: 2,
      }),
    });
    expect(draft.status).toBe(200);
    const draftEtag = draft.headers.get('etag') ?? '';
    const validated = await fetch(`${baseUrl}/api/v1/node/draft/validate`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': draftEtag,
        'idempotency-key': 'p12-profile-validate',
      },
      body: JSON.stringify({ reason: 'Validate P12 Profile.', expectedRevision: 2 }),
    });
    expect(validated.status).toBe(200);
    const published = await fetch(`${baseUrl}/api/v1/node/draft/publish`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': draftEtag,
        'idempotency-key': 'p12-profile-publish',
      },
      body: JSON.stringify({ reason: 'Publish P12 Profile.', expectedRevision: 2 }),
    });
    expect(published.status).toBe(202);

    const profile = await fetch(`${baseUrl}/api/v1/node`, { headers: organizationHeaders });
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({
      displayName: 'P12 Organization Node',
      revision: 2,
      status: 'active',
    });
    const tasks = await fetch(`${baseUrl}/api/v1/tasks`, { headers: organizationHeaders });
    expect(tasks.status).toBe(200);
    const taskPage = await tasks.json();
    expect(taskPage).toMatchObject({
      items: [expect.objectContaining({ taskId: 'task-p12', phase: 'working' })],
    });
    const task = await fetch(`${baseUrl}/api/v1/tasks/task-p12`, {
      headers: organizationHeaders,
    });
    expect(task.status).toBe(200);
    const taskSchema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/task-summary.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(taskSchema, await task.json())).toEqual({
      valid: true,
      errors: [],
    });
    const forbidden = await fetch(`${baseUrl}/api/v1/audit-events`, {
      headers: organizationHeaders,
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'CONTROL_SCOPE_FORBIDDEN' });
    const forbiddenWrite = await fetch(`${baseUrl}/api/v1/node-capabilities`, {
      method: 'POST',
      headers: { ...organizationHeaders, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(forbiddenWrite.status).toBe(403);

    const crossTenant = await fetch(`${baseUrl}/api/v1/node`, {
      headers: { ...organizationHeaders, 'x-sdar-tenant-id': 'another-organization' },
    });
    expect(crossTenant.status).toBe(403);
    await expect(crossTenant.json()).resolves.toMatchObject({ code: 'CONTROL_TENANT_FORBIDDEN' });

    const operatorAudit = await fetch(`${baseUrl}/api/v1/audit-events`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(operatorAudit.status).toBe(200);
    const operatorWrite = await fetch(`${baseUrl}/api/v1/configuration-revisions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(operatorWrite.status).toBe(403);
    const securityAudit = await fetch(`${baseUrl}/api/v1/audit-events`, {
      headers: { authorization: `Bearer ${securityToken}` },
    });
    expect(securityAudit.status).toBe(200);
    const securityWrite = await fetch(`${baseUrl}/api/v1/configuration-revisions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${securityToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(securityWrite.status).toBe(403);
    const viewerHeaders = { authorization: `Bearer ${viewerToken}` };
    expect((await fetch(`${baseUrl}/api/v1/node`, { headers: viewerHeaders })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/v1/audit-events`, { headers: viewerHeaders })).status).toBe(
      403,
    );

    const deniedEndpoint = await fetch(`${baseUrl}/api/v1/llm-providers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'metadata-endpoint',
        providerType: 'openai_compatible',
        baseUrl: 'http://169.254.169.254/latest',
        credentialRef: 'runtime-model-provider://metadata',
        models: [
          {
            modelId: 'model-a',
            capabilities: ['structured_output'],
            contextWindow: 4096,
            enabled: true,
          },
        ],
        healthPolicy: {
          timeoutMs: 1000,
          retryAttempts: 0,
          failureThreshold: 1,
          recoverySeconds: 30,
        },
        rateLimitPolicy: { requestsPerMinute: 10, tokensPerMinute: 1000, maxConcurrent: 1 },
        status: 'draft',
        secretStatus: 'unknown',
        revision: 1,
      }),
    });
    expect(deniedEndpoint.status).toBe(422);
    await expect(deniedEndpoint.json()).resolves.toMatchObject({ code: 'ENDPOINT_NOT_ALLOWED' });

    const deceptiveLoopback = await fetch(`${baseUrl}/api/v1/llm-providers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        providerId: 'deceptive-loopback',
        providerType: 'openai_compatible',
        baseUrl: 'http://127.0.0.1.evil.example',
        credentialRef: 'runtime-model-provider://deceptive-loopback',
        models: [
          {
            modelId: 'model-a',
            capabilities: ['structured_output'],
            contextWindow: 4096,
            enabled: true,
          },
        ],
        healthPolicy: {
          timeoutMs: 1000,
          retryAttempts: 0,
          failureThreshold: 1,
          recoverySeconds: 30,
        },
        rateLimitPolicy: { requestsPerMinute: 10, tokensPerMinute: 1000, maxConcurrent: 1 },
        status: 'draft',
        secretStatus: 'unknown',
        revision: 1,
      }),
    });
    expect(deceptiveLoopback.status).toBe(422);
    await expect(deceptiveLoopback.json()).resolves.toMatchObject({
      code: 'ENDPOINT_NOT_ALLOWED',
    });

    const oversized = await fetch(`${baseUrl}/api/v1/node/draft`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(2_048) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ code: 'REQUEST_BODY_TOO_LARGE' });

    let rateLimited: Response | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/v1/node`, { headers: viewerHeaders });
      if (response.status === 429) {
        rateLimited = response;
        break;
      }
    }
    if (rateLimited === undefined) throw new Error('TEST_RATE_LIMIT_NOT_ENFORCED');
    expect(rateLimited.status).toBe(429);
    await expect(rateLimited.json()).resolves.toMatchObject({
      code: 'CONTROL_RATE_LIMIT_EXCEEDED',
    });

    const controller = new AbortController();
    const stream = await fetch(`${baseUrl}/api/v1/events`, {
      headers: { ...organizationHeaders, 'last-event-id': 'evt-p12-old' },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const reader = stream.body?.getReader();
    if (reader === undefined) throw new Error('TEST_NODE_EVENT_STREAM_MISSING');
    const chunk = await reader.read();
    const chunkValue: unknown = chunk.value;
    if (!(chunkValue instanceof Uint8Array)) throw new Error('TEST_NODE_EVENT_CHUNK_MISSING');
    const text = new TextDecoder().decode(chunkValue);
    expect(text).toContain('id: evt-p12-new');
    expect(text).toContain('event: node.profile.changed');
    const data = text
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length);
    if (data === undefined) throw new Error('TEST_NODE_EVENT_DATA_MISSING');
    const envelope = JSON.parse(data) as unknown;
    const schema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/event-envelope.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(schema, envelope)).toEqual({
      valid: true,
      errors: [],
    });
    expect(envelope).not.toHaveProperty('profile');
    expect(cursors[0]).toBe('evt-p12-old');
    controller.abort();
    await reader.cancel().catch(() => undefined);
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
  createNodeProfileDraft(
    profile: NodeProfile,
    _expectedRevision: number,
    _context: ConfigurationMutationContext,
  ): Promise<NodeProfile> {
    void _expectedRevision;
    void _context;
    this.profile = profile;
    return Promise.resolve(profile);
  }
  validateNodeProfileDraft(
    _revision: number,
    _expectedRevision: number,
    _context: ConfigurationMutationContext,
  ): Promise<NodeProfile> {
    void _revision;
    void _expectedRevision;
    void _context;
    if (this.profile === undefined) return Promise.reject(new Error('NODE_PROFILE_NOT_FOUND'));
    return Promise.resolve(this.profile);
  }
  publishNodeProfileDraft(
    _revision: number,
    _expectedRevision: number,
    operation: ManagementOperation,
    audit: ControlAuditEvent,
    _context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    void _revision;
    void _expectedRevision;
    void _context;
    if (this.profile !== undefined)
      this.profile = Object.freeze({ ...this.profile, status: 'active' as const });
    this.operations.push(operation);
    this.audits.push(audit);
    return Promise.resolve(operation);
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
