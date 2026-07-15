import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EvolutionExperience } from '../../domain/src/index.js';

import {
  startManagementHttpEndpoint,
  type ManagementHttpEndpointHandle,
  type ManagementOperations,
} from '../src/index.js';

describe('management HTTP API contract', () => {
  let endpoint: ManagementHttpEndpointHandle | undefined;

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
  });

  it('serves the unauthenticated console from the management process with the risk header', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sdar-console-'));
    try {
      await writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html><body>trusted-intranet-only-no-auth</body></html>',
        'utf8',
      );
      endpoint = await startManagementHttpEndpoint({
        operations: operations(),
        consoleDirectory: directory,
      });
      const response = await fetch(`${endpoint.baseUrl}/console`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-sdar-security-warning')).toBe('trusted-intranet-only-no-auth');
      await expect(response.text()).resolves.toContain('trusted-intranet-only-no-auth');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exposes workflow-template inventory and usage evidence', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const inventory = await fetch(`${endpoint.baseUrl}/api/v1/workflow-templates`);
    expect(inventory.status).toBe(200);
    await expect(inventory.json()).resolves.toEqual({ items: [] });
    const uses = await fetch(`${endpoint.baseUrl}/api/v1/workflow-templates/template-1/uses`);
    expect(uses.status).toBe(200);
    await expect(uses.json()).resolves.toEqual({ items: [] });
  });

  it('exposes credential-safe MCP management operation evidence', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        mcp: {
          ...operations().mcp,
          listManagementOperations: () =>
            Promise.resolve([
              {
                operationId: 'operation-1',
                serverId: 'mcp.devices',
                operationType: 'credentials_update' as const,
                actor: 'anonymous-management' as const,
                summary: { headerNames: ['Authorization'] },
                occurredAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers/mcp.devices/operations`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      items: [expect.objectContaining({ operationType: 'credentials_update' })],
    });
    expect(JSON.stringify(payload)).not.toContain('Bearer');
  });

  it('exposes persisted MCP dependency warnings for management display', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        mcp: {
          ...operations().mcp,
          listDependencyWarnings: (serverId) =>
            Promise.resolve([
              {
                warningId: 'warning-1',
                serverId,
                skillId: 'skill.device',
                skillVersion: 2,
                toolName: 'device_status',
                toolRevision: 3,
                reason: 'schema_changed' as const,
                message: 'The enabled Skill may require review.',
                createdAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers/mcp.devices/warnings`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          serverId: 'mcp.devices',
          skillId: 'skill.device',
          reason: 'schema_changed',
        }),
      ],
    });
  });

  it('reads and updates the unified Task wait timeout', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskWaitTimeouts: {
          getPolicy: () =>
            Promise.resolve({ timeoutSeconds: 300, updatedAt: '2026-07-12T00:00:00.000Z' }),
          updatePolicy: (timeoutSeconds) =>
            Promise.resolve({ timeoutSeconds, updatedAt: '2026-07-12T00:01:00.000Z' }),
        },
      },
    });
    await expect(
      (await fetch(`${endpoint.baseUrl}/api/v1/system/task-wait-policy`)).json(),
    ).resolves.toMatchObject({ timeoutSeconds: 300 });
    const update = await fetch(`${endpoint.baseUrl}/api/v1/system/task-wait-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutSeconds: 60 }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ timeoutSeconds: 60 });
  });

  it('lists Tasks with bounded PostgreSQL query filters', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        tasks: {
          ...configured.tasks,
          list: (query) =>
            Promise.resolve([
              {
                taskId: 'task-live',
                contextId: query.contextId ?? 'context-live',
                userId: 'anonymous',
                requestText: 'Operate runtime.',
                requestMetadata: {},
                phase: query.phase ?? 'executing',
                phaseMessage: 'Executing.',
                ...(query.planId === undefined ? {} : { planId: query.planId }),
                ...(query.goalId === undefined ? {} : { goalId: query.goalId }),
                ...(query.skillId === undefined ? {} : { selectedSkillId: query.skillId }),
                createdAt: '2026-07-13T00:00:00.000Z',
                updatedAt: '2026-07-13T00:01:00.000Z',
              },
            ]),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/tasks?contextId=context-live&phase=executing&planId=plan-live&goalId=goal-live&skillId=skill-live&limit=25`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          taskId: 'task-live',
          contextId: 'context-live',
          phase: 'executing',
          planId: 'plan-live',
          goalId: 'goal-live',
          selectedSkillId: 'skill-live',
        },
      ],
    });
  });

  it('lists credential-safe model Providers and fixed stage routes', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        models: {
          ...configured.models,
          listProviders: () =>
            Promise.resolve([
              {
                providerId: 'provider.local',
                name: 'Local model',
                kind: 'local' as const,
                apiStyle: 'openai_chat_completions' as const,
                baseUrl: 'http://127.0.0.1:11434',
                model: 'runtime-model',
                enabled: true,
                timeoutMs: 30000,
                createdAt: '2026-07-13T00:00:00.000Z',
                updatedAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
          listStageRoutes: () =>
            Promise.resolve([
              {
                stage: 'workflow_planning' as const,
                providerId: 'provider.local',
                updatedAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    const providers = await fetch(`${endpoint.baseUrl}/api/v1/models/providers`).then((response) =>
      response.json(),
    );
    expect(providers).toMatchObject({ items: [{ providerId: 'provider.local' }] });
    expect(JSON.stringify(providers)).not.toContain('credential');
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/models/routes`).then((response) => response.json()),
    ).resolves.toMatchObject({ items: [{ stage: 'workflow_planning' }] });
  });

  it('reads and updates disabled-by-default Memory retention controls', async () => {
    const policy = {
      reviewAfterDays: 90,
      archiveAfterDays: 365,
      deleteAfterDays: 730,
      automaticArchiveEnabled: false,
      automaticDeleteEnabled: false,
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        memoryRetention: {
          getPolicy: () => Promise.resolve(policy),
          updatePolicy: (input) => Promise.resolve({ ...input, updatedAt: policy.updatedAt }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/system/memory-retention-policy`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject(policy);
    const updated = await fetch(`${endpoint.baseUrl}/api/v1/system/memory-retention-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...policy, reviewAfterDays: 30 }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ reviewAfterDays: 30 });
  });

  it('reads and updates the authoritative Evolution threshold and exposes trigger logs', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evolutionPolicy: {
          getPolicy: () =>
            Promise.resolve({ successThreshold: 2, updatedAt: '2026-07-12T00:00:00.000Z' }),
          updatePolicy: (successThreshold) =>
            Promise.resolve({ successThreshold, updatedAt: '2026-07-12T00:01:00.000Z' }),
          listTriggers: () =>
            Promise.resolve([
              {
                triggerId: 'trigger-1',
                capabilityFingerprint: 'fingerprint-1',
                experienceId: 'experience-1',
                successfulExperienceCount: 1,
                configuredThreshold: 2,
                decision: 'below_threshold' as const,
                createdAt: '2026-07-12T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/system/evolution-policy`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({ successThreshold: 2 });
    const update = await fetch(`${endpoint.baseUrl}/api/v1/system/evolution-policy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ successThreshold: 3 }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ successThreshold: 3 });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/evolution-triggers`).then((response) => response.json()),
    ).resolves.toMatchObject({
      items: [{ configuredThreshold: 2, decision: 'below_threshold' }],
    });
  });

  it('exposes persisted processed-result evidence by Task', async () => {
    const configured = operations();
    const result = {
      resultId: 'processed-result-1',
      taskId: 'task-1',
      skillId: 'skill-1',
      skillVersion: 1,
      normalized: {
        data: { status: 'online' },
        errors: [],
        originalSize: 19,
        contextValue: { status: 'online' },
        contextTruncated: false,
        summary: 'Successful result with 19 JSON characters.',
      },
      output: { text: 'Online.', structured: { status: 'online' } },
      facts: [{ name: 'status', value: 'online', confidence: 1 }],
      valuable: true,
      valueSummary: 'Useful.',
      memoryCandidates: [{ kind: 'fact' as const, content: 'Online.', confidence: 1 }],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        resultProcessing: {
          get: () => Promise.resolve(result),
          list: () => Promise.resolve([result]),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/processed-results`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ valuable: true })] });
  });

  it('exposes the five-component Task quality report', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        taskQuality: {
          getByTask: (taskId) =>
            Promise.resolve({
              reportId: 'quality-1',
              taskId,
              goalId: 'goal-1',
              goalVersion: 1,
              workflowInstanceId: 'instance-1',
              processedResultId: 'result-1',
              assessments: [
                {
                  component: 'goal',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['goal:1'],
                },
                {
                  component: 'workflow',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['workflow:1'],
                },
                {
                  component: 'skill',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['skill:1'],
                },
                {
                  component: 'result_quality',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['result:1'],
                },
                {
                  component: 'tool_call',
                  score: 1,
                  summary: 'Good.',
                  findings: [],
                  evidenceRefs: ['tool:1'],
                },
              ],
              overallScore: 1,
              status: 'passed',
              createdAt: '2026-07-13T00:00:00.000Z',
            }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/quality-report`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      taskId: 'task-1',
      assessments: [
        { component: 'goal' },
        { component: 'workflow' },
        { component: 'skill' },
        { component: 'result_quality' },
        { component: 'tool_call' },
      ],
    });
  });

  it('lists low-confidence implicit feedback linked to a Task', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        implicitFeedback: {
          listByTask: (taskId) =>
            Promise.resolve([
              {
                feedbackId: 'feedback-1',
                kind: 'requested_redo',
                sourceTaskId: taskId,
                triggerTaskId: taskId,
                contextId: 'context-1',
                confidence: 0.35,
                evidenceSummary: 'The revision text requested a redo.',
                createdAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/implicit-feedback`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      items: [{ kind: 'requested_redo', sourceTaskId: 'task-1', confidence: 0.35 }],
    });
  });

  it('exposes the report-linked Evaluation influence record', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evaluationInfluences: {
          getByReport: (reportId) =>
            Promise.resolve({
              influenceId: 'influence-1',
              reportId,
              taskId: 'task-1',
              experienceId: 'experience-1',
              skillObservationId: 'observation-1',
              workflowDisposition: 'rejected_low_quality',
              promptDisposition: 'candidate_created',
              promptId: 'prompt-workflow',
              promptVersion: 2,
              promptStage: 'workflow_planning',
              createdAt: '2026-07-13T01:00:00.000Z',
            }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/task-quality-reports/report-1/influence`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      reportId: 'report-1',
      experienceId: 'experience-1',
      promptDisposition: 'candidate_created',
    });
  });

  it('filters operational Evaluation analytics by Skill, version, model, and Tool', async () => {
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evaluationAnalytics: {
          summarize: (filters) =>
            Promise.resolve({
              filters,
              sampleCount: 2,
              successCount: 1,
              successRate: 0.5,
              averageDurationMs: 150,
              totalCost: 4,
              averageCost: 2,
              failureTypes: [{ code: 'MCP_TIMEOUT', count: 1 }],
              mcpUsage: [],
              modelEffects: [],
              versionStability: [
                {
                  skillId: 'skill-1',
                  skillVersion: 2,
                  sampleCount: 2,
                  successRate: 0.5,
                  averageQuality: 0.6,
                  qualityDeviation: 0.2,
                  stabilityScore: 0.4,
                },
              ],
              qualityTrend: [],
              capabilityGrowth: [],
              optimizationSuggestions: [],
            }),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/evaluation/analytics?skillId=skill-1&skillVersion=2&providerId=provider-1&model=model-a&serverId=mcp-1&toolName=read`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      filters: {
        skillId: 'skill-1',
        skillVersion: 2,
        providerId: 'provider-1',
        model: 'model-a',
        serverId: 'mcp-1',
        toolName: 'read',
      },
      successRate: 0.5,
      averageDurationMs: 150,
      totalCost: 4,
      failureTypes: [{ code: 'MCP_TIMEOUT', count: 1 }],
      versionStability: [{ stabilityScore: 0.4 }],
    });
  });

  it('advertises the trusted-intranet no-auth risk and returns credential-free MCP data', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const health = await fetch(`${endpoint.baseUrl}/api/v1/health`);
    expect(health.headers.get('x-sdar-security-warning')).toBe('trusted-intranet-only-no-auth');
    await expect(health.json()).resolves.toEqual({
      status: 'ok',
      authentication: 'none',
      deployment: 'trusted-intranet-only',
      historicalDataRetention: {
        default: 'indefinite',
        automaticArchive: false,
        automaticDelete: false,
        policyFieldsAreAdvisory: true,
      },
    });

    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`);
    expect(JSON.stringify(await response.json())).not.toContain('credential');
  });

  it('rejects invalid external input with a stable error envelope before application calls', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId: '', endpoint: 'file:///tmp/server', credentialHeaders: {} }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'REQUEST_VALIDATION_FAILED' },
    });
  });

  it('does not expose unexpected infrastructure error details', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations(true) });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/mcp/servers`);
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toContain('MANAGEMENT_INTERNAL_ERROR');
    expect(body).not.toContain('database-password');
  });

  it('fails explicitly instead of using a fallback when no authoring model is configured', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/skills/author`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SKILL_AUTHORING_MODEL_NOT_CONFIGURED' },
    });
  });

  it('publishes a persisted A2A Skill draft only through the management draft route', async () => {
    const draft = {
      draftId: 'draft-task-1',
      taskId: 'task-1',
      contextId: 'context-1',
      requestedBy: 'anonymous',
      intent: 'create' as const,
      requestText: 'Create a detailed read-only device inspection Skill.',
      status: 'draft' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillAuthoring: {
          authorAndRegister: () => Promise.reject(new Error('UNUSED')),
          getDraft: () => Promise.resolve(draft),
          publishDraft: (_draftId, input) =>
            Promise.resolve({
              draft: {
                ...draft,
                status: 'published' as const,
                publishedSkillId: input.skillId,
                publishedSkillVersion: 1,
                publishedBy: input.actor,
                publishedAt: '2026-07-12T00:01:00.000Z',
              },
              skill: {
                skillId: input.skillId,
                version: 1,
                name: 'Published draft',
                summary: 'Published.',
                description: draft.requestText,
                capabilities: ['inspection'],
                workflowGuidance: 'Inspect.',
                outputInstruction: 'Return.',
                inputSchema: { type: 'object' },
                outputSchema: { type: 'object' },
                toolPolicy: input.toolPolicy,
                runtimePolicy: input.runtimePolicy,
                status: input.status,
                sourceKind: 'a2a_draft' as const,
                validationPassed: true,
                createdAt: '2026-07-12T00:01:00.000Z',
              },
            }),
        },
      },
    });
    const read = await fetch(`${endpoint.baseUrl}/api/v1/skill-drafts/draft-task-1`);
    await expect(read.json()).resolves.toMatchObject({ status: 'draft' });
    const published = await fetch(`${endpoint.baseUrl}/api/v1/skill-drafts/draft-task-1/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actor: 'operator@example.test',
        skillId: 'skill.a2a.published',
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
      }),
    });
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      draft: { status: 'published', publishedBy: 'operator@example.test' },
      skill: { sourceKind: 'a2a_draft', status: 'enabled' },
    });
  });

  it('records and lists Skill quality warnings without a status mutation operation', async () => {
    const warning = {
      warningId: 'warning-1',
      skillId: 'skill.quality',
      skillVersion: 1,
      kind: 'consecutive_low_score' as const,
      observationIds: ['observation-1', 'observation-2', 'observation-3'],
      observedValue: 0.2,
      threshold: 0.4,
      summary: 'Low scores.',
      status: 'active' as const,
      skillStatusAtCreation: 'enabled' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillQuality: {
          record: (input) =>
            Promise.resolve({
              observation: {
                observationId: 'observation-3',
                ...input,
                createdAt: warning.createdAt,
              },
              warnings: [warning],
            }),
          listWarnings: () => Promise.resolve([warning]),
        },
      },
    });
    const recorded = await fetch(
      `${endpoint.baseUrl}/api/v1/skills/skill.quality/quality-observations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillVersion: 1,
          evaluationRef: 'evaluation-3',
          score: 0.2,
          successful: false,
        }),
      },
    );
    expect(recorded.status).toBe(201);
    await expect(recorded.json()).resolves.toMatchObject({ warnings: [{ status: 'active' }] });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/skill-quality-warnings?skillId=skill.quality`).then(
        (response) => response.json(),
      ),
    ).resolves.toMatchObject({ items: [{ warningId: 'warning-1' }] });
  });

  it('fails explicitly when semantic and final selection providers are not configured', async () => {
    endpoint = await startManagementHttpEndpoint({ operations: operations() });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/skill-selections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goalDescription: 'Inspect a device.' }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SKILL_SELECTION_MODEL_NOT_CONFIGURED' },
    });
  });

  it('exposes auditable Skill induction and simulation reports', async () => {
    const proposedSkill = {
      skillId: 'skill.existing',
      name: 'Corrected Skill',
      summary: 'Corrected summary.',
      description: 'Corrected description.',
      capabilities: ['inspection'],
      workflowGuidance: 'Validate before calling the Tool.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
    };
    const candidate = {
      candidateId: 'candidate-1',
      capabilityFingerprint: 'fingerprint-1',
      successfulExperienceCount: 2,
      requiredSuccessThreshold: 2,
      sourceExperienceIds: ['experience-1', 'experience-2'],
      status: 'published' as const,
      inductionReport: {
        consistent: true,
        stable: true,
        generalizable: true,
        duplicateSkillId: 'skill.existing',
        duplicateScore: 0.9,
        evolutionKind: 'new_version' as const,
        targetSkillId: 'skill.existing',
        boundaryDecisionSummary: 'The capability boundary is unchanged.',
        decisionSummary: 'Create a new version.',
      },
      validationReport: { allPassed: true, cases: [], decisionSummary: 'All passed.' },
      publishedSkillId: 'skill.evolved',
      publishedSkillVersion: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
      evaluatedAt: '2026-07-12T00:01:00.000Z',
    };
    const correction = {
      correctionId: 'correction-1',
      candidateId: candidate.candidateId,
      capabilityFingerprint: candidate.capabilityFingerprint,
      actor: 'operator@example.test',
      summary: 'Correct boundary handling.',
      beforeSkill: proposedSkill,
      afterSkill: proposedSkill,
      diff: [{ path: '/workflowGuidance', before: 'Call.', after: 'Validate.' }],
      validationReport: candidate.validationReport,
      outcome: 'published' as const,
      createdAt: '2026-07-12T00:02:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        skillEvolution: {
          get: () => Promise.resolve(candidate),
          evaluateAndPublish: () => Promise.resolve(candidate),
          correctAndRevalidate: () => Promise.resolve({ candidate, correction }),
          listCorrections: () => Promise.resolve([correction]),
        },
      },
    });

    const read = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1`,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      status: 'published',
      validationReport: { allPassed: true },
      inductionReport: {
        evolutionKind: 'new_version',
        targetSkillId: 'skill.existing',
        boundaryDecisionSummary: 'The capability boundary is unchanged.',
      },
    });
    const simulate = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1/simulate`,
      { method: 'POST' },
    );
    expect(simulate.status).toBe(200);
    await expect(simulate.json()).resolves.toMatchObject({ publishedSkillId: 'skill.evolved' });
    const corrected = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1/corrections`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: correction.actor,
          summary: correction.summary,
          proposedSkill,
        }),
      },
    );
    expect(corrected.status).toBe(200);
    await expect(corrected.json()).resolves.toMatchObject({
      correction: { correctionId: 'correction-1', actor: 'operator@example.test' },
    });
    const history = await fetch(
      `${endpoint.baseUrl}/api/v1/skill-formalization-candidates/candidate-1/corrections`,
    );
    await expect(history.json()).resolves.toMatchObject({
      items: [{ correctionId: 'correction-1', diff: [{ path: '/workflowGuidance' }] }],
    });
  });

  it('lists replayable Evolution Experiences by Goal', async () => {
    const experience: EvolutionExperience = {
      experienceId: 'experience-1',
      controlId: 'control-1',
      roundIndex: 0,
      taskId: 'task-1',
      contextId: 'context-1',
      goal: {
        goalId: 'goal-1',
        version: 1,
        title: 'Goal',
        description: 'Complete it.',
        constraints: [],
        successCriteria: ['Complete'],
      },
      workflow: {
        workflowDefinitionId: 'workflow-1',
        version: 1,
        goalId: 'goal-1',
        goalVersion: 1,
        entryNodeId: 'result',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        edges: [],
      },
      instanceId: 'instance-1',
      skillVersions: [{ skillId: 'skill-1', version: 1 }],
      tools: [],
      input: {},
      result: true,
      errors: {},
      evaluation: { decision: 'achieved', summary: 'Complete.' },
      successful: true,
      durationMs: 10,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...operations(),
        evolutionExperiences: {
          get: () => Promise.resolve(experience),
          listByGoal: () => Promise.resolve([experience]),
          listBySkill: () => Promise.resolve([experience]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/evolution-experiences`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          goal: { goalId: 'goal-1' },
          workflow: { workflowDefinitionId: 'workflow-1' },
          evaluation: { decision: 'achieved' },
        },
      ],
    });
  });

  it('exposes the same confirmed-plan state through confirmation and execution endpoints', async () => {
    const configured = operations();
    const confirm = (planId: string) =>
      Promise.resolve({
        planId,
        goalId: 'goal-1',
        goalVersion: 1,
        confirmationStatus: 'confirmed' as const,
        confirmedAt: '2026-07-12T00:00:01.000Z',
        attemptCount: 1,
        createdAt: '2026-07-12T00:00:00.000Z',
      });
    const execute = (input: { instanceId: string; planId: string; input: unknown }) =>
      Promise.resolve({
        instanceId: input.instanceId,
        planId: input.planId,
        workflowDefinitionId: 'workflow-1',
        workflowVersion: 1,
        goalId: 'goal-1',
        goalVersion: 1,
        skillVersions: [],
        budgetLimits: {
          maxReplans: 3,
          maxDurationSeconds: 60,
          maxLlmCalls: 10,
          maxMcpCalls: 10,
          maxCost: 100,
        },
        budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
        status: 'succeeded' as const,
        input: input.input,
        errors: {},
        startedAt: '2026-07-12T00:00:00.000Z',
        completedAt: '2026-07-12T00:00:01.000Z',
      });
    endpoint = await startManagementHttpEndpoint({
      operations: { ...configured, workflows: { ...configured.workflows, confirm, execute } },
    });
    const confirmation = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/confirm`, {
      method: 'POST',
    });
    expect(confirmation.status).toBe(200);
    await expect(confirmation.json()).resolves.toMatchObject({
      planId: 'plan-1',
      confirmationStatus: 'confirmed',
      confirmedAt: '2026-07-12T00:00:01.000Z',
    });
    const execution = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'instance-1', input: { request: 'run' } }),
    });
    expect(execution.status).toBe(201);
    await expect(execution.json()).resolves.toMatchObject({
      instanceId: 'instance-1',
      planId: 'plan-1',
      status: 'succeeded',
    });
  });

  it('exposes persisted human-confirmation resume for a paused Workflow instance', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          resumeHumanConfirmation: ({ instanceId, confirmed }) =>
            Promise.resolve({
              instanceId,
              planId: 'plan-1',
              workflowDefinitionId: 'workflow-1',
              workflowVersion: 1,
              goalId: 'goal-1',
              goalVersion: 1,
              skillVersions: [],
              budgetLimits: {
                maxReplans: 3,
                maxDurationSeconds: 60,
                maxLlmCalls: 10,
                maxMcpCalls: 10,
                maxCost: 100,
              },
              budgetUsage: {
                replanCount: 0,
                durationMs: 2,
                llmCalls: 0,
                mcpCalls: 1,
                cost: 1,
              },
              status: 'succeeded' as const,
              input: {},
              result: confirmed,
              errors: {},
              startedAt: '2026-07-12T00:00:00.000Z',
              completedAt: '2026-07-12T00:00:02.000Z',
            }),
        },
      },
    });
    const response = await fetch(
      `${endpoint.baseUrl}/api/v1/workflows/instances/instance-1/human-confirmation`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      instanceId: 'instance-1',
      status: 'succeeded',
      result: true,
    });
  });

  it('returns an ordered Workflow instance trace for replay', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          trace: (instanceId) =>
            Promise.resolve({
              instance: { ...workflowInstance('plan-trace', 'succeeded'), instanceId },
              events: [
                {
                  eventId: 'event-1',
                  instanceId,
                  sequence: 1,
                  nodeId: 'start',
                  eventType: 'node_succeeded' as const,
                  timestamp: '2026-07-13T00:00:00.125Z',
                  durationMs: 125,
                  summary: 'start node succeeded.',
                },
              ],
            }),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/workflows/instances/instance-trace`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      instance: { instanceId: 'instance-trace', status: 'succeeded' },
      events: [{ sequence: 1, nodeId: 'start', eventType: 'node_succeeded', durationMs: 125 }],
    });
  });

  it('filters Task-linked runtime, model, MCP, and plan trace evidence', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        runtimeEvents: {
          listByTask: (taskId) =>
            Promise.resolve([
              {
                eventId: 'runtime-event-1',
                taskId,
                contextId: 'context-1',
                eventType: 'task.phase_changed' as const,
                timestamp: '2026-07-13T00:00:00.000Z',
                summary: 'Task executing.',
              },
            ]),
        },
        models: {
          ...configured.models,
          listInvocationsByTask: (taskId) =>
            Promise.resolve([
              {
                invocationId: 'model-invocation-1',
                taskId,
                stage: 'goal' as const,
                providerId: 'provider-1',
                model: 'model-1',
                operation: 'structured_generation' as const,
                promptId: 'prompt-goal',
                promptVersion: 3,
                request: { instruction: 'Displayable rendered prompt.' },
                context: {},
                rawResponse: { content: '{"decision":"continue"}' },
                structuredResult: { decision: 'continue', decisionSummary: 'Proceed.' },
                durationMs: 5,
                status: 'succeeded' as const,
                createdAt: '2026-07-13T00:00:00.000Z',
              },
            ]),
        },
        mcp: {
          ...configured.mcp,
          listInvocationsByTask: (taskId) =>
            Promise.resolve([
              {
                invocationId: 'mcp-invocation-1',
                taskId,
                contextId: 'context-1',
                executionMode: 'live' as const,
                serverId: 'server-1',
                toolName: 'tool-1',
                arguments: {},
                status: 'succeeded' as const,
                startedAt: '2026-07-13T00:00:00.000Z',
                completedAt: '2026-07-13T00:00:00.005Z',
                durationMs: 5,
              },
            ]),
        },
        workflows: {
          ...configured.workflows,
          traceForPlan: (planId) =>
            Promise.resolve({
              instance: workflowInstance(planId, 'succeeded'),
              events: [],
            }),
        },
      },
    });
    const [events, models, mcp, trace] = await Promise.all([
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-linked/events`).then((response) =>
        response.json(),
      ),
      fetch(`${endpoint.baseUrl}/api/v1/models/invocations?taskId=task-linked`).then((response) =>
        response.json(),
      ),
      fetch(`${endpoint.baseUrl}/api/v1/mcp/invocations?taskId=task-linked`).then((response) =>
        response.json(),
      ),
      fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-linked/trace`).then((response) =>
        response.json(),
      ),
    ]);
    expect(events).toMatchObject({ items: [{ taskId: 'task-linked' }] });
    expect(models).toMatchObject({
      items: [
        {
          taskId: 'task-linked',
          promptId: 'prompt-goal',
          promptVersion: 3,
          request: { instruction: 'Displayable rendered prompt.' },
          rawResponse: { content: '{"decision":"continue"}' },
          structuredResult: { decisionSummary: 'Proceed.' },
        },
      ],
    });
    expect(mcp).toMatchObject({ items: [{ taskId: 'task-linked' }] });
    expect(trace).toMatchObject({ instance: { planId: 'plan-linked' }, events: [] });
  });

  it('exposes plan-scoped pause, resume, and cancel execution controls', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        workflows: {
          ...configured.workflows,
          pauseForPlan: (planId) => Promise.resolve(workflowInstance(planId, 'paused')),
          resumePauseForPlan: (planId) =>
            Promise.resolve({
              disposition: 'resumed' as const,
              instance: workflowInstance(planId, 'succeeded'),
            }),
          cancelForPlan: (planId) => Promise.resolve(workflowInstance(planId, 'canceled')),
        },
      },
    });
    for (const [action, status] of [
      ['pause', 'paused'],
      ['resume', 'succeeded'],
      ['cancel', 'canceled'],
    ] as const) {
      const response = await fetch(
        `${endpoint.baseUrl}/api/v1/workflows/plans/plan-control/${action}`,
        { method: 'POST' },
      );
      expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).toContain(status);
    }
  });

  it('exposes Goal creation and the persisted outer-control entry point', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goals: {
          ...configured.goals,
          create: (input) =>
            Promise.resolve({
              ...input,
              constraints: input.constraints ?? [],
              successCriteria: input.successCriteria ?? [],
              version: 1,
              status: 'active' as const,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            }),
        },
        workflowControls: {
          ...configured.workflowControls,
          start: (input) =>
            Promise.resolve({
              ...input,
              status: 'awaiting_confirmation' as const,
              currentPlanId: input.initialPlanId,
              roundCount: 1,
              replanCount: 1,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:01.000Z',
            }),
        },
      },
    });
    const goal = await fetch(`${endpoint.baseUrl}/api/v1/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goalId: 'goal-1',
        contextId: 'context-1',
        title: 'Goal',
        description: 'Complete the task.',
      }),
    });
    expect(goal.status).toBe(201);
    await expect(goal.json()).resolves.toMatchObject({ goalId: 'goal-1', status: 'active' });
    const control = await fetch(`${endpoint.baseUrl}/api/v1/workflow-controls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        controlId: 'control-1',
        contextId: 'context-1',
        goalId: 'goal-1',
        goalVersion: 1,
        initialPlanId: 'plan-1',
        input: {},
        skillIds: ['skill-1'],
        planningInstruction: 'Complete the task.',
      }),
    });
    expect(control.status).toBe(201);
    await expect(control.json()).resolves.toMatchObject({
      controlId: 'control-1',
      status: 'awaiting_confirmation',
      replanCount: 1,
    });
  });

  it('exposes Goal Patch apply and history contracts', async () => {
    const configured = operations();
    const patch = {
      patchId: 'patch-1',
      goalId: 'goal-1',
      triggeringTaskId: 'task-1',
      fromVersion: 1,
      toVersion: 2,
      instruction: 'Add temperature.',
      changes: { successCriteria: ['Return temperature.'] },
      decisionSummary: 'Added temperature.',
      compensationWarnings: ['No automatic compensation was attempted.'],
      invalidatedPlanIds: ['plan-1'],
      invalidatedInstanceIds: ['instance-1'],
      newPlanId: 'plan-2',
      beforeGoal: goalRecord(1),
      afterGoal: { ...goalRecord(1), version: 2 },
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goalPatches: {
          apply: () => Promise.resolve(patch),
          get: () => Promise.resolve(patch),
          list: () => Promise.resolve([patch]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/patches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourcePlanId: 'plan-1',
        instruction: 'Add temperature.',
        taskId: 'task-1',
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      patchId: 'patch-1',
      triggeringTaskId: 'task-1',
      toVersion: 2,
      newPlanId: 'plan-2',
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/patches`).then((value) => value.json()),
    ).resolves.toMatchObject({ items: [{ patchId: 'patch-1' }] });
  });

  it('exposes ordered Goal and relationship history for a context', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goals: {
          ...configured.goals,
          history: () =>
            Promise.resolve({
              goals: [goalRecord(1)],
              transitions: [
                {
                  transitionId: 'transition-1',
                  contextId: 'context-1',
                  fromGoalId: 'goal-old',
                  toGoalId: 'goal-1',
                  relationship: 'related_successor',
                  decisionSummary: 'Related next phase.',
                  requestText: 'Continue.',
                  createdAt: '2026-07-12T00:00:00.000Z',
                },
              ],
            }),
        },
      },
    });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/contexts/context-1/goals`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      goals: [expect.objectContaining({ goalId: 'goal-1' })],
      transitions: [expect.objectContaining({ relationship: 'related_successor' })],
    });
  });

  it('exposes Goal cancellation and immutable cancellation history', async () => {
    const configured = operations();
    const record = {
      cancellationId: 'goal-cancellation-1',
      goalId: 'goal-1',
      goalVersion: 1,
      reason: 'Operator canceled.',
      canceledTaskIds: ['task-1'],
      invalidatedPlanIds: ['plan-1'],
      canceledInstanceIds: ['instance-1'],
      warnings: ['No automatic compensation ran.'],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        goalCancellations: {
          cancel: () => Promise.resolve(record),
          get: () => Promise.resolve(record),
          list: () => Promise.resolve([record]),
        },
      },
    });
    const response = await fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Operator canceled.' }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject(record);
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/goals/goal-1/cancellations`).then((value) => value.json()),
    ).resolves.toMatchObject({ items: [record] });
  });

  it('exposes task-plan binding and validated admin plan revision contracts', async () => {
    const configured = operations();
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        tasks: {
          ...configured.tasks,
          attachPlan: (taskId, input) =>
            Promise.resolve({
              taskId,
              contextId: 'context-1',
              userId: 'anonymous',
              requestText: 'Inspect.',
              requestMetadata: {},
              phase: 'awaiting_plan_confirmation' as const,
              phaseMessage: 'Plan confirmation required.',
              goalId: input.goalId,
              goalVersion: input.goalVersion,
              planId: input.planId,
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
            }),
          followUp: (input) =>
            Promise.resolve({
              taskId: input.taskId,
              contextId: 'context-1',
              userId: 'anonymous',
              requestText: 'Inspect.',
              requestMetadata: {},
              phase:
                input.action === 'confirm_plan'
                  ? ('executing' as const)
                  : input.action === 'reject_plan'
                    ? ('canceled' as const)
                    : ('awaiting_plan_confirmation' as const),
              phaseMessage: `Action ${input.action}.`,
              goalId: 'goal-1',
              goalVersion: 1,
              planId: input.action === 'revise_plan' ? 'plan-2' : 'plan-1',
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:01.000Z',
            }),
        },
        workflowRevisions: {
          ...configured.workflowRevisions,
          reviseAdmin: (input) =>
            Promise.resolve({
              planId: input.newPlanId,
              goalId: 'goal-1',
              goalVersion: 1,
              sourcePlanId: input.sourcePlanId,
              revisionKind:
                input.format === 'dsl' ? ('admin_dsl' as const) : ('admin_dag' as const),
              confirmationStatus: 'awaiting_confirmation' as const,
              attemptCount: 1,
              createdAt: '2026-07-12T00:00:00.000Z',
            }),
        },
      },
    });
    const attached = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/plan`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: 'plan-1', goalId: 'goal-1', goalVersion: 1 }),
    });
    expect(attached.status).toBe(200);
    await expect(attached.json()).resolves.toMatchObject({ taskId: 'task-1', planId: 'plan-1' });
    const confirmed = await fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_plan', messageText: 'Confirm.' }),
    });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({ phase: 'executing' });

    const revised = await fetch(`${endpoint.baseUrl}/api/v1/workflows/plans/plan-1/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPlanId: 'plan-2', format: 'dag', definition: { nodes: [] } }),
    });
    expect(revised.status).toBe(201);
    await expect(revised.json()).resolves.toMatchObject({
      planId: 'plan-2',
      sourcePlanId: 'plan-1',
      revisionKind: 'admin_dag',
      confirmationStatus: 'awaiting_confirmation',
    });
  });

  it('creates and semantically searches source-traceable global memories', async () => {
    const configured = operations();
    const item = {
      memoryId: 'memory-1',
      type: 'fact' as const,
      content: { deviceId: 'device-17' },
      summary: 'The target device is device-17.',
      status: 'active' as const,
      sourceRefs: ['task-source'],
      supersedes: [],
      confidence: 0.9,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    endpoint = await startManagementHttpEndpoint({
      operations: {
        ...configured,
        memories: {
          refine: () => Promise.resolve(item),
          get: () => Promise.resolve(item),
          search: () => Promise.resolve([{ item, score: 1 }]),
          supersede: () =>
            Promise.resolve({ ...item, memoryId: 'memory-2', supersedes: ['memory-1'] }),
          invalidate: () => Promise.resolve(),
          listTransitions: () => Promise.resolve([]),
        },
        goalInputInference: {
          list: () =>
            Promise.resolve([
              {
                inferenceId: 'inference-1',
                taskId: 'task-1',
                contextId: 'context-1',
                outcome: 'inferred' as const,
                decisionSummary: 'Memory identified device-17.',
                usedSources: [
                  {
                    sourceId: 'memory:memory-1',
                    kind: 'global_memory' as const,
                    summary: item.summary,
                    content: item.content,
                  },
                ],
                inferredGoal: {
                  title: 'Inspect',
                  description: 'Inspect device-17.',
                  constraints: [],
                  successCriteria: ['Inspected'],
                },
                createdAt: item.createdAt,
              },
            ]),
        },
      },
    });
    const created = await fetch(`${endpoint.baseUrl}/api/v1/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'fact',
        content: { deviceId: 'device-17' },
        summary: item.summary,
        sourceRefs: ['task-source'],
        confidence: 0.9,
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject(item);
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/memories/search?q=target%20device&limit=5`).then((value) =>
        value.json(),
      ),
    ).resolves.toMatchObject({ items: [{ item: { memoryId: 'memory-1' }, score: 1 }] });
    const superseded = await fetch(`${endpoint.baseUrl}/api/v1/memories/memory-1/supersede`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'fact',
        content: { deviceId: 'device-18' },
        summary: 'The target device is device-18.',
        sourceRefs: ['task-new'],
        confidence: 0.95,
        actor: 'operator.test',
        reason: 'New evidence.',
      }),
    });
    expect(superseded.status).toBe(201);
    await expect(superseded.json()).resolves.toMatchObject({
      memoryId: 'memory-2',
      supersedes: ['memory-1'],
    });
    expect(
      (
        await fetch(`${endpoint.baseUrl}/api/v1/memories/memory-2/invalidate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actor: 'operator.test', reason: 'Retracted.' }),
        })
      ).status,
    ).toBe(204);
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/memories/memory-1/transitions`).then((value) =>
        value.json(),
      ),
    ).resolves.toEqual({ items: [] });
    await expect(
      fetch(`${endpoint.baseUrl}/api/v1/tasks/task-1/input-inferences`).then((value) =>
        value.json(),
      ),
    ).resolves.toMatchObject({
      items: [{ outcome: 'inferred', usedSources: [{ sourceId: 'memory:memory-1' }] }],
    });
  });
});

function operations(failServerList = false): ManagementOperations {
  const unused = () => Promise.reject(new Error('UNEXPECTED_OPERATION'));
  return {
    goals: { create: unused, get: unused, history: unused },
    goalPatches: { apply: unused, get: unused, list: () => Promise.resolve([]) },
    goalCancellations: { cancel: unused, get: unused, list: () => Promise.resolve([]) },
    tasks: { attachPlan: unused, followUp: unused, get: unused, list: () => Promise.resolve([]) },
    taskWaitTimeouts: { getPolicy: unused, updatePolicy: unused },
    resultProcessing: { get: unused, list: () => Promise.resolve([]) },
    taskQuality: { getByTask: unused },
    implicitFeedback: { listByTask: () => Promise.resolve([]) },
    evaluationInfluences: { getByReport: unused },
    evaluationAnalytics: { summarize: unused },
    memories: {
      refine: unused,
      get: unused,
      search: () => Promise.resolve([]),
      supersede: unused,
      invalidate: unused,
      listTransitions: () => Promise.resolve([]),
    },
    runtimeEvents: { listByTask: () => Promise.resolve([]) },
    memoryRetention: { getPolicy: unused, updatePolicy: unused },
    goalInputInference: { list: () => Promise.resolve([]) },
    skillQuality: { record: unused, listWarnings: () => Promise.resolve([]) },
    workflowTemplates: {
      listTemplates: () => Promise.resolve([]),
      listUses: () => Promise.resolve([]),
    },
    graph: {
      create: unused,
      delete: unused,
      list: () => Promise.resolve([]),
    },
    mcp: {
      checkHealth: unused,
      delete: unused,
      listDependencyWarnings: () => Promise.resolve([]),
      listInvocations: () => Promise.resolve([]),
      listInvocationsByTask: () => Promise.resolve([]),
      listManagementOperations: () => Promise.resolve([]),
      listServers: () =>
        failServerList
          ? Promise.reject(new Error('database-password leaked by driver'))
          : Promise.resolve([
              {
                serverId: 'mcp.devices',
                name: 'Devices',
                endpoint: 'https://mcp.example.test/mcp',
                transport: 'streamable_http',
                status: 'enabled',
                toolRevision: 1,
                createdAt: '2026-07-11T10:00:00.000Z',
                updatedAt: '2026-07-11T10:00:00.000Z',
              },
            ]),
      listTools: () => Promise.resolve([]),
      refresh: unused,
      register: unused,
      updateToolEnhancement: unused,
      updateCredentials: unused,
    },
    models: {
      configureProvider: unused,
      listInvocations: () => Promise.resolve([]),
      listInvocationsByTask: () => Promise.resolve([]),
      listProviders: () => Promise.resolve([]),
      listStageRoutes: () => Promise.resolve([]),
      route: unused,
    },
    prompts: {
      create: unused,
      disable: unused,
      effect: unused,
      listVersions: () => Promise.resolve([]),
      publish: unused,
      rollback: unused,
    },
    skills: {
      diff: unused,
      listCurrentVersions: () => Promise.resolve([]),
      listVersions: () => Promise.resolve([]),
      register: unused,
      rollback: unused,
      setEnabled: unused,
    },
    temporarySkills: {
      complete: unused,
      create: unused,
      listByTask: () => Promise.resolve([]),
    },
    skillEvolution: {
      evaluateAndPublish: unused,
      get: unused,
      correctAndRevalidate: unused,
      listCorrections: () => Promise.resolve([]),
    },
    evolutionExperiences: {
      get: unused,
      listByGoal: () => Promise.resolve([]),
      listBySkill: () => Promise.resolve([]),
    },
    evolutionPolicy: {
      getPolicy: unused,
      updatePolicy: unused,
      listTriggers: () => Promise.resolve([]),
    },
    workflows: {
      cancelForPlan: unused,
      confirm: unused,
      execute: unused,
      pauseForPlan: unused,
      resumeHumanConfirmation: unused,
      resumePauseForPlan: unused,
      trace: unused,
      traceForPlan: unused,
      plan: unused,
      validate: () => Promise.resolve({ valid: false, errors: [] }),
    },
    workflowControls: {
      continueAfterConfirmation: unused,
      get: unused,
      listRounds: () => Promise.resolve([]),
      start: unused,
    },
    workflowRevisions: { get: unused, reviseAdmin: unused },
  };
}

function goalRecord(version: number) {
  return {
    goalId: 'goal-1',
    contextId: 'context-1',
    version,
    title: 'Goal',
    description: 'Complete it.',
    constraints: [],
    successCriteria: [],
    status: 'active' as const,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function workflowInstance(planId: string, status: 'paused' | 'succeeded' | 'canceled') {
  return {
    instanceId: 'instance-control',
    planId,
    workflowDefinitionId: 'workflow-control',
    workflowVersion: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
    status,
    input: {},
    errors: {},
    startedAt: '2026-07-12T00:00:00.000Z',
    ...(status === 'paused'
      ? {
          pendingConfirmation: {
            nodeId: 'next',
            prompt: 'Paused.',
            kind: 'task_pause' as const,
            pausedAt: '2026-07-12T00:00:01.000Z',
          },
        }
      : { completedAt: '2026-07-12T00:00:02.000Z' }),
  };
}
