import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCatalogEvidenceEnvelope,
  hashCanonicalEvidenceJson,
  type EvidenceBatchRequest,
  type ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import {
  EnvironmentEvidenceCredentialResolver,
  HttpEvidenceExportTransport,
} from '../src/index.js';

const now = '2026-08-04T02:00:00.000Z';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['TEST_EVIDENCE_TOKEN'];
});

describe('sdar.evidence/v1 HTTP transport', () => {
  it('sends the exact header, bounded canonical batch and parses an explicit partial ACK', async () => {
    process.env['TEST_EVIDENCE_TOKEN'] = 'opaque-token';
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer opaque-token',
        'content-type': 'application/json',
        'x-sdar-evidence-contract': 'sdar.evidence/v1',
      });
      if (typeof init?.body !== 'string') throw new Error('TEST_EVIDENCE_BODY_MISSING');
      const body = JSON.parse(init.body) as EvidenceBatchRequest;
      expect(body.contractVersion).toBe('sdar.evidence/v1');
      expect(body.batchHash).toBe(hashCanonicalEvidenceJson(unsigned(body)));
      expect(body.records).toHaveLength(2);
      return Promise.resolve(
        new Response(JSON.stringify({ lastAcknowledgedSequence: '1' }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HttpEvidenceExportTransport(new EnvironmentEvidenceCredentialResolver());
    await expect(transport.send(configuration(), batch())).resolves.toEqual({
      lastAcknowledgedSequence: '1',
    });
  });

  it('uses HEAD for a non-authoritative probe and allows loopback HTTP only', async () => {
    process.env['TEST_EVIDENCE_TOKEN'] = 'opaque-token';
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('HEAD');
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe('error');
      return Promise.resolve(new Response(undefined, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const transport = new HttpEvidenceExportTransport(new EnvironmentEvidenceCredentialResolver());
    await expect(
      transport.probe(configuration({ endpointRef: 'http://127.0.0.2:4318/evidence' })),
    ).resolves.toBeUndefined();
    await expect(
      transport.probe(configuration({ endpointRef: 'http://evidence.example.test/ingest' })),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ENDPOINT_TLS_REQUIRED' });
  });

  it('admits non-loopback plaintext only when the composition root enables unsafe test mode', async () => {
    process.env['TEST_EVIDENCE_TOKEN'] = 'opaque-token';
    const fetchMock = vi.fn(() => Promise.resolve(new Response(undefined, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    const endpointRef = 'http://192.168.1.7:4318/evidence';
    await expect(
      new HttpEvidenceExportTransport(new EnvironmentEvidenceCredentialResolver()).probe(
        configuration({ endpointRef }),
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ENDPOINT_TLS_REQUIRED' });
    await expect(
      new HttpEvidenceExportTransport(
        new EnvironmentEvidenceCredentialResolver(),
        5_000,
        true,
      ).probe(configuration({ endpointRef })),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(endpointRef),
      expect.objectContaining({ method: 'HEAD', redirect: 'error' }),
    );
  });

  it.each([
    [new Response(undefined, { status: 204 }), 'EVIDENCE_ACK_INVALID'],
    [
      new Response(JSON.stringify({ lastAcknowledgedSequence: 2 }), { status: 200 }),
      'EVIDENCE_ACK_INVALID',
    ],
    [
      new Response(JSON.stringify({ lastAcknowledgedSequence: '2', authority: true }), {
        status: 200,
      }),
      'EVIDENCE_ACK_INVALID',
    ],
  ])('rejects invalid or authority-shaped sink responses %#', async (response, code) => {
    process.env['TEST_EVIDENCE_TOKEN'] = 'opaque-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(response)),
    );
    const transport = new HttpEvidenceExportTransport(new EnvironmentEvidenceCredentialResolver());
    await expect(transport.send(configuration(), batch())).rejects.toMatchObject({ code });
  });

  it('rejects missing credentials, tampered hashes, oversized bodies and redirect/network failure', async () => {
    const transport = new HttpEvidenceExportTransport(new EnvironmentEvidenceCredentialResolver());
    await expect(transport.send(configuration(), batch())).rejects.toMatchObject({
      code: 'EVIDENCE_CREDENTIAL_UNAVAILABLE',
    });
    process.env['TEST_EVIDENCE_TOKEN'] = 'opaque-token';
    await expect(
      transport.send(configuration(), { ...batch(), batchHash: `sha256:${'0'.repeat(64)}` }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_BATCH_HASH_INVALID' });
    await expect(
      transport.send(
        configuration({ batchPolicy: { ...configuration().batchPolicy, maxBytes: 10 } }),
        batch(),
      ),
    ).rejects.toMatchObject({ code: 'EVIDENCE_BATCH_TOO_LARGE' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('redirect denied'))),
    );
    await expect(transport.send(configuration(), batch())).rejects.toMatchObject({
      code: 'EVIDENCE_ENDPOINT_UNAVAILABLE',
    });
  });

  it('bounds a stalled endpoint with the configured transport timeout', async () => {
    process.env['TEST_EVIDENCE_TOKEN'] = 'opaque-token';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(new Error('TEST_ENDPOINT_ABORTED', { cause: init.signal?.reason }));
              },
              { once: true },
            );
          }),
      ),
    );
    const transport = new HttpEvidenceExportTransport(
      new EnvironmentEvidenceCredentialResolver(),
      5,
    );
    await expect(transport.send(configuration(), batch())).rejects.toMatchObject({
      code: 'EVIDENCE_ENDPOINT_UNAVAILABLE',
    });
  });
});

function configuration(
  override: Partial<ManagedEvidenceExportConfiguration> = {},
): ManagedEvidenceExportConfiguration {
  return {
    exportId: 'primary-evidence-export',
    revision: 1,
    endpointRef: 'https://evidence.example.test/ingest',
    sourceId: 'sdar-runtime',
    nodeId: 'node-001',
    credentialRef: 'env:TEST_EVIDENCE_TOKEN',
    includedFamilies: [
      'runtime',
      'skill',
      'mcp_task',
      'capability',
      'experience',
      'replay',
      'artifact',
      'node_control',
      'evidence',
    ] as const,
    batchPolicy: { maxRecords: 100, maxBytes: 262_144, flushIntervalMs: 1_000 },
    retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000 },
    outboxPolicy: { maxPendingRecords: 10_000, retentionDays: 30 },
    redactionProfile: 'strict_internal_v1',
    artifactMode: 'reference',
    status: 'active',
    applyMode: 'hot_reload',
    ...override,
  };
}

function batch(): EvidenceBatchRequest {
  const records = [envelope('1'), envelope('2')];
  const input = {
    contractVersion: 'sdar.evidence/v1' as const,
    exportId: 'primary-evidence-export',
    sourceId: 'sdar-runtime',
    nodeId: 'node-001',
    revision: 1,
    firstSequence: '1',
    lastSequence: '2',
    records,
  };
  return Object.freeze({ ...input, batchHash: hashCanonicalEvidenceJson(input) });
}

function envelope(sequence: string) {
  return createCatalogEvidenceEnvelope({
    recordType: 'runtime.episode',
    sourceRecordId: `task-${sequence}`,
    sourceRevision: '1',
    environment: 'test',
    correlationId: `task-${sequence}`,
    occurredAt: now,
    recordedAt: now,
    taskId: `task-${sequence}`,
    contextId: `context-${sequence}`,
    episodeId: `task-${sequence}`,
    evidenceSequence: sequence,
    payload: { episodeId: `task-${sequence}`, taskId: `task-${sequence}`, status: 'completed' },
  });
}

function unsigned(batchRequest: EvidenceBatchRequest) {
  return Object.fromEntries(Object.entries(batchRequest).filter(([key]) => key !== 'batchHash'));
}
