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
    'bom-ref': 'pkg:docker/sdar/postgres-pgvector@17.10-0.8.5-alpine3.23',
    name: 'sdar/postgres-pgvector',
    version: '17.10-0.8.5-alpine3.23',
    hashes: [
      {
        alg: 'SHA-256',
        content: '856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762',
      },
    ],
    licenses: [{ license: { name: 'PostgreSQL License' } }, { license: { id: 'MIT' } }],
    properties: [
      { name: 'sdar:use', value: 'modified_local_standalone_container' },
      {
        name: 'sdar:dockerfile',
        value: 'infra/postgres/Dockerfile.pgvector-hardened',
      },
      {
        name: 'sdar:base',
        value:
          'postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4',
      },
      {
        name: 'sdar:dockerfileFrontend',
        value:
          'docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89',
      },
      { name: 'sdar:buildBase', value: 'pkg:apk/alpine/build-base@0.5-r3' },
      {
        name: 'sdar:pgvector',
        value:
          'v0.8.5@159b79aaad5983fb7459c1e3df2897fbb2d11788#sha256:6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44',
      },
      {
        name: 'sdar:privilegeHelper',
        value: 'pkg:apk/alpine/su-exec@0.3-r0#89c016e6e08749d583efdeda04b9f73e1218e253',
      },
      { name: 'sdar:distribution', value: 'local-build-only' },
    ],
    purl: 'pkg:docker/sdar/postgres-pgvector@17.10-0.8.5-alpine3.23',
  },
  {
    type: 'container',
    'bom-ref': 'pkg:docker/redis@8.8.1-alpine3.23',
    name: 'redis',
    version: '8.8.1-alpine3.23',
    hashes: [
      {
        alg: 'SHA-256',
        content: '8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
      },
    ],
    licenses: [{ license: { id: 'AGPL-3.0-or-later' } }],
    properties: [
      { name: 'sdar:use', value: 'unmodified_external_standalone_container' },
      { name: 'sdar:redisSourceCommit', value: '77b6c308396c9700672390a210143a8496fb4b10' },
    ],
    purl: 'pkg:docker/redis@8.8.1-alpine3.23',
  },
  {
    type: 'application',
    'bom-ref': 'pkg:docker/docker/dockerfile@1.24.0',
    name: 'docker/dockerfile frontend',
    version: '1.24.0',
    scope: 'excluded',
    hashes: [
      {
        alg: 'SHA-256',
        content: '87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89',
      },
    ],
    licenses: [{ license: { id: 'Apache-2.0' } }],
    externalReferences: [{ type: 'vcs', url: 'https://github.com/moby/buildkit' }],
    properties: [
      { name: 'sdar:use', value: 'container_build_tool' },
      { name: 'sdar:runtimeDependency', value: 'false' },
      { name: 'sdar:bundled', value: 'false' },
      {
        name: 'sdar:linuxAmd64Manifest',
        value: 'sha256:e82bbc85c3cb06cf2a5a27b058208b43984448acbcd6a832cd1491933d4376dd',
      },
      {
        name: 'sdar:sourceRevision',
        value: 'dd2170e156c9633da1b2d1a58a6188e3f7d36fa4',
      },
      {
        name: 'sdar:licenseBlob',
        value: '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64',
      },
      { name: 'sdar:rootNotice', value: 'absent' },
    ],
    purl: 'pkg:docker/docker/dockerfile@1.24.0',
  },
  {
    type: 'application',
    'bom-ref': 'pkg:github/aquasecurity/trivy@8a3177aedf7ee0864920eb1852eef031cd3742b8',
    name: 'aquasecurity/trivy',
    version: '0.70.0',
    scope: 'excluded',
    hashes: [
      {
        alg: 'SHA-256',
        content: 'eea5442eab86f9e26cd718d7618d43899e72a83767619e8bee47911bddbfb825',
      },
    ],
    licenses: [{ license: { id: 'Apache-2.0' } }],
    externalReferences: [
      { type: 'vcs', url: 'https://github.com/aquasecurity/trivy' },
      {
        type: 'distribution',
        url: 'https://github.com/aquasecurity/trivy/releases/tag/v0.70.0',
      },
    ],
    properties: [
      { name: 'sdar:use', value: 'temporary_release_evidence_tool' },
      { name: 'sdar:runtimeDependency', value: 'false' },
      { name: 'sdar:committedBinary', value: 'false' },
      {
        name: 'sdar:officialChecksumsSha256',
        value: 'c45281240bb9211ea9e830fc0bf5cf8acf7c0ca830feb64ac8a0aa932c5c92d9',
      },
      { name: 'sdar:supplyChainReview', value: 'GHSA-69fq-xp46-6x23' },
    ],
    purl: 'pkg:github/aquasecurity/trivy@8a3177aedf7ee0864920eb1852eef031cd3742b8',
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
      timestamp: '2026-07-30T13:16:20.000Z',
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
    generated_at: '2026-07-30T21:16:20+08:00',
    package_count: packageList.length,
    unknown_license_count: unknown.length,
    packages: packageList,
    external_services: [
      {
        name: 'sdar/postgres-pgvector',
        version: '17.10-0.8.5-alpine3.23',
        image_id: 'sha256:856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762',
        use: 'modified_local_standalone_container',
        license: 'PostgreSQL License (PostgreSQL and pgvector); MIT (su-exec)',
        base: 'postgres:17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4',
        pgvector:
          'v0.8.5@159b79aaad5983fb7459c1e3df2897fbb2d11788#sha256:6f88a5cbdde31666f4b6c1a6b75c51dcbeffe58f9a7d2b26e502d5a6e5e14d44',
        build_base: '0.5-r3',
        su_exec: '0.3-r0@89c016e6e08749d583efdeda04b9f73e1218e253',
        su_exec_license_sha256: 'a0f3f75e286f08be153fd2b7a91788f0bbcd7d5155a40cdca6952742c293fb14',
      },
      {
        name: 'redis',
        version: '8.8.1-alpine3.23',
        image_digest: 'sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
        use: 'unmodified_external_standalone_container',
        license: 'AGPL-3.0-or-later',
        obligations:
          'redistribution of modified or unmodified image requires AGPL notice and Corresponding Source; modified network service also requires section 13 compliance',
      },
    ],
    build_tools: [
      {
        name: 'docker/dockerfile frontend',
        version: '1.24.0',
        image_digest: 'sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89',
        linux_amd64_manifest:
          'sha256:e82bbc85c3cb06cf2a5a27b058208b43984448acbcd6a832cd1491933d4376dd',
        revision: 'dd2170e156c9633da1b2d1a58a6188e3f7d36fa4',
        license: 'Apache-2.0',
        license_blob: '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64',
        root_notice: 'absent',
        use: 'container_build_tool',
        bundled: false,
        runtime_dependency: false,
      },
    ],
    release_tools: [
      {
        name: 'aquasecurity/trivy',
        version: '0.70.0',
        commit: '8a3177aedf7ee0864920eb1852eef031cd3742b8',
        artifact: 'trivy_0.70.0_windows-64bit.zip',
        sha256: 'eea5442eab86f9e26cd718d7618d43899e72a83767619e8bee47911bddbfb825',
        checksums_sha256: 'c45281240bb9211ea9e830fc0bf5cf8acf7c0ca830feb64ac8a0aa932c5c92d9',
        license: 'Apache-2.0',
        notice_blob: '3fe97bf7d4b08dfdc5c8f3feab223403d651fec9',
        use: 'temporary_release_evidence_tool',
        bundled: false,
        runtime_dependency: false,
        supply_chain_review: 'GHSA-69fq-xp46-6x23',
      },
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

- sdar/postgres-pgvector 17.10-0.8.5-alpine3.23 — modified local standalone container built from digest-pinned PostgreSQL 17.10 Alpine and checksum-pinned pgvector v0.8.5. PostgreSQL and pgvector use the PostgreSQL License; su-exec 0.3-r0 is MIT and its license text is retained in the image. The P13 observed reproducible local image ID is sha256:856ba6c2ed2292bba994e945ebf1bd638d2c1c78c2562bc9c8b57ea6b9138762.
- Redis 8.8.1-alpine3.23 — AGPL-3.0-or-later option selected; unmodified standalone container pinned to sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb. Redis trademark rules remain applicable. Redistribution of either a modified or unmodified image requires the AGPL notice and Corresponding Source; a modified network service must also satisfy section 13.

## Container build tool

- docker/dockerfile frontend 1.24.0 — Apache-2.0, LICENSE blob 261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64 and no root NOTICE; immutable index sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89 (BuildKit revision dd2170e156c9633da1b2d1a58a6188e3f7d36fa4). It is used only to parse the hardened Dockerfile and is neither bundled nor an SDAR runtime/development dependency.

## Release evidence tool

- aquasecurity/trivy v0.70.0 commit 8a3177aedf7ee0864920eb1852eef031cd3742b8 — Apache-2.0 with NOTICE blob 3fe97bf7d4b08dfdc5c8f3feab223403d651fec9. The temporary Windows scanner asset was verified against the official release checksum as sha256:eea5442eab86f9e26cd718d7618d43899e72a83767619e8bee47911bddbfb825 after review of the March 2026 GHSA-69fq-xp46-6x23 supply-chain incident. It is not bundled and is not an SDAR runtime or development dependency.

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
  `${checkOnly ? 'Verified' : 'Generated'} SBOM and licenses for ${String(packageList.length)} npm packages, 2 external services, 1 excluded build tool, and 1 excluded release tool.\n`,
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
