import { describe, expect, it } from 'vitest';

import { UgvNaturalLanguageCapabilityAdmissionResolver } from '../src/ugv-natural-language-capability-admission.js';

const resolver = resolverFor(2);

describe('UGV natural-language Capability admission', () => {
  it('uses the public Exposure resource for benchmark natural-language requests', async () => {
    const site = resolverFor(1, 'vehicle:ugv');
    const result = await site.resolve({
      messageText: 'Move the UGV to longitude 106.8, latitude 29.7.',
      userId: 'benchmark',
      clientRequestId: 'site-benchmark',
      receivedAt: '2026-09-09T00:00:00.000Z',
    });
    expect(result?.capabilityInput).toEqual({
      resourceId: 'vehicle:ugv',
      target: { x: 106.8, y: 29.7, frame: 'WGS84' },
    });
  });

  it('deterministically resolves an English SACS text request without private metadata', async () => {
    const resolved = await resolver.resolve({
      messageText: 'Move the UGV to WGS84 lon: 106.81344630, lat: 29.72034353, alt: 500.000.',
      userId: 'anonymous',
      clientRequestId: 'sacs-message-1',
      receivedAt: '2026-08-24T08:00:00.000Z',
    });

    expect(resolved).toEqual({
      idempotencyKey: expect.stringMatching(/^nlcap-[a-f0-9]{64}$/u),
      requestedCapability: {
        exposureId: 'a2a.embodied.move',
        exposureVersion: 2,
        requestId: resolved?.idempotencyKey,
      },
      capabilityInput: {
        resourceId: 'vehicle:ugv1',
        target: { x: 106.8134463, y: 29.72034353, frame: 'WGS84' },
      },
    });
  });

  it('resolves Chinese labels and keeps replay identity independent of receive time', async () => {
    const request = {
      messageText: '请让无人车移动到经度 106.8，纬度 29.7。',
      userId: 'anonymous',
      clientRequestId: 'sacs-message-2',
    } as const;
    const first = await resolver.resolve({
      ...request,
      receivedAt: '2026-08-24T08:00:00.000Z',
    });
    const replay = await resolver.resolve({
      ...request,
      receivedAt: '2026-08-24T08:01:00.000Z',
    });

    expect(replay).toEqual(first);
  });

  it('uses the current active append-only Exposure version instead of a profile constant', async () => {
    const successor = resolverFor(3);

    const resolved = await successor.resolve({
      messageText: 'Move the UGV to longitude 106.8, latitude 29.7.',
      userId: 'anonymous',
      clientRequestId: 'sacs-successor-3',
      receivedAt: '2026-08-31T16:00:00.000Z',
    });

    expect(resolved?.requestedCapability).toMatchObject({
      exposureId: 'a2a.embodied.move',
      exposureVersion: 3,
    });
  });

  it('does not create an admission when no active Exposure exists', async () => {
    const unavailable = new UgvNaturalLanguageCapabilityAdmissionResolver({
      exposures: { findCurrent: () => Promise.resolve(undefined) },
    });

    await expect(
      unavailable.resolve({
        messageText: 'Move the UGV to longitude 106.8, latitude 29.7.',
        userId: 'anonymous',
        clientRequestId: 'sacs-no-exposure',
        receivedAt: '2026-08-31T16:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it('does not reinterpret unrelated natural language as UGV admission', async () => {
    await expect(
      resolver.resolve({
        messageText: 'Summarize the current weather.',
        userId: 'anonymous',
        clientRequestId: 'sacs-message-3',
        receivedAt: '2026-08-24T08:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['missing latitude', 'Move the UGV to longitude 106.8.'],
    ['duplicate longitude', 'Move the UGV to lon 106.8, longitude 106.9, lat 29.7.'],
    ['unlabelled axes', 'Move the UGV to 106.8, 29.7.'],
    ['out of range', 'Move the UGV to longitude 181, latitude 29.7.'],
  ])('rejects %s before creating execution authority', async (_name, messageText) => {
    await expect(
      resolver.resolve({
        messageText,
        userId: 'anonymous',
        clientRequestId: 'sacs-message-invalid',
        receivedAt: '2026-08-24T08:00:00.000Z',
      }),
    ).rejects.toThrow();
  });
});

function resolverFor(
  exposureVersion: number,
  resourceId = 'vehicle:ugv1',
): UgvNaturalLanguageCapabilityAdmissionResolver {
  return new UgvNaturalLanguageCapabilityAdmissionResolver({
    exposures: {
      findCurrent: (exposureId) =>
        Promise.resolve({
          exposureId,
          exposureVersion,
          requestSchema: { properties: { resourceId: { const: resourceId } } },
        }),
    },
  });
}
