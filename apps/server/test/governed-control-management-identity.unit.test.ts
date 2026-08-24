import { describe, expect, it } from 'vitest';

import {
  ConfiguredBearerGovernedControlIdentity,
  ConfiguredTrustedIntranetGovernedControlIdentity,
} from '../src/governed-control-management-identity.js';

const token = 'governed-control-test-token-000001';

describe('ConfiguredBearerGovernedControlIdentity', () => {
  it('derives a human principal and explicit permissions from the exact Bearer credential', async () => {
    const identity = new ConfiguredBearerGovernedControlIdentity({
      token,
      actorId: 'human:operator-1',
      permissions: ['physical_control.confirm', 'physical_control.revoke'],
    });

    const principal = await identity.resolve({
      authorization: `Bearer ${token}`,
      requestId: 'request-1',
      sourceIp: '127.0.0.1',
    });
    expect(principal).toMatchObject({
      actorId: 'human:operator-1',
      kind: 'human',
      authenticationMethod: 'configured_bearer',
      requestId: 'request-1',
    });
    expect([...principal.permissions]).toEqual([
      'physical_control.confirm',
      'physical_control.revoke',
    ]);
  });

  it('rejects missing, malformed, and near-match credentials with 401', async () => {
    const identity = new ConfiguredBearerGovernedControlIdentity({
      token,
      actorId: 'human:operator-1',
      permissions: ['physical_control.confirm'],
    });
    for (const authorization of [
      undefined,
      token,
      `bearer ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token}-wrong`,
    ])
      await expect(
        identity.resolve({
          ...(authorization === undefined ? {} : { authorization }),
          requestId: 'request-denied',
        }),
      ).rejects.toMatchObject({
        code: 'GOVERNED_CONTROL_AUTHENTICATION_REQUIRED',
        status: 401,
      });
  });

  it('fails closed for agent identities and invalid permission configuration', () => {
    expect(
      () =>
        new ConfiguredBearerGovernedControlIdentity({
          token,
          actorId: 'agent:planner',
          permissions: ['physical_control.confirm'],
        }),
    ).toThrow('GOVERNED_CONTROL_IDENTITY_CONFIG_INVALID');
    expect(
      () =>
        new ConfiguredBearerGovernedControlIdentity({
          token,
          actorId: 'human:operator-1',
          permissions: ['physical_control.confirm', 'physical_control.confirm'],
        }),
    ).toThrow('GOVERNED_CONTROL_IDENTITY_CONFIG_INVALID');
  });
});

describe('ConfiguredTrustedIntranetGovernedControlIdentity', () => {
  it('derives the configured human principal without inspecting Authorization', async () => {
    const identity = new ConfiguredTrustedIntranetGovernedControlIdentity({
      actorId: 'human:local-operator',
      permissions: ['physical_control.confirm'],
    });

    for (const authorization of [undefined, 'Bearer ignored-by-trusted-intranet-mode']) {
      const principal = await identity.resolve({
        ...(authorization === undefined ? {} : { authorization }),
        requestId: 'request-trusted-intranet',
        sourceIp: '127.0.0.1',
      });
      expect(principal).toMatchObject({
        actorId: 'human:local-operator',
        kind: 'human',
        authenticationMethod: 'trusted_intranet',
        requestId: 'request-trusted-intranet',
        sourceIp: '127.0.0.1',
      });
      expect([...principal.permissions]).toEqual(['physical_control.confirm']);
    }
  });
});
