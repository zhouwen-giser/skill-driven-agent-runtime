import { spawn, spawnSync } from 'node:child_process';
import { get } from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], 120_000);
run(
  'docker',
  ['compose', '-f', 'compose.yaml', 'up', '-d', '--wait', 'postgres', 'redis'],
  180_000,
);
const server = spawn(process.execPath, ['dist/apps/server/src/main.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    SDAR_MCP_MASTER_KEY_BASE64: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  },
});
try {
  const card = await waitForJson('http://127.0.0.1:9999/.well-known/agent-card.json');
  if (!Array.isArray(card.skills) || card.skills.length === 0) {
    throw new Error('SERVER_SMOKE_AGENT_CARD_SKILLS_MISSING');
  }
  process.stdout.write('Server build smoke passed: Agent Card is reachable with enabled skills.\n');
} finally {
  server.kill();
  run('docker', ['compose', '-f', 'compose.yaml', 'stop', 'postgres', 'redis'], 60_000, true);
}

function run(command, args, timeout, ignoreFailure = false) {
  const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit', timeout });
  if (result.error !== undefined && !ignoreFailure) throw result.error;
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(`SERVER_SMOKE_COMMAND_FAILED: ${command} ${args.join(' ')}`);
  }
}

async function waitForJson(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const body = await requestBody(url);
      return JSON.parse(body);
    } catch {
      await setTimeout(250);
    }
  }
  throw new Error('SERVER_SMOKE_NOT_READY');
}

function requestBody(url) {
  return new Promise((resolvePromise, reject) => {
    const request = get(url, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) reject(new Error(`HTTP_${String(response.statusCode)}`));
        else resolvePromise(body);
      });
    });
    request.once('error', reject);
  });
}
