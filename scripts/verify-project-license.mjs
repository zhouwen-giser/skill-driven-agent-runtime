import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const [license, notice, readme, rootPackageText, consolePackageText] = await Promise.all([
  readFile(new URL('LICENSE', root), 'utf8'),
  readFile(new URL('NOTICE', root), 'utf8'),
  readFile(new URL('README.md', root), 'utf8'),
  readFile(new URL('package.json', root), 'utf8'),
  readFile(new URL('apps/console/package.json', root), 'utf8'),
]);

for (const fragment of [
  'Apache License',
  'Version 2.0, January 2004',
  '3. Grant of Patent License.',
  'END OF TERMS AND CONDITIONS',
  'APPENDIX: How to apply the Apache License to your work.',
]) {
  if (!license.includes(fragment)) throw new Error(`PROJECT_LICENSE_TEXT_MISSING: ${fragment}`);
}
if (license.length < 10_000) throw new Error('PROJECT_LICENSE_TEXT_TRUNCATED');

for (const [name, text] of [
  ['root', rootPackageText],
  ['console', consolePackageText],
]) {
  const manifest = JSON.parse(text);
  if (manifest.license !== 'Apache-2.0') {
    throw new Error(`PROJECT_LICENSE_METADATA_MISMATCH: ${name}`);
  }
}

if (JSON.parse(rootPackageText).author !== 'zhouwen') {
  throw new Error('PROJECT_LICENSE_AUTHOR_MISMATCH');
}

for (const fragment of [
  'Skill-Driven Agent Runtime',
  'Copyright 2026 zhouwen',
  'THIRD_PARTY_NOTICES.md',
]) {
  if (!notice.includes(fragment)) throw new Error(`PROJECT_NOTICE_MISSING: ${fragment}`);
}

for (const fragment of [
  '[Apache License 2.0](LICENSE)',
  '[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)',
]) {
  if (!readme.includes(fragment)) throw new Error(`PROJECT_LICENSE_README_MISSING: ${fragment}`);
}

process.stdout.write('Project Apache-2.0 license, NOTICE, metadata, and README verified.\n');
