import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const compilerFiles = await collectFiles('packages/domain/src/compiler');
const schemaFiles = await collectFiles('packages/schemas/src');
const productFiles = await collectFiles('packages');

const forbiddenArtifactDependencies = [
  '@a2a-js/sdk',
  '@modelcontextprotocol/',
  '@langchain/',
  'express',
  'bullmq',
  'redis',
  'drizzle-orm',
  'pg',
  'react',
  'ajv',
  'zod',
];

for (const file of compilerFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
    const dependency = match[1];
    if (dependency !== undefined && !dependency.startsWith('./') && dependency !== '../errors.js') {
      throw new Error(`ARCH_ARTIFACT_DOMAIN_IMPORT_FORBIDDEN: ${normalize(file)} -> ${dependency}`);
    }
  }
  for (const dependency of forbiddenArtifactDependencies) {
    if (source.includes(`'${dependency}`) || source.includes(`"${dependency}`)) {
      throw new Error(`ARCH_ARTIFACT_RUNTIME_DEPENDENCY_FORBIDDEN: ${normalize(file)}`);
    }
  }
  if (
    /\b(executeSkill|invokeSkill|callMcp|invokeMcp|executeProvider|compileLangGraph|setGoalTerminal)\b/u.test(
      source,
    )
  ) {
    throw new Error(`ARCH_ARTIFACT_DIRECT_EXECUTION_FORBIDDEN: ${normalize(file)}`);
  }
}

for (const file of schemaFiles) {
  const source = await readFile(file, 'utf8');
  for (const dependency of forbiddenArtifactDependencies.filter((item) => item !== 'zod')) {
    if (source.includes(`'${dependency}`) || source.includes(`"${dependency}`)) {
      throw new Error(`ARCH_ARTIFACT_SCHEMA_DEPENDENCY_FORBIDDEN: ${normalize(file)}`);
    }
  }
}

for (const file of productFiles) {
  const normalized = normalize(file);
  if (
    normalized.startsWith('packages/domain/src/compiler/') ||
    normalized === 'packages/domain/src/index.ts' ||
    normalized.startsWith('packages/schemas/src/') ||
    normalized.startsWith('packages/application/src/compiler/') ||
    normalized === 'packages/application/src/index.ts' ||
    normalized.startsWith('packages/application/test/experience-') ||
    normalized === 'packages/application/test/process-miner.unit.test.ts' ||
    normalized.startsWith('packages/persistence-postgres/src/compiler/') ||
    normalized === 'packages/persistence-postgres/src/index.ts' ||
    normalized === 'packages/persistence-postgres/test/experience-p03.contract.test.ts' ||
    normalized.startsWith('packages/runtime-redis/src/compiler/') ||
    normalized === 'packages/runtime-redis/src/index.ts' ||
    normalized === 'packages/domain/test/experience-compilation.unit.test.ts'
  ) {
    continue;
  }
  const source = await readFile(file, 'utf8');
  if (/from\s+['"][^'"]*(?:domain\/src\/compiler|\/compiler\/|compiler\/index)/u.test(source)) {
    throw new Error(`ARCH_ARTIFACT_PREMATURE_PRODUCT_CONSUMER: ${normalized}`);
  }
}

process.stdout.write(
  `Artifact architecture verified: ${String(compilerFiles.length)} Domain files, ${String(schemaFiles.length)} schema files, P02-P03 compiler/PostgreSQL/wake-only boundaries, no online runtime product consumer dependency.\n`,
);

async function collectFiles(root) {
  const files = [];
  await visit(path.resolve(root));
  return files;

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(path.relative(process.cwd(), fullPath));
      }
    }
  }
}

function normalize(file) {
  return file.replaceAll('\\', '/');
}
