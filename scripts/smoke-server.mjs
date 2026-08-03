import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { get, request } from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { URL } from 'node:url';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const packageManagerExecPath = process.env['npm_execpath'];
if (packageManagerExecPath === undefined) throw new Error('NPM_EXECPATH_REQUIRED');
run(process.execPath, [packageManagerExecPath, 'build'], 180_000);
startInfrastructure();
const { Pool } = pg;
const postgresUrl =
  process.env.SDAR_POSTGRES_URL ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const reuseDatabase = process.env.SDAR_SMOKE_REUSE_DATABASE === 'true';
const temporaryDatabase = `sdar_server_smoke_${String(process.pid)}_${String(Date.now())}`;
const smokePostgresUrl = reuseDatabase ? postgresUrl : withDatabase(postgresUrl, temporaryDatabase);
const admin = reuseDatabase
  ? undefined
  : new Pool({ connectionString: withDatabase(postgresUrl, 'postgres') });
const artifactManagementToken = 'p13-artifact-management-smoke-token';
let server;
try {
  if (admin !== undefined)
    await admin.query(`CREATE DATABASE ${quotedIdentifier(temporaryDatabase)}`);
  server = spawn(process.execPath, ['dist/apps/server/src/main.js'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      SDAR_POSTGRES_URL: smokePostgresUrl,
      SDAR_MASTER_KEY_BASE64: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: artifactManagementToken,
      SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'p13-smoke-viewer',
      SDAR_ARTIFACT_MANAGEMENT_KIND: 'human',
      SDAR_ARTIFACT_MANAGEMENT_ROLES: 'viewer',
    },
  });
  const management = await waitForJson('http://127.0.0.1:9998/api/v1/health');
  if (management.authentication !== 'none' || management.deployment !== 'trusted-intranet-only') {
    throw new Error('SERVER_SMOKE_MANAGEMENT_WARNING_MISSING');
  }
  const artifactListUrl = 'http://127.0.0.1:9998/api/v1/artifacts';
  if ((await getStatus(artifactListUrl)) !== 401) {
    throw new Error('SERVER_SMOKE_ARTIFACT_AUTHENTICATION_NOT_ENFORCED');
  }
  if (
    (await getStatus(artifactListUrl, {
      authorization: `Bearer ${artifactManagementToken}`,
      'x-request-id': 'p13-standard-main-smoke',
    })) !== 200
  ) {
    throw new Error('SERVER_SMOKE_ARTIFACT_AUTHENTICATED_QUERY_FAILED');
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
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId,
      skillVersion: 1,
      specificationHash: `sha256:${'7'.repeat(64)}`,
      effects: ['effect.server_smoke_completed'],
      evidence: ['evidence.server_smoke_result'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: { classification: 'read_only' },
    },
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Return the deterministic local smoke result.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: {
          summary: 'Run the local server smoke path.',
          instructions: ['Return the deterministic local smoke result.'],
        },
      },
      taskBindings: [],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    },
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
    'Server build smoke passed: Agent Card, Console bundle, trusted-intranet management API, and configured Artifact bearer identity are reachable.\n',
  );
} finally {
  server?.kill();
  if (admin !== undefined) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [
      temporaryDatabase,
    ]);
    await admin
      .query(`DROP DATABASE IF EXISTS ${quotedIdentifier(temporaryDatabase)}`)
      .finally(() => admin.end());
  }
  stopInfrastructure();
}

function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function quotedIdentifier(value) {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error('SERVER_SMOKE_DATABASE_NAME_INVALID');
  return `"${value}"`;
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

function getStatus(url, headers = {}) {
  return new Promise((resolvePromise, reject) => {
    const outgoing = get(url, { headers }, (response) => {
      response.resume();
      response.on('end', () => resolvePromise(response.statusCode));
    });
    outgoing.once('error', reject);
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
