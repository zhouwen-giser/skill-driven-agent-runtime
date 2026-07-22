import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmStore = path.join(root, 'node_modules', '.pnpm');
const outputDir = path.join(root, 'reports', 'EP-00-repo-bootstrap');
const checkOnly = process.argv.includes('--check');
const projectManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
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
  // Optional native leaf packages vary by the host used for a frozen install. The
  // portable source-distribution SBOM records their cross-platform wrapper package
  // instead, whose license and dependency declaration cover the selected binary.
  // This keeps the checked-in evidence identical on Linux, macOS, and Windows.
  if (Array.isArray(manifest.os) || Array.isArray(manifest.cpu)) return;
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
    licenseFiles: licenseFiles.map((file) => `${key}/${file}`),
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
const v123DesignReferences = [
  {
    name: 'google-gemini/gemini-cli',
    commit: 'c776c665b00a39d55c470beb788a2b9a77a2feb7',
    license: 'Apache-2.0',
    licenseFile: 'LICENSE',
    licenseBlob: '7a4a3ea2424c09fbe48d455aed1eaa94d9124835',
    notice: 'absent',
  },
  {
    name: 'ECNU-ICALK/AutoSkill',
    commit: '94c47ca488d4ba4117d20272e66d49b9877e68cf',
    license: 'UNCONFIRMED',
    licenseFile: 'absent',
    licenseBlob: 'absent',
    notice: 'absent',
  },
  {
    name: 'langchain-ai/langmem',
    commit: 'a2d580946465137c89162e67dc0b18108bd4850c',
    license: 'MIT',
    licenseFile: 'LICENSE',
    licenseBlob: 'c38f6f284dc464af69e9f618bc0304d299d0bdf0',
    notice: 'absent',
  },
  {
    name: 'agentscope-ai/ReMe',
    commit: '46adb5ae1e94715ecdffe201a46933fbd419a5e1',
    license: 'Apache-2.0',
    licenseFile: 'LICENSE',
    licenseBlob: '65c2c5cf06d722c79d8105cfce97016491a7a7f4',
    notice: 'absent',
  },
  {
    name: 'zorazrw/agent-workflow-memory',
    commit: '8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1',
    license: 'Apache-2.0',
    licenseFile: 'LICENSE',
    licenseBlob: '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64',
    notice: 'absent',
  },
  {
    name: 'ace-agent/ace',
    commit: 'bcb7cea0504afad6f55fec4845dd4864c9f9eee7',
    license: 'Apache-2.0',
    licenseFile: 'LICENSE.txt',
    licenseBlob: '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64',
    notice: 'absent',
  },
];

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
    type: 'library',
    'bom-ref':
      'pkg:github/modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288',
    name: 'modelcontextprotocol/modelcontextprotocol frozen schema',
    version: '26897cc322f356487da89113451bd16b520b9288',
    hashes: [
      {
        alg: 'SHA-256',
        content: '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708',
      },
    ],
    licenses: [
      {
        license: {
          name: 'Apache-2.0 transition / retained MIT contributions / CC-BY-4.0 non-spec docs',
        },
      },
    ],
    externalReferences: [
      { type: 'vcs', url: 'https://github.com/modelcontextprotocol/modelcontextprotocol' },
    ],
    purl: 'pkg:github/modelcontextprotocol/modelcontextprotocol@26897cc322f356487da89113451bd16b520b9288',
  },
  {
    type: 'library',
    'bom-ref': 'pkg:github/modelcontextprotocol/ext-tasks@8966bea9c4f4e6d71060cc8284a539086e9e234f',
    name: 'modelcontextprotocol/ext-tasks',
    version: '8966bea9c4f4e6d71060cc8284a539086e9e234f',
    hashes: [
      {
        alg: 'SHA-256',
        content: '72d9dae54a96d7b2c9acd13338d3407b7413d5d04076bf82ef0724007742df75',
      },
    ],
    licenses: [{ license: { id: 'Apache-2.0' } }],
    externalReferences: [{ type: 'vcs', url: 'https://github.com/modelcontextprotocol/ext-tasks' }],
    purl: 'pkg:github/modelcontextprotocol/ext-tasks@8966bea9c4f4e6d71060cc8284a539086e9e234f',
  },
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
components.push(
  ...v123DesignReferences.map((source) => ({
    type: 'library',
    'bom-ref': `pkg:github/${source.name}@${source.commit}`,
    name: source.name,
    version: source.commit,
    scope: 'excluded',
    licenses: [{ license: { name: source.license } }],
    externalReferences: [{ type: 'vcs', url: `https://github.com/${source.name}` }],
    properties: [
      { name: 'sdar:use', value: 'design_reference' },
      { name: 'sdar:licenseFile', value: source.licenseFile },
      { name: 'sdar:licenseBlob', value: source.licenseBlob },
      { name: 'sdar:notice', value: source.notice },
    ],
    purl: `pkg:github/${source.name}@${source.commit}`,
  })),
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
        version: projectManifest.version,
        licenses: [{ license: { id: 'Apache-2.0' } }],
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
    adapted_sources: [
      {
        name: 'modelcontextprotocol/modelcontextprotocol frozen schema',
        commit: '26897cc322f356487da89113451bd16b520b9288',
        schema_blob: 'cc44564e33305dbc07e820cdd0a97648f3852019',
        sha256: '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708',
        license: 'Apache-2.0 transition / retained MIT contributions / CC-BY-4.0 non-spec docs',
        modified_by: 'source unmodified; SDAR-derived schemas by zhouwen',
        local_file: 'protocol/source/mcp-2026-07-28.schema.json',
      },
      {
        name: 'modelcontextprotocol/ext-tasks',
        commit: '8966bea9c4f4e6d71060cc8284a539086e9e234f',
        schema_blob: '2634c47c2b25ac8fafe7fadaa7dd3f3b732c0abc',
        license: 'Apache-2.0',
        modified_by: 'zhouwen',
        local_file: 'packages/mcp-adapter/src/mcp-tasks-contract.ts',
      },
      ...v123DesignReferences.map((source) => ({
        name: source.name,
        commit: source.commit,
        license: source.license,
        license_file: source.licenseFile,
        license_blob: source.licenseBlob,
        notice: source.notice,
        use: 'design_reference',
        copied_code: false,
      })),
    ],
  },
  null,
  2,
)}\n`;

const notices = `# Third-Party Notices

Generated from the exact pnpm lockfile installation and pinned adapted sources. Host-specific optional native leaf packages are represented by their portable wrapper packages so this source-distribution evidence is reproducible across operating systems. This file is not legal advice. Package license texts remain available at the recorded package-relative locators and must be bundled or reproduced as required for a release artifact.

## Adapted protocol source

- modelcontextprotocol/ext-tasks commit 8966bea9c4f4e6d71060cc8284a539086e9e234f, schema.ts blob 2634c47c2b25ac8fafe7fadaa7dd3f3b732c0abc — Apache-2.0. The bounded client Schema in packages/mcp-adapter/src/mcp-tasks-contract.ts was modified by zhouwen and carries its source/modification notice. No upstream runtime implementation is vendored.
- modelcontextprotocol/modelcontextprotocol commit 26897cc322f356487da89113451bd16b520b9288, \`schema/draft/schema.json\` blob cc44564e33305dbc07e820cdd0a97648f3852019 — exact LICENSE records an Apache-2.0 transition, retained MIT contributions and CC-BY-4.0 non-specification documentation; no root NOTICE is present. The source Schema is vendored unmodified under \`protocol/source\`; SDAR-derived schemas are separate modified works under \`protocol/schemas\`.

## SDAR v1.2.3 design references

These exact commits are excluded design/algorithm references, not packaged runtime components. G00 copies no source code. A new intake is required before any later direct port.

${v123DesignReferences
  .map(
    (source) =>
      `- ${source.name} commit ${source.commit} — ${source.license}; ${source.licenseFile} blob ${source.licenseBlob}; root NOTICE ${source.notice}.`,
  )
  .join('\n')}

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
