import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Frozen MCP Tasks shared protocol package', () => {
  it('verifies the pinned source, derived schema lock, valid fixtures and legacy rejection fixtures', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const output = execFileSync(
      process.execPath,
      [resolve(root, 'protocol/scripts/verify-protocol-package.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(output).toContain('Frozen protocol package verified');
    expect(output).toContain('9 valid fixtures');
    expect(output).toContain('12 invalid fixtures');
  });
});
