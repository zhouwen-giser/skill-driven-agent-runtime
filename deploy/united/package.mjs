import { spawnSync } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';
import process from 'node:process';
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const result = spawnSync(
  'python3',
  [fileURLToPath(new URL('./bundle.py', import.meta.url)), 'package', ...args],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
