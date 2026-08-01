import { describe, expect, it } from 'vitest';

import {
  A2A_ARTIFACT_PROJECTION_SCHEMA_HASH,
  MANAGEMENT_API_CONTRACT_SCHEMA_HASH,
  SSE_ARTIFACT_EVENT_PROJECTION_SCHEMA_HASH,
  type A2AArtifactProjection,
  type ManagementApiContract,
  type SseArtifactEventProjection,
} from '../src/index.js';

describe('P12 frozen interface contracts', () => {
  it('publishes the exact frozen schema hashes', () => {
    expect(MANAGEMENT_API_CONTRACT_SCHEMA_HASH).toBe(
      '842c040064b7171337082d865d4b46cbc27c8063ab3b0a3f881f4458247e8cbe',
    );
    expect(A2A_ARTIFACT_PROJECTION_SCHEMA_HASH).toBe(
      'bdf152659c84b4fbbcb7d1d9dd47b97aedf73f5e82c55265a796ec4fd406d0ff',
    );
    expect(SSE_ARTIFACT_EVENT_PROJECTION_SCHEMA_HASH).toBe(
      'c9c2b763d109005241827ddb1cb957e28fcf7003a759d387f0888a85700f7380',
    );
  });

  it('keeps the frozen field sets compile-time complete', () => {
    const management: ManagementApiContract = {
      queryOperations: ['artifact.list'],
      commandOperations: ['artifact.validate'],
      pagination: 'cursor',
      filters: ['status'],
      expectedVersion: true,
      idempotency: true,
      rbac: true,
      tenant: true,
      redaction: true,
      openapiVersion: '3.1.0',
    };
    const a2a: A2AArtifactProjection = {
      publicCapabilitySummary: [],
      inputRequired: false,
      confirmation: false,
      formalTaskState: 'TASK_STATE_WORKING',
      safeEvidence: {},
      redactionPolicyVersion: 'artifact-exposure/1.1',
    };
    const sse: SseArtifactEventProjection = {
      eventId: '1',
      eventType: 'artifact.activated',
      tenantId: 'tenant-a',
      safePayload: {},
      sourceRef: 'event-a',
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    expect(Object.keys(management)).toHaveLength(10);
    expect(Object.keys(a2a)).toHaveLength(6);
    expect(Object.keys(sse)).toHaveLength(6);
  });
});
