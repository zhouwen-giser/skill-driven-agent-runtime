import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SkillPackageImporter,
  SkillPackageValidator,
} from '../../../packages/application/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import {
  governHomeLabCapabilities,
  type HomeLabCapabilityGovernanceConfiguration,
} from '../src/home-lab-capability-governance-driver.js';

const NOW = '2026-08-10T12:00:00.000Z';
const VALID_UNTIL = '2026-08-10T13:00:00.000Z';
const CONTROL_TOKEN = 'control-secret-never-report';
const CHECKSUM = 'a'.repeat(64);
const GOVERNANCE_LIFECYCLE_TEST_TIMEOUT_MS = 20_000;
const roots: string[] = [];

const EXPECTED_SKILLS = Object.freeze([
  Object.freeze({
    skillId: 'home.light.get-state',
    capabilityId: 'home.light.read-state',
    toolName: 'light_get_state',
    evidenceType: 'light.state.observation',
  }),
  Object.freeze({
    skillId: 'home.light.set-power',
    capabilityId: 'home.light.set-power',
    toolName: 'light_set_power',
    evidenceType: 'light.state.observation',
  }),
  Object.freeze({
    skillId: 'home.climate.get-state',
    capabilityId: 'home.climate.read-state',
    toolName: 'climate_get_state',
    evidenceType: 'climate.state.observation',
  }),
  Object.freeze({
    skillId: 'home.climate.set-hvac-mode',
    capabilityId: 'home.climate.set-hvac-mode',
    toolName: 'climate_set_hvac_mode',
    evidenceType: 'climate.hvac_mode.observation',
  }),
  Object.freeze({
    skillId: 'home.climate.set-temperature',
    capabilityId: 'home.climate.set-temperature',
    toolName: 'climate_set_temperature',
    evidenceType: 'climate.target_temperature.observation',
  }),
]);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

describe('home-lab Capability and Skill governance driver', () => {
  it(
    'imports and publishes five exact Skills and five non-physical Capabilities',
    async () => {
      const root = workspaceRoot();
      const api = new FakeGovernanceApis();
      const report = await governHomeLabCapabilities(await configuration(root, true), {
        fetch: api.fetch,
        now: () => NOW,
      });

      expect(report.capabilityGovernanceReady).toBe(true);
      expect(report.runtimeCapabilityReadiness).toBe('available');
      expect(report.skills).toHaveLength(5);
      expect(report.capabilities).toHaveLength(5);
      expect(
        report.skills.map(({ skillId, taskType, mcpToolName }) => ({
          skillId,
          taskType,
          mcpToolName,
        })),
      ).toEqual(
        EXPECTED_SKILLS.map(({ skillId, toolName }) => ({
          skillId,
          taskType: toolName,
          mcpToolName: toolName,
        })),
      );
      expect(report.resourcePolicy).toEqual({
        identifierAuthority: 'public_resource_id',
        auxiliaryLightIncluded: true,
        allowedResourceIds: [
          'living-room-main-light',
          'living-room-air-conditioner',
          'living-room-aux-light',
        ],
        physicalResourceBindings: 0,
      });
      expect(api.uniqueMutations('skill-import')).toBe(5);
      expect(api.uniqueMutations('skill-publish')).toBe(5);
      expect(api.uniqueMutations('capability-create')).toBe(5);
      expect(api.uniqueMutations('capability-implementation')).toBe(5);
      expect(api.uniqueMutations('capability-validate')).toBe(5);
      expect(api.uniqueMutations('capability-publish')).toBe(5);
      expect(api.uniqueMutations('capability-readiness')).toBe(5);

      const packageSchema = JSON.parse(
        await readFile('schemas/skill-package.schema.json', 'utf8'),
      ) as unknown;
      const importer = new SkillPackageImporter({
        reader: new NodeSkillPackageReader(),
        validator: new SkillPackageValidator({
          schemas: new AjvJsonSchemaValidator(),
          packageSchema,
        }),
        clock: { now: () => NOW },
      });
      for (const expected of EXPECTED_SKILLS) {
        const candidate = await importer.import(join(root, expected.skillId, 'v1'));
        expect(candidate.skillVersion.skillId).toBe(expected.skillId);
        expect(candidate.skillVersion.version).toBe(1);
        expect(candidate.skillVersion.status).toBe('draft');
        expect(candidate.skillVersion.validationPassed).toBe(true);
        expect(candidate.skillVersion.usageSpecification?.taskBindings).toEqual([
          expect.objectContaining({
            taskType: expected.toolName,
            providerPolicy: expect.objectContaining({
              selection: 'required',
              requiredAttributes: [
                `task_behavior:${expected.toolName.endsWith('get_state') ? 'synchronous_only' : 'task_required'}`,
              ],
            }),
          }),
        ]);
        expect(candidate.skillVersion.usageSpecification?.modes).toEqual({
          supported: ['procedure'],
          defaultMode: 'procedure',
          procedure: {
            summary: 'Deterministic exact-version home-lab execution.',
            instructions: [
              'Validate resourceId, confirmation, Provider Binding freshness and required evidence.',
            ],
          },
        });
        expect(candidate.skillVersion.usageSpecification?.evidencePolicy).toEqual({
          requirements: [
            {
              requirementId: 'evidence-1',
              evidenceType: expected.evidenceType,
              required: true,
              hardGate: true,
            },
          ],
          rejectSuccessWithoutRequiredEvidence: true,
        });
        expect(candidate.skillVersion.toolPolicy.required).toEqual([
          expect.objectContaining({ toolName: expected.toolName }),
        ]);
      }

      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(CONTROL_TOKEN);
      expect(serialized).not.toContain('http://127.0.0.1');
      expect(serialized).not.toContain('sensitive-preflight-only');
      expect(serialized).not.toContain('never-projected');
      expect(serialized).not.toContain('light.living_room');
      expect(report.redaction).toEqual({
        secretsIncluded: false,
        endpointsIncluded: false,
        entityIdsIncluded: false,
      });
    },
    GOVERNANCE_LIFECYCLE_TEST_TIMEOUT_MS,
  );

  it(
    'replays the same run without duplicating exact-version authority records',
    async () => {
      const root = workspaceRoot();
      const api = new FakeGovernanceApis();
      const config = await configuration(root, false);
      await governHomeLabCapabilities(config, { fetch: api.fetch, now: () => NOW });
      const uniqueAfterFirst = api.uniqueMutationCount;
      const replay = await governHomeLabCapabilities(config, {
        fetch: api.fetch,
        now: () => NOW,
      });

      expect(api.uniqueMutationCount).toBe(uniqueAfterFirst);
      expect(replay.skills.every(({ action }) => action === 'reconciled')).toBe(true);
      expect(replay.resourcePolicy.auxiliaryLightIncluded).toBe(false);
      expect(JSON.stringify(replay)).not.toContain('living-room-aux-light');
      expect(api.callsFor('skill-import')).toBe(5);
      expect(api.callsFor('skill-publish')).toBe(10);
      expect(api.callsFor('capability-create')).toBe(5);
      expect(api.callsFor('capability-publish')).toBe(5);
      expect(api.callsFor('capability-readiness')).toBe(10);
    },
    GOVERNANCE_LIFECYCLE_TEST_TIMEOUT_MS,
  );

  it(
    'evaluates every Capability before one bounded readiness stability wait',
    async () => {
      const root = workspaceRoot();
      const api = new FakeGovernanceApis();
      api.readinessStabilityOnce = true;
      const delays: number[] = [];

      const report = await governHomeLabCapabilities(await configuration(root, false), {
        fetch: api.fetch,
        now: () => NOW,
        delay: (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      });

      expect(report.runtimeCapabilityReadiness).toBe('available');
      expect(delays).toEqual([10_250]);
      expect(api.uniqueMutations('capability-readiness')).toBe(10);
      expect(api.callsFor('capability-readiness')).toBe(10);
    },
    GOVERNANCE_LIFECYCLE_TEST_TIMEOUT_MS,
  );

  it('rejects Tool aliases and case drift before any package or API mutation', async () => {
    const root = workspaceRoot();
    const api = new FakeGovernanceApis();
    api.lightReadToolName = 'Light_Get_State';

    await expect(
      governHomeLabCapabilities(await configuration(root, false), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'MCP_TOOL_IDENTITY_NOT_EXACT' });
    expect(api.uniqueMutationCount).toBe(0);
  });

  it('derives the auxiliary-light allowlist only from current reachable Preflight evidence', async () => {
    const root = workspaceRoot();
    const api = new FakeGovernanceApis();
    const config = await configuration(root, true);
    const preflight = JSON.parse(await readFile(config.preflightReportFile, 'utf8')) as Record<
      string,
      unknown
    >;
    const resources = preflight['resources'];
    if (!Array.isArray(resources)) throw new Error('PREFLIGHT_FIXTURE_RESOURCES_MISSING');
    const auxiliary = resources.find(
      (resource) => isRecord(resource) && resource['resourceId'] === 'living-room-aux-light',
    );
    if (!isRecord(auxiliary)) throw new Error('PREFLIGHT_FIXTURE_AUXILIARY_MISSING');
    auxiliary['reachable'] = false;
    await writeFile(config.preflightReportFile, JSON.stringify(preflight), 'utf8');

    await expect(
      governHomeLabCapabilities(config, { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_EVIDENCE_INVALID' });
    expect(api.uniqueMutationCount).toBe(0);
  });

  it(
    'rejects ambiguous or physical implementation authority before further mutation',
    async () => {
      const root = workspaceRoot();
      const api = new FakeGovernanceApis();
      const config = await configuration(root, false);
      await governHomeLabCapabilities(config, { fetch: api.fetch, now: () => NOW });
      const before = api.uniqueMutationCount;
      api.injectPhysicalImplementation('home.light.read-state');

      await expect(
        governHomeLabCapabilities(config, { fetch: api.fetch, now: () => NOW }),
      ).rejects.toMatchObject({ code: 'CAPABILITY_IMPLEMENTATION_AUTHORITY_AMBIGUOUS' });
      expect(api.uniqueMutationCount).toBe(before);
    },
    GOVERNANCE_LIFECYCLE_TEST_TIMEOUT_MS,
  );
});

function workspaceRoot(): string {
  const root = join(tmpdir(), `sdar-home-lab-governance-${randomUUID()}`);
  roots.push(root);
  return root;
}

async function configuration(
  packageWorkspaceRoot: string,
  auxiliaryLightPreflightAvailable: boolean,
): Promise<HomeLabCapabilityGovernanceConfiguration> {
  await mkdir(packageWorkspaceRoot, { recursive: true });
  const preflightReportFile = join(packageWorkspaceRoot, 'ha-preflight.json');
  await writeFile(
    preflightReportFile,
    JSON.stringify({
      evidenceClass: 'real',
      phase: 'P1_HA_READ_ONLY_PREFLIGHT',
      completedAt: '2026-08-10T11:59:00.000Z',
      status: 'passed',
      readOnly: true,
      sideEffectsAttempted: false,
      environment: 'home-lab',
      resources: [
        {
          resourceId: 'living-room-air-conditioner',
          domain: 'climate',
          reachable: true,
          observedAt: '2026-08-10T11:58:00.000Z',
          entityHash: 'never-projected',
        },
        {
          resourceId: 'living-room-main-light',
          domain: 'light',
          reachable: true,
          observedAt: '2026-08-10T11:58:00.000Z',
          entityHash: 'never-projected',
        },
        ...(auxiliaryLightPreflightAvailable
          ? [
              {
                resourceId: 'living-room-aux-light',
                domain: 'light',
                reachable: true,
                observedAt: '2026-08-10T11:58:00.000Z',
                entityHash: 'never-projected',
              },
            ]
          : []),
      ],
      homeAssistantUrl: 'http://sensitive-preflight-only.invalid',
      token: { path: '<redacted>', present: true },
    }),
    'utf8',
  );
  return Object.freeze({
    nodeControlBaseUrl: 'http://127.0.0.1:10080',
    nodeControlBearerToken: CONTROL_TOKEN,
    runtimeManagementBaseUrl: 'http://127.0.0.1:9998',
    packageWorkspaceRoot,
    preflightReportFile,
    preflightMaximumAgeMs: 3_600_000,
    runId: 'home-lab-governance-test-run',
  });
}

class FakeGovernanceApis {
  readonly #runtimeSkills = new Map<string, Record<string, unknown>>();
  readonly #governedSkills = new Set<string>();
  readonly #capabilities = new Map<string, Record<string, unknown>>();
  readonly #implementations = new Map<string, Record<string, unknown>[]>();
  readonly #receipts = new Map<string, unknown>();
  readonly #mutationCalls: string[] = [];
  readonly #readinessStabilitySeen = new Set<string>();
  lightReadToolName = 'light_get_state';
  readinessStabilityOnce = false;

  get uniqueMutationCount(): number {
    return this.#receipts.size;
  }

  uniqueMutations(scope: string): number {
    return [...this.#receipts.keys()].filter((key) => key.includes(scope)).length;
  }

  callsFor(scope: string): number {
    return this.#mutationCalls.filter((key) => key.includes(scope)).length;
  }

  injectPhysicalImplementation(capabilityId: string): void {
    const current = this.#implementations.get(capabilityId) ?? [];
    current.push({
      bindingId: 'forbidden-physical-resource-binding',
      capabilityId,
      capabilityVersion: 1,
      implementationType: 'skill',
      implementationId: 'home.light.get-state',
      implementationVersion: '1',
      role: 'primary',
      priority: 99,
      providerPolicyOverride: { physicalResourceId: 'forbidden' },
      status: 'active',
      revision: 1,
    });
    this.#implementations.set(capabilityId, current);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname.startsWith('/api/v1/mcp-provider-bindings/'))
      return json(200, providerBinding(url.pathname.includes('climate') ? 'climate' : 'light'));
    if (method === 'GET' && url.pathname.endsWith('/tools')) {
      const provider = url.pathname.includes('climate') ? 'climate' : 'light';
      return json(200, { items: tools(provider, this.lightReadToolName) });
    }

    const runtimeSkill = /^\/api\/v1\/skills\/(.+)\/versions\/1$/u.exec(url.pathname);
    if (method === 'GET' && runtimeSkill !== null && url.port === '9998') {
      const skillId = decodeURIComponent(capture(runtimeSkill, 1));
      const skill = this.#runtimeSkills.get(skillId);
      return skill === undefined ? json(404, { code: 'SKILL_NOT_FOUND' }) : json(200, skill);
    }
    if (method === 'GET' && runtimeSkill !== null) {
      const skillId = decodeURIComponent(capture(runtimeSkill, 1));
      const skill = this.#runtimeSkills.get(skillId);
      if (skill === undefined) return json(404, { code: 'SKILL_NOT_FOUND' });
      return json(200, governedSkill(skill, this.#governedSkills.has(skillId)));
    }
    if (method === 'POST' && url.pathname === '/api/v1/skills/import') {
      const key = idempotencyKey(init);
      return this.mutate(key, async () => {
        const body = parsedBody(init);
        const payload = body['payload'];
        if (!isRecord(payload) || typeof payload['packageRoot'] !== 'string')
          return { status: 'failed', errorCode: 'PACKAGE_ROOT_INVALID' };
        const manifest = JSON.parse(
          await readFile(join(payload['packageRoot'], 'manifest.json'), 'utf8'),
        ) as Record<string, unknown>;
        const skill = manifest['skill'];
        if (!isRecord(skill) || typeof skill['skillId'] !== 'string')
          return { status: 'failed', errorCode: 'SKILL_MANIFEST_INVALID' };
        const normative = JSON.parse(
          await readFile(join(payload['packageRoot'], 'normative.json'), 'utf8'),
        ) as Record<string, unknown>;
        const adaptive = JSON.parse(
          await readFile(join(payload['packageRoot'], 'adaptive.json'), 'utf8'),
        ) as Record<string, unknown>;
        const modes = JSON.parse(
          await readFile(join(payload['packageRoot'], 'modes.json'), 'utf8'),
        ) as Record<string, unknown>;
        const evidence = JSON.parse(
          await readFile(join(payload['packageRoot'], 'evidence.json'), 'utf8'),
        ) as Record<string, unknown>;
        this.#runtimeSkills.set(skill['skillId'], {
          ...skill,
          usageSpecification: {
            apiVersion: 'sdar.io/v1alpha1',
            visibility: normative['visibility'],
            normative: normative['normative'],
            contextRequirements: normative['contextRequirements'],
            taskBindings: normative['taskBindings'],
            adaptive: adaptive['adaptive'],
            modes,
            evidencePolicy: evidence,
          },
        });
        return { status: 'succeeded' };
      });
    }
    if (method === 'POST' && url.pathname.endsWith('/publish') && runtimeSkillPath(url.pathname)) {
      const skillId = decodeURIComponent(pathSegment(url.pathname, 4));
      const key = idempotencyKey(init);
      return this.mutate(key, () => {
        this.#governedSkills.add(skillId);
        const current = this.#runtimeSkills.get(skillId);
        if (current !== undefined)
          this.#runtimeSkills.set(skillId, { ...current, status: 'enabled' });
        return { status: 'succeeded' };
      });
    }

    const capabilityMatch = /^\/api\/v1\/node-capabilities\/(.+)\/versions\/1$/u.exec(url.pathname);
    if (method === 'GET' && capabilityMatch !== null) {
      const capabilityId = decodeURIComponent(capture(capabilityMatch, 1));
      const capability = this.#capabilities.get(capabilityId);
      return capability === undefined
        ? json(404, { code: 'NODE_CAPABILITY_NOT_FOUND' })
        : json(200, capability);
    }
    const implementationMatch =
      /^\/api\/v1\/node-capabilities\/(.+)\/versions\/1\/implementations$/u.exec(url.pathname);
    if (method === 'GET' && implementationMatch !== null) {
      const capabilityId = decodeURIComponent(capture(implementationMatch, 1));
      return json(200, { items: this.#implementations.get(capabilityId) ?? [] });
    }
    if (method === 'POST' && url.pathname === '/api/v1/node-capabilities') {
      const body = parsedBody(init);
      const capabilityId = String(body['capabilityId']);
      return this.mutate(
        idempotencyKey(init),
        () => {
          this.#capabilities.set(capabilityId, body);
          return body;
        },
        201,
      );
    }
    if (method === 'POST' && implementationMatch !== null) {
      const capabilityId = decodeURIComponent(capture(implementationMatch, 1));
      const body = parsedBody(init);
      return this.mutate(
        idempotencyKey(init),
        () => {
          this.#implementations.set(capabilityId, [body]);
          return body;
        },
        201,
      );
    }
    const transition =
      /^\/api\/v1\/node-capabilities\/(.+)\/versions\/1\/(validate|publish)$/u.exec(url.pathname);
    if (method === 'POST' && transition !== null) {
      const capabilityId = decodeURIComponent(capture(transition, 1));
      const action = capture(transition, 2);
      return this.mutate(
        idempotencyKey(init),
        () => {
          const capability = this.#capabilities.get(capabilityId);
          if (capability === undefined) return { status: 'failed' };
          const next = {
            ...capability,
            status: action === 'validate' ? 'validating' : 'published',
          };
          this.#capabilities.set(capabilityId, next);
          return action === 'validate' ? next : { status: 'succeeded' };
        },
        action === 'validate' ? 200 : 202,
      );
    }
    const readiness = /^\/api\/v1\/capability-readiness\/(.+)\/1\/evaluate$/u.exec(url.pathname);
    if (method === 'POST' && readiness !== null) {
      const capabilityId = decodeURIComponent(capture(readiness, 1));
      return this.mutate(idempotencyKey(init), () => {
        const stabilityWindow =
          this.readinessStabilityOnce && !this.#readinessStabilitySeen.has(capabilityId);
        this.#readinessStabilitySeen.add(capabilityId);
        return {
          status: 'succeeded',
          result: {
            capabilityId,
            capabilityVersion: 1,
            status: stabilityWindow ? 'unavailable' : 'available',
            validUntil: VALID_UNTIL,
            availableImplementations: [`capability-binding-${capabilityId}-v1`],
            unavailableImplementations: [],
            ...(stabilityWindow
              ? {
                  reasons: [
                    {
                      code: 'READINESS_STABILITY_WINDOW',
                      severity: 'info',
                    },
                  ],
                }
              : {}),
          },
        };
      });
    }
    return json(500, { code: 'UNEXPECTED_FAKE_ROUTE' });
  };

  private async mutate(key: string, apply: () => unknown, status = 202): Promise<Response> {
    this.#mutationCalls.push(key);
    const replay = this.#receipts.get(key);
    if (replay !== undefined) return json(status, replay);
    const result = await apply();
    this.#receipts.set(key, result);
    return json(status, result);
  }
}

type ProviderKind = 'light' | 'climate';

function providerBinding(provider: ProviderKind) {
  return {
    bindingId: `mcp-binding-ha-${provider}-lab`,
    localServerId: `sdar-ha-${provider}-lab`,
    originType: 'smpp_registry',
    status: 'active',
    availabilityStatus: 'available',
    availabilityValidUntil: VALID_UNTIL,
    registryRevision: 3,
    registryChecksum: CHECKSUM,
    catalogRevision: '1.0.0:1',
    catalogChecksum: CHECKSUM,
  };
}

function tools(provider: ProviderKind, lightReadToolName: string) {
  const names =
    provider === 'climate'
      ? [
          'climate_get_state',
          'climate_set_power',
          'climate_set_hvac_mode',
          'climate_set_temperature',
        ]
      : [lightReadToolName, 'light_set_power', 'light_set_brightness'];
  return names.map((toolName) => ({
    serverId: `sdar-ha-${provider}-lab`,
    toolName,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        resourceId: { type: 'string' },
        ...(toolName.endsWith('set_power') ? { power: { type: 'boolean' } } : {}),
        ...(toolName.endsWith('set_hvac_mode') ? { hvacMode: { type: 'string' } } : {}),
        ...(toolName.endsWith('set_temperature')
          ? { temperature: { type: 'number', minimum: 16, maximum: 30 } }
          : {}),
      },
      required: ['resourceId'],
    },
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: { resourceId: { type: 'string' }, state: { type: 'object' } },
      required: ['resourceId'],
    },
    protocolMode: 'frozen_v1',
    taskExecutionProfile: {
      taskBehavior: toolName.endsWith('get_state') ? 'synchronous_only' : 'task_required',
    },
  }));
}

function governedSkill(skill: Record<string, unknown>, governed: boolean) {
  const toolPolicy = skill['toolPolicy'];
  const outcome = skill['outcomeSpecification'];
  return {
    skillId: skill['skillId'],
    version: '1',
    status: governed ? 'published' : 'validated',
    inputSchema: skill['inputSchema'],
    outputSchema: skill['outputSchema'],
    usageSpecification: skill['usageSpecification'],
    outcomeSpecification: outcome,
    providerPolicy: {
      required: isRecord(toolPolicy) ? toolPolicy['required'] : [],
      optional: isRecord(toolPolicy) ? toolPolicy['optional'] : [],
      forbidden: isRecord(toolPolicy) ? toolPolicy['forbidden'] : [],
    },
    evidencePolicy: {
      requiredEvidence: isRecord(outcome) ? outcome['evidence'] : [],
    },
  };
}

function runtimeSkillPath(pathname: string): boolean {
  return /^\/api\/v1\/skills\/.+\/versions\/1\/publish$/u.test(pathname);
}

function capture(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error('FAKE_ROUTE_CAPTURE_MISSING');
  return value;
}

function pathSegment(pathname: string, index: number): string {
  const value = pathname.split('/')[index];
  if (value === undefined) throw new Error('FAKE_ROUTE_SEGMENT_MISSING');
  return value;
}

function idempotencyKey(init: RequestInit | undefined): string {
  const headers = new Headers(init?.headers);
  const value = headers.get('idempotency-key');
  if (value === null) throw new Error('FAKE_IDEMPOTENCY_KEY_MISSING');
  return value;
}

function parsedBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('FAKE_REQUEST_BODY_INVALID');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
