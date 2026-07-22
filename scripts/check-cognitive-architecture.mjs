import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const v122AuthorityFiles = [
  'packages/application/src/user-goal-planning.ts',
  'packages/application/src/user-goal-plan-controller.ts',
  'packages/application/src/skill-goal-scheduler.ts',
  'packages/application/src/outcome-judges.ts',
  'packages/application/src/progress-recovery.ts',
  'packages/application/src/business-event-impact.ts',
];

for (const file of v122AuthorityFiles) {
  const source = await readFile(file, 'utf8');
  if (
    /from\s+['"][^'"]*cognitive\//u.test(source) ||
    /from\s+['"][^'"]*(planning-knowledge|task-type-induction|capability-pattern|experience-enriched)/u.test(
      source,
    )
  ) {
    throw new Error(`ARCH_V122_COGNITIVE_REVERSE_DEPENDENCY: ${file}`);
  }
}

const cognitiveDomainFiles = await collectFiles('packages/domain/src/cognitive', '.ts');
for (const file of cognitiveDomainFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
    const dependency = match[1];
    if (dependency === undefined) continue;
    if (dependency.startsWith('./') || dependency === '../errors.js') continue;
    throw new Error(`ARCH_COGNITIVE_DOMAIN_IMPORT_FORBIDDEN: ${normalize(file)} -> ${dependency}`);
  }
}

const cognitiveApplicationFiles = await collectFiles('packages/application/src/cognitive', '.ts');
const forbiddenApplicationDependencies = [
  '@a2a-js/sdk',
  '@modelcontextprotocol/',
  '@langchain/langgraph',
  'express',
  'bullmq',
  'redis',
  'pg',
  'ajv',
];
for (const file of cognitiveApplicationFiles) {
  const source = await readFile(file, 'utf8');
  for (const dependency of forbiddenApplicationDependencies) {
    if (source.includes(`'${dependency}`) || source.includes(`"${dependency}`)) {
      throw new Error(
        `ARCH_COGNITIVE_APPLICATION_IMPORT_FORBIDDEN: ${normalize(file)} -> ${dependency}`,
      );
    }
  }
}

const pythonProductFiles = [
  ...(await collectFiles('apps', '.py')),
  ...(await collectFiles('packages', '.py')),
];
if (pythonProductFiles.length > 0) {
  throw new Error(`ARCH_PYTHON_PRODUCT_RUNTIME_FORBIDDEN: ${pythonProductFiles.join(',')}`);
}

process.stdout.write(
  `Cognitive architecture verified: ${String(v122AuthorityFiles.length)} v1.2.2 authorities, ${String(cognitiveDomainFiles.length)} Domain files, ${String(cognitiveApplicationFiles.length)} Application files, no Python product runtime.\n`,
);

async function collectFiles(root, extension) {
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
      else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(path.relative(process.cwd(), fullPath));
      }
    }
  }
}

function normalize(file) {
  return file.replaceAll('\\', '/');
}
