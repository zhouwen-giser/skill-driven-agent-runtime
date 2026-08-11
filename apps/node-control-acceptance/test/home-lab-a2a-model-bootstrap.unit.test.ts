import { afterEach, describe, expect, it } from 'vitest';

import {
  bootstrapHomeLabA2AModelFixture,
  type HomeLabA2AModelBootstrapConfiguration,
} from '../src/home-lab-a2a-model-bootstrap.js';
import {
  HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES,
  HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
  HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
} from '../src/home-lab-a2a-model-contract.js';
import {
  startHomeLabA2AModelFixture,
  type HomeLabA2AModelFixtureHandle,
} from '../src/home-lab-a2a-model-fixture.js';

const token = 'home-lab-a2a-bootstrap-token-00000000000001';

describe('home-lab A2A Model bootstrap', () => {
  let fixture: HomeLabA2AModelFixtureHandle | undefined;
  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it('authenticates the fixture, freezes prompts before routes, and reruns without new versions', async () => {
    fixture = await startHomeLabA2AModelFixture({ token });
    const management = managementHarness(fixture.baseUrl);
    const first = await bootstrapHomeLabA2AModelFixture(
      configuration(fixture.baseUrl),
      management.fetch,
    );
    const structuredStageCount = HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.length - 1;
    expect(first).toMatchObject({
      status: 'configured',
      providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
      model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
      publishedPromptCount: structuredStageCount,
      credentialsIncluded: false,
      endpointsIncluded: false,
    });
    const probeIndex = management.calls.findIndex((call) => call.path === '/v1/embeddings');
    const firstWrite = management.calls.findIndex(
      (call) => call.management && ['POST', 'PUT'].includes(call.method),
    );
    const promptWrites = management.calls.filter(
      (call) => call.management && call.method === 'POST' && call.path === '/api/v1/prompts',
    );
    const firstRouteWrite = management.calls.findIndex((call) =>
      call.path.startsWith('/api/v1/models/routes/'),
    );
    expect(probeIndex).toBeGreaterThanOrEqual(0);
    expect(probeIndex).toBeLessThan(firstWrite);
    expect(promptWrites).toHaveLength(structuredStageCount);
    expect(promptWrites.every((call) => call.body?.['content'] === '{{instruction}}')).toBe(true);
    expect(firstRouteWrite).toBeGreaterThan(
      Math.max(...promptWrites.map((call) => management.calls.indexOf(call))),
    );
    expect(management.routes).toEqual(
      new Map(
        HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.map((stage) => [
          stage,
          HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
        ]),
      ),
    );

    const promptWriteCount = promptWrites.length;
    await bootstrapHomeLabA2AModelFixture(configuration(fixture.baseUrl), management.fetch);
    expect(
      management.calls.filter(
        (call) => call.management && call.method === 'POST' && call.path === '/api/v1/prompts',
      ),
    ).toHaveLength(promptWriteCount);
  });

  it('fails before any management write for a wrong fixture token or occupied Prompt stage', async () => {
    fixture = await startHomeLabA2AModelFixture({ token });
    const wrongToken = managementHarness(fixture.baseUrl);
    await expect(
      bootstrapHomeLabA2AModelFixture(
        {
          ...configuration(fixture.baseUrl),
          fixtureToken: 'wrong-token-00000000000000000000000001',
        },
        wrongToken.fetch,
      ),
    ).rejects.toThrow('HOME_LAB_A2A_MODEL_BOOTSTRAP_HTTP_401');
    expect(wrongToken.calls.some((call) => call.management && call.method !== 'GET')).toBe(false);

    const occupied = managementHarness(fixture.baseUrl);
    occupied.current.set('workflow_planning', {
      promptId: 'prompt.some-other-authority',
      stage: 'workflow_planning',
      version: 1,
      content: '{{instruction}}',
      status: 'enabled',
      source: 'admin',
      createdAt: '2026-08-11T00:00:00.000Z',
    });
    await expect(
      bootstrapHomeLabA2AModelFixture(configuration(fixture.baseUrl), occupied.fetch),
    ).rejects.toThrow('HOME_LAB_A2A_MODEL_PROMPT_STAGE_CONFLICT');
    expect(occupied.calls.some((call) => call.management && call.method !== 'GET')).toBe(false);

    const providerDrift = managementHarness(fixture.baseUrl);
    providerDrift.setProvider({
      providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
      name: 'Home-lab A2A structured fixture',
      kind: 'local',
      apiStyle: 'openai_chat_completions',
      baseUrl: fixture.baseUrl,
      model: 'drifted-model',
      enabled: true,
      timeoutMs: 2_000,
    });
    await expect(
      bootstrapHomeLabA2AModelFixture(configuration(fixture.baseUrl), providerDrift.fetch),
    ).rejects.toThrow('HOME_LAB_A2A_MODEL_PROVIDER_IDENTITY_CONFLICT');
    expect(providerDrift.calls.some((call) => call.management && call.method !== 'GET')).toBe(
      false,
    );
  });

  it('uses manual redirect handling and never follows a 3xx credential boundary', async () => {
    let calls = 0;
    const redirects: ('follow' | 'error' | 'manual' | undefined)[] = [];
    const request = ((_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      redirects.push(init?.redirect);
      return Promise.resolve(
        new Response(null, {
          status: 307,
          headers: { location: 'https://external.invalid/credential-capture' },
        }),
      );
    }) as typeof fetch;
    await expect(
      bootstrapHomeLabA2AModelFixture(configuration('http://127.0.0.1:18461/v1'), request),
    ).rejects.toThrow('HOME_LAB_A2A_MODEL_BOOTSTRAP_HTTP_307');
    expect(calls).toBe(1);
    expect(redirects).toEqual(['manual']);
  });
});

function configuration(fixtureBaseUrl: string): HomeLabA2AModelBootstrapConfiguration {
  return {
    managementBaseUrl: 'http://127.0.0.1:29998',
    fixtureBaseUrl,
    fixtureToken: token,
    managementBearerToken: 'management-test-token',
    timeoutMs: 2_000,
  };
}

interface PromptAuthority {
  readonly promptId: string;
  readonly stage: string;
  readonly version: number;
  readonly content: '{{instruction}}';
  readonly status: 'enabled';
  readonly source: 'admin';
  readonly createdAt: string;
}

interface ObservedCall {
  readonly management: boolean;
  readonly method: string;
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
}

function managementHarness(fixtureBaseUrl: string) {
  const fixtureOrigin = new URL(fixtureBaseUrl).origin;
  const current = new Map<string, PromptAuthority>();
  const versions = new Map<string, PromptAuthority[]>();
  const routes = new Map<string, string>();
  const calls: ObservedCall[] = [];
  let provider: Readonly<Record<string, unknown>> | undefined;
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url,
    );
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Readonly<Record<string, unknown>>)
        : undefined;
    const management = url.origin !== fixtureOrigin;
    calls.push({ management, method, path: url.pathname, ...(body === undefined ? {} : { body }) });
    if (!management) return fetch(url, init);

    const currentMatch = /^\/api\/v1\/prompts\/current\/([^/]+)$/u.exec(url.pathname);
    if (method === 'GET' && currentMatch !== null)
      return json({ item: current.get(decodeURIComponent(currentMatch[1] ?? '')) ?? null });
    const versionsMatch = /^\/api\/v1\/prompts\/([^/]+)\/versions$/u.exec(url.pathname);
    if (method === 'GET' && versionsMatch !== null)
      return json({ items: versions.get(decodeURIComponent(versionsMatch[1] ?? '')) ?? [] });
    if (method === 'PUT' && url.pathname.startsWith('/api/v1/models/providers/')) {
      provider = { providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID, ...body };
      return empty();
    }
    if (method === 'POST' && url.pathname === '/api/v1/prompts') {
      const promptId = String(body?.['promptId']);
      const stage = String(body?.['stage']);
      const chain = versions.get(promptId) ?? [];
      const prompt: PromptAuthority = {
        promptId,
        stage,
        version: chain.length + 1,
        content: '{{instruction}}',
        status: 'enabled',
        source: 'admin',
        createdAt: '2026-08-11T00:00:00.000Z',
      };
      versions.set(promptId, [...chain, prompt]);
      current.set(stage, prompt);
      return json(prompt, 201);
    }
    const routeMatch = /^\/api\/v1\/models\/routes\/([^/]+)$/u.exec(url.pathname);
    if (method === 'PUT' && routeMatch !== null) {
      routes.set(decodeURIComponent(routeMatch[1] ?? ''), String(body?.['providerId']));
      return empty();
    }
    if (method === 'GET' && url.pathname === '/api/v1/models/providers')
      return json({ items: provider === undefined ? [] : [provider] });
    if (method === 'GET' && url.pathname === '/api/v1/models/routes')
      return json({
        items: [...routes].map(([stage, providerId]) => ({ stage, providerId })),
      });
    return json({ error: 'unexpected' }, 500);
  };
  return {
    fetch: fake,
    calls,
    current,
    routes,
    setProvider(value: Readonly<Record<string, unknown>>) {
      provider = value;
    },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function empty(): Response {
  return new Response(null, { status: 204 });
}
