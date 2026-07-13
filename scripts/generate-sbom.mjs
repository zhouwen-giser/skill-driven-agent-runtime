import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmStore = path.join(root, 'node_modules', '.pnpm');
const outputDir = path.join(root, 'reports', 'EP-00-repo-bootstrap');
const checkOnly = process.argv.includes('--check');
const activePackageKeys = parsePackageKeys(
  await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'),
);

const packages = new Map();
for (const storeEntry of await readdir(pnpmStore, { withFileTypes: true })) {
  if (!storeEntry.isDirectory() || storeEntry.name === 'node_modules') continue;
  const modulesDir = path.join(pnpmStore, storeEntry.name, 'node_modules');
  let entries;
  try {
    entries = await readdir(modulesDir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(modulesDir, entry.name);
      for (const scoped of await readdir(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory()) await collectPackage(path.join(scopeDir, scoped.name));
      }
    } else {
      await collectPackage(path.join(modulesDir, entry.name));
    }
  }
}

async function collectPackage(packageDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return;
  const key = `${manifest.name}@${manifest.version}`;
  if (!activePackageKeys.has(key)) return;
  if (packages.has(key)) return;
  const license = normalizeLicense(manifest.license);
  const files = await readdir(packageDir);
  const licenseFiles = files.filter((file) => /^(licen[cs]e|copying|notice)/iu.test(file)).sort();
  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    license,
    licenseFiles: licenseFiles.map((file) => path.relative(root, path.join(packageDir, file))),
    repository: normalizeRepository(manifest.repository),
  });
}

function normalizeLicense(value) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value !== null && typeof value === 'object' && typeof value.type === 'string') {
    return value.type;
  }
  return 'UNKNOWN';
}

function normalizeRepository(value) {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && typeof value.url === 'string') {
    return value.url;
  }
  return undefined;
}

function parsePackageKeys(lockfile) {
  const packagesStart = lockfile.indexOf('\npackages:\n');
  const snapshotsStart = lockfile.indexOf('\nsnapshots:\n');
  if (packagesStart < 0 || snapshotsStart <= packagesStart) {
    throw new Error('PNPM_LOCK_PACKAGES_MISSING');
  }

  const keys = new Set();
  for (const line of lockfile.slice(packagesStart, snapshotsStart).split(/\r?\n/u)) {
    const match = /^ {2}(\S.*):$/u.exec(line);
    if (match === null) continue;
    let key = match[1];
    if (key.startsWith("'") && key.endsWith("'")) {
      key = key.slice(1, -1).replaceAll("''", "'");
    }
    keys.add(key.replace(/\(.+$/u, ''));
  }
  if (keys.size === 0) throw new Error('PNPM_LOCK_PACKAGES_EMPTY');
  return keys;
}

const packageList = [...packages.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);
const unknown = packageList.filter((item) => item.license === 'UNKNOWN');

const components = packageList.map((item) => ({
  type: 'library',
  'bom-ref': `pkg:npm/${encodePurlName(item.name)}@${item.version}`,
  name: item.name,
  version: item.version,
  licenses: [{ license: { id: item.license } }],
  ...(item.repository === undefined
    ? {}
    : { externalReferences: [{ type: 'vcs', url: item.repository }] }),
  purl: `pkg:npm/${encodePurlName(item.name)}@${item.version}`,
}));
components.push(
  {
    type: 'container',
    'bom-ref': 'pkg:docker/pgvector/pgvector@0.8.4-pg17-bookworm',
    name: 'pgvector/pgvector',
    version: '0.8.4-pg17-bookworm',
    hashes: [
      {
        alg: 'SHA-256',
        content: 'da864cc9983d6a346c39c55c8c5250d752a9b573bbac06b1c3ad5d72f20f5be6',
      },
    ],
    licenses: [{ license: { name: 'PostgreSQL License' } }],
  },
  {
    type: 'container',
    'bom-ref': 'pkg:docker/redis@8.2.7-alpine3.22',
    name: 'redis',
    version: '8.2.7-alpine3.22',
    hashes: [
      {
        alg: 'SHA-256',
        content: 'e762b8716f68d0de494b9fecc5a598db03e24206d3266725dd5521ca2c8b18a3',
      },
    ],
    licenses: [{ license: { id: 'AGPL-3.0-only' } }],
  },
);

const sbom = `${JSON.stringify(
  {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: 'urn:uuid:019f5072-d2fb-7c01-b6bd-2779678541e1',
    version: 1,
    metadata: {
      timestamp: '2026-07-11T09:42:00.000Z',
      component: {
        type: 'application',
        name: 'skill-driven-agent-runtime',
        version: '0.0.0',
      },
    },
    components,
  },
  null,
  2,
)}\n`;

const licenseJson = `${JSON.stringify(
  {
    schema_version: 1,
    generated_at: '2026-07-11T17:42:00+08:00',
    package_count: packageList.length,
    unknown_license_count: unknown.length,
    packages: packageList,
    external_services: [
      { name: 'pgvector/pgvector', version: '0.8.4-pg17-bookworm', license: 'PostgreSQL' },
      { name: 'redis', version: '8.2.7-alpine3.22', license: 'AGPL-3.0-only' },
    ],
  },
  null,
  2,
)}\n`;

const notices = `# Third-Party Notices

Generated from the exact pnpm lockfile installation for the EP-00 baseline. This file is not legal advice. Package license texts remain available at the recorded installed paths and must be bundled or reproduced as required for a release artifact.

## External services

- pgvector/pgvector 0.8.4-pg17-bookworm — PostgreSQL License; unmodified standalone container.
- Redis 8.2.7-alpine3.22 — AGPL-3.0-only option selected; unmodified standalone container. Redis trademark rules remain applicable.

## npm packages (${String(packageList.length)})

| Package | License | Packaged license/notice files |
| --- | --- | --- |
${packageList
  .map(
    (item) =>
      `| \`${item.name}@${item.version}\` | ${item.license} | ${item.licenseFiles.length === 0 ? 'not found' : item.licenseFiles.map((file) => `\`${file}\``).join(', ')} |`,
  )
  .join('\n')}
`;

if (unknown.length > 0) {
  throw new Error(
    `LICENSE_UNKNOWN: ${unknown.map((item) => `${item.name}@${item.version}`).join(', ')}`,
  );
}

await emit('sbom.cdx.json', sbom);
await emit('license-report.json', licenseJson);
await emit(path.join('..', '..', 'THIRD_PARTY_NOTICES.md'), notices);
process.stdout.write(
  `${checkOnly ? 'Verified' : 'Generated'} SBOM and licenses for ${String(packageList.length)} npm packages and 2 external services.\n`,
);

async function emit(relativePath, content) {
  const target = path.resolve(outputDir, relativePath);
  if (checkOnly) {
    const current = await readFile(target, 'utf8');
    if (current !== content) throw new Error(`GENERATED_EVIDENCE_STALE: ${relativePath}`);
    return;
  }
  await writeFile(target, content, 'utf8');
}

function encodePurlName(name) {
  return name.startsWith('@') ? name.replace('/', '%2F') : name;
}
