import { describe, expect, it } from 'vitest';

import { normalizeTelemetryExportConfiguration } from '../src/index.js';

describe('Telemetry Export contract', () => {
  it('normalizes record families and preserves only a CredentialRef', () => {
    expect(
      normalizeTelemetryExportConfiguration({
        exportId: 'export-1',
        endpointRef: 'https://telemetry.example.test/ingest',
        sourceId: 'runtime-1',
        credentialRef: 'env:TELEMETRY_TOKEN',
        recordFamilies: ['task_event', 'runtime_event', 'task_event'],
        status: 'draft',
        revision: 1,
      }),
    ).toMatchObject({
      endpointRef: 'https://telemetry.example.test/ingest',
      recordFamilies: ['runtime_event', 'task_event'],
    });
  });

  it('rejects inline secrets and endpoint userinfo', () => {
    expect(() =>
      normalizeTelemetryExportConfiguration({
        exportId: 'export-1',
        endpointRef: 'https://user:password@telemetry.example.test/ingest',
        sourceId: 'runtime-1',
        credentialRef: 'env:TELEMETRY_TOKEN',
        recordFamilies: ['runtime_event'],
        retryPolicy: { apiToken: 'must-not-be-here' },
        status: 'draft',
        revision: 1,
      }),
    ).toThrow(/credentials|secret/iu);
  });
});
