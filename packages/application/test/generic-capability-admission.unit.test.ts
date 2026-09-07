import { describe, expect, it, vi } from 'vitest';
import type { CognitiveStructuredModelStageInvoker } from '../src/cognitive/ports.js';
import { GenericCapabilityAdmissionResolver } from '../src/generic-capability-admission.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
const exposure = {
  exposureId: 'documents.summarize',
  exposureVersion: 2,
  requestedCapabilityId: 'documents.summary',
  capabilityVersion: 1,
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['documentId'],
    properties: { documentId: { type: 'string' } },
  },
};
const request = {
  messageText: 'Condense my report.',
  userId: 'reader',
  clientRequestId: 'request-1',
  receivedAt: '2026-09-07T09:00:00.000Z',
};
function resolver(output: unknown, policy?: Readonly<Record<string, unknown>>) {
  const generate = vi.fn(
    (_input: Parameters<CognitiveStructuredModelStageInvoker['generate']>[0]) => {
      void _input;
      return Promise.resolve({ structuredResult: output, invocationId: 'admission-model-1' });
    },
  );
  const service = new GenericCapabilityAdmissionResolver({
    listCurrentExposures: () =>
      Promise.resolve([
        { ...exposure, ...(policy === undefined ? {} : { requesterPolicy: policy }) },
      ]),
    model: { generate },
    schemas: new AjvJsonSchemaValidator(),
  });
  return { service, generate };
}
const choice = {
  status: 'resolved',
  exposures: [{ exposureId: exposure.exposureId, exposureVersion: 2 }],
  input: { documentId: 'report-a' },
  question: '',
  reason: '',
  missingFields: [],
};
describe('Generic public capability admission', () => {
  it('resolves an exact non-device Exposure using only current schema context', async () => {
    const s = resolver(choice);
    expect(await s.service.resolve(request)).toMatchObject({
      status: 'resolved',
      admission: {
        capabilityInput: { documentId: 'report-a' },
        requestedCapability: { exposureVersion: 2 },
      },
    });
    expect(JSON.parse(s.generate.mock.calls[0]?.[0]?.instruction ?? '{}')).toMatchObject({
      exposures: [exposure],
    });
  });
  it('requires missing parameters without inserting any resource defaults', async () => {
    const s = resolver({ ...choice, input: {} });
    expect(await s.service.resolve(request)).toMatchObject({
      status: 'clarification',
      partialInput: {},
      exposureId: exposure.exposureId,
    });
  });
  it('rejects an explicit requester prohibition and never reclassifies it as not applicable', async () => {
    const s = resolver(choice, { allowedRequesterIds: ['owner'] });
    expect(await s.service.resolve(request)).toMatchObject({
      status: 'rejected',
      code: 'TASK_CAPABILITY_REQUESTER_FORBIDDEN',
    });
  });
  it('rejects unknown or revoked versions before binding', async () => {
    const s = resolver({
      ...choice,
      exposures: [{ exposureId: exposure.exposureId, exposureVersion: 1 }],
    });
    expect(await s.service.resolve(request)).toMatchObject({ status: 'rejected' });
  });
  it('requests a split for independent governed capabilities', async () => {
    const s = resolver({
      ...choice,
      exposures: [...choice.exposures, { exposureId: 'data.aggregate', exposureVersion: 1 }],
    });
    expect(await s.service.resolve(request)).toMatchObject({
      status: 'rejected',
      code: 'TASK_CAPABILITY_SPLIT_REQUIRED',
    });
  });
  it('returns not applicable only for an initial unrelated request', async () => {
    const s = resolver({ ...choice, status: 'not_applicable', exposures: [], input: {} });
    expect(await s.service.resolve(request)).toEqual({ status: 'not_applicable' });
    expect(
      await s.service.resolve({
        ...request,
        clarification: {
          status: 'clarification',
          partialInput: {},
          question: 'Document?',
          missingFields: ['documentId'],
        },
        answer: 'changed request',
      }),
    ).toMatchObject({ status: 'rejected' });
  });
});
