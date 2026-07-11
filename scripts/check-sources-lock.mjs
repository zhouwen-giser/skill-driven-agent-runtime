import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const sourceLock = await readFile(new URL('../third_party/sources.lock.yaml', import.meta.url), 'utf8');
const unpinned = sourceLock.match(/\bUNPINNED\b/g) ?? [];

if (unpinned.length > 0) {
  throw new Error(`OSS_SOURCE_UNPINNED: ${String(unpinned.length)} unresolved source pins`);
}

const pinCount = sourceLock.match(/^\s+pin:\s+/gm)?.length ?? 0;
const sourceCount = sourceLock.match(/^\s+- name:\s+/gm)?.length ?? 0;
if (sourceCount < 10 || pinCount !== sourceCount) {
  throw new Error(
    `OSS_SOURCE_COUNT_INVALID: ${String(sourceCount)} sources and ${String(pinCount)} pins`,
  );
}

process.stdout.write(`Verified ${String(pinCount)} OSS source pins; no UNPINNED entries.\n`);
