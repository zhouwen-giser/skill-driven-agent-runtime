import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
const requiredFragments = [
  'pgvector/pgvector@sha256:',
  'redis@sha256:',
  'platform: linux/amd64',
  'healthcheck:',
  './infra/postgres/init:/docker-entrypoint-initdb.d:ro',
  "restart: 'no'",
];

for (const fragment of requiredFragments) {
  if (!compose.includes(fragment)) {
    throw new Error(`COMPOSE_BASELINE_MISSING: ${fragment}`);
  }
}

if (/image:\s+[^\n]+:(latest|main|master)\b/u.test(compose)) {
  throw new Error('COMPOSE_MUTABLE_IMAGE_TAG');
}

const migration = await readFile(
  new URL('../infra/postgres/init/0001_sdar_bootstrap.up.sql', import.meta.url),
  'utf8',
);
for (const statement of [
  'CREATE EXTENSION IF NOT EXISTS vector',
  'CREATE TABLE IF NOT EXISTS schema_migration',
  'vector(3)',
]) {
  if (!migration.includes(statement)) {
    throw new Error(`POSTGRES_BOOTSTRAP_MISSING: ${statement}`);
  }
}

const smoke = await readFile(new URL('./smoke-infra.mjs', import.meta.url), 'utf8');
for (const fragment of [
  "'up', '-d', '--wait'",
  "extname = 'vector'",
  "'[1,0,0]'::vector(3)",
  'sdar:smoke:queue-persistence',
  "'stop'",
]) {
  if (!smoke.includes(fragment)) {
    throw new Error(`INFRA_SMOKE_BASELINE_MISSING: ${fragment}`);
  }
}

process.stdout.write('Compose and PostgreSQL bootstrap baseline verified.\n');
