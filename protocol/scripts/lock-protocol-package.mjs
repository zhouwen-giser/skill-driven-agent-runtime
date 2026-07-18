import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const protocolRoot = resolve(root, 'protocol');
const files = [
  resolve(protocolRoot, 'protocol-baseline.json'),
  resolve(protocolRoot, 'source', 'mcp-2026-07-28.schema.json'),
  ...(await jsonFiles(resolve(protocolRoot, 'schemas'))),
];
const hashes = Object.fromEntries(
  await Promise.all(
    files.sort().map(async (file) => [slash(relative(root, file)), await sha256(readFile(file))]),
  ),
);
const frozenDocument = resolve(
  root,
  'docs',
  'protocol',
  'SDAR_MCP_TASKS_UNIFIED_PROTOCOL_V1_0_FROZEN.md',
);
const lock = {
  schemaVersion: 1,
  protocolVersion: '2026-07-28',
  sourceCommit: '26897cc322f356487da89113451bd16b520b9288',
  sourceSchemaGitBlob: 'cc44564e33305dbc07e820cdd0a97648f3852019',
  sourceSchemaSha256: '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708',
  frozenDocumentSha256: await sha256(readFile(frozenDocument)),
  files: hashes,
};

await writeFile(
  resolve(protocolRoot, 'protocol-baseline.lock.json'),
  `${JSON.stringify(lock, null, 2)}\n`,
);
process.stdout.write(`Locked ${String(Object.keys(hashes).length)} protocol files.\n`);

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(directory, entry.name));
}

async function sha256(promise) {
  return createHash('sha256')
    .update(await promise)
    .digest('hex');
}

function slash(value) {
  return value.replaceAll('\\', '/');
}
