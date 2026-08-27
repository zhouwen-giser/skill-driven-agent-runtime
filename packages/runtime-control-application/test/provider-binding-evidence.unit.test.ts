import { describe, expect, it } from 'vitest';
import { frozenProviderBindingEvidence } from '../src/mcp-capability-evidence-projector.js';
import { CatalogValidatingEvidenceWriter } from '../src/catalog-validating-evidence-writer.js';
import { createCatalogEvidenceEnvelope } from '../../domain/src/index.js';

describe('Provider execution-time evidence', () => {
  it('exports only pinned identity and never endpoints or credentials', () => {
    const result = frozenProviderBindingEvidence({
      authority_snapshot_json: {
        schemaVersion: '1.0',
        capturedAt: '2026-08-26T00:00:00Z',
        runtime: { serverId: 'runtime', toolRevision: 1, protocolSnapshotId: 'snapshot' },
        providerBinding: {
          bindingId: 'binding',
          revision: 2,
          originType: 'smpp_registry',
          providerId: 'provider',
          smppSourceId: 'source',
          catalogRevision: '2:2',
          catalogChecksum: 'a'.repeat(64),
          endpointRef: 'private-endpoint',
          credential: 'never-export',
        },
      },
    });
    expect(result).toMatchObject({
      providerAuthority: {
        providerBindingRevision: 2,
        providerSourceId: 'source',
        providerId: 'provider',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-endpoint|never-export/u);
    expect(result['providerAuthorityHash']).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(frozenProviderBindingEvidence({})).toEqual({});
    expect(() =>
      frozenProviderBindingEvidence({ authority_snapshot_json: { schemaVersion: 'bad' } }),
    ).toThrow();
  });
  it('adds observation metadata before append without changing immutable payload identity', async () => {
    const envelope = createCatalogEvidenceEnvelope({
      recordType: 'mcp_task.remote_binding',
      sourceRecordId: 'binding',
      sourceRevision: '1',
      environment: 'integration',
      correlationId: 'task',
      occurredAt: '2026-08-26T00:00:00Z',
      recordedAt: '2026-08-26T00:00:00Z',
      payload: { bindingId: 'binding', remoteTaskId: 'remote', version: 1 },
    });
    const writer = new CatalogValidatingEvidenceWriter({
      validator: { validate: () => ({ valid: true, errors: [] }) },
      delegate: {
        append(value) {
          expect(value).toMatchObject({
            tenantId: 'tenant',
            projectId: 'project',
            recordId: envelope.recordId,
            payloadHash: envelope.payloadHash,
          });
          return Promise.resolve('1');
        },
      },
      observationScope: { tenantId: 'tenant', projectId: 'project' },
    });
    await expect(writer.append(envelope, envelope.recordedAt, 'test')).resolves.toBe('1');
    await expect(
      writer.append({ ...envelope, tenantId: 'other' }, envelope.recordedAt, 'test'),
    ).rejects.toThrow();
  });
});
