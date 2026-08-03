import { describe, expect, it } from 'vitest';

import { NodeControlDomainError, rehydrateNodeEventEnvelope } from '../src/index.js';

const event = Object.freeze({
  eventId: 'evt-p12-1',
  eventType: 'node.capability.readiness_changed' as const,
  occurredAt: '2026-08-02T08:00:00.000Z',
  recordedAt: '2026-08-02T08:00:01.000Z',
  nodeId: 'node-p12',
  aggregateType: 'node_capability',
  aggregateId: 'inspection',
  aggregateRevision: 8,
  correlationId: 'corr-p12-1',
  dataClassification: 'internal' as const,
  payload: Object.freeze({
    resourceRef: Object.freeze({ type: 'node_capability', id: 'inspection', revision: 8 }),
    changeCode: 'READINESS_CHANGED',
  }),
});

describe('P12 Node Event envelope', () => {
  it('rehydrates an immutable hint-only frozen-catalog event', () => {
    const hydrated = rehydrateNodeEventEnvelope(event);
    expect(hydrated).toEqual(event);
    expect(Object.isFrozen(hydrated)).toBe(true);
    expect(hydrated.payload).not.toHaveProperty('resource');
  });

  it('rejects event types outside the frozen catalog', () => {
    expect(() =>
      rehydrateNodeEventEnvelope({
        ...event,
        eventType: 'node.resource.snapshot' as typeof event.eventType,
      }),
    ).toThrow(NodeControlDomainError);
  });

  it('rejects secret-shaped values at every payload depth', () => {
    expect(() =>
      rehydrateNodeEventEnvelope({
        ...event,
        payload: { resourceRef: { id: 'inspection' }, credentialToken: 'must-not-leak' },
      }),
    ).toThrow('payload contains secret-shaped data.');
  });
});
