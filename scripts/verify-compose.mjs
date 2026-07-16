import { readFile, readdir } from 'node:fs/promises';
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
  "'127.0.0.1:${SDAR_POSTGRES_PORT:-55432}:5432'",
  "'127.0.0.1:${SDAR_REDIS_PORT:-56379}:6379'",
];

for (const fragment of requiredFragments) {
  if (!compose.includes(fragment)) {
    throw new Error(`COMPOSE_BASELINE_MISSING: ${fragment}`);
  }
}

if (/image:\s+[^\n]+:(latest|main|master)\b/u.test(compose)) {
  throw new Error('COMPOSE_MUTABLE_IMAGE_TAG');
}

for (const containerPort of ['5432', '6379']) {
  const publishedPort = compose
    .split(/\r?\n/u)
    .find(
      (line) =>
        new RegExp(String.raw`^\s*-\s*.+:${containerPort}['"]?\s*$`, 'u').test(line) &&
        !line.includes(`'127.0.0.1:`) &&
        !line.includes(`"127.0.0.1:`),
    );
  if (publishedPort !== undefined) {
    throw new Error(`COMPOSE_PUBLIC_DATASTORE_PORT: ${containerPort}`);
  }
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
  'startInfrastructure();',
  "extname = 'vector'",
  "'[1,0,0]'::vector(3)",
  'sdar:smoke:queue-persistence',
  'stopInfrastructure();',
]) {
  if (!smoke.includes(fragment)) {
    throw new Error(`INFRA_SMOKE_BASELINE_MISSING: ${fragment}`);
  }
}

const runtime = await readFile(new URL('../apps/server/src/runtime.ts', import.meta.url), 'utf8');
const migrationEntries = await readdir(new URL('../infra/postgres/migrations/', import.meta.url));
const upMigrations = migrationEntries.filter((name) => name.endsWith('.up.sql')).sort();
for (const name of upMigrations) {
  if (!runtime.includes(`'${name}'`)) {
    throw new Error(`SERVER_RUNTIME_MIGRATION_MISSING: ${name}`);
  }
  const down = name.replace(/\.up\.sql$/u, '.down.sql');
  if (!migrationEntries.includes(down)) {
    throw new Error(`POSTGRES_ROLLBACK_MISSING: ${down}`);
  }
}

process.stdout.write(
  `Compose, PostgreSQL bootstrap, and ${String(upMigrations.length)} runtime migrations verified.\n`,
);
