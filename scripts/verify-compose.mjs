import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const compose = (await readFile(new URL('../compose.yaml', import.meta.url), 'utf8')).replaceAll(
  '\r\n',
  '\n',
);
const infrastructureHelper = (
  await readFile(new URL('./lib/infrastructure.mjs', import.meta.url), 'utf8')
).replaceAll('\r\n', '\n');
const requiredFragments = [
  "build:\n      context: .\n      dockerfile: infra/postgres/Dockerfile.pgvector-hardened\n      args:\n        SOURCE_DATE_EPOCH: '0'\n      provenance: false\n      sbom: false",
  'image: sdar/postgres-pgvector:17.10-0.8.5-alpine3.23\n    pull_policy: never\n    platform: linux/amd64',
  'image: redis@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
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

if ([...compose.matchAll(/^\s+pull_policy:\s+never\s*$/gmu)].length !== 1)
  throw new Error('COMPOSE_POSTGRES_PULL_POLICY_INVALID');

for (const deterministicBuildControl of [
  "'--project-name',\n      'sdar'",
  "'--provenance=false'",
  "'--sbom=false'",
]) {
  if (!infrastructureHelper.includes(deterministicBuildControl))
    throw new Error(`POSTGRES_HARDENED_IMAGE_BUILD_CONTROL_MISSING: ${deterministicBuildControl}`);
}

for (const stableReadinessControl of [
  'PostgreSQL init process complete; ready for start up.',
  'Skipping initialization',
  'database system is ready to accept connections',
  'INFRASTRUCTURE_POSTGRES_NOT_STABLY_READY',
  '--command "SELECT 1"',
  'SDAR_INFRA_READY_URL',
  'connectionTimeoutMillis: 1_000',
  'SDAR_INFRA_REDIS_PORT',
  "socket.write('*1\\\\r\\\\n$4\\\\r\\\\nPING\\\\r\\\\n')",
  "'--force-recreate'",
]) {
  if (!infrastructureHelper.includes(stableReadinessControl))
    throw new Error(`POSTGRES_STABLE_READINESS_CONTROL_MISSING: ${stableReadinessControl}`);
}

const imageReferences = [...compose.matchAll(/^\s+image:\s+([^\s#]+)\s*$/gmu)].map(
  (match) => match[1],
);
const expectedImageReferences = [
  'sdar/postgres-pgvector:17.10-0.8.5-alpine3.23',
  'redis@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
];
if (
  imageReferences.length !== expectedImageReferences.length ||
  imageReferences.some((reference, index) => reference !== expectedImageReferences[index])
) {
  throw new Error(`COMPOSE_IMAGE_SET_INVALID: ${imageReferences.join(',')}`);
}

if (/image:\s+[^\n]+:(latest|main|master)\b/u.test(compose))
  throw new Error('COMPOSE_MUTABLE_IMAGE_TAG');

const postgresDockerfile = (
  await readFile(new URL('../infra/postgres/Dockerfile.pgvector-hardened', import.meta.url), 'utf8')
).replaceAll('\r\n', '\n');
const expectedSyntaxDirective =
  '# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89';
const syntaxDirectives = postgresDockerfile
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('# syntax='));
if (
  postgresDockerfile.split(/\r?\n/u)[0] !== expectedSyntaxDirective ||
  syntaxDirectives.length !== 1 ||
  syntaxDirectives[0] !== expectedSyntaxDirective
) {
  throw new Error(`POSTGRES_HARDENED_IMAGE_SYNTAX_INVALID: ${syntaxDirectives.join(',')}`);
}
const dockerfileLines = postgresDockerfile
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

assertExactInstructionSet('FROM', [
  'FROM postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4',
]);
assertExactInstructionSet('ARG', [
  'ARG SOURCE_DATE_EPOCH=0',
  'ARG PGVECTOR_VERSION=0.8.5',
  'ARG PGVECTOR_SOURCE_SHA256=6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44',
  'ARG BUILD_BASE_VERSION=0.5-r3',
  'ARG SU_EXEC_VERSION=0.3-r0',
]);
assertExactInstructionSet('ADD', [
  'ADD --checksum=sha256:6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44 \\',
  'ADD --checksum=sha256:a0f3f75e286f08be153fd2b7a91788f0bbcd7d5155a40cdca6952742c293fb14 --chmod=0644 \\',
]);
for (const addBlock of [
  'ADD --checksum=sha256:6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44 \\\n  https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.5.tar.gz \\\n  /tmp/pgvector.tar.gz',
  'ADD --checksum=sha256:a0f3f75e286f08be153fd2b7a91788f0bbcd7d5155a40cdca6952742c293fb14 --chmod=0644 \\\n  https://raw.githubusercontent.com/ncopa/su-exec/89c016e6e08749d583efdeda04b9f73e1218e253/LICENSE \\\n  /usr/share/doc/su-exec/LICENSE',
]) {
  if (postgresDockerfile.split(addBlock).length !== 2)
    throw new Error(`POSTGRES_HARDENED_IMAGE_ADD_BLOCK_INVALID: ${addBlock}`);
}

for (const command of [
  'test "$SOURCE_DATE_EPOCH" = "0"; \\',
  'test "$PGVECTOR_VERSION" = "0.8.5"; \\',
  'test "$PGVECTOR_SOURCE_SHA256" = "6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44"; \\',
  'test "$BUILD_BASE_VERSION" = "0.5-r3"; \\',
  'test "$SU_EXEC_VERSION" = "0.3-r0"; \\',
  'apk add --no-cache --virtual .pgvector-build-deps "build-base=$BUILD_BASE_VERSION"; \\',
  'cp /tmp/pgvector/LICENSE /tmp/pgvector/README.md /usr/share/doc/pgvector/; \\',
  'apk add --no-cache "su-exec=$SU_EXEC_VERSION"; \\',
  "sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh; \\",
  'rm /usr/local/bin/gosu',
  'org.opencontainers.image.version="17.10-pgvector-0.8.5-alpine3.23" \\',
  'org.opencontainers.image.source="https://github.com/zhouwen-giser/skill-driven-agent-runtime" \\',
  'org.opencontainers.image.licenses="PostgreSQL AND MIT" \\',
  'io.sdar.pgvector.source="https://github.com/pgvector/pgvector/tree/v0.8.5" \\',
  'io.sdar.su-exec.source="https://github.com/ncopa/su-exec/tree/89c016e6e08749d583efdeda04b9f73e1218e253"',
]) {
  if (dockerfileLines.filter((line) => line === command).length !== 1)
    throw new Error(`POSTGRES_HARDENED_IMAGE_COMMAND_INVALID: ${command}`);
}

const remoteReferences = [...postgresDockerfile.matchAll(/https?:\/\/[^\s\\"]+/gu)].map(
  (match) => match[0],
);
const expectedRemoteReferences = [
  'https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.5.tar.gz',
  'https://raw.githubusercontent.com/ncopa/su-exec/89c016e6e08749d583efdeda04b9f73e1218e253/LICENSE',
  'https://github.com/zhouwen-giser/skill-driven-agent-runtime',
  'https://github.com/pgvector/pgvector/tree/v0.8.5',
  'https://github.com/ncopa/su-exec/tree/89c016e6e08749d583efdeda04b9f73e1218e253',
];
if (
  remoteReferences.length !== expectedRemoteReferences.length ||
  remoteReferences.some((reference, index) => reference !== expectedRemoteReferences[index])
) {
  throw new Error(`POSTGRES_HARDENED_IMAGE_REMOTE_SOURCE_INVALID: ${remoteReferences.join(',')}`);
}

function assertExactInstructionSet(instruction, expected) {
  const actual = dockerfileLines.filter((line) => line.startsWith(`${instruction} `));
  if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) {
    throw new Error(`POSTGRES_HARDENED_IMAGE_${instruction}_INVALID: ${actual.join(',')}`);
  }
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
