import type { TelemetryExportConfiguration } from '../../node-control-domain/src/index.js';
import type {
  TelemetryExportRecord,
  TelemetryExportTransport,
} from '../../runtime-control-application/src/index.js';

export interface TelemetryCredentialResolver {
  resolve(reference: string): Promise<string>;
}

export class EnvironmentTelemetryCredentialResolver implements TelemetryCredentialResolver {
  resolve(reference: string): Promise<string> {
    const matched = /^env:([A-Z][A-Z0-9_]{0,127})$/u.exec(reference);
    if (matched === null)
      return Promise.reject(
        Object.assign(new Error('Unsupported telemetry CredentialRef.'), {
          code: 'TELEMETRY_CREDENTIAL_REF_INVALID',
        }),
      );
    const variableName = matched[1];
    if (variableName === undefined)
      return Promise.reject(new Error('TELEMETRY_CREDENTIAL_REF_INVALID'));
    const credential = process.env[variableName];
    if (credential === undefined || credential === '')
      return Promise.reject(
        Object.assign(new Error('Telemetry credential is unavailable.'), {
          code: 'TELEMETRY_CREDENTIAL_UNAVAILABLE',
        }),
      );
    return Promise.resolve(credential);
  }
}

export class HttpTelemetryExportTransport implements TelemetryExportTransport {
  readonly #credentials: TelemetryCredentialResolver;
  readonly #timeoutMs: number;

  constructor(credentials: TelemetryCredentialResolver, timeoutMs = 5_000) {
    this.#credentials = credentials;
    this.#timeoutMs = timeoutMs;
  }

  async probe(configuration: TelemetryExportConfiguration): Promise<void> {
    await this.#request(configuration, {
      exportId: configuration.exportId,
      sourceId: configuration.sourceId,
      revision: configuration.revision,
      probe: true,
      records: [],
    });
  }

  async send(
    configuration: TelemetryExportConfiguration,
    records: readonly TelemetryExportRecord[],
  ): Promise<Readonly<{ lastAcknowledgedSequence: number }>> {
    const response = await this.#request(configuration, {
      exportId: configuration.exportId,
      sourceId: configuration.sourceId,
      revision: configuration.revision,
      records,
    });
    const last = records.at(-1)?.sequence;
    if (last === undefined)
      throw Object.assign(new Error('Telemetry batch must not be empty.'), {
        code: 'TELEMETRY_BATCH_EMPTY',
      });
    if (response === undefined) return Object.freeze({ lastAcknowledgedSequence: last });
    const candidate = response['lastAcknowledgedSequence'];
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0)
      throw Object.assign(new Error('Telemetry ACK is invalid.'), {
        code: 'TELEMETRY_ACK_INVALID',
      });
    return Object.freeze({ lastAcknowledgedSequence: candidate });
  }

  async #request(
    configuration: TelemetryExportConfiguration,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    const endpoint = safeEndpoint(configuration.endpointRef);
    const credential = await this.#credentials.resolve(configuration.credentialRef);
    let response: Response;
    try {
      response = await globalThis.fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
          'x-sdar-telemetry-contract': '1.0.0',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw Object.assign(new Error('Telemetry endpoint is unavailable.'), {
        code: 'TELEMETRY_ENDPOINT_UNAVAILABLE',
      });
    }
    if (!response.ok)
      throw Object.assign(new Error('Telemetry endpoint rejected the request.'), {
        code: 'TELEMETRY_ENDPOINT_REJECTED',
      });
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (text.trim() === '') return undefined;
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      return value as Readonly<Record<string, unknown>>;
    } catch {
      throw Object.assign(new Error('Telemetry endpoint response is invalid.'), {
        code: 'TELEMETRY_ACK_INVALID',
      });
    }
  }
}

function safeEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol === 'https:') return endpoint;
  if (
    endpoint.protocol === 'http:' &&
    (endpoint.hostname === '127.0.0.1' ||
      endpoint.hostname === '::1' ||
      endpoint.hostname === 'localhost')
  )
    return endpoint;
  throw Object.assign(new Error('Telemetry endpoint must use HTTPS except on loopback.'), {
    code: 'TELEMETRY_ENDPOINT_TLS_REQUIRED',
  });
}
