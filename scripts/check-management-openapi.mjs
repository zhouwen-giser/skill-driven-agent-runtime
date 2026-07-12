import { readFile } from 'node:fs/promises';
import process from 'node:process';

const implementation = await readFile('packages/management-api/src/http-endpoint.ts', 'utf8');
const specification = await readFile('schemas/management-api.openapi.yaml', 'utf8');

const implemented = [
  ...implementation.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gu),
]
  .map((match) => `${match[1]} ${normalizePath(match[2])}`)
  .filter((route) => route.includes(' /api/'));
const documented = [];
let currentPath;
for (const line of specification.split(/\r?\n/u)) {
  const pathMatch = /^\s{2}(\/[^:]+):\s*$/u.exec(line);
  if (pathMatch !== null) {
    currentPath = pathMatch[1];
    continue;
  }
  const methodMatch = /^\s{4}(get|post|put|patch|delete):\s*$/u.exec(line);
  if (methodMatch !== null && currentPath !== undefined) {
    documented.push(`${methodMatch[1]} ${currentPath}`);
  }
}

const missing = implemented.filter((route) => !documented.includes(route));
const stale = documented.filter((route) => !implemented.includes(route));
if (missing.length > 0 || stale.length > 0) {
  throw new Error(
    `MANAGEMENT_OPENAPI_ROUTE_DRIFT\nMissing: ${missing.join(', ') || 'none'}\nStale: ${stale.join(', ') || 'none'}`,
  );
}

const operationIds = [...specification.matchAll(/^\s{6}operationId:\s*(\S+)\s*$/gmu)].map(
  (match) => match[1],
);
const duplicates = operationIds.filter((value, index) => operationIds.indexOf(value) !== index);
if (duplicates.length > 0) {
  throw new Error(`MANAGEMENT_OPENAPI_DUPLICATE_OPERATION_ID: ${duplicates.join(', ')}`);
}

process.stdout.write(
  `Verified ${String(implemented.length)} management API operations against OpenAPI.\n`,
);

function normalizePath(value) {
  return value.replace(/:([A-Za-z0-9]+)/gu, '{$1}');
}
