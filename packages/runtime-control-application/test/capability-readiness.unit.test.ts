import { describe, expect, it } from 'vitest';

import {
  createCapabilityImplementationBinding,
  createNodeCapabilityDefinition,
} from '../../node-control-domain/src/index.js';
import {
  RuntimeCapabilityReadinessService,
  type RuntimeCapabilityReadinessRepository,
  type RuntimeImplementationReadiness,
  type StoredCapabilityReadiness,
} from '../src/index.js';

describe('P07 Runtime Capability Readiness', () => {
  it('applies safety downgrades immediately and holds recovery through the stability window', async () => {
    let now = '2026-08-02T11:00:00.000Z';
    let assessment = implementation(true);
    const records: StoredCapabilityReadiness[] = [];
    const repository: RuntimeCapabilityReadinessRepository = {
      findLatest: () => Promise.resolve(records.at(-1)),
      findReplay: () => Promise.resolve(undefined),
      assessImplementations: () => Promise.resolve([assessment]),
      save: (record) => {
        records.push(record);
        return Promise.resolve(record);
      },
      listLatest: () => Promise.resolve(records.slice(-1)),
      listExpired: () => Promise.resolve([]),
    };
    const service = new RuntimeCapabilityReadinessService({
      repository,
      clock: { now: () => now },
    });
    const input = evaluationInput();

    await expect(service.evaluate(input)).resolves.toMatchObject({
      snapshot: { status: 'available', snapshotVersion: 1 },
    });
    assessment = implementation(false);
    now = '2026-08-02T11:00:01.000Z';
    await expect(service.evaluate(input)).resolves.toMatchObject({
      snapshot: { status: 'unavailable', snapshotVersion: 2 },
    });
    assessment = implementation(true);
    now = '2026-08-02T11:00:02.000Z';
    await expect(service.evaluate(input)).resolves.toMatchObject({
      snapshot: { status: 'unavailable', snapshotVersion: 3 },
      candidateStatus: 'available',
    });
    now = '2026-08-02T11:00:13.000Z';
    await expect(service.evaluate(input)).resolves.toMatchObject({
      snapshot: { status: 'available', snapshotVersion: 4 },
    });
  });

  it('lets maintenance and kill-switch facts suspend every implementation', async () => {
    const records: StoredCapabilityReadiness[] = [];
    const repository: RuntimeCapabilityReadinessRepository = {
      findLatest: () => Promise.resolve(records.at(-1)),
      findReplay: () => Promise.resolve(undefined),
      assessImplementations: () => Promise.resolve([implementation(true)]),
      save: (record) => {
        records.push(record);
        return Promise.resolve(record);
      },
      listLatest: () => Promise.resolve([]),
      listExpired: () => Promise.resolve([]),
    };
    const service = new RuntimeCapabilityReadinessService({
      repository,
      clock: { now: () => '2026-08-02T11:00:00.000Z' },
    });
    await expect(
      service.evaluate({ ...evaluationInput(), maintenanceMode: true }),
    ).resolves.toMatchObject({
      snapshot: { status: 'suspended', reasons: [{ code: 'NODE_MAINTENANCE' }] },
    });
  });
});

function evaluationInput() {
  return {
    definition: createNodeCapabilityDefinition({
      capabilityId: 'device.inspect.p07',
      version: 1,
      domain: 'device',
      name: 'Inspect',
      description: 'Inspect a device.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      successCriteria: [{ type: 'completed' }],
      requiredEvidence: [{ type: 'provider_result' }],
      riskLevel: 'low',
      status: 'published',
    }),
    implementations: [
      createCapabilityImplementationBinding({
        bindingId: 'binding.p07',
        capabilityId: 'device.inspect.p07',
        capabilityVersion: 1,
        implementationType: 'skill',
        implementationId: 'skill.p07',
        implementationVersion: '1',
        role: 'primary',
        priority: 1,
        status: 'active',
        revision: 1,
      }),
    ],
    maintenanceMode: false,
    killSwitch: false,
    ttlMs: 60_000,
    minimumStableWindowMs: 10_000,
    trigger: 'unit-test',
  } as const;
}

function implementation(available: boolean): RuntimeImplementationReadiness {
  return Object.freeze({
    bindingId: 'binding.p07',
    available,
    degraded: false,
    catalogParts: Object.freeze(['catalog.p07']),
    policyParts: Object.freeze(['policy.p07']),
    reasons: Object.freeze(
      available ? [] : [{ code: 'PROVIDER_AVAILABILITY_EXPIRED', severity: 'blocking' as const }],
    ),
  });
}
