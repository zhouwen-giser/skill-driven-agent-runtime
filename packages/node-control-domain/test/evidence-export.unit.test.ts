import { describe, expect, it } from 'vitest';

import {
  activeEvidenceExportConfiguration,
  normalizeEvidenceExportConfiguration,
  type ManagedEvidenceExportConfiguration,
} from '../src/index.js';

const configuration: ManagedEvidenceExportConfiguration = Object.freeze({
  exportId: 'primary-evidence-export',
  revision: 1,
  endpointRef: 'https://evidence.example.test/v1/batches',
  sourceId: 'sdar-runtime',
  nodeId: 'node-001',
  credentialRef: 'env:SDAR_EVIDENCE_SINK_TOKEN',
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
  excludedDiagnosticTypes: ['node_control.health_observation'],
  batchPolicy: { maxRecords: 100, maxBytes: 262_144, flushIntervalMs: 1_000 },
  retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 10 },
  outboxPolicy: { maxPendingRecords: 10_000, retentionDays: 30 },
  redactionProfile: 'strict_internal_v1',
  artifactMode: 'reference',
  status: 'draft',
  applyMode: 'hot_reload',
});

describe('Evidence Export configuration', () => {
  it('normalizes a strongly typed catalog configuration and activates it immutably', () => {
    const normalized = normalizeEvidenceExportConfiguration(configuration);
    expect(normalized.includedFamilies).toEqual([...configuration.includedFamilies].sort());
    expect(activeEvidenceExportConfiguration(configuration).status).toBe('active');
    expect(Object.isFrozen(normalized.batchPolicy)).toBe(true);
  });

  it('rejects unknown family, inline credentials and invalid batch limits', () => {
    expect(() =>
      normalizeEvidenceExportConfiguration({
        ...configuration,
        includedFamilies: [...configuration.includedFamilies, 'unknown'],
      } as unknown as ManagedEvidenceExportConfiguration),
    ).toThrow(/Unknown Evidence record family/u);
    expect(() =>
      normalizeEvidenceExportConfiguration({ ...configuration, credentialRef: 'inline-token' }),
    ).toThrow(/opaque env: or secret: reference/u);
    expect(() =>
      normalizeEvidenceExportConfiguration({
        ...configuration,
        batchPolicy: { ...configuration.batchPolicy, maxBytes: 10 },
      }),
    ).toThrow(/batchPolicy.maxBytes/u);
  });
});
