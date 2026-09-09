import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('verifies union identities, unsafe archives, source coverage, secrets and repeatable publication', () => {
  expect(() =>
    execFileSync('python3', ['-B', resolve('deploy/united/bundle_test.py')], {
      cwd: resolve('.'),
      stdio: 'pipe',
    }),
  ).not.toThrow();
}, 60_000);
