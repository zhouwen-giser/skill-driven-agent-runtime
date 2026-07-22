import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const forbiddenRuntimeDependencies = [
  '@google/adk',
  '@mastra/',
  '@microsoft/agents',
  '@openai/agents',
  '@voltagent/',
  'beeai-framework',
  'dify',
  'openhands',
];

const forbiddenDomainImports = [
  '@a2a-js/sdk',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/client',
  '@langchain/langgraph',
  'express',
  'bullmq',
  'redis',
  'drizzle-orm',
  'pg',
  'react',
  'ajv',
];
const forbiddenApplicationImports = [
  '@a2a-js/sdk',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/client',
  '@langchain/langgraph',
  'express',
  'bullmq',
  'redis',
  'drizzle-orm',
  'pg',
  'ajv',
];

await assertImports('packages/domain', forbiddenDomainImports);
await assertImports('packages/application', forbiddenApplicationImports);
await assertSingleWorkflowRuntime();
await assertRemovedCompatibilitySymbols();
await import('./check-cognitive-architecture.mjs');

const sourceFiles = [
  ...(await collectSourceFiles('packages')),
  ...(await collectSourceFiles('apps/server')),
];
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  if (/\beval\s*\(|\bnew\s+Function\s*\(/u.test(source)) {
    throw new Error(`ARCH_DYNAMIC_CODE_FORBIDDEN: ${file}`);
  }
  if (
    source.includes('@langchain/langgraph') &&
    !normalize(file).startsWith('packages/langgraph-runtime/')
  ) {
    throw new Error(`ARCH_LANGGRAPH_BOUNDARY_VIOLATION: ${file}`);
  }
  if (source.includes('@a2a-js/sdk') && !normalize(file).startsWith('packages/a2a-adapter/')) {
    throw new Error(`ARCH_A2A_BOUNDARY_VIOLATION: ${file}`);
  }
  if (
    (source.includes('@modelcontextprotocol/sdk') ||
      source.includes('@modelcontextprotocol/client')) &&
    !normalize(file).startsWith('packages/mcp-adapter/')
  ) {
    throw new Error(`ARCH_MCP_BOUNDARY_VIOLATION: ${file}`);
  }
  if (
    (source.includes("from 'pg'") || source.includes('from "pg"')) &&
    !normalize(file).startsWith('packages/persistence-postgres/') &&
    !normalize(file).startsWith('apps/server/')
  ) {
    throw new Error(`ARCH_POSTGRES_BOUNDARY_VIOLATION: ${file}`);
  }
  if (
    (source.includes("from 'bullmq'") || source.includes('from "bullmq"')) &&
    !normalize(file).startsWith('packages/runtime-redis/')
  ) {
    throw new Error(`ARCH_BULLMQ_BOUNDARY_VIOLATION: ${file}`);
  }
  if (
    source.includes("from 'ajv") &&
    !normalize(file).startsWith('packages/json-schema-adapter/')
  ) {
    throw new Error(`ARCH_AJV_BOUNDARY_VIOLATION: ${file}`);
  }
}

process.stdout.write(
  `Architecture boundaries verified across ${String(sourceFiles.length)} TypeScript source files.\n`,
);

async function assertImports(root, forbidden) {
  for (const file of await collectSourceFiles(root)) {
    const source = await readFile(file, 'utf8');
    for (const dependency of forbidden) {
      if (source.includes(`'${dependency}`) || source.includes(`"${dependency}`)) {
        throw new Error(`ARCH_FORBIDDEN_IMPORT: ${normalize(file)} -> ${dependency}`);
      }
    }
  }
}

async function assertSingleWorkflowRuntime() {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  if (dependencies['@langchain/langgraph'] === undefined) {
    throw new Error('ARCH_LANGGRAPH_RUNTIME_REQUIRED');
  }
  for (const dependency of Object.keys(dependencies)) {
    if (
      forbiddenRuntimeDependencies.some(
        (forbidden) => dependency === forbidden || dependency.startsWith(forbidden),
      )
    ) {
      throw new Error(`ARCH_SECOND_RUNTIME_FORBIDDEN: ${dependency}`);
    }
  }
}

async function assertRemovedCompatibilitySymbols() {
  const prefix = ['leg', 'acy'].join('');
  const forbidden = [
    `${prefix}_v11`,
    `${prefix}_guidance`,
    `${prefix[0].toUpperCase()}${prefix.slice(1)}V11`,
    'McpTransportRouter',
  ];
  const files = [
    ...(await collectSourceFiles('apps')),
    ...(await collectSourceFiles('packages')),
    ...(await collectFiles('schemas', (name) => name.endsWith('.json') || name.endsWith('.yaml'))),
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const symbol of forbidden)
      if (source.includes(symbol))
        throw new Error(`ARCH_REMOVED_COMPATIBILITY_SYMBOL: ${normalize(file)} -> ${symbol}`);
  }
}

async function collectFiles(root, include) {
  const result = [];
  await visit(path.resolve(root));
  return result;

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
      else if (entry.isFile() && include(entry.name))
        result.push(path.relative(process.cwd(), fullPath));
    }
  }
}

async function collectSourceFiles(root) {
  const result = [];
  await visit(path.resolve(root));
  return result;

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
      else if (entry.isFile() && entry.name.endsWith('.ts'))
        result.push(path.relative(process.cwd(), fullPath));
    }
  }
}

function normalize(file) {
  return file.replaceAll('\\', '/');
}
