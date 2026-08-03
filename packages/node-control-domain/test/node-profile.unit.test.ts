import { describe, expect, it } from 'vitest';

import {
  createManagementOperation,
  createNodeProfile,
  NodeControlDomainError,
  transitionManagementOperation,
} from '../src/index.js';

const now = '2026-08-01T17:00:00.000Z';

describe('Node Control foundation domain', () => {
  it('creates a bounded immutable Node Profile', () => {
    const profile = createNodeProfile(
      {
        nodeId: 'node-east-1',
        nodeType: 'sdar-runtime',
        displayName: 'East node',
        environment: 'test',
        labels: { region: 'east' },
        authorityScopes: ['local'],
        runtimeEndpointRef: 'http://127.0.0.1:9998',
      },
      now,
    );
    expect(profile).toMatchObject({ nodeId: 'node-east-1', revision: 1, status: 'draft' });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.labels)).toBe(true);
  });

  it('rejects duplicate authority scopes and oversized labels', () => {
    expect(() =>
      createNodeProfile(
        {
          nodeId: 'node-east-1',
          nodeType: 'sdar-runtime',
          displayName: 'East node',
          environment: 'test',
          authorityScopes: ['local', 'local'],
          runtimeEndpointRef: 'http://127.0.0.1:9998',
        },
        now,
      ),
    ).toThrow(NodeControlDomainError);
  });

  it('enforces the ManagementOperation state machine', () => {
    const accepted = createManagementOperation(
      {
        operationId: 'op-1',
        operationType: 'node.profile.publish',
        target: { type: 'node', id: 'node-east-1', revision: 1 },
        actorId: 'operator-1',
        reason: 'publish approved profile',
        idempotencyKeyHash: 'a'.repeat(64),
        inputHash: 'b'.repeat(64),
      },
      now,
    );
    const running = transitionManagementOperation(accepted, 'running', now);
    expect(
      transitionManagementOperation(running, 'succeeded', now, { result: { ok: true } }),
    ).toMatchObject({
      status: 'succeeded',
      result: { ok: true },
    });
    expect(() => transitionManagementOperation(accepted, 'succeeded', now)).toThrow(
      'Cannot transition ManagementOperation from accepted to succeeded.',
    );
  });
});
