import { describe, expect, it } from 'vitest';

import {
  assertRevisionIntegrity,
  configurationEtag,
  createConfigurationRevision,
  NodeControlDomainError,
  observeConfigurationRevision,
  publishConfigurationRevision,
  validateConfigurationRevision,
} from '../src/index.js';

const now = '2026-08-01T18:30:00.000Z';

describe('ConfigurationRevision', () => {
  it('hashes canonical bounded JSON and enforces Draft to Validate to Publish', () => {
    const first = createConfigurationRevision(
      {
        configurationId: 'runtime-policy',
        targetType: 'runtime_policy',
        targetId: 'node-1',
        revision: 1,
        applyMode: 'new_task_only',
        content: { b: 2, a: { d: 4, c: 3 } },
        createdBy: 'operator-1',
      },
      now,
    );
    const reordered = createConfigurationRevision(
      { ...first, content: { a: { c: 3, d: 4 }, b: 2 } },
      now,
    );
    expect(first.checksum).toBe(reordered.checksum);
    const published = publishConfigurationRevision(validateConfigurationRevision(first), now);
    expect(published.status).toBe('published');
    expect(configurationEtag(published)).toContain(published.checksum);
    expect(() => publishConfigurationRevision(first, now)).toThrow(
      'Cannot transition Configuration Revision from draft to published.',
    );
  });

  it('rejects plaintext secret-shaped fields and forged content', () => {
    expect(() =>
      createConfigurationRevision(
        {
          configurationId: 'provider',
          targetType: 'llm_provider',
          targetId: 'provider-1',
          revision: 1,
          applyMode: 'reconnect_required',
          content: { apiToken: 'plaintext' },
          createdBy: 'operator-1',
        },
        now,
      ),
    ).toThrow(NodeControlDomainError);
    expect(() =>
      createConfigurationRevision(
        {
          configurationId: 'provider-credential',
          targetType: 'llm_provider',
          targetId: 'provider-1',
          revision: 1,
          applyMode: 'reconnect_required',
          content: { credential: 'plaintext' },
          createdBy: 'operator-1',
        },
        now,
      ),
    ).toThrow('must be represented by a SecretRef');
    const revision = createConfigurationRevision(
      {
        configurationId: 'provider',
        targetType: 'llm_provider',
        targetId: 'provider-1',
        revision: 1,
        applyMode: 'reconnect_required',
        content: { credentialRef: 'secret://provider-1' },
        createdBy: 'operator-1',
      },
      now,
    );
    expect(() => {
      assertRevisionIntegrity({ ...revision, content: { enabled: true } });
    }).toThrow('Configuration Revision checksum does not match canonical content.');
  });

  it('requires an exact checksum before acknowledging applied', () => {
    const published = publishConfigurationRevision(
      validateConfigurationRevision(
        createConfigurationRevision(
          {
            configurationId: 'runtime-policy',
            targetType: 'runtime_policy',
            targetId: 'node-1',
            revision: 1,
            applyMode: 'hot_reload',
            content: { logLevel: 'info' },
            createdBy: 'operator-1',
          },
          now,
        ),
      ),
      now,
    );
    expect(
      observeConfigurationRevision(published, {
        runtimeInstanceId: 'runtime-1',
        targetType: 'runtime_policy',
        targetId: 'node-1',
        revision: 1,
        status: 'applied',
        observedRuntimeVersion: '1.4.0',
        activeChecksum: published.checksum,
        acknowledgedAt: now,
      }),
    ).toBe('applied');
    expect(() =>
      observeConfigurationRevision(published, {
        runtimeInstanceId: 'runtime-1',
        targetType: 'runtime_policy',
        targetId: 'node-1',
        revision: 1,
        status: 'applied',
        observedRuntimeVersion: '1.4.0',
        activeChecksum: '0'.repeat(64),
        acknowledgedAt: now,
      }),
    ).toThrow('Applied acknowledgement checksum does not match');
  });
});
