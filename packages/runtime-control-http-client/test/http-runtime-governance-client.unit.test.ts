import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { HttpRuntimeGovernanceClient } from '../src/index.js';

const token = 'p10-runtime-governance-token-0000000000000000';
let server: Server | undefined;

afterEach(async () => {
  if (server !== undefined) await close(server);
  server = undefined;
});

describe('HttpRuntimeGovernanceClient', () => {
  it('follows authoritative Plan Template pages and authenticates exact-version commands', async () => {
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(`${request.method ?? 'GET'} ${request.url ?? ''}`);
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.statusCode = 401;
        response.end();
        return;
      }
      if (request.method === 'GET' && request.url?.startsWith('/internal/v1/plan-templates')) {
        const url = new URL(request.url, 'http://runtime.invalid');
        const second = url.searchParams.get('pageToken') === 'next-p10';
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            items: [planTemplate(second ? 'artifact.p10.2' : 'artifact.p10.1')],
            ...(second ? {} : { nextPageToken: 'next-p10' }),
            totalEstimate: 1,
            asOf: '2026-08-02T00:00:00.000Z',
          }),
        );
        return;
      }
      if (
        request.method === 'POST' &&
        request.url === '/internal/v1/skills/skill.p10/versions/3/publish'
      ) {
        expect(request.headers['idempotency-key']).toBe('publish-skill-p10');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(operation()));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await listen(server);
    const client = new HttpRuntimeGovernanceClient({
      baseUrl: address(server),
      serviceToken: token,
    });

    await expect(client.listPlanTemplates()).resolves.toHaveLength(2);
    await expect(
      client.governSkill('publish', 'skill.p10', '3', {
        reason: 'Publish exact version.',
        idempotencyKey: 'publish-skill-p10',
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({ operationType: 'skill.publish', status: 'succeeded' });
    expect(requests).toEqual([
      'GET /internal/v1/plan-templates?pageSize=200',
      'GET /internal/v1/plan-templates?pageSize=200&pageToken=next-p10',
      'POST /internal/v1/skills/skill.p10/versions/3/publish',
    ]);
  });
});

function planTemplate(authorityArtifactId: string) {
  return {
    artifactId: 'plan.p10',
    authorityArtifactId,
    version: '1',
    name: 'plan.p10',
    status: 'approved',
    checksum: 'a'.repeat(64),
    activePointer: false,
    createdAt: '2026-08-02T00:00:00.000Z',
  };
}

function operation() {
  return {
    operationId: 'runtime-skill-p10',
    operationType: 'skill.publish',
    target: { type: 'skill_version', id: 'skill.p10', version: '3' },
    status: 'succeeded',
    actorId: 'node-control',
    reason: 'Publish exact version.',
    idempotencyKeyHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    result: { version: '3' },
    createdAt: '2026-08-02T00:00:00.000Z',
    startedAt: '2026-08-02T00:00:00.000Z',
    completedAt: '2026-08-02T00:00:00.000Z',
  };
}

function listen(candidate: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(0, '127.0.0.1', resolve);
  });
}

function address(candidate: Server): string {
  const value = candidate.address();
  if (value === null || typeof value === 'string') throw new Error('TEST_SERVER_ADDRESS_INVALID');
  return `http://127.0.0.1:${String(value.port)}`;
}

function close(candidate: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    candidate.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
