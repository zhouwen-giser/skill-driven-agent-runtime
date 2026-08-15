import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NodeControlFoundationService,
  NodeControlConfigurationService,
  NodeControlEventService,
  NodeControlRuntimeGovernanceService,
  NodeControlTaskControlService,
  type NodeControlMcpProviderBindingService,
  type NodeControlCapabilityService,
  type NodeControlEvidenceExportService,
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
  it('exposes exact Capability authority only through the runtime-service channel', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-14T01:00:00.000Z' },
      ids: { next: () => 'audit-runtime-capability' },
    });
    await service.bootstrapNodeProfile({
      nodeId: 'node-runtime-capability',
      nodeType: 'sdar-runtime',
      displayName: 'Runtime Capability Node',
      environment: 'test',
      runtimeEndpointRef: 'http://127.0.0.1:9998',
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-14T01:00:00.000Z' },
      ids: { next: () => 'operation-runtime-capability' },
    });
    const capability = Object.freeze({
      capabilityId: 'vehicle.ugv.read-state',
      version: 1,
      domain: 'vehicle.ugv',
      name: 'Read UGV state',
      description: 'Read one UGV state.',
      inputSchema: Object.freeze({ type: 'object' }),
      outputSchema: Object.freeze({ type: 'object' }),
      successCriteria: Object.freeze([]),
      requiredEvidence: Object.freeze([]),
      effects: Object.freeze([]),
      artifacts: Object.freeze([]),
      constraints: Object.freeze([]),
      supportedModes: Object.freeze([]),
      riskLevel: 'low',
      status: 'published',
      definitionHash: 'a'.repeat(64),
    });
    const implementation = Object.freeze({
      bindingId: 'binding-read-state-v1',
      revision: 1,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      implementationType: 'skill',
      implementationId: 'ugv.get-state',
      implementationVersion: '1',
      role: 'primary',
      priority: 0,
      status: 'active',
    });
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      capabilities: {
        get: () => Promise.resolve(capability),
        listImplementations: () => Promise.resolve([implementation]),
      } as unknown as NodeControlCapabilityService,
    });
    server = await listen(app);
    const baseUrl = address(server);
    const path = `${baseUrl}/internal/v1/node-capabilities/vehicle.ugv.read-state/versions/1/authority`;

    const unauthorized = await fetch(path, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unauthorized.status).toBe(401);
    const response = await fetch(path, {
      headers: { authorization: `Bearer ${token}-runtime` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      definition: { capabilityId: 'vehicle.ugv.read-state', version: 1 },
      implementationBindings: [
        { bindingId: 'binding-read-state-v1', implementationId: 'ugv.get-state' },
      ],
    });
  });

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

  it('exposes only secret-free current MCP Binding authority to the Runtime service identity', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-11T02:00:00.000Z' },
      ids: { next: () => 'audit-current-binding' },
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-11T02:00:00.000Z' },
      ids: { next: () => 'operation-current-binding' },
    });
    const getCurrentAuthority = vi.fn(() =>
      Promise.resolve({
        observedAt: '2026-08-11T02:00:00.000Z',
        binding: {
          bindingId: 'binding-light',
          revision: 7,
          localServerId: 'home-lab-light-mcp',
          originType: 'smpp_registry' as const,
          providerId: 'ha-light-lab',
          externalProviderId: 'ha-light-lab',
          externalServerId: 'runtime-light',
          registryRevision: 2,
          registryChecksum: 'a'.repeat(64),
          catalogRevision: '2.0.0:7',
          catalogChecksum: 'b'.repeat(64),
          endpointRef: 'http://127.0.0.1:18081/mcp',
          availabilityValidUntil: '2026-08-11T03:00:00.000Z',
          catalogObservedAt: '2026-08-11T02:00:00.000Z',
          operationCount: 3,
        },
        sourceCandidateLineage: {
          smppSourceId: 'home-lab-smpp',
          externalProviderId: 'ha-light-lab',
          externalServerId: 'runtime-light',
          registryRevision: 2,
          registryChecksum: 'a'.repeat(64),
          nativeRevision: 2,
          nativeChecksum: 'c'.repeat(64),
          projectionContract: 'sdar-registry-v1' as const,
          candidateEndpoint: 'http://127.0.0.1:18081/mcp',
        },
      }),
    );
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      mcpBindings: { getCurrentAuthority } as unknown as NodeControlMcpProviderBindingService,
    });
    server = await listen(app);
    const url = `${address(server)}/internal/v1/mcp-provider-bindings/current?bindingId=binding-light&localServerId=home-lab-light-mcp`;

    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}-runtime` },
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      binding: { bindingId: 'binding-light', localServerId: 'home-lab-light-mcp' },
    });
    expect(JSON.stringify(body)).not.toMatch(/credential|secret/iu);
    expect(getCurrentAuthority).toHaveBeenCalledWith({
      bindingId: 'binding-light',
      localServerId: 'home-lab-light-mcp',
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

  it('exposes only the frozen output-side Evidence Export routes', async () => {
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
    const evidenceConfiguration = Object.freeze({
      exportId: 'export-p11',
      endpointRef: 'https://evidence.example.test/ingest',
      sourceId: 'runtime-p11',
      nodeId: 'node-p11',
      credentialRef: 'env:P11_EVIDENCE_TOKEN',
      includedFamilies: Object.freeze([
        'runtime',
        'skill',
        'mcp_task',
        'capability',
        'experience',
        'replay',
        'artifact',
        'node_control',
        'evidence',
      ]),
      batchPolicy: Object.freeze({ maxRecords: 100, maxBytes: 262_144, flushIntervalMs: 1_000 }),
      retryPolicy: Object.freeze({ baseDelayMs: 100, maxDelayMs: 300_000 }),
      outboxPolicy: Object.freeze({ maxPendingRecords: 10_000, retentionDays: 30 }),
      redactionProfile: 'strict_internal_v1',
      artifactMode: 'reference' as const,
      status: 'active' as const,
      revision: 1,
      applyMode: 'hot_reload' as const,
    });
    const operation = runtimeOperation('evidence-export.apply', 'Apply P11 Evidence export.');
    const evidenceExport = {
      current: () =>
        Promise.resolve({ configuration: evidenceConfiguration, etag: '"evidence:p11:1"' }),
      create: () =>
        Promise.resolve({
          configuration: { ...evidenceConfiguration, status: 'draft' as const },
          etag: '"evidence:p11:1"',
        }),
      validate: () =>
        Promise.resolve({
          configuration: { ...evidenceConfiguration, status: 'draft' as const },
          etag: '"evidence:p11:1:validated"',
        }),
      publish: () => Promise.resolve(operation),
      test: () => Promise.resolve(operation),
      status: () =>
        Promise.resolve({
          exportId: 'export-p11',
          status: 'degraded' as const,
          activeRevision: 1,
          pendingRecords: 2,
          lastErrorCode: 'EVIDENCE_ENDPOINT_UNAVAILABLE',
          lastErrorAt: '2026-08-03T00:00:00.000Z',
          observedAt: '2026-08-03T00:00:00.000Z',
        }),
    } as unknown as NodeControlEvidenceExportService;
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      evidenceExport,
    });
    server = await listen(app);
    const baseUrl = address(server);

    const current = await fetch(`${baseUrl}/api/v1/evidence-export`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(current.status).toBe(200);
    expect(current.headers.get('etag')).toBe('"evidence:p11:1"');
    const body = await current.json();
    const schema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/evidence-export-config.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(schema, body)).toEqual({
      valid: true,
      errors: [],
    });
    const status = await json(`${baseUrl}/api/v1/evidence-export/status`, true);
    expect(status).toMatchObject({ status: 'degraded', pendingRecords: 2 });

    const forbiddenQuery = await fetch(`${baseUrl}/api/v1/evidence-export/query`, {
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
      capabilities: {
        listImplementations: () => Promise.resolve([]),
      } as unknown as NodeControlCapabilityService,
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
        getWithRevision: (taskId) =>
          Promise.resolve(
            taskId === 'task-p12'
              ? {
                  summary: Object.freeze({
                    taskId,
                    contextId: 'context-p12',
                    phase: 'working',
                    updatedAt: '2026-08-02T08:00:00.000Z',
                    controlledActions: Object.freeze({ cancel: false }),
                  }),
                  revision: 11,
                }
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
    expect(task.headers.get('etag')).toBe('"task-revision-11"');
    expect(task.headers.get('x-sdar-task-revision')).toBe('11');
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
    expect(
      (
        await fetch(
          `${baseUrl}/api/v1/node-capabilities/vehicle.ugv.read-state/versions/1/implementations`,
          { headers: viewerHeaders },
        )
      ).status,
    ).toBe(403);
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

  it('authenticates and delegates all four public Task commands through durable Node Control', async () => {
    const repository = new MemoryRepository();
    const service = new NodeControlFoundationService({
      repository,
      clock: { now: () => '2026-08-13T01:00:00.000Z' },
      ids: { next: () => 'audit-task-control' },
    });
    const configurationService = new NodeControlConfigurationService({
      configurations: new MemoryConfigurationRepository(),
      foundation: repository,
      clock: { now: () => '2026-08-13T01:00:00.000Z' },
      ids: { next: () => 'operation-task-control' },
    });
    const execute = vi.fn(
      (
        action: 'pause' | 'resume' | 'cancel' | 'goal_patch',
        taskId: string,
        command: { reason: string; idempotencyKey: string },
      ) =>
        taskId === 'task-stale'
          ? Promise.reject(
              Object.assign(new Error('The Runtime Task revision changed.'), {
                code: 'REVISION_CONFLICT',
                status: 412,
              }),
            )
          : taskId === 'task-reconciliation'
            ? Promise.reject(
                Object.assign(new Error('The Runtime command requires reconciliation.'), {
                  code: 'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
                  status: 409,
                }),
              )
            : Promise.resolve(
                runtimeTaskControlOperation(action, taskId, command.reason, command.idempotencyKey),
              ),
    );
    const taskControl = new NodeControlTaskControlService({
      runtime: { execute },
      operations: repository,
      clock: { now: () => '2026-08-13T01:00:01.000Z' },
    });
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: token,
      operatorBearerToken: operatorToken,
      viewerBearerToken: viewerToken,
      securityBearerToken: securityToken,
      organizationBearerToken: organizationToken,
      organizationTenantId: 'organization-task-control',
      runtimeServiceToken: `${token}-runtime`,
      nodeControlApiUrl: 'http://127.0.0.1:10080',
      nodeEventsUrl: 'http://127.0.0.1:10080/api/v1/events',
      a2aAgentCardUrl: 'http://127.0.0.1:9999/.well-known/agent-card.json',
      taskControl,
    });
    server = await listen(app);
    const baseUrl = address(server);
    const requests = [
      { suffix: 'pause', action: 'pause', body: { reason: 'Pause Task safely.' } },
      { suffix: 'resume', action: 'resume', body: { reason: 'Resume Task safely.' } },
      { suffix: 'cancel', action: 'cancel', body: { reason: 'Cancel Task safely.' } },
      {
        suffix: 'goal-patches',
        action: 'goal_patch',
        body: {
          reason: 'Patch Task Goal safely.',
          payload: { instruction: 'Retain accepted evidence.' },
          expectedRevision: 3,
        },
      },
    ] as const;

    for (const [index, request] of requests.entries()) {
      const taskId = `task-${String(index)}`;
      const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}/${request.suffix}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${organizationToken}`,
          'content-type': 'application/json',
          'idempotency-key': `organization-task-command-${String(index)}`,
          'x-correlation-id': `task-command-correlation-${String(index)}`,
        },
        body: JSON.stringify(request.body),
      });
      expect(response.status).toBe(202);
      expect(response.headers.get('x-correlation-id')).toBe(
        `task-command-correlation-${String(index)}`,
      );
      await expect(response.json()).resolves.toMatchObject({
        operationType: `task.${request.action}`,
        target: { type: 'task', id: taskId },
        status: 'succeeded',
        actorId: 'node-control:organization_service',
        reason: request.body.reason,
      });
    }

    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenNthCalledWith(
      4,
      'goal_patch',
      'task-3',
      expect.objectContaining({
        reason: 'Patch Task Goal safely.',
        payload: { instruction: 'Retain accepted evidence.' },
        expectedRevision: 3,
        idempotencyKey: 'organization-task-command-3',
        correlationId: 'task-command-correlation-3',
      }),
    );

    const replay = await fetch(`${baseUrl}/api/v1/tasks/task-0/pause`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${organizationToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'organization-task-command-0',
        'x-correlation-id': 'task-command-replay-correlation',
      },
      body: JSON.stringify({ reason: 'Pause Task safely.' }),
    });
    expect(replay.status).toBe(202);
    expect(execute).toHaveBeenCalledTimes(4);

    const stale = await fetch(`${baseUrl}/api/v1/tasks/task-stale/resume`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${organizationToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'organization-task-stale-command',
      },
      body: JSON.stringify({ reason: 'Resume exact revision only.', expectedRevision: 2 }),
    });
    expect(stale.status).toBe(412);
    expect(stale.headers.get('content-type')).toContain('application/problem+json');
    await expect(stale.json()).resolves.toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 412,
      retryable: true,
    });
    expect(execute).toHaveBeenCalledTimes(5);
    const staleReplay = await fetch(`${baseUrl}/api/v1/tasks/task-stale/resume`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${organizationToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'organization-task-stale-command',
      },
      body: JSON.stringify({ reason: 'Resume exact revision only.', expectedRevision: 2 }),
    });
    expect(staleReplay.status).toBe(412);
    await expect(staleReplay.json()).resolves.toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 412,
      retryable: true,
    });
    expect(execute).toHaveBeenCalledTimes(5);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = await fetch(`${baseUrl}/api/v1/tasks/task-reconciliation/cancel`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${organizationToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'organization-task-reconciliation-command',
        },
        body: JSON.stringify({ reason: 'Reconcile the uncertain Runtime command.' }),
      });
      expect(pending.status).toBe(409);
      await expect(pending.json()).resolves.toMatchObject({
        code: 'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
        status: 409,
        retryable: true,
      });
    }
    expect(execute).toHaveBeenCalledTimes(7);

    for (const deniedToken of [operatorToken, viewerToken, securityToken]) {
      const denied = await fetch(`${baseUrl}/api/v1/tasks/task-denied/cancel`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deniedToken}`,
          'content-type': 'application/json',
          'idempotency-key': 'denied-task-command',
        },
        body: JSON.stringify({ reason: 'Must be denied.' }),
      });
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toMatchObject({ code: 'CONTROL_SCOPE_FORBIDDEN' });
    }

    const missingKey = await fetch(`${baseUrl}/api/v1/tasks/task-invalid/pause`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${organizationToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'No idempotency key.' }),
    });
    expect(missingKey.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(7);
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
  startGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const index = this.operations.findIndex(
      (candidate) => candidate.operationId === operation.operationId,
    );
    const current = this.operations[index];
    if (index < 0 || current === undefined)
      return Promise.reject(new Error('TEST_GOVERNANCE_OPERATION_NOT_FOUND'));
    if (['succeeded', 'failed', 'canceled'].includes(current.status))
      return Promise.resolve(current);
    const running = transitionManagementOperation(current, 'running', audit.createdAt);
    this.operations[index] = running;
    this.audits.push(audit);
    return Promise.resolve(running);
  }
  markGovernanceOperationReconciliationPending(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const index = this.operations.findIndex(
      (candidate) => candidate.operationId === operation.operationId,
    );
    const current = this.operations[index];
    if (index < 0 || current === undefined)
      return Promise.reject(new Error('TEST_GOVERNANCE_OPERATION_NOT_FOUND'));
    if (['succeeded', 'failed', 'canceled'].includes(current.status))
      return Promise.resolve(current);
    if (current.status !== 'running')
      return Promise.reject(new Error('TEST_GOVERNANCE_OPERATION_NOT_RUNNING'));
    this.operations[index] = operation;
    this.audits.push(audit);
    return Promise.resolve(operation);
  }
  completeGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const index = this.operations.findIndex(
      (candidate) => candidate.operationId === operation.operationId,
    );
    if (index < 0) return Promise.reject(new Error('TEST_GOVERNANCE_OPERATION_NOT_FOUND'));
    const current = this.operations[index];
    if (current === undefined)
      return Promise.reject(new Error('TEST_GOVERNANCE_OPERATION_MISSING'));
    if (['succeeded', 'failed', 'canceled'].includes(current.status))
      return Promise.resolve(current);
    this.operations[index] = operation;
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

function runtimeTaskControlOperation(
  action: 'pause' | 'resume' | 'cancel' | 'goal_patch',
  taskId: string,
  reason: string,
  idempotencyKey: string,
): ManagementOperation {
  const accepted = createManagementOperation(
    {
      operationId: `runtime-task-${action}`,
      operationType: `task.${action}`,
      target: { type: 'task', id: taskId },
      actorId: 'runtime-task-authority',
      reason,
      idempotencyKeyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
      inputHash: 'f'.repeat(64),
    },
    '2026-08-13T01:00:00.000Z',
  );
  return transitionManagementOperation(
    transitionManagementOperation(accepted, 'running', '2026-08-13T01:00:00.000Z'),
    'succeeded',
    '2026-08-13T01:00:01.000Z',
    { result: { applied: true } },
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
