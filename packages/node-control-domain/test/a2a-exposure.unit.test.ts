import { describe, expect, it } from 'vitest';

import {
  a2aExposureEtag,
  assertA2aExposureTransition,
  createA2aExposureVersion,
} from '../src/index.js';

function exposure() {
  return createA2aExposureVersion({
    exposureId: 'exposure.inspect',
    version: 1,
    capabilityId: 'device.inspect',
    capabilityVersion: 2,
    agentSkillId: 'capability.device.inspect',
    name: 'Inspect device',
    description: 'Inspect a declared device.',
    tags: ['inspection'],
    requestSchema: { type: 'object' },
    resultSchema: { type: 'object' },
    visibility: 'public',
    requesterPolicy: { allowedRequesterIds: ['requester.allowed'] },
    readinessPublicationPolicy: 'publish_degraded',
    status: 'draft',
  });
}

describe('P08 A2A Exposure identity', () => {
  it('keeps the canonical content hash stable across lifecycle transitions', () => {
    const draft = exposure();
    const published = createA2aExposureVersion({ ...draft, status: 'published' });

    expect(published.exposureHash).toBe(draft.exposureHash);
    expect(a2aExposureEtag(published)).not.toBe(a2aExposureEtag(draft));
    expect(() => {
      assertA2aExposureTransition(draft, 'published');
    }).not.toThrow();
  });

  it('rejects direct draft retirement and sensitive requester policy fields', () => {
    expect(() => {
      assertA2aExposureTransition(exposure(), 'retired');
    }).toThrow();
    expect(() =>
      createA2aExposureVersion({
        ...exposure(),
        requesterPolicy: { apiToken: 'forbidden' },
      }),
    ).toThrow(/sensitive/u);
  });
});
