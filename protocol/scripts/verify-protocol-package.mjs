import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const protocolRoot = resolve(root, 'protocol');
const baseline = await json(resolve(protocolRoot, 'protocol-baseline.json'));
const lock = await json(resolve(protocolRoot, 'protocol-baseline.lock.json'));
const expected = {
  protocolVersion: '2026-07-28',
  sourceCommit: '26897cc322f356487da89113451bd16b520b9288',
  sourceSchemaGitBlob: 'cc44564e33305dbc07e820cdd0a97648f3852019',
  sourceSchemaSha256: '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708',
};

for (const [key, value] of Object.entries(expected)) {
  if (baseline[key] !== value || lock[key] !== value) {
    throw new Error(`PROTOCOL_BASELINE_MISMATCH: ${key}`);
  }
}

for (const [path, digest] of Object.entries(lock.files)) {
  const actual = await sha256(readFile(resolve(root, path)));
  if (actual !== digest) throw new Error(`PROTOCOL_LOCK_DRIFT: ${path}`);
}

const frozenDocument = resolve(
  root,
  'docs',
  'protocol',
  'SDAR_MCP_TASKS_UNIFIED_PROTOCOL_V1_0_FROZEN.md',
);
if ((await sha256(readFile(frozenDocument))) !== lock.frozenDocumentSha256) {
  throw new Error('PROTOCOL_FROZEN_DOCUMENT_DRIFT');
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) =>
    /(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value) && Number.isFinite(Date.parse(value)),
});
const schemaDirectory = resolve(protocolRoot, 'schemas');
for (const name of await names(schemaDirectory)) {
  ajv.addSchema(await json(resolve(schemaDirectory, name)));
}

const validCount = await verifyFixtures('valid', true);
const invalidCount = await verifyFixtures('invalid', false);
process.stdout.write(
  `Frozen protocol package verified: ${String(Object.keys(lock.files).length)} locked files, ${String(validCount)} valid fixtures, ${String(invalidCount)} invalid fixtures.\n`,
);

async function verifyFixtures(kind, expectedValid) {
  const directory = resolve(protocolRoot, 'fixtures', kind);
  const files = await names(directory);
  for (const name of files) {
    const fixture = await json(resolve(directory, name));
    const schema = await json(resolve(schemaDirectory, fixture.schema));
    const validate = ajv.getSchema(`${schema.$id}${fixture.ref ?? ''}`);
    if (validate === undefined) throw new Error(`PROTOCOL_FIXTURE_SCHEMA_MISSING: ${name}`);
    const valid = validate(fixture.value);
    if (valid !== expectedValid) {
      throw new Error(
        `PROTOCOL_FIXTURE_EXPECTATION_MISMATCH: ${kind}/${name} ${ajv.errorsText(validate.errors)}`,
      );
    }
  }
  return files.length;
}

async function names(directory) {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function sha256(promise) {
  return createHash('sha256')
    .update(await promise)
    .digest('hex');
}
