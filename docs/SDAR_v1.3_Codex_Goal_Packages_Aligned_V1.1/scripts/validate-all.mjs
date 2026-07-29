import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.join(root, 'packages');
const p04rMode = process.argv.includes('--p04r');
const formalPackages = [
  'P00',
  'P01',
  'P02',
  'P03',
  'P04',
  'P05',
  'P06',
  'P07',
  'P08',
  'P09',
  'P10',
  'P11',
  'P12',
  'P13',
];
const frozenPackages = new Set(['P00', 'P01', 'P02']);
// P06 consumes the V1.2 overlay as locked by its manifest. Its own contracts
// remain in the immutable V1.1 base registry; the overlay changes the P03–P05
// inputs on which its evidence chain depends.
const v12Packages = new Set(['P03', 'P04', 'P05', 'P06']);
const selfChecksInP04rMode = new Set(['P03', 'P04', 'P04R', 'P05']);

const baseRegistry = readJson(
  path.join(root, 'shared/SDAR_v1.3_Frozen_Interface_Registry_V1.1.json'),
);
const deltaRegistry = readJson(
  path.join(root, 'shared/SDAR_v1.3_Frozen_Interface_Registry_V1.2.json'),
);
const matrix = readJson(path.join(root, 'shared/SDAR_v1.3_Package_Execution_Matrix_V1.1.json'));
const mergedContracts = {
  ...baseRegistry.contracts,
  ...deltaRegistry.contracts,
};
const report = {
  ok: true,
  mode: p04rMode ? 'p04r' : 'full',
  counts: deltaRegistry.counts,
  packages: [],
  errors: [],
};

verifyRegistryHash(baseRegistry, 'V1.1');
verifyRegistryHash(deltaRegistry, 'V1.2');
verifyBundleShape();

const produced = new Map();
for (const packageId of formalPackages) {
  const directory = findPackageDirectory(packageId);
  if (!directory) continue;
  const manifest = readJson(path.join(directory, 'manifest.json'));
  const lock = readJson(path.join(directory, 'CONTRACT-LOCK.json'));
  const expectedRegistry = v12Packages.has(packageId) ? deltaRegistry : baseRegistry;
  const lockRegistryHash = lock.registrySha256;

  if (
    manifest.contractRegistrySha256 !== expectedRegistry.registrySha256 ||
    lockRegistryHash !== expectedRegistry.registrySha256
  ) {
    report.errors.push(`${packageId} registry hash`);
  }
  if (
    manifest.sequence !== Number(packageId.slice(1)) ||
    manifest.formalPackage !== true ||
    manifest.totalFormalPackages !== 14
  ) {
    report.errors.push(`${packageId} sequence`);
  }

  for (const name of manifest.consumesContracts) {
    if (!(name in mergedContracts)) {
      report.errors.push(`${packageId} unknown consume ${name}`);
      continue;
    }
    const owner = mergedContracts[name].owner;
    if (owner !== 'shared' && owner !== 'P00' && !produced.has(name)) {
      report.errors.push(`${packageId} consumes before produced ${name}`);
    }
  }
  for (const name of manifest.producesContracts) {
    if (!(name in mergedContracts)) {
      report.errors.push(`${packageId} unknown produce ${name}`);
    }
    if (produced.has(name)) {
      report.errors.push(`${packageId} duplicate owner ${name}`);
    }
    produced.set(name, packageId);
  }

  const selfCheck = runSelfCheck(packageId, directory);
  report.packages.push({
    package: packageId,
    goals: manifest.atomicGoals,
    consumes: manifest.consumesContracts,
    produces: manifest.producesContracts,
    registryVersion: manifest.contractRegistryVersion,
    selfCheck,
    frozenReadOnly: p04rMode && frozenPackages.has(packageId),
  });
}

validateP04rPackage();
validateMatrix();
validateGoals();

report.ok = report.errors.length === 0;
fs.writeFileSync(
  path.join(root, 'audit/cross-package-validation.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function verifyRegistryHash(registry, label) {
  const expected = registry.registrySha256;
  const hashInput = { ...registry };
  delete hashInput.registrySha256;
  const actual = crypto
    .createHash('sha256')
    .update(JSON.stringify(sortValue(hashInput), null, 2))
    .digest('hex');
  if (actual !== expected) {
    report.errors.push(`${label} registry canonical hash`);
  }
}

function verifyBundleShape() {
  if (
    JSON.stringify(deltaRegistry.formalPackages) !== JSON.stringify(formalPackages) ||
    JSON.stringify(deltaRegistry.mandatoryRemediationPackages) !== JSON.stringify(['P04R']) ||
    JSON.stringify(deltaRegistry.optionalPostReleasePackages) !== JSON.stringify(['P14'])
  ) {
    report.errors.push('package class membership');
  }
  if (
    deltaRegistry.counts.formalProductPackages !== 14 ||
    deltaRegistry.counts.mandatoryRemediationPackages !== 1 ||
    deltaRegistry.counts.optionalPostReleasePackages !== 1
  ) {
    report.errors.push('package counts');
  }
  if (
    deltaRegistry.sequencePatch.after !== 'P04' ||
    deltaRegistry.sequencePatch.package !== 'P04R' ||
    deltaRegistry.sequencePatch.before !== 'P05' ||
    deltaRegistry.sequencePatch.newAtomicGoal !== false
  ) {
    report.errors.push('P04R sequence patch');
  }
}

function findPackageDirectory(packageId) {
  const matches = fs.readdirSync(packagesRoot).filter((entry) => {
    const manifestPath = path.join(packagesRoot, entry, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return false;
    return readJson(manifestPath).packageId === `SDAR-V1.3-${packageId}`;
  });
  if (matches.length !== 1) {
    report.errors.push(`${packageId} directory count`);
    return undefined;
  }
  return path.join(packagesRoot, matches[0]);
}

function runSelfCheck(packageId, directory) {
  if (p04rMode && !selfChecksInP04rMode.has(packageId)) {
    return 'not_run_read_only';
  }
  const run = spawnSync('node', [path.join(directory, 'scripts/self-check.mjs')], {
    cwd: directory,
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    report.errors.push(`${packageId} selfcheck: ${run.stderr || run.stdout}`);
    return false;
  }
  return true;
}

function validateP04rPackage() {
  const directory = findPackageDirectory('P04R');
  if (!directory) return;
  const manifest = readJson(path.join(directory, 'manifest.json'));
  const lock = readJson(path.join(directory, 'CONTRACT-LOCK.json'));
  if (
    manifest.formalPackage !== false ||
    manifest.packageClass !== 'mandatory_remediation' ||
    manifest.newAtomicGoal !== false ||
    manifest.sortOrder !== 4.5 ||
    manifest.nextPackage !== 'P05'
  ) {
    report.errors.push('P04R manifest');
  }
  if (
    lock.targetContractRegistryVersion !== '1.2' ||
    lock.targetContractRegistrySha256 !== deltaRegistry.registrySha256
  ) {
    report.errors.push('P04R registry lock');
  }
  const selfCheck = runSelfCheck('P04R', directory);
  report.packages.push({
    package: 'P04R',
    goals: [],
    remediatesGoals: manifest.remediatesGoals,
    registryVersion: lock.targetContractRegistryVersion,
    selfCheck,
    frozenReadOnly: false,
  });
}

function validateMatrix() {
  const p04 = matrix.find((entry) => entry.package === 'P04');
  const p04r = matrix.find((entry) => entry.package === 'P04R');
  const p05 = matrix.find((entry) => entry.package === 'P05');
  if (
    p04?.next !== 'P04R' ||
    p04r?.formal !== false ||
    p04r?.mandatoryRemediation !== true ||
    p04r?.goals.length !== 0 ||
    p04r?.next !== 'P05' ||
    !p05?.dependsOn.includes('P04R') ||
    p05?.requiredStatus.P04R !== 'COMPLETED'
  ) {
    report.errors.push('execution matrix P04R alignment');
  }
}

function validateGoals() {
  const goals = report.packages
    .filter(({ package: packageId }) => packageId !== 'P04R')
    .flatMap(({ goals }) => goals);
  const expectedGoals = Array.from(
    { length: 23 },
    (_, index) => `G${String(index).padStart(2, '0')}`,
  );
  if (JSON.stringify(goals) !== JSON.stringify(expectedGoals)) {
    report.errors.push(`goal coverage ${JSON.stringify(goals)}`);
  }
  if (goals.includes('G23')) {
    report.errors.push('G23 must not exist');
  }
}
