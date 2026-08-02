import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../node-control-api/src/runtime.js';
import { ConfiguredBearerArtifactManagementIdentity } from '../../server/src/artifact-management-identity.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../../server/src/runtime.js';
import {
  CognitiveManagementActionGate,
  ConfiguredOperatorIdentityPort,
  DefaultArtifactGovernanceService,
  hashValidationSummary,
} from '../../../packages/application/src/index.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../../packages/domain/src/index.js';
import { applyControlMigrations } from '../../../packages/node-control-persistence-postgres/src/index.js';
import {
  PostgresArtifactGovernanceStore,
  PostgresArtifactRepository,
  PostgresArtifactValidationRepository,
  PostgresCognitiveManagementActionRepository,
} from '../../../packages/persistence-postgres/src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const redisPort = Number(process.env['SDAR_REDIS_PORT'] ?? '56379');
const apiToken = 'p10-control-api-token-00000000000000000000000';
const runtimeToken = 'p10-runtime-service-token-0000000000000000000';
const previousPromotionFlag = process.env['SDAR_V13_PROMOTION_ENABLED'];
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 2 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 2 });
let runtime: ServerRuntimeHandle | undefined;
let control: NodeControlApiRuntime | undefined;
let skillId: string;
let planArtifactId: string;
let planArtifactKey: string;
let planValidationSummaryHash: string;

beforeAll(async () => {
  process.env['SDAR_V13_PROMOTION_ENABLED'] = 'true';
  await applyControlMigrations(controlPool);
  const controlNode = await controlPool.query<{ node_id: string }>(
    'SELECT node_id FROM sdar_control.node_profile LIMIT 1',
  );
  const controlNodeId = controlNode.rows[0]?.node_id ?? 'node-p10';
  skillId = `skill.p10.vertical.${randomUUID()}`;
  const artifactIdentity = new ConfiguredBearerArtifactManagementIdentity({
    token: runtimeToken,
    actorId: 'p10-node-control-admin',
    kind: 'human',
    roles: ['administrator'],
  });
  runtime = await startServerRuntime({
    postgresUrl: runtimeConnectionString,
    redis: { host: '127.0.0.1', port: redisPort },
    masterKeyBase64: randomBytes(32).toString('base64'),
    applyMigrations: true,
    a2aHost: '127.0.0.1',
    a2aPort: 0,
    managementHost: '127.0.0.1',
    managementPort: 0,
    runtimeControlServiceToken: runtimeToken,
    artifactOperatorIdentity: new ConfiguredOperatorIdentityPort({
      environment: 'production',
      provider: artifactIdentity.externalOperatorIdentityProvider,
    }),
    artifactManagementPrincipalResolver: artifactIdentity.managementPrincipalResolver,
    queueName: `p10-governance-${randomUUID()}`,
  });
  await runtime.registerSkill({
    skillId,
    name: 'P10 Vertical Skill',
    summary: 'Exact governed version.',
    description: 'Proves Node Control delegates Skill governance to Runtime.',
    capabilities: ['governance'],
    workflowGuidance: 'Execute after exact publication.',
    outputInstruction: 'Return governance evidence.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId,
      skillVersion: 1,
      specificationHash: `sha256:${randomBytes(32).toString('hex')}`,
      effects: ['effect.p10.vertical'],
      evidence: ['evidence.p10.vertical'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: {},
    },
  });
  const prepared = await preparePlanTemplate();
  planArtifactId = prepared.artifactId;
  planArtifactKey = prepared.artifactKey;
  planValidationSummaryHash = prepared.validationSummaryHash;
  control = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_RUNTIME_DATABASE_URL: runtimeConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: controlNodeId,
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P10 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: runtime.management.baseUrl,
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: runtime.a2a.baseUrl,
  });
});

afterAll(async () => {
  await control?.close();
  await runtime?.close();
  await Promise.all([runtimePool.end(), controlPool.end()]);
  if (previousPromotionFlag === undefined) delete process.env['SDAR_V13_PROMOTION_ENABLED'];
  else process.env['SDAR_V13_PROMOTION_ENABLED'] = previousPromotionFlag;
});

describe(
  'P10 Node Control -> Runtime -> PostgreSQL Skill governance',
  { concurrent: false },
  () => {
    it('publishes and replays one exact version while keeping SkillVersion content immutable', async () => {
      if (control === undefined) throw new Error('P10_CONTROL_NOT_STARTED');
      const controlBaseUrl = control.baseUrl;
      const idempotencyKey = `p10-publish-${randomUUID()}`;
      const publish = () =>
        fetch(`${controlBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/1/publish`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiToken}`,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            reason: 'Publish the exact validated P10 Skill version.',
            expectedRevision: 0,
          }),
        });

      const first = await publish();
      const firstBody = await first.json();
      expect(first.status, JSON.stringify(firstBody)).toBe(202);
      const replay = await publish();
      expect(replay.status).toBe(202);
      expect(await replay.json()).toEqual(firstBody);
      expect(firstBody).toMatchObject({
        operationType: 'skill.publish',
        status: 'succeeded',
        target: { id: skillId, version: '1' },
      });

      const exact = await fetch(
        `${control.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/1`,
        { headers: { authorization: `Bearer ${apiToken}` } },
      );
      expect(exact.status).toBe(200);
      await expect(exact.json()).resolves.toMatchObject({
        skillId,
        version: '1',
        status: 'published',
      });

      const authority = await runtimePool.query<{
        immutable_status: string;
        lifecycle_status: string;
        lock_version: string;
        current_version: number;
        command_count: number;
      }>(
        `SELECT version.status AS immutable_status,governance.lifecycle_status,
              governance.lock_version::text,skill.current_version,
              (SELECT count(*)::integer FROM runtime_skill_governance_command command
                WHERE command.skill_id=version.skill_id AND command.skill_version=version.version)
                AS command_count
         FROM skill_version version
         JOIN skill ON skill.skill_id=version.skill_id
         JOIN runtime_skill_version_governance governance
           ON governance.skill_id=version.skill_id AND governance.skill_version=version.version
        WHERE version.skill_id=$1 AND version.version=1`,
        [skillId],
      );
      expect(authority.rows).toEqual([
        {
          immutable_status: 'draft',
          lifecycle_status: 'published',
          lock_version: '1',
          current_version: 1,
          command_count: 1,
        },
      ]);
      const controlEvidence = await controlPool.query<{ operations: number; audits: number }>(
        `SELECT
         (SELECT count(*)::integer FROM sdar_control.management_operation
           WHERE target_id=$1 AND operation_type='skill.publish') AS operations,
         (SELECT count(*)::integer FROM sdar_control.control_audit_event
           WHERE aggregate_id=$1 || ':1' AND action='skill.publish') AS audits`,
        [skillId],
      );
      expect(controlEvidence.rows).toEqual([{ operations: 1, audits: 1 }]);
    });

    it('activates a logical Plan Template through the exact P02/P06 Artifact authority', async () => {
      if (control === undefined) throw new Error('P10_CONTROL_NOT_STARTED');
      const controlBaseUrl = control.baseUrl;
      const idempotencyKey = `p10-plan-publish-${randomUUID()}`;
      const publish = () =>
        fetch(
          `${controlBaseUrl}/api/v1/plan-templates/${encodeURIComponent(planArtifactKey)}/versions/1/publish`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${apiToken}`,
              'content-type': 'application/json',
              'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify({
              reason: 'Activate the exact validated and approved P10 Plan Template.',
              expectedRevision: 1,
              payload: {
                expectedLockVersion: 0,
                validationSummaryHash: planValidationSummaryHash,
              },
            }),
          },
        );

      const first = await publish();
      const firstBody = await first.json();
      expect(first.status, JSON.stringify(firstBody)).toBe(202);
      const replay = await publish();
      expect(replay.status).toBe(202);
      expect(await replay.json()).toEqual(firstBody);
      expect(firstBody).toMatchObject({
        operationType: 'plan-template.publish',
        status: 'succeeded',
        target: { id: planArtifactKey, version: '1' },
      });

      const exact = await fetch(
        `${control.baseUrl}/api/v1/plan-templates/${encodeURIComponent(planArtifactKey)}/versions/1`,
        { headers: { authorization: `Bearer ${apiToken}` } },
      );
      expect(exact.status).toBe(200);
      const exactBody = await exact.json();
      expect(exactBody).toMatchObject({
        artifactId: planArtifactKey,
        version: '1',
        status: 'active',
        activePointer: true,
      });
      expect(exactBody).not.toHaveProperty('authorityArtifactId');

      const authority = await runtimePool.query<{
        artifact_id: string;
        artifact_key: string;
        status: string;
        lock_version: number;
        activated_events: number;
      }>(
        `SELECT artifact.artifact_id,artifact.artifact_key,artifact.status,pointer.lock_version,
              (SELECT count(*)::integer FROM cognitive_runtime_outbox outbox
                WHERE outbox.event_type='artifact.activated'
                  AND outbox.aggregate_id=artifact.artifact_id) AS activated_events
           FROM compiled_artifact artifact
           JOIN artifact_active_pointer pointer
             ON pointer.artifact_id=artifact.artifact_id
            AND pointer.artifact_version=artifact.version
          WHERE artifact.artifact_id=$1`,
        [planArtifactId],
      );
      expect(authority.rows).toEqual([
        {
          artifact_id: planArtifactId,
          artifact_key: planArtifactKey,
          status: 'active',
          lock_version: 1,
          activated_events: 1,
        },
      ]);
      const controlEvidence = await controlPool.query<{ operations: number; audits: number }>(
        `SELECT
         (SELECT count(*)::integer FROM sdar_control.management_operation
           WHERE target_id=$1 AND operation_type='plan-template.publish') AS operations,
         (SELECT count(*)::integer FROM sdar_control.control_audit_event
           WHERE aggregate_id=$1 || ':1' AND action='plan-template.publish') AS audits`,
        [planArtifactKey],
      );
      expect(controlEvidence.rows).toEqual([{ operations: 1, audits: 1 }]);
    });
  },
);

interface ArtifactFixture {
  readonly artifacts: readonly CompiledArtifact[];
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding: ArtifactRuntimeBinding;
}

async function preparePlanTemplate(): Promise<
  Readonly<{ artifactId: string; artifactKey: string; validationSummaryHash: string }>
> {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as ArtifactFixture;
  const source = fixture.artifacts.find((artifact) => artifact.artifactType === 'plan_template');
  if (source === undefined) throw new Error('P10_PLAN_TEMPLATE_FIXTURE_MISSING');
  const suffix = randomUUID();
  const artifactId = `artifact.plan.p10.${suffix}`;
  const artifactKey = `plan.p10.${suffix}`;
  const validationRunId = `validation.plan.p10.${suffix}`;
  const { validationSummaryRef: _validationSummaryRef, ...candidateSource } = source;
  void _validationSummaryRef;
  const artifact: CompiledArtifact = Object.freeze({
    ...structuredClone(candidateSource),
    artifactId,
    artifactKey,
    status: 'candidate',
    lineageRef: `lineage.plan.p10.${suffix}`,
    contentHash: `sha256:${randomBytes(32).toString('hex')}`,
    createdAt: '2026-08-02T00:00:00.000Z',
  });
  const lineage: ArtifactLineage = Object.freeze({
    ...structuredClone(fixture.lineage),
    lineageId: artifact.lineageRef,
    artifactId,
    artifactVersion: 1,
    validationRunRefs: Object.freeze([]),
  });
  const runtimeBinding: ArtifactRuntimeBinding = Object.freeze({
    ...structuredClone(fixture.runtimeBinding),
    bindingId: `binding.plan.p10.${suffix}`,
    artifactId,
    artifactVersion: 1,
    compiledAt: artifact.createdAt,
  });
  const repository = new PostgresArtifactRepository(runtimePool);
  const validation = new PostgresArtifactValidationRepository(runtimePool);
  const governance = new DefaultArtifactGovernanceService({
    identity: new ConfiguredOperatorIdentityPort({ environment: 'test' }),
    repository,
    store: new PostgresArtifactGovernanceStore(runtimePool),
    audit: new CognitiveManagementActionGate({
      repository: new PostgresCognitiveManagementActionRepository(runtimePool),
      clock: { now: () => '2026-08-02T00:01:00.000Z' },
    }),
  });
  await repository.saveCandidate({ artifact, lineage, runtimeBinding });
  await governance.requestValidation({
    validationRunId,
    artifactId,
    version: 1,
    context: {
      operatorId: 'p10-plan-validator',
      permissions: ['artifact.validate'],
    },
    expectedVersion: 1,
    idempotencyKey: `validate-plan-p10-${suffix}`,
    reason: 'Validate the real P10 Plan Template candidate.',
    occurredAt: '2026-08-02T00:01:00.000Z',
    validationType: 'static',
    datasetRef: `dataset.plan.p10.${suffix}`,
  });
  await validation.appendResult({
    validationRunId,
    status: 'passed',
    result: 'P10 Plan Template validation passed.',
    metrics: Object.freeze({}),
    counterexampleRefs: Object.freeze([]),
    completedAt: '2026-08-02T00:02:00.000Z',
  });
  const summary = await validation.findPromotionSummary({ artifactId, version: 1 });
  if (summary === undefined) throw new Error('P10_PLAN_TEMPLATE_VALIDATION_MISSING');
  const validationSummaryHash = hashValidationSummary(summary);
  await governance.recordApproval({
    artifactId,
    version: 1,
    context: {
      operatorId: 'p10-plan-approver',
      permissions: ['artifact.approve'],
    },
    expectedVersion: 1,
    idempotencyKey: `approve-plan-p10-${suffix}`,
    reason: 'Approve the real P10 Plan Template candidate.',
    occurredAt: '2026-08-02T00:03:00.000Z',
    approvalId: `approval.plan.p10.${suffix}`,
    decision: 'approved',
    validationSummaryHash,
  });
  return Object.freeze({ artifactId, artifactKey, validationSummaryHash });
}
