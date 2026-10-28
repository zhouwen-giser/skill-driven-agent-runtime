import { describe, expect, it } from 'vitest';
import { taskBusinessFixture } from './task-business-fixture.js';
import { taskBusinessContextDigest, projectTaskBusiness } from '../src/task-business.js';
import { hashCanonicalEvidenceJson } from '../src/evidence/canonical-evidence.js';
import { hashSourceArtifactJson } from '../src/evidence/source-artifact-ref.js';
import type { EvidenceJsonValue } from '../src/evidence/canonical-evidence.js';
describe('native effect source context identity', () => {
  it('preserves legacy digests and retains the original v2 source without publishing an authorization value', () => {
    const legacy = taskBusinessFixture();
    expect(taskBusinessContextDigest(legacy.context)).toBe(
      hashCanonicalEvidenceJson(legacy.context),
    );
    const base = taskBusinessFixture({
      operationName: 'simulation_apply_effect',
      resourceId: 'vehicle:ugv1',
    });
    const view = {
      ...base,
      context: {
        ...base.context,
        summary: {
          ...base.context.summary,
          properties: {
            schemaVersion: 'ugv.zmq-context-summary/1',
            executionResult: {
              schemaVersion: 'ugv.zmq-effect-result/2',
              qualification: 'site_control',
              targetProvenance: {
                kind: 'manual',
                sourceNote: 'isolated virtual entity',
                authorizationContextHash: 'a'.repeat(64),
              },
            },
          },
        },
      },
    };
    expect(() => hashCanonicalEvidenceJson(view.context)).toThrow('Forbidden evidence field');
    expect(taskBusinessContextDigest(view.context)).toBe(
      hashSourceArtifactJson(view.context as unknown as EvidenceJsonValue),
    );
    const p = projectTaskBusiness({
      bindingId: 'native-effect-binding',
      taskId: 'native-effect',
      view,
      contents: [],
      receivedAt: '2026-10-28T00:00:00Z',
      projectedAt: '2026-10-28T00:00:00Z',
      historyContinuous: false,
    });
    expect(p.executionSummary['properties']).toEqual(view.context.summary.properties);
    expect(() =>
      taskBusinessContextDigest({
        ...view.context,
        identity: { ...view.context.identity, operationName: 'another-operation' },
      }),
    ).toThrow('Forbidden evidence field');
  });
  it('allows only exact public hash schema declarations and keeps actual values/defaults forbidden', () => {
    expect(() =>
      hashCanonicalEvidenceJson({ properties: { authorizationContextHash: { type: 'string' } } }),
    ).not.toThrow();
    for (const value of [
      'a'.repeat(64),
      { type: 'string', default: 'a'.repeat(64) },
      { type: 'string', examples: ['a'.repeat(64)] },
    ])
      expect(() => hashCanonicalEvidenceJson({ authorizationContextHash: value })).toThrow(
        'Forbidden evidence field',
      );
  });
});
