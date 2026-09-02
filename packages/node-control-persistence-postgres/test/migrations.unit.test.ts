import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveDefaultControlMigrationRoot } from '../src/migrations.js';

describe('Control migration asset resolution', () => {
  it('resolves deployment assets from the process working directory', () => {
    expect(resolveDefaultControlMigrationRoot('/opt/sdar-runtime')).toBe(
      resolve('/opt/sdar-runtime', 'infra', 'postgres-control', 'migrations'),
    );
  });
});
