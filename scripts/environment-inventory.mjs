import process from 'node:process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults } from '../deploy/development/config.mjs';

export const environmentSources = [
  'apps/server/src/environment.ts',
  'apps/node-control-api/src/environment.ts',
  'apps/node-control-worker/src/environment.ts',
  'packages/application/src/compiler/artifact-registry.ts',
  'apps/server/src/ugv-live-side-effect-gate.ts',
  'apps/server/src/ugv-simulation-side-effect-gate.ts',
];
export function environmentInventory(root) {
  const fields = new Map();
  for (const path of environmentSources) {
    const source = readFileSync(resolve(root, path), 'utf8');
    for (const match of source.matchAll(
      /\b((?:SDAR_|ALLOW_UGV_|UGV_|BUSINESS_EVENTS_)[A-Z0-9_]+|NODE_ENV)\b/gu,
    )) {
      const key = match[1];
      // Error constants and a protocol queue prefix are not configuration reads.
      if (
        key.endsWith('_NOT_AUTHORIZED') ||
        ['SDAR_V13_ARTIFACT_QUEUES', 'SDAR_V13_ARTIFACT_EVENTS'].includes(key)
      )
        continue;
      if (!fields.has(key)) fields.set(key, []);
      if (!fields.get(key).includes(path)) fields.get(key).push(path);
    }
  }
  for (const key of [
    ...Object.keys(defaults),
    'SDAR_ENV_FILE',
    'SDAR_POSTGRES_PASSWORD',
    'SDAR_CONTROL_POSTGRES_PASSWORD',
    'SDAR_CONSOLE_DEV_PORT',
    'SDAR_CONSOLE_DEV_PROXY_URL',
    'SDAR_UGV_REGISTRY_ENDPOINT',
    'SDAR_UGV_REGISTRY_ENVIRONMENT',
    'SDAR_UGV_SOURCE_ID',
    'SDAR_UGV_EXTERNAL_PROVIDER_ID',
    'SDAR_UGV_EXTERNAL_SERVER_ID',
  ]) {
    if (!fields.has(key)) fields.set(key, ['deploy/development/config.mjs']);
  }
  return [...fields].sort(([a], [b]) => a.localeCompare(b));
}
export function missingEnvironmentExamples(root) {
  const text = readFileSync(resolve(root, '.env.example'), 'utf8');
  const present = new Set(
    [...text.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]+)=/gmu)].map((m) => m[1]),
  );
  return environmentInventory(root)
    .filter(([key]) => !present.has(key))
    .map(([key]) => key);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingEnvironmentExamples(resolve(import.meta.dirname, '..'));
  console.log(JSON.stringify({ status: missing.length ? 'failed' : 'passed', missing }));
  process.exitCode = missing.length ? 1 : 0;
}
