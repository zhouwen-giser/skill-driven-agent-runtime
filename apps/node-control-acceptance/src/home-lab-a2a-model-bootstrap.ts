import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES,
  HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY,
  HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
  HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
} from './home-lab-a2a-model-contract.js';

const HealthSchema = z
  .object({
    ready: z.literal(true),
    providerId: z.literal(HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID),
    model: z.literal(HOME_LAB_A2A_MODEL_FIXTURE_MODEL),
    modelBoundary: z.literal(HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY),
    mode: z.string().min(1),
  })
  .strict();
const ProvidersSchema = z.object({
  items: z.array(
    z
      .object({
        providerId: z.string().min(1),
        name: z.string().min(1),
        kind: z.string().min(1),
        apiStyle: z.string().min(1),
        baseUrl: z.url(),
        model: z.string().min(1),
        enabled: z.boolean(),
        timeoutMs: z.number().int().positive(),
      })
      .loose(),
  ),
});
const RoutesSchema = z.object({
  items: z.array(
    z
      .object({
        stage: z.string().min(1),
        operation: z.enum(['structured_generation', 'embedding']),
        providerId: z.string().min(1),
      })
      .loose(),
  ),
});
const EmbeddingProbeSchema = z
  .object({
    model: z.literal(HOME_LAB_A2A_MODEL_FIXTURE_MODEL),
    data: z.array(z.object({ embedding: z.array(z.number()).min(1) }).strict()).length(1),
  })
  .loose();
const PromptResultSchema = z
  .object({
    promptId: z.string().min(1),
    stage: z.string().min(1),
    version: z.number().int().positive(),
    content: z.literal('{{instruction}}'),
    status: z.literal('enabled'),
    source: z.literal('admin'),
  })
  .loose();
const CurrentPromptSchema = z.object({ item: PromptResultSchema.nullable() }).strict();
const PromptVersionsSchema = z.object({ items: z.array(PromptResultSchema) }).strict();

export interface HomeLabA2AModelBootstrapConfiguration {
  readonly managementBaseUrl: string;
  readonly fixtureBaseUrl: string;
  readonly fixtureToken: string;
  readonly managementBearerToken?: string;
  readonly timeoutMs?: number;
}

export interface HomeLabA2AModelBootstrapReport {
  readonly status: 'configured';
  readonly providerId: typeof HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID;
  readonly model: typeof HOME_LAB_A2A_MODEL_FIXTURE_MODEL;
  readonly modelBoundary: typeof HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY;
  readonly routeStages: typeof HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES;
  readonly publishedPromptCount: number;
  readonly credentialsIncluded: false;
  readonly endpointsIncluded: false;
}

export async function bootstrapHomeLabA2AModelFixture(
  input: HomeLabA2AModelBootstrapConfiguration,
  request: typeof fetch = fetch,
): Promise<HomeLabA2AModelBootstrapReport> {
  const management = loopbackBaseUrl(input.managementBaseUrl, false);
  const fixture = loopbackBaseUrl(input.fixtureBaseUrl, true);
  const token = localToken(input.fixtureToken);
  const timeoutMs = input.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000)
    throw new Error('HOME_LAB_A2A_MODEL_BOOTSTRAP_TIMEOUT_INVALID');
  const managementHeaders = Object.freeze({
    'content-type': 'application/json',
    ...(input.managementBearerToken === undefined
      ? {}
      : { Authorization: `Bearer ${managementToken(input.managementBearerToken)}` }),
  });
  const health = HealthSchema.parse(
    await requestJson(request, new URL('/health', fixture), { method: 'GET' }, timeoutMs, 200),
  );
  if (health.mode !== 'valid') throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_MODE_NOT_VALID');
  EmbeddingProbeSchema.parse(
    await requestJson(
      request,
      new URL('/v1/embeddings', fixture),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
          input: 'home-lab-a2a-bootstrap-authenticated-wire-probe',
        }),
      },
      timeoutMs,
      200,
    ),
  );

  const existingProviders = ProvidersSchema.parse(
    await requestJson(
      request,
      new URL('/api/v1/models/providers', management),
      { method: 'GET', headers: managementHeaders },
      timeoutMs,
      200,
    ),
  );
  const existingProvider = existingProviders.items.find(
    (provider) => provider.providerId === HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  );
  if (existingProvider !== undefined && !providerExact(existingProvider, fixture, timeoutMs))
    throw new Error('HOME_LAB_A2A_MODEL_PROVIDER_IDENTITY_CONFLICT');

  const structuredStages = HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.filter((stage) => stage !== 'goal');
  const stagesToCreate: (typeof structuredStages)[number][] = [];
  const promptVersions: number[] = [];
  for (const stage of structuredStages) {
    const promptId = fixturePromptId(stage);
    const current = CurrentPromptSchema.parse(
      await requestJson(
        request,
        new URL(`/api/v1/prompts/current/${encodeURIComponent(stage)}`, management),
        { method: 'GET', headers: managementHeaders },
        timeoutMs,
        200,
      ),
    ).item;
    const versions = PromptVersionsSchema.parse(
      await requestJson(
        request,
        new URL(`/api/v1/prompts/${encodeURIComponent(promptId)}/versions`, management),
        { method: 'GET', headers: managementHeaders },
        timeoutMs,
        200,
      ),
    ).items;
    const latest = versions.at(-1);
    if (current === null) {
      if (versions.length !== 0) throw new Error('HOME_LAB_A2A_MODEL_PROMPT_DRIFT');
      stagesToCreate.push(stage);
      continue;
    }
    if (
      !promptExact(current, stage) ||
      latest?.version !== current.version ||
      !promptExact(latest, stage)
    )
      throw new Error('HOME_LAB_A2A_MODEL_PROMPT_STAGE_CONFLICT');
    promptVersions.push(current.version);
  }

  await requestJson(
    request,
    new URL(
      `/api/v1/models/providers/${encodeURIComponent(HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID)}`,
      management,
    ),
    {
      method: 'PUT',
      headers: managementHeaders,
      body: JSON.stringify({
        name: 'Home-lab A2A structured fixture',
        kind: 'local',
        apiStyle: 'openai_chat_completions',
        baseUrl: fixture.toString().replace(/\/$/u, ''),
        model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
        enabled: true,
        timeoutMs,
        credentialHeaders: { Authorization: `Bearer ${token}` },
      }),
    },
    timeoutMs,
    204,
  );

  for (const stage of stagesToCreate) {
    const prompt = PromptResultSchema.parse(
      await requestJson(
        request,
        new URL('/api/v1/prompts', management),
        {
          method: 'POST',
          headers: managementHeaders,
          body: JSON.stringify({
            promptId: fixturePromptId(stage),
            stage,
            content: '{{instruction}}',
            source: 'admin',
            publish: true,
          }),
        },
        timeoutMs,
        201,
      ),
    );
    if (!promptExact(prompt, stage))
      throw new Error('HOME_LAB_A2A_MODEL_PROMPT_VERIFICATION_FAILED');
    promptVersions.push(prompt.version);
  }
  if (promptVersions.length !== structuredStages.length)
    throw new Error('HOME_LAB_A2A_MODEL_PROMPT_VERIFICATION_FAILED');

  for (const stage of HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES)
    await requestJson(
      request,
      new URL(`/api/v1/models/routes/${encodeURIComponent(stage)}`, management),
      {
        method: 'PUT',
        headers: managementHeaders,
        body: JSON.stringify({ providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID }),
      },
      timeoutMs,
      204,
    );
  await requestJson(
    request,
    new URL('/api/v1/models/routes/goal', management),
    {
      method: 'PUT',
      headers: managementHeaders,
      body: JSON.stringify({
        providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
        operation: 'embedding',
      }),
    },
    timeoutMs,
    204,
  );

  const providers = ProvidersSchema.parse(
    await requestJson(
      request,
      new URL('/api/v1/models/providers', management),
      { method: 'GET', headers: managementHeaders },
      timeoutMs,
      200,
    ),
  );
  const configuredProvider = providers.items.find(
    (provider) => provider.providerId === HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  );
  if (configuredProvider === undefined || !providerExact(configuredProvider, fixture, timeoutMs))
    throw new Error('HOME_LAB_A2A_MODEL_PROVIDER_VERIFICATION_FAILED');

  const routes = RoutesSchema.parse(
    await requestJson(
      request,
      new URL('/api/v1/models/routes', management),
      { method: 'GET', headers: managementHeaders },
      timeoutMs,
      200,
    ),
  );
  const byStageAndOperation = new Map(
    routes.items.map((route) => [`${route.stage}:${route.operation}`, route.providerId]),
  );
  if (
    HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.some(
      (stage) =>
        byStageAndOperation.get(`${stage}:structured_generation`) !==
        HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
    ) ||
    byStageAndOperation.get('goal:embedding') !== HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID
  )
    throw new Error('HOME_LAB_A2A_MODEL_ROUTE_VERIFICATION_FAILED');

  return Object.freeze({
    status: 'configured',
    providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
    model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
    modelBoundary: HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY,
    routeStages: HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES,
    publishedPromptCount: promptVersions.length,
    credentialsIncluded: false,
    endpointsIncluded: false,
  });
}

async function requestJson(
  request: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  expectedStatus: number,
): Promise<unknown> {
  const response = await request(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== expectedStatus)
    throw new Error(`HOME_LAB_A2A_MODEL_BOOTSTRAP_HTTP_${String(response.status)}`);
  if (expectedStatus === 204) return undefined;
  return response.json();
}

function loopbackBaseUrl(value: string, requireV1: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('HOME_LAB_A2A_MODEL_BOOTSTRAP_URL_INVALID');
  }
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (requireV1 && parsed.pathname.replace(/\/$/u, '') !== '/v1')
  )
    throw new Error('HOME_LAB_A2A_MODEL_BOOTSTRAP_LOOPBACK_REQUIRED');
  return parsed;
}

function canonicalLoopbackUrl(value: string | URL, requireV1: boolean): string {
  return loopbackBaseUrl(value.toString(), requireV1).toString().replace(/\/$/u, '');
}

function localToken(value: string): string {
  if (typeof value !== 'string' || value.length < 32 || value.trim() !== value || /\s/u.test(value))
    throw new Error('HOME_LAB_A2A_MODEL_BOOTSTRAP_TOKEN_INVALID');
  return value;
}

function managementToken(value: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.trim() !== value ||
    /\s/u.test(value)
  )
    throw new Error('HOME_LAB_A2A_MODEL_BOOTSTRAP_MANAGEMENT_TOKEN_INVALID');
  return value;
}

function fixturePromptId(stage: string): string {
  return `prompt.home-lab-a2a-fixture.${stage}`;
}

function promptExact(value: z.infer<typeof PromptResultSchema>, stage: string): boolean {
  return value.promptId === fixturePromptId(stage) && value.stage === stage;
}

function providerExact(
  value: z.infer<typeof ProvidersSchema>['items'][number],
  fixture: URL,
  timeoutMs: number,
): boolean {
  return (
    value.providerId === HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID &&
    value.name === 'Home-lab A2A structured fixture' &&
    value.kind === 'local' &&
    value.apiStyle === 'openai_chat_completions' &&
    value.model === HOME_LAB_A2A_MODEL_FIXTURE_MODEL &&
    value.enabled &&
    value.timeoutMs === timeoutMs &&
    canonicalLoopbackUrl(value.baseUrl, true) === canonicalLoopbackUrl(fixture, true)
  );
}

async function main(): Promise<void> {
  const managementBaseUrl = process.env['SDAR_RUNTIME_MANAGEMENT_BASE_URL'];
  const fixtureBaseUrl = process.env['HOME_LAB_A2A_MODEL_FIXTURE_BASE_URL'];
  const fixtureToken = process.env['HOME_LAB_A2A_MODEL_FIXTURE_TOKEN'];
  if (managementBaseUrl === undefined || fixtureBaseUrl === undefined || fixtureToken === undefined)
    throw new Error('HOME_LAB_A2A_MODEL_BOOTSTRAP_CONFIGURATION_REQUIRED');
  const report = await bootstrapHomeLabA2AModelFixture({
    managementBaseUrl,
    fixtureBaseUrl,
    fixtureToken,
    ...(process.env['SDAR_RUNTIME_MANAGEMENT_BEARER_TOKEN'] === undefined
      ? {}
      : { managementBearerToken: process.env['SDAR_RUNTIME_MANAGEMENT_BEARER_TOKEN'] }),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) await main();
