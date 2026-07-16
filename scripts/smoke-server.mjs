import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { get, request } from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], 120_000);
startInfrastructure();
const server = spawn(process.execPath, ['dist/apps/server/src/main.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    SDAR_MASTER_KEY_BASE64: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  },
});
try {
  const management = await waitForJson('http://127.0.0.1:9998/api/v1/health');
  if (management.authentication !== 'none' || management.deployment !== 'trusted-intranet-only') {
    throw new Error('SERVER_SMOKE_MANAGEMENT_WARNING_MISSING');
  }
  const consoleHtml = await requestBody('http://127.0.0.1:9998/console/');
  const consoleScript = consoleHtml.match(/src="(\/console\/assets\/[^"]+\.js)"/u)?.[1];
  if (consoleScript === undefined) throw new Error('SERVER_SMOKE_CONSOLE_SCRIPT_PATH_INVALID');
  const consoleBundle = await requestBody(`http://127.0.0.1:9998${consoleScript}`);
  if (!consoleBundle.includes('trusted-intranet-only-no-auth')) {
    throw new Error('SERVER_SMOKE_CONSOLE_BUNDLE_INVALID');
  }
  const skillId = `skill.server-smoke.${String(Date.now())}`;
  const registrationStatus = await postJson('http://127.0.0.1:9998/api/v1/skills', {
    skillId,
    name: 'Server smoke',
    summary: 'Verifies dynamic Agent Card projection.',
    description: 'A local-only Skill created by the server smoke test.',
    capabilities: ['smoke'],
    workflowGuidance: 'Return a local smoke result.',
    outputInstruction: 'Return the result.',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: { type: 'object', additionalProperties: false },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
  });
  if (registrationStatus !== 201) throw new Error('SERVER_SMOKE_SKILL_REGISTRATION_FAILED');
  const card = await waitForJson('http://127.0.0.1:9999/.well-known/agent-card.json');
  if (!Array.isArray(card.skills) || !card.skills.some((skill) => skill.id === skillId)) {
    throw new Error('SERVER_SMOKE_AGENT_CARD_SKILLS_MISSING');
  }
  process.stdout.write(
    'Server build smoke passed: Agent Card, Console bundle, and trusted-intranet management API are reachable.\n',
  );
} finally {
  server.kill();
  stopInfrastructure();
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

function postJson(url, value) {
  return new Promise((resolvePromise, reject) => {
    const body = JSON.stringify(value);
    const outgoing = request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolvePromise(response.statusCode));
      },
    );
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}
