import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const root = process.cwd();
const patterns = [
  ['github-token', /(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{36,})/gu],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ['openai-api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/gu],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
];
const tracked = capture('git', ['ls-files', '-z'])
  .split('\0')
  .filter((value) => value.length > 0);
const generated = await generatedFiles();
const currentFindings = [];
let scannedBytes = 0;

for (const relativePath of [...new Set([...tracked, ...generated])].sort()) {
  const absolutePath = resolve(root, relativePath);
  let metadata;
  try {
    metadata = await stat(absolutePath);
  } catch {
    continue;
  }
  if (!metadata.isFile() || metadata.size > 5_000_000) continue;
  const content = await readFile(absolutePath);
  if (content.includes(0)) continue;
  scannedBytes += content.byteLength;
  const text = content.toString('utf8');
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) currentFindings.push({ scope: 'current-tree', kind, relativePath });
  }
}

const remoteResult = spawnSync('git', ['remote', 'get-url', '--all', 'origin'], {
  cwd: root,
  encoding: 'utf8',
});
if (remoteResult.status !== 0) throw new Error('P13_SECRET_SCAN_REMOTE_READ_FAILED');
let credentializedRemoteCount = 0;
for (const value of remoteResult.stdout.split(/\r?\n/u).filter(Boolean)) {
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '') credentializedRemoteCount += 1;
  } catch {
    if (/https?:\/\/[^/\s]+@/iu.test(value)) credentializedRemoteCount += 1;
  }
}

const history = await scanHistory();
const findings = [
  ...currentFindings,
  ...(credentializedRemoteCount === 0
    ? []
    : [{ scope: 'git-remote', kind: 'credentialized-url', count: credentializedRemoteCount }]),
  ...history.findings,
];
const report = {
  schemaVersion: '1.0',
  packageId: 'SDAR-V1.3-P13',
  status: findings.length === 0 ? 'passed' : 'failed',
  classification: 'real high-confidence repository, generated-artifact and Git-history scan',
  scanned: {
    currentFiles: [...new Set([...tracked, ...generated])].length,
    currentBytes: scannedBytes,
    historyBytes: history.scannedBytes,
    patterns: patterns.map(([kind]) => kind),
    remoteUrls: 'inspected without persisting credential material',
  },
  redaction: 'Matching secret values are never written to stdout or the report.',
  findings,
  relatedEvidence: [
    'packages/crypto-adapter/test/aes-gcm-secret-cipher.unit.test.ts',
    'packages/persistence-postgres/test/repositories.integration.test.ts',
    'packages/application/test/artifact-management-p12.unit.test.ts',
  ],
};
const reportDirectory = resolve(root, 'reports', 'goal');
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  resolve(reportDirectory, 'v1.3-final-secret-scan-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (findings.length > 0) {
  process.stderr.write(
    `P13 secret scan failed with ${String(findings.length)} redacted high-confidence finding(s).\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `P13 secret scan passed across ${String(report.scanned.currentFiles)} current files and Git history; findings=0.\n`,
  );
}

async function scanHistory() {
  const child = spawn(
    'git',
    ['log', '--all', '-p', '--no-ext-diff', '--no-textconv', '--format=commit:%H'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let carry = '';
  let scannedHistoryBytes = 0;
  const kinds = new Set();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    scannedHistoryBytes += Buffer.byteLength(chunk);
    const value = carry + chunk;
    for (const [kind, pattern] of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(value)) kinds.add(kind);
    }
    carry = value.slice(-512);
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const status = await new Promise((resolveStatus, reject) => {
    child.once('error', reject);
    child.once('close', resolveStatus);
  });
  if (status !== 0) throw new Error(`P13_SECRET_SCAN_HISTORY_FAILED:${stderr.trim()}`);
  return {
    scannedBytes: scannedHistoryBytes,
    findings: [...kinds].map((kind) => ({ scope: 'git-history', kind })),
  };
}

async function generatedFiles() {
  const roots = ['dist', 'apps/console/dist', 'reports'];
  const files = [];
  for (const relativeRoot of roots) {
    const absoluteRoot = resolve(root, relativeRoot);
    try {
      files.push(...(await walk(absoluteRoot, relativeRoot)));
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

async function walk(directory, relativeDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = `${relativeDirectory}/${entry.name}`.replaceAll('\\', '/');
    if (entry.isDirectory())
      files.push(...(await walk(resolve(directory, entry.name), childRelative)));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`P13_SECRET_SCAN_CAPTURE_FAILED:${command}`);
  return result.stdout;
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}
