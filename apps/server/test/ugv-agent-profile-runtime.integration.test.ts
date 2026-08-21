import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { RegisterSkillVersionInput } from '../../../packages/application/src/index.js';
import type { SkillVersion } from '../../../packages/domain/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../test-support/postgres.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';
import {
  UGV_AGENT_PROFILE_ID,
  ugvAgentProfileTaskUnderstandingConfiguration,
} from '../src/ugv-agent-profile.js';
import { loadExactUgvProfileSkill } from './ugv-agent-profile-test-fixture.js';

const postgresAdminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseName = 'sdar_uap_p2_b01_integration';
const postgresUrl = isolatedDatabaseUrl(postgresAdminUrl, databaseName);
const packageRoot = 'skills/embodied.move_to';
const capabilityAuthorityLoad = vi.fn(() =>
  Promise.reject(new Error('PROVIDER_AUTHORITY_MUST_NOT_BE_READ_BY_CARD_PIPELINE')),
);
const providerBindingAuthorityLoad = vi.fn(() =>
  Promise.reject(new Error('PROVIDER_BINDING_MUST_NOT_BE_READ_BY_CARD_PIPELINE')),
);
let runtime: ServerRuntimeHandle;
let pool: Pool;
let databaseCreated = false;
let runtimeStarted = false;
let poolStarted = false;

beforeAll(async () => {
  await createIsolatedRuntimeDatabase(postgresAdminUrl, databaseName, { template: 'template0' });
  databaseCreated = true;
  runtime = await startServerRuntime({
    postgresUrl,
    redis: {
      host: '127.0.0.1',
      port: Number(process.env['SDAR_REDIS_PORT'] ?? '56379'),
    },
    masterKeyBase64: randomBytes(32).toString('base64'),
    evidenceEnvironment: 'integration',
    queueName: `uap-p2-b01-${randomUUID()}`,
    applyMigrations: true,
    a2aPort: 0,
    managementPort: 0,
    capabilityAuthorityReader: { load: capabilityAuthorityLoad },
    currentMcpProviderBindingAuthorityReader: {
      loadCurrentMcpProviderBinding: providerBindingAuthorityLoad,
    },
    governedControlPrincipalResolver: {
      resolve: ({ requestId, sourceIp }) =>
        Promise.resolve({
          actorId: 'uap-p2-simulation-operator',
          kind: 'human',
          authenticationMethod: 'integration-fixture',
          permissions: new Set(['physical_control.confirm' as const]),
          requestId,
          ...(sourceIp === undefined ? {} : { sourceIp }),
        }),
    },
    frozenMcpTasks: {
      isolationAcknowledged: true,
      queueName: `uap-p2-b01-remote-${randomUUID()}`,
    },
    taskUnderstanding: ugvAgentProfileTaskUnderstandingConfiguration(),
  });
  runtimeStarted = true;
  pool = new Pool({ connectionString: postgresUrl });
  poolStarted = true;
});

afterAll(async () => {
  if (runtimeStarted) await runtime.close();
  if (poolStarted) await pool.end();
  if (databaseCreated) await dropIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
});

describe('UGV Agent Profile real Runtime and PostgreSQL composition', () => {
  it('serves only exact enabled move_to@1, stays Provider-independent, and fails closed across a stale rebuild', async () => {
    const exact = await loadExactUgvProfileSkill();
    const legacy = await runtime.registerSkill(legacyNavigateInput(exact));
    expect(legacy).toMatchObject({ skillId: 'ugv.navigate', version: 1, status: 'enabled' });

    const imported = await postJson(`${runtime.management.baseUrl}/api/v1/skill-packages/import`, {
      packageRoot,
    });
    expect(imported.response.status).toBe(201);
    expect(imported.body).toMatchObject({
      skillId: 'embodied.move_to',
      version: 1,
      status: 'enabled',
    });

    const audit = await pool.query<{
      skill_id: string;
      skill_version: number;
      package_checksum: string;
      package_root: string;
    }>(
      `SELECT skill_id,skill_version,package_checksum,package_root
         FROM skill_package_import_audit
        WHERE skill_id='embodied.move_to' AND skill_version=1`,
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        skill_id: 'embodied.move_to',
        skill_version: 1,
        package_root: resolve(packageRoot),
        package_checksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);

    const firstCard = await readCapabilityCard();
    expect(firstCard).toMatchObject({
      agentName: UGV_AGENT_PROFILE_ID,
      generationPolicyVersion: 'capability-policy-v1:ugv-agent-profile-v1',
      publicSkills: [{ id: 'embodied.move_to' }],
      sourceSkillRefs: ['embodied.move_to:1'],
    });
    expect(JSON.stringify(firstCard)).not.toContain('ugv.navigate');
    const firstA2aCard = await readA2aCard();
    expect(firstA2aCard.name).toBe(UGV_AGENT_PROFILE_ID);
    expect(firstA2aCard.skills.map((skill) => skill.id)).toEqual(['embodied.move_to']);

    const rebuilt = await postJson(
      `${runtime.management.baseUrl}/api/v1/capabilities/card/rebuild`,
      {
        expectedVersion: firstCard.revision,
        idempotencyKey: 'uap-p2-card-same-catalog',
        actorId: 'uap-p2-integration',
        reason: 'Verify deterministic same-catalog Card rebuild without Provider authority.',
      },
    );
    expect(rebuilt.response.status).toBe(200);
    expect(CardSchema.parse(rebuilt.body)).toMatchObject({
      catalogHash: firstCard.catalogHash,
      cardContentHash: firstCard.cardContentHash,
      sourceSkillRefs: ['embodied.move_to:1'],
    });
    expect(capabilityAuthorityLoad).not.toHaveBeenCalled();
    expect(providerBindingAuthorityLoad).not.toHaveBeenCalled();

    await installSummaryWriteFailure(pool);
    try {
      const disabled = await fetch(
        `${runtime.management.baseUrl}/api/v1/skills/embodied.move_to/disable`,
        { method: 'POST' },
      );
      expect(disabled.status).toBe(200);
      await expect(disabled.json()).resolves.toMatchObject({
        skillId: 'embodied.move_to',
        version: 2,
        previousVersion: 1,
        status: 'disabled',
      });

      await expect(
        pool.query(
          `SELECT skill.current_version,version.status
             FROM skill
             JOIN skill_version version
               ON version.skill_id=skill.skill_id AND version.version=skill.current_version
            WHERE skill.skill_id='embodied.move_to'`,
        ),
      ).resolves.toMatchObject({ rows: [{ current_version: 2, status: 'disabled' }] });
      await expect(
        pool.query(
          `SELECT published_at
             FROM cognitive_runtime_outbox
            WHERE event_id='skill.catalog_changed:embodied.move_to:2'`,
        ),
      ).resolves.toMatchObject({ rows: [{ published_at: null }] });

      const staleManagementCard = await fetch(
        `${runtime.management.baseUrl}/api/v1/capabilities/card`,
      );
      expect(staleManagementCard.status).toBe(400);
      await expect(staleManagementCard.json()).resolves.toMatchObject({
        error: { code: 'CAPABILITY_CARD_NOT_AVAILABLE' },
      });
      const staleA2aCard = await fetch(`${runtime.a2a.baseUrl}/.well-known/agent-card.json`);
      expect(staleA2aCard.status).toBe(500);
      await expect(staleA2aCard.json()).resolves.toEqual({
        error: 'Failed to retrieve agent card',
      });
      expect(capabilityAuthorityLoad).not.toHaveBeenCalled();
      expect(providerBindingAuthorityLoad).not.toHaveBeenCalled();
    } finally {
      await removeSummaryWriteFailure(pool);
    }

    const recoveredCard = await eventuallyReadCapabilityCard();
    expect(recoveredCard).toMatchObject({
      publicSkills: [],
      sourceSkillRefs: [],
      generationPolicyVersion: 'capability-policy-v1:ugv-agent-profile-v1',
    });
    expect(recoveredCard.catalogHash).not.toBe(firstCard.catalogHash);
    const recoveredA2aCard = await eventuallyReadA2aCard();
    expect(recoveredA2aCard.name).toBe(UGV_AGENT_PROFILE_ID);
    expect(recoveredA2aCard.skills).toEqual([]);
    await expect(
      pool.query(
        `SELECT published_at IS NOT NULL AS published
           FROM cognitive_runtime_outbox
          WHERE event_id='skill.catalog_changed:embodied.move_to:2'`,
      ),
    ).resolves.toMatchObject({ rows: [{ published: true }] });

    const exactVersions = await getJson(
      `${runtime.management.baseUrl}/api/v1/skills/embodied.move_to/versions`,
    );
    expect(VersionsSchema.parse(exactVersions)).toMatchObject({
      items: [
        { skillId: 'embodied.move_to', version: 1, status: 'enabled' },
        { skillId: 'embodied.move_to', version: 2, status: 'disabled' },
      ],
    });
    const legacyVersions = await getJson(
      `${runtime.management.baseUrl}/api/v1/skills/ugv.navigate/versions`,
    );
    expect(VersionsSchema.parse(legacyVersions)).toMatchObject({
      items: [{ skillId: 'ugv.navigate', version: 1, status: 'enabled' }],
    });
    expect(capabilityAuthorityLoad).not.toHaveBeenCalled();
    expect(providerBindingAuthorityLoad).not.toHaveBeenCalled();
  });
});

const CardSchema = z
  .object({
    revision: z.number().int().positive(),
    agentName: z.string(),
    catalogHash: z.string(),
    generationPolicyVersion: z.string(),
    publicSkills: z.array(z.object({ id: z.string() }).loose()),
    sourceSkillRefs: z.array(z.string()),
    cardContentHash: z.string(),
  })
  .loose();

const A2aCardSchema = z
  .object({
    name: z.string(),
    skills: z.array(z.object({ id: z.string() }).loose()),
  })
  .loose();

const VersionsSchema = z.object({
  items: z.array(
    z
      .object({
        skillId: z.string(),
        version: z.number().int().positive(),
        status: z.enum(['enabled', 'disabled']),
      })
      .loose(),
  ),
});

function legacyNavigateInput(skill: SkillVersion): RegisterSkillVersionInput {
  return {
    skillId: 'ugv.navigate',
    name: 'Historical UGV Navigate',
    summary: 'Historical public UGV navigation Skill retained outside this Profile.',
    description:
      'Historical public UGV navigation Skill retained for compatibility but not exposed by the UGV Agent Profile.',
    capabilities: skill.capabilities,
    workflowGuidance: skill.workflowGuidance,
    outputInstruction: skill.outputInstruction,
    inputSchema: skill.inputSchema,
    outputSchema: skill.outputSchema,
    toolPolicy: skill.toolPolicy,
    runtimePolicy: skill.runtimePolicy,
    status: skill.status,
    sourceKind: skill.sourceKind,
    validationPassed: skill.validationPassed,
    ...(skill.usageSpecification === undefined
      ? {}
      : { usageSpecification: skill.usageSpecification }),
    ...(skill.outcomeSpecification === undefined
      ? {}
      : { outcomeSpecification: skill.outcomeSpecification }),
  };
}

async function readCapabilityCard(): Promise<z.infer<typeof CardSchema>> {
  const response = await fetch(`${runtime.management.baseUrl}/api/v1/capabilities/card`);
  expect(response.status).toBe(200);
  return CardSchema.parse(await response.json());
}

async function readA2aCard(): Promise<z.infer<typeof A2aCardSchema>> {
  const response = await fetch(`${runtime.a2a.baseUrl}/.well-known/agent-card.json`);
  expect(response.status).toBe(200);
  return A2aCardSchema.parse(await response.json());
}

async function eventuallyReadCapabilityCard(): Promise<z.infer<typeof CardSchema>> {
  let last = '';
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${runtime.management.baseUrl}/api/v1/capabilities/card`);
    last = await response.text();
    if (response.status === 200) {
      const card = CardSchema.parse(JSON.parse(last) as unknown);
      if (card.sourceSkillRefs.length === 0) return card;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`UGV_PROFILE_CARD_NOT_RECOVERED:${last}`);
}

async function eventuallyReadA2aCard(): Promise<z.infer<typeof A2aCardSchema>> {
  let last = '';
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${runtime.a2a.baseUrl}/.well-known/agent-card.json`);
    last = await response.text();
    if (response.status === 200) {
      const card = A2aCardSchema.parse(JSON.parse(last) as unknown);
      if (card.skills.length === 0) return card;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`UGV_PROFILE_A2A_CARD_NOT_RECOVERED:${last}`);
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function postJson(
  url: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Readonly<{ response: Response; body: unknown }>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function installSummaryWriteFailure(target: Pool): Promise<void> {
  await target.query(
    `CREATE FUNCTION uap_p2_reject_capability_summary_write() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'UAP_P2_INJECTED_CAPABILITY_SUMMARY_WRITE_FAILURE';
     END;
     $$`,
  );
  await target.query(
    `CREATE TRIGGER uap_p2_reject_capability_summary_write
     BEFORE INSERT OR UPDATE ON runtime_capability_summary
     FOR EACH ROW EXECUTE FUNCTION uap_p2_reject_capability_summary_write()`,
  );
}

async function removeSummaryWriteFailure(target: Pool): Promise<void> {
  await target.query(
    'DROP TRIGGER IF EXISTS uap_p2_reject_capability_summary_write ON runtime_capability_summary',
  );
  await target.query('DROP FUNCTION IF EXISTS uap_p2_reject_capability_summary_write()');
}
