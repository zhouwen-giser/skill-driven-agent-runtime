import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const source = resolve(root, 'docs', 'SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0_FROZEN.md');
const target = resolve(root, 'docs', 'protocol', 'SDAR_MCP_TASKS_UNIFIED_PROTOCOL_V1_0_FROZEN.md');
const bytes = await readFile(source);
const digest = createHash('sha256').update(bytes).digest('hex');

await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
await writeFile(`${source}.sha256`, `${digest}  ${source.split(/[\\/]/).at(-1)}\n`);
await writeFile(`${target}.sha256`, `${digest}  ${target.split(/[\\/]/).at(-1)}\n`);

process.stdout.write(`${digest}\n`);
