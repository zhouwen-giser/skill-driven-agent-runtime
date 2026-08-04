import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpNodeControlCapabilityEvidenceReader } from '../src/index.js';

describe('HttpNodeControlCapabilityEvidenceReader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticates, validates and maps full Control authority state', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          capabilityId: 'cap.inspect',
          version: 1,
          domain: 'embodied',
          name: 'Inspect',
          description: 'Inspect an area.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          successCriteria: [],
          requiredEvidence: [],
          effects: [],
          artifacts: [],
          constraints: [],
          supportedModes: [],
          riskLevel: 'low',
          status: 'published',
          definitionHash: 'a'.repeat(64),
          createdAt: '2026-08-04T07:00:00.000Z',
          updatedAt: '2026-08-04T07:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              bindingId: 'binding-a',
              revision: 1,
              capabilityId: 'cap.inspect',
              capabilityVersion: 1,
              implementationType: 'skill',
              implementationId: 'skill.inspect',
              implementationVersion: '1',
              role: 'primary',
              priority: 0,
              status: 'active',
              createdAt: '2026-08-04T07:00:00.000Z',
            },
          ],
          totalEstimate: 1,
          asOf: '2026-08-04T07:00:00.000Z',
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const reader = new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'https://control.example.test/',
      serviceToken: 's'.repeat(32),
    });

    await expect(reader.load('cap.inspect', 1)).resolves.toMatchObject({
      definition: { capability_id: 'cap.inspect', version: 1 },
      implementationBindings: [{ binding_id: 'binding-a', implementation_id: 'skill.inspect' }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls)
      expect(call[1]?.headers).toMatchObject({ authorization: `Bearer ${'s'.repeat(32)}` });
  });
});
