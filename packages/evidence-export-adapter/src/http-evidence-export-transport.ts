import {
  canonicalizeEvidenceJson,
  hashCanonicalEvidenceJson,
  type EvidenceBatchAcknowledgement,
  type EvidenceBatchRequest,
  type ManagedEvidenceExportConfiguration,
} from '../../domain/src/index.js';
import type { EvidenceExportTransport } from '../../runtime-control-application/src/index.js';

export interface EvidenceCredentialResolver {
  resolve(reference: string): Promise<string>;
}

export class EnvironmentEvidenceCredentialResolver implements EvidenceCredentialResolver {
  resolve(reference: string): Promise<string> {
    const matched = /^env:([A-Z][A-Z0-9_]{0,127})$/u.exec(reference);
    if (matched === null) return Promise.reject(exportError('EVIDENCE_CREDENTIAL_REF_INVALID'));
    const variableName = matched[1];
    if (variableName === undefined)
      return Promise.reject(exportError('EVIDENCE_CREDENTIAL_REF_INVALID'));
    const credential = process.env[variableName];
    if (credential === undefined || credential === '')
      return Promise.reject(exportError('EVIDENCE_CREDENTIAL_UNAVAILABLE'));
    return Promise.resolve(credential);
  }
}

export class HttpEvidenceExportTransport implements EvidenceExportTransport {
  readonly #credentials: EvidenceCredentialResolver;
  readonly #timeoutMs: number;

  constructor(credentials: EvidenceCredentialResolver, timeoutMs = 5_000) {
    this.#credentials = credentials;
    this.#timeoutMs = timeoutMs;
  }

  async probe(configuration: ManagedEvidenceExportConfiguration): Promise<void> {
    const endpoint = safeEvidenceEndpoint(configuration.endpointRef);
    const credential = await this.#credentials.resolve(configuration.credentialRef);
    await request(
      endpoint,
      {
        method: 'HEAD',
        redirect: 'error',
        headers: headers(credential),
        signal: AbortSignal.timeout(this.#timeoutMs),
      },
      'EVIDENCE_ENDPOINT_UNAVAILABLE',
    );
  }

  async send(
    configuration: ManagedEvidenceExportConfiguration,
    batch: EvidenceBatchRequest,
  ): Promise<EvidenceBatchAcknowledgement> {
    assertBatchHash(batch);
    const body = canonicalizeEvidenceJson(batch);
    if (Buffer.byteLength(body, 'utf8') > configuration.batchPolicy.maxBytes)
      throw exportError('EVIDENCE_BATCH_TOO_LARGE');
    const endpoint = safeEvidenceEndpoint(configuration.endpointRef);
    const credential = await this.#credentials.resolve(configuration.credentialRef);
    const response = await request(
      endpoint,
      {
        method: 'POST',
        redirect: 'error',
        headers: headers(credential, { 'content-type': 'application/json' }),
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      },
      'EVIDENCE_ENDPOINT_UNAVAILABLE',
    );
    const text = await boundedResponseText(response, 4_096);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw exportError('EVIDENCE_ACK_INVALID');
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !('lastAcknowledgedSequence' in value) ||
      typeof value.lastAcknowledgedSequence !== 'string' ||
      !/^(?:0|[1-9][0-9]*)$/u.test(value.lastAcknowledgedSequence)
    ) {
      throw exportError('EVIDENCE_ACK_INVALID');
    }
    return Object.freeze({ lastAcknowledgedSequence: value.lastAcknowledgedSequence });
  }
}

function headers(
  credential: string,
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return Object.freeze({
    authorization: `Bearer ${credential}`,
    'x-sdar-evidence-contract': 'sdar.evidence/v1',
    ...extra,
  });
}

async function request(endpoint: URL, init: RequestInit, fallbackCode: string): Promise<Response> {
  let response: Response;
  try {
    response = await globalThis.fetch(endpoint, init);
  } catch {
    throw exportError(fallbackCode);
  }
  if (!response.ok) throw exportError('EVIDENCE_ENDPOINT_REJECTED');
  return response;
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maximumBytes)
    throw exportError('EVIDENCE_ACK_INVALID');
  const bodyCandidate: unknown = response.body;
  if (bodyCandidate === null) throw exportError('EVIDENCE_ACK_INVALID');
  const responseBody = bodyCandidate as AsyncIterable<Uint8Array> & {
    cancel(reason?: unknown): Promise<void>;
  };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of responseBody) {
    total += chunk.byteLength;
    if (total > maximumBytes) {
      await responseBody.cancel().catch(() => undefined);
      throw exportError('EVIDENCE_ACK_INVALID');
    }
    chunks.push(chunk);
  }
  if (total === 0) throw exportError('EVIDENCE_ACK_INVALID');
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(combined);
  } catch {
    throw exportError('EVIDENCE_ACK_INVALID');
  }
  if (text.trim() === '') throw exportError('EVIDENCE_ACK_INVALID');
  return text;
}

function assertBatchHash(batch: EvidenceBatchRequest): void {
  const { batchHash, ...unsigned } = batch;
  if (hashCanonicalEvidenceJson(unsigned) !== batchHash)
    throw exportError('EVIDENCE_BATCH_HASH_INVALID');
}

function safeEvidenceEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.username !== '' || endpoint.password !== '')
    throw exportError('EVIDENCE_ENDPOINT_CREDENTIALS_FORBIDDEN');
  if (endpoint.protocol === 'https:') return endpoint;
  if (endpoint.protocol === 'http:' && isLoopbackHostname(endpoint.hostname)) return endpoint;
  throw exportError('EVIDENCE_ENDPOINT_TLS_REQUIRED');
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  if (ipv4 === null) return false;
  return Number(ipv4[1]) === 127 && ipv4.slice(1).every((part) => Number(part) <= 255);
}

function exportError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
