import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  remediateUgvSmppControlAuthorities,
  writeRedactedUgvSmppControlAuthorityRemediationReport,
} from '../src/ugv-smpp-control-authority-remediation-driver.js';
import type { UgvSmppControlAuthorityRemediationError } from '../src/ugv-smpp-control-authority-remediation-driver.js';

const NODE_CONTROL = 'http://node-control.test';
const RUNTIME = 'http://runtime.test';
const TOKEN = 'control-token-that-must-not-leak';
const FIRE_SKILL_ID = 'ugv.fire-weapon';
const FIRE_CAPABILITY_ID = 'vehicle.ugv.fire-weapon';
const CONTROLS = [
  ['vehicle_navigate', 'ugv.navigate', 'vehicle.ugv.navigate', 'medium'],
  ['vehicle_area_recon', 'ugv.area-recon', 'vehicle.ugv.recon', 'medium'],
  ['vehicle_track_target', 'ugv.track-target', 'vehicle.ugv.track-target', 'medium'],
  ['vehicle_control_gimbal', 'ugv.control-gimbal', 'vehicle.ugv.control-gimbal', 'medium'],
  ['vehicle_emergency_stop', 'ugv.emergency-stop', 'vehicle.ugv.emergency-stop', 'high'],
] as const;

describe('UGV SMPP control authority remediation driver', () => {
  it('suspends only the exact five live control authorities with dynamic revisions and ETags', async () => {
    const api = new RemediationApi('published');
    const times = ['2026-08-12T06:00:00.000Z', '2026-08-12T06:00:01.000Z'];

    const report = await remediateUgvSmppControlAuthorities(configuration(), {
      fetch: api.fetch,
      now: () => times.shift() ?? '2026-08-12T06:00:01.000Z',
    });

    expect(report).toMatchObject({
      status: 'passed',
      authorityCount: 5,
      governanceMutationPerformed: true,
      firePolicy: {
        toolName: 'vehicle_fire_weapon',
        runtimeSkillAbsent: true,
        governedSkillAbsent: true,
        capabilityAbsent: true,
        readinessAbsent: true,
        readinessAvailable: false,
      },
      safety: {
        mcpInvocationPerformed: false,
        deviceRequestPerformed: false,
        physicalToolAcceptanceClaimed: false,
      },
      redaction: {
        secretsIncluded: false,
        endpointsIncluded: false,
        credentialReferencesIncluded: false,
        sensitivePayloadsIncluded: false,
        entityIdsIncluded: true,
      },
    });
    expect(report.controls).toHaveLength(5);
    expect(
      report.controls.map(
        ({ skillId, capabilityId, skillGovernanceRevisionUsed, actions, after }) => ({
          skillId,
          capabilityId,
          skillGovernanceRevisionUsed,
          actions,
          after,
        }),
      ),
    ).toEqual(
      CONTROLS.map(([, skillId, capabilityId], index) => ({
        skillId,
        capabilityId,
        skillGovernanceRevisionUsed: index + 3,
        actions: {
          skill: 'suspended',
          capability: 'suspended',
          readiness: 'evaluated_suspended',
        },
        after: {
          runtimeSkillStatus: 'disabled',
          governedSkillStatus: 'suspended',
          capabilityStatus: 'suspended',
          readinessStatus: 'suspended',
          readinessHasBlockingReason: true,
          admissionAvailable: false,
        },
      })),
    );

    expect(api.posts()).toHaveLength(15);
    expect(api.posts().every(({ url }) => url.origin === NODE_CONTROL)).toBe(true);
    expect(api.calls.some(({ url }) => /(?:mcp|device|tool-invocation)/iu.test(url.pathname))).toBe(
      false,
    );
    for (const [, skillId, capabilityId] of CONTROLS) {
      const skillCall = api.postFor(`/api/v1/skills/${skillId}/versions/1/suspend`);
      expect(skillCall.body).toMatchObject({
        expectedRevision: CONTROLS.findIndex(([, id]) => id === skillId) + 3,
      });
      expect(skillCall.headers.get('idempotency-key')).toMatch(/^remediation-run-001-/u);
      const capabilityCall = api.postFor(
        `/api/v1/node-capabilities/${capabilityId}/versions/1/suspend`,
      );
      expect(capabilityCall.headers.get('if-match')).toBe(etag(capabilityId, 'published'));
      expect(capabilityCall.headers.get('idempotency-key')).toMatch(/^remediation-run-001-/u);
    }

    const directory = await mkdtemp(join(tmpdir(), 'ugv-remediation-report-'));
    try {
      const reportFile = join(directory, 'remediation.redacted.json');
      await writeRedactedUgvSmppControlAuthorityRemediationReport(reportFile, report);
      const serialized = await readFile(reportFile, 'utf8');
      expect(JSON.parse(serialized)).toEqual(report);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain(NODE_CONTROL);
      expect(serialized).not.toContain(RUNTIME);
      expect(serialized).not.toMatch(/https?:\/\//iu);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('is idempotent when every exact authority and readiness snapshot is already suspended', async () => {
    const api = new RemediationApi('suspended');

    const report = await remediateUgvSmppControlAuthorities(configuration(), {
      fetch: api.fetch,
      now: () => '2026-08-12T06:00:00.000Z',
    });

    expect(report.governanceMutationPerformed).toBe(false);
    expect(report.controls.every(({ actions }) => actions.skill === 'already_suspended')).toBe(
      true,
    );
    expect(report.controls.every(({ actions }) => actions.capability === 'already_suspended')).toBe(
      true,
    );
    expect(report.controls.every(({ actions }) => actions.readiness === 'already_suspended')).toBe(
      true,
    );
    expect(api.posts()).toHaveLength(0);
    expect(api.calls.some(({ url }) => url.pathname === '/api/v1/management-operations')).toBe(
      false,
    );
  });

  it('fails before every mutation when the current Skill governance revision is unavailable', async () => {
    const api = new RemediationApi('published');
    api.omitGovernanceOperations = true;

    await expect(
      remediateUgvSmppControlAuthorities(configuration(), {
        fetch: api.fetch,
        now: () => '2026-08-12T06:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      code: 'SKILL_GOVERNANCE_REVISION_UNAVAILABLE',
    } satisfies Partial<UgvSmppControlAuthorityRemediationError>);
    expect(api.posts()).toHaveLength(0);
  });

  it('fails before every mutation when any fire Skill or Capability authority exists', async () => {
    const api = new RemediationApi('published');
    api.fireCapabilityPresent = true;

    await expect(
      remediateUgvSmppControlAuthorities(configuration(), {
        fetch: api.fetch,
        now: () => '2026-08-12T06:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'FIRE_AUTHORITY_PRESENT' });
    expect(api.posts()).toHaveLength(0);
  });
});

function configuration() {
  return {
    nodeControlBaseUrl: `${NODE_CONTROL}/`,
    nodeControlBearerToken: TOKEN,
    runtimeManagementBaseUrl: `${RUNTIME}/`,
    runId: 'remediation-run-001',
  } as const;
}

type Lifecycle = 'published' | 'suspended';

interface RecordedCall {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: Readonly<Record<string, unknown>>;
}

class RemediationApi {
  readonly calls: RecordedCall[] = [];
  readonly #skillState = new Map<string, 'enabled' | 'disabled'>();
  readonly #governedState = new Map<string, Lifecycle>();
  readonly #capabilityState = new Map<string, Lifecycle>();
  readonly #readinessState = new Map<string, 'available' | 'suspended'>();
  readonly #revisions = new Map<string, number>();
  fireCapabilityPresent = false;
  omitGovernanceOperations = false;

  constructor(lifecycle: Lifecycle) {
    CONTROLS.forEach(([, skillId, capabilityId], index) => {
      this.#skillState.set(skillId, lifecycle === 'published' ? 'enabled' : 'disabled');
      this.#governedState.set(skillId, lifecycle);
      this.#capabilityState.set(capabilityId, lifecycle);
      this.#readinessState.set(capabilityId, lifecycle === 'published' ? 'available' : 'suspended');
      this.#revisions.set(skillId, index + 3);
    });
  }

  readonly fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : {}));
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Readonly<Record<string, unknown>>)
        : undefined;
    this.calls.push({ url, method, headers, ...(body === undefined ? {} : { body }) });
    if (url.origin === RUNTIME) return Promise.resolve(this.#runtime(url, method));
    if (url.origin !== NODE_CONTROL)
      return Promise.resolve(json({ code: 'UNEXPECTED_ORIGIN' }, 500));
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    return Promise.resolve(this.#control(url, method, headers, body));
  };

  posts(): readonly RecordedCall[] {
    return this.calls.filter(({ method }) => method === 'POST');
  }

  postFor(path: string): RecordedCall {
    const found = this.posts().find(({ url }) => decodeURIComponent(url.pathname) === path);
    if (found === undefined) throw new Error(`Missing POST ${path}`);
    return found;
  }

  #runtime(url: URL, method: string): Response {
    if (method !== 'GET') return json({ code: 'RUNTIME_MUTATION_FORBIDDEN' }, 500);
    const match = /^\/api\/v1\/skills\/(.+)\/versions\/1$/u.exec(url.pathname);
    if (match === null) return json({ code: 'UNEXPECTED_RUNTIME_PATH' }, 500);
    const skillId = decodeURIComponent(requiredCapture(match, 1));
    if (skillId === FIRE_SKILL_ID) return json({ code: 'NOT_FOUND' }, 404);
    const control = CONTROLS.find(([, expected]) => expected === skillId);
    if (control === undefined) return json({ code: 'NOT_FOUND' }, 404);
    const [toolName, , capabilityId] = control;
    const status = this.#skillState.get(skillId);
    if (status === undefined) return json({ code: 'NOT_FOUND' }, 404);
    return json(runtimeSkill(toolName, skillId, capabilityId, status));
  }

  #control(
    url: URL,
    method: string,
    headers: Headers,
    body: Readonly<Record<string, unknown>> | undefined,
  ): Response {
    if (method === 'GET' && url.pathname === '/api/v1/management-operations')
      return json({ items: this.omitGovernanceOperations ? [] : this.#operations() });

    const skill = /^\/api\/v1\/skills\/(.+)\/versions\/1$/u.exec(url.pathname);
    if (method === 'GET' && skill !== null) {
      const skillId = decodeURIComponent(requiredCapture(skill, 1));
      if (skillId === FIRE_SKILL_ID) return json({ code: 'NOT_FOUND' }, 404);
      const status = this.#governedState.get(skillId);
      if (status === undefined) return json({ code: 'NOT_FOUND' }, 404);
      return json({ skillId, version: '1', status });
    }

    const skillSuspend = /^\/api\/v1\/skills\/(.+)\/versions\/1\/suspend$/u.exec(url.pathname);
    if (method === 'POST' && skillSuspend !== null) {
      const skillId = decodeURIComponent(requiredCapture(skillSuspend, 1));
      expect(body?.['expectedRevision']).toBe(this.#revisions.get(skillId));
      expect(headers.get('idempotency-key')).toBeTruthy();
      this.#skillState.set(skillId, 'disabled');
      this.#governedState.set(skillId, 'suspended');
      this.#revisions.set(skillId, (this.#revisions.get(skillId) ?? 0) + 1);
      return operation({ skillId, version: '1', status: 'suspended' });
    }

    const capability = /^\/api\/v1\/node-capabilities\/(.+)\/versions\/1$/u.exec(url.pathname);
    if (method === 'GET' && capability !== null) {
      const capabilityId = decodeURIComponent(requiredCapture(capability, 1));
      if (capabilityId === FIRE_CAPABILITY_ID) {
        if (!this.fireCapabilityPresent) return json({ code: 'NOT_FOUND' }, 404);
        return json(capabilityView(capabilityId, 'published', 'critical'), 200, {
          etag: etag(capabilityId, 'published'),
        });
      }
      const control = CONTROLS.find(([, , expected]) => expected === capabilityId);
      const status = this.#capabilityState.get(capabilityId);
      if (control === undefined || status === undefined) return json({ code: 'NOT_FOUND' }, 404);
      return json(capabilityView(capabilityId, status, control[3]), 200, {
        etag: etag(capabilityId, status),
      });
    }

    const implementations =
      /^\/api\/v1\/node-capabilities\/(.+)\/versions\/1\/implementations$/u.exec(url.pathname);
    if (method === 'GET' && implementations !== null) {
      const capabilityId = decodeURIComponent(requiredCapture(implementations, 1));
      const control = CONTROLS.find(([, , expected]) => expected === capabilityId);
      if (control === undefined) return json({ code: 'NOT_FOUND' }, 404);
      return json({
        items: [
          {
            bindingId: `implementation-${control[1]}`,
            capabilityId,
            capabilityVersion: 1,
            implementationType: 'skill',
            implementationId: control[1],
            implementationVersion: '1',
            role: 'primary',
            priority: 0,
            status: 'active',
            revision: 1,
          },
        ],
      });
    }

    const capabilitySuspend = /^\/api\/v1\/node-capabilities\/(.+)\/versions\/1\/suspend$/u.exec(
      url.pathname,
    );
    if (method === 'POST' && capabilitySuspend !== null) {
      const capabilityId = decodeURIComponent(requiredCapture(capabilitySuspend, 1));
      expect(headers.get('if-match')).toBe(etag(capabilityId, 'published'));
      expect(headers.get('idempotency-key')).toBeTruthy();
      this.#capabilityState.set(capabilityId, 'suspended');
      return operation({ capabilityId, version: 1, status: 'suspended' });
    }

    const readiness = /^\/api\/v1\/capability-readiness\/(.+)\/1$/u.exec(url.pathname);
    if (method === 'GET' && readiness !== null) {
      const capabilityId = decodeURIComponent(requiredCapture(readiness, 1));
      if (capabilityId === FIRE_CAPABILITY_ID) return json({ code: 'NOT_FOUND' }, 404);
      const status = this.#readinessState.get(capabilityId);
      if (status === undefined) return json({ code: 'NOT_FOUND' }, 404);
      return json(readinessView(capabilityId, status));
    }

    const readinessEvaluate = /^\/api\/v1\/capability-readiness\/(.+)\/1\/evaluate$/u.exec(
      url.pathname,
    );
    if (method === 'POST' && readinessEvaluate !== null) {
      const capabilityId = decodeURIComponent(requiredCapture(readinessEvaluate, 1));
      expect(headers.get('idempotency-key')).toBeTruthy();
      this.#readinessState.set(capabilityId, 'suspended');
      return operation(readinessView(capabilityId, 'suspended'));
    }
    return json({ code: 'UNEXPECTED_CONTROL_PATH' }, 500);
  }

  #operations() {
    return CONTROLS.map(([, skillId], index) => ({
      operationId: `publish-${skillId}`,
      operationType: 'skill.publish',
      target: { type: 'skill_version', id: skillId, version: '1' },
      status: 'succeeded',
      result: {
        runtimeOperation: {
          result: {
            skillId,
            version: '1',
            status: 'published',
            governanceRevision: index + 3,
          },
        },
      },
    }));
  }
}

function runtimeSkill(
  toolName: string,
  skillId: string,
  capabilityId: string,
  status: 'enabled' | 'disabled',
) {
  const serverId = 'ugv-smpp-runtime';
  return {
    skillId,
    version: 1,
    status,
    capabilities: [capabilityId],
    toolPolicy: {
      required: [{ serverId, toolName }],
      optional: [],
      forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
    },
    runtimePolicy: { autoConfirmPlan: false, maxMcpCalls: 1 },
    sourceKind: 'admin',
    validationPassed: true,
  };
}

function capabilityView(capabilityId: string, status: Lifecycle, riskLevel: string) {
  return {
    capabilityId,
    version: 1,
    status,
    riskLevel,
    definitionHash: 'a'.repeat(64),
  };
}

function readinessView(capabilityId: string, status: 'available' | 'suspended') {
  return {
    capabilityId,
    capabilityVersion: 1,
    status,
    reasons:
      status === 'suspended' ? [{ code: 'CAPABILITY_KILL_SWITCH', severity: 'blocking' }] : [],
    availableImplementations: status === 'available' ? [`implementation-${capabilityId}`] : [],
    unavailableImplementations: [],
    evaluatedAt: '2026-08-12T05:59:00.000Z',
    validUntil: '2026-08-12T06:01:00.000Z',
  };
}

function operation(result: unknown): Response {
  return json({ status: 'succeeded', result }, 202);
}

function etag(capabilityId: string, status: Lifecycle): string {
  return `"${capabilityId}-${status}"`;
}

function json(value: unknown, status = 200, headers?: Readonly<Record<string, string>>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function requiredCapture(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error('Missing regex capture.');
  return value;
}
