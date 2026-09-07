import process from 'node:process';
import { readFile } from 'node:fs/promises';
const configuration = JSON.parse(await readFile('/run/sdar/environment.json', 'utf8'));
Object.assign(process.env, configuration);
// The rendered JSON is already merged with explicit deployment overrides. Do not load host paths.
delete process.env.SDAR_ENV_FILE;
const app = { runtime: 'server', api: 'node-control-api', worker: 'node-control-worker' }[
  process.argv[2]
];
if (!app) throw new Error('DEVELOPMENT_SERVICE_INVALID');
await import(`../../dist/apps/${app}/src/main.js`);
