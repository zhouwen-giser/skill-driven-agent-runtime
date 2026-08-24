#!/usr/bin/env node

import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { Pool } from 'pg';

import {
  sha256CanonicalJson,
  writeCanonicalFirstPassIndex,
  writeCanonicalJsonFirstWriter,
  writeImmutableAttemptJson,
} from './evidence-files.mjs';
import { initializeState } from './initialize-state.mjs';
import { validateDotEnv } from './validate-profile.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATE_ROOT = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}`;
const REPORT_ROOT = resolve(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation');
const DATABASE_URL = 'postgresql://sdar_uap@127.0.0.1:55462/sdar_uap';
export const EXPECTED_MODEL_STAGES = Object.freeze([
  'intent',
  'goal',
  'goal_planning',
  'tool_enhancement',
  'skill_authoring',
  'skill_selection',
  'skill_input_resolution',
  'workflow_planning',
  'execution_decision',
  'goal_evaluation',
  'evaluation',
  'result_processing',
  'task_understanding',
  'task_clarification',
  'goal_contract_generation',
  'interactive_plan_patch',
  'experience_observation',
  'experience_reflection',
  'task_type_induction',
  'capability_pattern_induction',
  'knowledge_promotion_assessment',
]);

export async function auditModelInvocations(mode, options = {}) {
  if (!['baseline', 'final'].includes(mode)) throw new Error('UAP_MODEL_AUDIT_MODE_INVALID');
  const stateRoot = resolve(options.stateRoot ?? STATE_ROOT);
  const reportRoot = resolve(options.reportRoot ?? REPORT_ROOT);
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const state = await initializeState(stateRoot);
  const dotEnv = await validateDotEnv(options.dotEnvPath);
  const authority = await modelAuthority(options.queryAuthority);
  const projection = validateModelAuthority(authority, dotEnv.values);
  const count = authority.invocationCount;
  const baselinePath = resolve(stateRoot, 'model-invocation-baseline.json');
  let baseline;
  if (mode === 'baseline') {
    baseline = Object.freeze({
      schemaVersion: 'sdar.ugv-agent-profile.model-invocation-baseline/v1',
      task: 'UAP-P3-B01',
      bootstrapRunId: state.bootstrapRunId,
      observedAt: new Date().toISOString(),
      invocationCount: 0,
      configurationFingerprintSha256: projection.configurationFingerprintSha256,
      providerCount: 2,
      routeCount: EXPECTED_MODEL_STAGES.length * 2,
    });
    try {
      await writeCanonicalJsonFirstWriter(baselinePath, baseline);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'UAP_CANONICAL_EVIDENCE_DRIFT')
        throw error;
      baseline = await readBaseline(baselinePath, state.bootstrapRunId);
    }
  } else {
    baseline = await readBaseline(baselinePath, state.bootstrapRunId);
  }
  if (baseline.configurationFingerprintSha256 !== projection.configurationFingerprintSha256)
    throw new Error('UAP_MODEL_AUTHORITY_DRIFT');
  const report = Object.freeze({
    schemaVersion: `sdar.ugv-agent-profile.model-invocation-${mode}/v1`,
    status: 'passed',
    task: 'UAP-P3-B01',
    generatedAt: new Date().toISOString(),
    command:
      mode === 'baseline'
        ? 'deploy/ugv-agent-profile-simulation/up-sdar.sh'
        : 'deploy/ugv-agent-profile-simulation/verify.sh',
    exitCode: 0,
    bootstrapRunId: state.bootstrapRunId,
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    auditPhase: mode,
    baselineInvocationCount: baseline.invocationCount,
    observedInvocationCount: count,
    configurationLoadedFromDotEnv: true,
    generationProviderExact: true,
    embeddingProviderExact: true,
    modelProviderCount: projection.providerCount,
    stageModelRouteCount: projection.routeCount,
    modelConfigurationFingerprintSha256: projection.configurationFingerprintSha256,
    noExternalModelInvocation: true,
    navigationCallCount: 0,
    simulationSideEffectsEnabled: false,
    secretsIncluded: false,
    endpointsIncluded: false,
    modelConfigurationIncluded: false,
  });
  const attempt = await writeImmutableAttemptJson(
    resolve(reportRoot, 'attempts'),
    `model-invocation-${mode}-${state.bootstrapRunId}`,
    report,
  );
  await writeCanonicalFirstPassIndex(
    resolve(reportRoot, `model-invocation-${mode}.redacted.json`),
    {
      schemaVersion: `sdar.ugv-agent-profile.model-invocation-${mode}-index/v1`,
      status: 'passed',
      task: report.task,
      bootstrapRunId: report.bootstrapRunId,
      evidenceClass: report.evidenceClass,
      canonicalSemantics: 'immutable_first_pass',
      firstPassAttemptFile: attempt.slice(repositoryRoot.length + 1),
      firstPassAttemptSha256: sha256CanonicalJson(report),
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      modelConfigurationIncluded: false,
    },
    repositoryRoot,
  );
  return report;
}

async function modelAuthority(queryAuthority) {
  if (queryAuthority !== undefined) return queryAuthority();
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const [invocations, providers, routes] = await Promise.all([
      pool.query('SELECT count(*)::integer AS count FROM model_invocation'),
      pool.query(
        `SELECT provider_id AS "providerId",name,kind,api_style AS "apiStyle",
                base_url AS "baseUrl",model,enabled,timeout_ms AS "timeoutMs",
                length(encrypted_credential) > 0 AS "credentialPresent"
         FROM model_provider ORDER BY provider_id`,
      ),
      pool.query(
        `SELECT stage,operation,provider_id AS "providerId"
         FROM stage_model_route ORDER BY stage,operation`,
      ),
    ]);
    return Object.freeze({
      invocationCount: invocations.rows[0]?.count,
      providers: Object.freeze(providers.rows),
      routes: Object.freeze(routes.rows),
    });
  } finally {
    await pool.end();
  }
}

export function validateModelAuthority(authority, dotEnvValues) {
  if (!Number.isSafeInteger(authority?.invocationCount) || authority.invocationCount < 0)
    throw new Error('UAP_MODEL_AUDIT_INVALID');
  if (authority.invocationCount !== 0) throw new Error('UAP_MODEL_INVOCATION_OBSERVED');
  if (!Array.isArray(authority?.providers) || authority.providers.length !== 2)
    throw new Error('UAP_MODEL_PROVIDER_AUTHORITY_INVALID');
  const timeoutMs = Number(dotEnvValues.SDAR_UGV_MODEL_TIMEOUT_MS);
  const expectedProviders = [
    {
      providerId: dotEnvValues.SDAR_UGV_MODEL_PROVIDER_ID,
      name: dotEnvValues.SDAR_UGV_MODEL_PROVIDER_ID,
      kind: 'openai_compatible',
      apiStyle: 'openai_chat_completions',
      baseUrl: dotEnvValues.SDAR_UGV_MODEL_BASE_URL,
      model: dotEnvValues.SDAR_UGV_MODEL_NAME,
      enabled: true,
      timeoutMs,
      credentialPresent: true,
    },
    {
      providerId: dotEnvValues.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID,
      name: dotEnvValues.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID,
      kind: 'openai_compatible',
      apiStyle: 'openai_chat_completions',
      baseUrl: dotEnvValues.SDAR_UGV_MODEL_EMBEDDING_BASE_URL,
      model: dotEnvValues.SDAR_UGV_MODEL_EMBEDDING_NAME,
      enabled: true,
      timeoutMs,
      credentialPresent: true,
    },
  ].sort((left, right) => left.providerId.localeCompare(right.providerId));
  const providers = [...authority.providers].sort((left, right) =>
    String(left?.providerId).localeCompare(String(right?.providerId)),
  );
  if (
    providers.some((provider, index) => canonical(provider) !== canonical(expectedProviders[index]))
  )
    throw new Error('UAP_MODEL_PROVIDER_AUTHORITY_INVALID');
  if (
    !Array.isArray(authority.routes) ||
    authority.routes.length !== EXPECTED_MODEL_STAGES.length * 2
  )
    throw new Error('UAP_MODEL_ROUTE_AUTHORITY_INVALID');
  const expectedRoutes = EXPECTED_MODEL_STAGES.flatMap((stage) => [
    {
      stage,
      operation: 'structured_generation',
      providerId: dotEnvValues.SDAR_UGV_MODEL_PROVIDER_ID,
    },
    {
      stage,
      operation: 'embedding',
      providerId: dotEnvValues.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID,
    },
  ]).sort(routeOrder);
  const routes = [...authority.routes].sort(routeOrder);
  if (routes.some((route, index) => canonical(route) !== canonical(expectedRoutes[index])))
    throw new Error('UAP_MODEL_ROUTE_AUTHORITY_INVALID');
  return Object.freeze({
    providerCount: providers.length,
    routeCount: routes.length,
    configurationFingerprintSha256: sha256CanonicalJson({
      providers: providers.map((provider) => ({
        providerId: provider.providerId,
        name: provider.name,
        kind: provider.kind,
        apiStyle: provider.apiStyle,
        baseUrl: provider.baseUrl,
        model: provider.model,
        enabled: provider.enabled,
        timeoutMs: provider.timeoutMs,
      })),
      routes,
    }),
  });
}

function routeOrder(left, right) {
  return `${String(left?.stage)}\0${String(left?.operation)}`.localeCompare(
    `${String(right?.stage)}\0${String(right?.operation)}`,
  );
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

async function readBaseline(path, bootstrapRunId) {
  const status = await lstat(path);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && status.uid !== process.getuid()) ||
    status.size > 65_536
  )
    throw new Error('UAP_MODEL_AUDIT_BASELINE_INVALID');
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('UAP_MODEL_AUDIT_BASELINE_INVALID');
  }
  if (
    value?.schemaVersion !== 'sdar.ugv-agent-profile.model-invocation-baseline/v1' ||
    value?.task !== 'UAP-P3-B01' ||
    value?.bootstrapRunId !== bootstrapRunId ||
    value?.invocationCount !== 0 ||
    !/^[a-f0-9]{64}$/u.test(value?.configurationFingerprintSha256) ||
    value?.providerCount !== 2 ||
    value?.routeCount !== EXPECTED_MODEL_STAGES.length * 2 ||
    typeof value?.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    Object.keys(value).sort().join(',') !==
      [
        'bootstrapRunId',
        'configurationFingerprintSha256',
        'invocationCount',
        'observedAt',
        'providerCount',
        'routeCount',
        'schemaVersion',
        'task',
      ]
        .sort()
        .join(',')
  )
    throw new Error('UAP_MODEL_AUDIT_BASELINE_INVALID');
  return value;
}

async function main() {
  if (process.argv.length !== 3) throw new Error('UAP_ARGUMENT_INVALID');
  const report = await auditModelInvocations(process.argv[2]);
  process.stdout.write(
    `${JSON.stringify({ status: report.status, auditPhase: report.auditPhase, invocationCount: 0, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error && /^UAP_/u.test(error.message) ? error.message : 'UAP_MODEL_AUDIT_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
