import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseEnv } from 'node:util';

/** Load dotenv as data, never shell source. Existing process values take precedence. */
export function loadEnvironmentFile(
  path = process.env['SDAR_ENV_FILE'] ?? '.env',
  target: NodeJS.ProcessEnv = process.env,
): void {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    if (path === '.env' && error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw new Error('SDAR_ENV_FILE_UNREADABLE', { cause: error });
  }
  for (const [name, value] of Object.entries(parseEnv(content))) {
    target[name] ??= value;
  }
}
