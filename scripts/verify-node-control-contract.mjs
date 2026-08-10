import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve('protocol/node-control/v1');
const manifest = JSON.parse(await readFile(path.join(root, 'MANIFEST.json'), 'utf8'));
if (manifest.version !== '1.0.0') throw new Error('NODE_CONTROL_CONTRACT_VERSION_INVALID');
if (manifest.status !== 'PROTOCOL_DESIGN_FROZEN_IMPLEMENTATION_PENDING')
  throw new Error('NODE_CONTROL_CONTRACT_STATUS_INVALID');
if (!Array.isArray(manifest.files)) throw new Error('NODE_CONTROL_CONTRACT_MANIFEST_INVALID');

for (const entry of manifest.files) {
  if (!isManifestEntry(entry)) throw new Error('NODE_CONTROL_CONTRACT_MANIFEST_ENTRY_INVALID');
  const file = path.join(root, ...entry.path.split('/'));
  const content = await readFile(file);
  if (content.byteLength !== entry.size)
    throw new Error(`NODE_CONTROL_CONTRACT_SIZE_DRIFT: ${entry.path}`);
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== entry.sha256)
    throw new Error(`NODE_CONTROL_CONTRACT_HASH_DRIFT: ${entry.path}`);
}

const actualFiles = await collectFiles(root);
if (actualFiles.length !== manifest.counts.files)
  throw new Error(`NODE_CONTROL_CONTRACT_FILE_COUNT_INVALID: ${String(actualFiles.length)}`);

const schemaFiles = actualFiles.filter((file) => file.includes('/schemas/') && file.endsWith('.json'));
for (const file of schemaFiles) JSON.parse(await readFile(path.resolve(file), 'utf8'));
if (schemaFiles.length !== manifest.counts.schemas)
  throw new Error(`NODE_CONTROL_SCHEMA_COUNT_INVALID: ${String(schemaFiles.length)}`);

const openApi = await Promise.all(
  actualFiles
    .filter((file) => file.includes('/openapi/') && file.endsWith('.yaml'))
    .map((file) => readFile(path.resolve(file), 'utf8')),
);
const [nodeControlOpenApi, runtimeControlOpenApi] = openApi;
const operationIds = openApi.flatMap((source) =>
  [...source.matchAll(/^\s+operationId:\s*([^\s]+)\s*$/gmu)].map((match) => match[1]),
);
const expectedOperationCount = manifest.counts.publicOperations + manifest.counts.internalOperations;
if (
  operationIds.length !== expectedOperationCount ||
  new Set(operationIds).size !== operationIds.length
)
  throw new Error('NODE_CONTROL_OPERATION_INVENTORY_INVALID');
for (const requiredOperation of [
  'getSdarNodeDeclaration',
  'getNodeControlLiveness',
  'getNodeControlReadiness',
  'getNodeProfile',
  'getNodeHealth',
  'listManagementOperations',
  'getManagementOperation',
  'listAuditEvents',
]) {
  if (!operationIds.includes(requiredOperation))
    throw new Error(`NODE_CONTROL_P01_OPERATION_MISSING: ${requiredOperation}`);
}
for (const [source, method, route, operationId] of [
  [nodeControlOpenApi, 'get', '/api/v1/evidence-export/outbox', 'listEvidenceOutbox'],
  [
    nodeControlOpenApi,
    'get',
    '/api/v1/evidence-export/source-checkpoints',
    'listEvidenceSourceCheckpoints',
  ],
  [
    nodeControlOpenApi,
    'get',
    '/api/v1/evidence-export/projection-issues',
    'listEvidenceProjectionIssues',
  ],
  [
    nodeControlOpenApi,
    'get',
    '/api/v1/evidence-export/quality-issues',
    'listEvidenceQualityIssues',
  ],
  [
    nodeControlOpenApi,
    'get',
    '/api/v1/evidence-export/episode-manifests/{episodeId}',
    'getEpisodeEvidenceManifest',
  ],
  [
    nodeControlOpenApi,
    'get',
    '/api/v1/evidence-export/dead-letters',
    'listEvidenceDeadLetters',
  ],
  [nodeControlOpenApi, 'post', '/api/v1/evidence-export/replays', 'replayEvidence'],
  [
    nodeControlOpenApi,
    'post',
    '/api/v1/evidence-export/dead-letters/{deadLetterId}/retry',
    'retryEvidenceDeadLetter',
  ],
  [
    nodeControlOpenApi,
    'post',
    '/api/v1/evidence-export/reconcile',
    'reconcileEvidenceCoverage',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/configuration',
    'getRuntimeEvidenceOperationsConfiguration',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/status',
    'getRuntimeEvidenceOperationsStatus',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/outbox',
    'listRuntimeEvidenceOutbox',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/source-checkpoints',
    'listRuntimeEvidenceSourceCheckpoints',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/projection-issues',
    'listRuntimeEvidenceProjectionIssues',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/quality-issues',
    'listRuntimeEvidenceQualityIssues',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/episode-manifests/{episodeId}',
    'getRuntimeEpisodeEvidenceManifest',
  ],
  [
    runtimeControlOpenApi,
    'get',
    '/internal/v1/evidence-export/operations/dead-letters',
    'listRuntimeEvidenceDeadLetters',
  ],
  [
    runtimeControlOpenApi,
    'post',
    '/internal/v1/evidence-export/operations/replays',
    'replayRuntimeEvidence',
  ],
  [
    runtimeControlOpenApi,
    'post',
    '/internal/v1/evidence-export/operations/dead-letters/{deadLetterId}/retry',
    'retryRuntimeEvidenceDeadLetter',
  ],
  [
    runtimeControlOpenApi,
    'post',
    '/internal/v1/evidence-export/operations/reconcile',
    'reconcileRuntimeEvidenceCoverage',
  ],
]) {
  if (source === undefined || !source.includes(`  ${route}:\n    ${method}:\n      operationId: ${operationId}\n`))
    throw new Error(`NODE_CONTROL_P11_ROUTE_MISSING: ${operationId}`);
}

const asyncApi = await readFile(path.join(root, 'asyncapi/node-events.asyncapi.yaml'), 'utf8');
const eventMessages = [...asyncApi.matchAll(/^\s{4}node_[a-z0-9_]+:\s*$/gmu)];
if (eventMessages.length !== 20) throw new Error('NODE_CONTROL_EVENT_INVENTORY_INVALID');

const fixtureFiles = actualFiles.filter(
  (file) => file.includes('/fixtures/') && file.endsWith('.json'),
);
for (const file of fixtureFiles) JSON.parse(await readFile(path.resolve(file), 'utf8'));
if (fixtureFiles.length !== 7) throw new Error('NODE_CONTROL_FIXTURE_COUNT_INVALID');

process.stdout.write(
  `Node Control frozen contract verified: ${String(manifest.counts.files)} files, ${String(manifest.counts.schemas)} schemas, ${String(expectedOperationCount)} operations, 20 events, 7 fixtures.\n`,
);

function isManifestEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.path === 'string' &&
    Number.isSafeInteger(value.size) &&
    typeof value.sha256 === 'string'
  );
}

async function collectFiles(directory) {
  const result = [];
  await visit(directory);
  return result;

  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && (await stat(target)).isFile())
        result.push(target.replaceAll('\\', '/'));
    }
  }
}
