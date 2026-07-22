import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const compose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
const requiredFragments = [
  'pgvector/pgvector@sha256:',
  'redis@sha256:',
  'platform: linux/amd64',
  'healthcheck:',
  './infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql:',
  './infra/postgres/seed/0001_sdar_v1_2_2_minimal_seed.sql:',
  "restart: 'no'",
  "'127.0.0.1:${SDAR_POSTGRES_PORT:-55432}:5432'",
  "'127.0.0.1:${SDAR_REDIS_PORT:-56379}:6379'",
];

for (const fragment of requiredFragments)
  if (!compose.includes(fragment)) throw new Error(`COMPOSE_BASELINE_MISSING: ${fragment}`);

if (/image:\s+[^\n]+:(latest|main|master)\b/u.test(compose))
  throw new Error('COMPOSE_MUTABLE_IMAGE_TAG');

for (const containerPort of ['5432', '6379']) {
  const publishedPort = compose
    .split(/\r?\n/u)
    .find(
      (line) =>
        new RegExp(String.raw`^\s*-\s*.+:${containerPort}['"]?\s*$`, 'u').test(line) &&
        !line.includes(`'127.0.0.1:`) &&
        !line.includes(`"127.0.0.1:`),
    );
  if (publishedPort !== undefined)
    throw new Error(`COMPOSE_PUBLIC_DATASTORE_PORT: ${containerPort}`);
}

const baseline = await readFile(
  new URL('../infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql', import.meta.url),
  'utf8',
);
for (const statement of [
  'CREATE EXTENSION IF NOT EXISTS vector',
  'CREATE TABLE public.schema_migration',
  'CREATE TABLE public.user_goal_plan',
  'CREATE TABLE public.skill_attempt',
  'CREATE TABLE public.business_event_inbox',
  "VALUES ('v1.2.2_clean_slate_baseline')",
])
  if (!baseline.includes(statement))
    throw new Error(`POSTGRES_V122_BASELINE_MISSING: ${statement}`);

const removedCompatibilityVocabulary = ['leg', 'acy'].join('');
if (new RegExp(removedCompatibilityVocabulary, 'iu').test(baseline))
  throw new Error('POSTGRES_V122_BASELINE_REMOVED_COMPATIBILITY_SYMBOL');

const seed = await readFile(
  new URL('../infra/postgres/seed/0001_sdar_v1_2_2_minimal_seed.sql', import.meta.url),
  'utf8',
);
for (const singleton of ['evolution_policy', 'memory_retention_policy'])
  if (!seed.includes(singleton)) throw new Error(`POSTGRES_V122_SEED_MISSING: ${singleton}`);

const reset = await readFile(new URL('./reset-v122-database.mjs', import.meta.url), 'utf8');
for (const guard of [
  'V122_RESET_ENVIRONMENT_REJECTED',
  'V122_RESET_CONFIRMATION_REQUIRED',
  'V122_RESET_DATABASE_NAME_REJECTED',
])
  if (!reset.includes(guard)) throw new Error(`POSTGRES_V122_RESET_GUARD_MISSING: ${guard}`);

process.stdout.write('Compose and SDAR v1.2.2 clean baseline/reset/seed verified.\n');
