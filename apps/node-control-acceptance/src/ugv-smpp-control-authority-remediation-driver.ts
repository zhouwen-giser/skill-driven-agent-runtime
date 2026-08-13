import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const VERSION = 1;
const FIRE_TOOL_NAME = 'vehicle_fire_weapon';
const FIRE_SKILL_ID = 'ugv.fire-weapon';
const FIRE_CAPABILITY_ID = 'vehicle.ugv.fire-weapon';

const CONTROL_AUTHORITIES = Object.freeze([
  Object.freeze({
    toolName: 'vehicle_navigate',
    skillId: 'ugv.navigate',
    capabilityId: 'vehicle.ugv.navigate',
    riskLevel: 'medium' as const,
  }),
  Object.freeze({
    toolName: 'vehicle_area_recon',
    skillId: 'ugv.area-recon',
    capabilityId: 'vehicle.ugv.recon',
    riskLevel: 'medium' as const,
  }),
  Object.freeze({
    toolName: 'vehicle_track_target',
    skillId: 'ugv.track-target',
    capabilityId: 'vehicle.ugv.track-target',
    riskLevel: 'medium' as const,
  }),
  Object.freeze({
    toolName: 'vehicle_control_gimbal',
    skillId: 'ugv.control-gimbal',
    capabilityId: 'vehicle.ugv.control-gimbal',
    riskLevel: 'medium' as const,
  }),
  Object.freeze({
    toolName: 'vehicle_emergency_stop',
    skillId: 'ugv.emergency-stop',
    capabilityId: 'vehicle.ugv.emergency-stop',
    riskLevel: 'high' as const,
  }),
]);

type ControlAuthority = (typeof CONTROL_AUTHORITIES)[number];

export interface UgvSmppControlAuthorityRemediationConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly runId: string;
}

export interface UgvSmppControlAuthorityRemediationReport {
  readonly schemaVersion: 'sdar.ugv-smpp-control-authority-remediation/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly completedAt: string;
  readonly authorityCount: 5;
  readonly governanceMutationPerformed: boolean;
  readonly controls: readonly Readonly<{
    toolName: string;
    skillId: string;
    skillVersion: 1;
    capabilityId: string;
    capabilityVersion: 1;
    before: Readonly<{
      runtimeSkillStatus: 'enabled' | 'disabled';
      governedSkillStatus: 'published' | 'suspended';
      capabilityStatus: 'published' | 'suspended';
      readinessStatus: 'missing' | 'available' | 'degraded' | 'unavailable' | 'suspended';
    }>;
    actions: Readonly<{
      skill: 'suspended' | 'already_suspended';
      capability: 'suspended' | 'already_suspended';
      readiness: 'evaluated_suspended' | 'already_suspended';
    }>;
    skillGovernanceRevisionUsed?: number;
    capabilityEtagSha256: string;
    after: Readonly<{
      runtimeSkillStatus: 'disabled';
      governedSkillStatus: 'suspended';
      capabilityStatus: 'suspended';
      readinessStatus: 'suspended';
      readinessHasBlockingReason: true;
      admissionAvailable: false;
    }>;
  }>[];
  readonly firePolicy: Readonly<{
    toolName: typeof FIRE_TOOL_NAME;
    runtimeSkillAbsent: true;
    governedSkillAbsent: true;
    capabilityAbsent: true;
    readinessAbsent: true;
    readinessAvailable: false;
  }>;
  readonly safety: Readonly<{
    mcpInvocationPerformed: false;
    deviceRequestPerformed: false;
    physicalToolAcceptanceClaimed: false;
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    credentialReferencesIncluded: false;
    sensitivePayloadsIncluded: false;
    entityIdsIncluded: true;
  }>;
}

export class UgvSmppControlAuthorityRemediationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvSmppControlAuthorityRemediationError';
    this.code = code;
  }
}

const ToolReferenceSchema = z
  .object({ serverId: z.string().min(1), toolName: z.string().min(1) })
  .strict();
const RuntimeSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.literal(1), z.literal('1')]),
    status: z.enum([
      'draft',
      'validating',
      'enabled',
      'disabled',
      'deprecated',
      'validation_failed',
    ]),
    capabilities: z.array(z.string().min(1)),
    toolPolicy: z
      .object({
        required: z.array(ToolReferenceSchema),
        optional: z.array(ToolReferenceSchema),
        forbidden: z.array(ToolReferenceSchema),
      })
      .strict(),
    runtimePolicy: z.record(z.string(), z.unknown()),
    sourceKind: z.string().min(1),
    validationPassed: z.boolean(),
  })
  .loose();
const GovernedSkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.literal(1), z.literal('1')]),
    status: z.enum(['draft', 'validated', 'published', 'suspended', 'deprecated', 'retired']),
    governanceRevision: z.number().int().nonnegative().optional(),
  })
  .loose();
const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.literal(1),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    definitionHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .loose();
const ImplementationSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.literal(1),
    implementationType: z.literal('skill'),
    implementationId: z.string().min(1),
    implementationVersion: z.union([z.literal(1), z.literal('1')]),
    status: z.literal('active'),
  })
  .loose();
const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.literal(1),
    status: z.enum(['available', 'degraded', 'unavailable', 'suspended']),
    reasons: z
      .array(
        z
          .object({
            code: z.string().min(1),
            severity: z.enum(['info', 'warning', 'blocking']).optional(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();
const OperationSchema = z
  .object({
    status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
    errorCode: z.string().optional(),
    result: z.unknown().optional(),
  })
  .loose();
const OperationCollectionSchema = z
  .object({
    items: z.array(
      z
        .object({
          operationType: z.string().min(1),
          target: z
            .object({
              type: z.string().min(1),
              id: z.string().min(1),
              version: z.string().optional(),
            })
            .loose(),
          status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
          result: z.unknown().optional(),
        })
        .loose(),
    ),
  })
  .loose();

type RuntimeSkill = z.infer<typeof RuntimeSkillSchema>;
type GovernedSkill = z.infer<typeof GovernedSkillSchema>;
type Capability = z.infer<typeof CapabilitySchema>;
type Readiness = z.infer<typeof ReadinessSchema>;

interface CapabilityRead {
  readonly capability: Capability;
  readonly etag: string;
}

interface PreparedAuthority {
  readonly spec: ControlAuthority;
  readonly runtimeSkill: RuntimeSkill;
  readonly governedSkill: GovernedSkill;
  readonly capability: Capability;
  readonly capabilityEtag: string;
  readonly readiness?: Readiness;
  readonly skillGovernanceRevision?: number;
}

export async function remediateUgvSmppControlAuthorities(
  input: UgvSmppControlAuthorityRemediationConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
): Promise<UgvSmppControlAuthorityRemediationReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observedAt = validTimestamp(now());

  await assertFireAuthorityAbsent(configuration, request);
  const initial = await Promise.all(
    CONTROL_AUTHORITIES.map(async (spec): Promise<PreparedAuthority> => {
      const [runtimeSkill, governedSkill, capabilityRead, implementations, readiness] =
        await Promise.all([
          requireRuntimeSkill(configuration, spec.skillId, request),
          requireGovernedSkill(configuration, spec.skillId, request),
          requireCapability(configuration, spec.capabilityId, request),
          listImplementations(configuration, spec.capabilityId, request),
          getReadiness(configuration, spec.capabilityId, request),
        ]);
      assertRuntimeSkillExact(runtimeSkill, spec);
      assertGovernedSkillExact(governedSkill, spec);
      assertSkillLifecyclePair(runtimeSkill.status, governedSkill.status);
      assertCapabilityExact(capabilityRead.capability, spec);
      assertImplementationExact(implementations, spec);
      if (readiness !== undefined) assertReadinessIdentity(readiness, spec);
      return Object.freeze({
        spec,
        runtimeSkill,
        governedSkill,
        capability: capabilityRead.capability,
        capabilityEtag: capabilityRead.etag,
        ...(readiness === undefined ? {} : { readiness }),
      });
    }),
  );

  const revisionOperations = initial.some(
    ({ runtimeSkill, governedSkill }) =>
      runtimeSkill.status === 'enabled' && governedSkill.governanceRevision === undefined,
  )
    ? await listManagementOperations(configuration, request)
    : undefined;
  const prepared = initial.map((item): PreparedAuthority => {
    if (item.runtimeSkill.status !== 'enabled') return item;
    const skillGovernanceRevision =
      item.governedSkill.governanceRevision ??
      governanceRevisionFromOperations(revisionOperations, item.spec);
    if (skillGovernanceRevision === undefined)
      return fail(
        'SKILL_GOVERNANCE_REVISION_UNAVAILABLE',
        'The current exact Skill governance revision is not available from public authority.',
      );
    return Object.freeze({ ...item, skillGovernanceRevision });
  });

  const actionBySkill = new Map<
    string,
    Readonly<{
      skill: 'suspended' | 'already_suspended';
      capability: 'suspended' | 'already_suspended';
      readiness: 'evaluated_suspended' | 'already_suspended';
    }>
  >();
  for (const item of prepared) {
    let skillAction: 'suspended' | 'already_suspended' = 'already_suspended';
    let capabilityAction: 'suspended' | 'already_suspended' = 'already_suspended';
    let readinessAction: 'evaluated_suspended' | 'already_suspended' = 'already_suspended';
    if (item.runtimeSkill.status === 'enabled') {
      const revision = item.skillGovernanceRevision;
      if (revision === undefined)
        fail('SKILL_GOVERNANCE_REVISION_UNAVAILABLE', 'Skill suspend revision is unavailable.');
      assertSucceeded(
        await controlCommand(
          configuration,
          `/api/v1/skills/${encodeURIComponent(item.spec.skillId)}/versions/1/suspend`,
          runKey(configuration.runId, 'skill-suspend', item.spec.skillId),
          {
            reason: `Suspend previously published UGV control Skill ${item.spec.skillId}@1.`,
            expectedRevision: revision,
          },
          request,
        ),
        'SKILL_SUSPEND_FAILED',
      );
      skillAction = 'suspended';
    }
    if (item.capability.status === 'published') {
      assertSucceeded(
        await controlMutation(
          configuration,
          `/api/v1/node-capabilities/${encodeURIComponent(item.spec.capabilityId)}/versions/1/suspend`,
          runKey(configuration.runId, 'capability-suspend', item.spec.capabilityId),
          {
            reason: `Suspend previously published UGV control Capability ${item.spec.capabilityId}@1.`,
          },
          item.capabilityEtag,
          request,
        ),
        'CAPABILITY_SUSPEND_FAILED',
      );
      capabilityAction = 'suspended';
    }
    if (capabilityAction === 'suspended' || !hasSuspendedReadiness(item.readiness)) {
      const operation = assertSucceeded(
        await controlCommand(
          configuration,
          `/api/v1/capability-readiness/${encodeURIComponent(item.spec.capabilityId)}/1/evaluate`,
          runKey(configuration.runId, 'readiness-revoke', item.spec.capabilityId),
          { reason: `Re-evaluate suspended control Capability ${item.spec.capabilityId}@1.` },
          request,
        ),
        'READINESS_REVOCATION_FAILED',
      );
      const snapshot = ReadinessSchema.parse(operation.result);
      assertSuspendedReadiness(snapshot, item.spec);
      readinessAction = 'evaluated_suspended';
    }
    actionBySkill.set(
      item.spec.skillId,
      Object.freeze({
        skill: skillAction,
        capability: capabilityAction,
        readiness: readinessAction,
      }),
    );
  }

  const controls: UgvSmppControlAuthorityRemediationReport['controls'][number][] = [];
  for (const item of prepared) {
    const [runtimeSkill, governedSkill, capabilityRead, readiness] = await Promise.all([
      requireRuntimeSkill(configuration, item.spec.skillId, request),
      requireGovernedSkill(configuration, item.spec.skillId, request),
      requireCapability(configuration, item.spec.capabilityId, request),
      getReadiness(configuration, item.spec.capabilityId, request),
    ]);
    assertRuntimeSkillExact(runtimeSkill, item.spec);
    assertGovernedSkillExact(governedSkill, item.spec);
    if (runtimeSkill.status !== 'disabled' || governedSkill.status !== 'suspended')
      fail(
        'SKILL_SUSPENSION_NOT_EFFECTIVE',
        'The exact control Skill is not disabled in Runtime and suspended in governance.',
      );
    assertCapabilityExact(capabilityRead.capability, item.spec);
    if (capabilityRead.capability.status !== 'suspended')
      fail('CAPABILITY_SUSPENSION_NOT_EFFECTIVE', 'The exact control Capability is not suspended.');
    if (readiness === undefined)
      fail('READINESS_REVOCATION_NOT_EFFECTIVE', 'Suspended Capability readiness is missing.');
    assertSuspendedReadiness(readiness, item.spec);
    const actions = actionBySkill.get(item.spec.skillId);
    if (actions === undefined) fail('REMEDIATION_ACTION_MISSING', 'Remediation action is missing.');
    controls.push(
      Object.freeze({
        toolName: item.spec.toolName,
        skillId: item.spec.skillId,
        skillVersion: VERSION,
        capabilityId: item.spec.capabilityId,
        capabilityVersion: VERSION,
        before: Object.freeze({
          runtimeSkillStatus: item.runtimeSkill.status as 'enabled' | 'disabled',
          governedSkillStatus: item.governedSkill.status as 'published' | 'suspended',
          capabilityStatus: item.capability.status as 'published' | 'suspended',
          readinessStatus: item.readiness?.status ?? 'missing',
        }),
        actions,
        ...(item.skillGovernanceRevision === undefined
          ? {}
          : { skillGovernanceRevisionUsed: item.skillGovernanceRevision }),
        capabilityEtagSha256: sha256(item.capabilityEtag),
        after: Object.freeze({
          runtimeSkillStatus: 'disabled' as const,
          governedSkillStatus: 'suspended' as const,
          capabilityStatus: 'suspended' as const,
          readinessStatus: 'suspended' as const,
          readinessHasBlockingReason: true as const,
          admissionAvailable: false as const,
        }),
      }),
    );
  }
  await assertFireAuthorityAbsent(configuration, request);
  const completedAt = validTimestamp(now());
  if (Date.parse(completedAt) < Date.parse(observedAt))
    fail('DRIVER_CLOCK_INVALID', 'Completion time precedes observation time.');
  const report = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-control-authority-remediation/v1' as const,
    status: 'passed' as const,
    observedAt,
    completedAt,
    authorityCount: 5 as const,
    governanceMutationPerformed: controls.some(
      ({ actions }) =>
        actions.skill === 'suspended' ||
        actions.capability === 'suspended' ||
        actions.readiness === 'evaluated_suspended',
    ),
    controls: Object.freeze(controls),
    firePolicy: Object.freeze({
      toolName: FIRE_TOOL_NAME,
      runtimeSkillAbsent: true as const,
      governedSkillAbsent: true as const,
      capabilityAbsent: true as const,
      readinessAbsent: true as const,
      readinessAvailable: false as const,
    }),
    safety: Object.freeze({
      mcpInvocationPerformed: false as const,
      deviceRequestPerformed: false as const,
      physicalToolAcceptanceClaimed: false as const,
    }),
    redaction: Object.freeze({
      secretsIncluded: false as const,
      endpointsIncluded: false as const,
      credentialReferencesIncluded: false as const,
      sensitivePayloadsIncluded: false as const,
      entityIdsIncluded: true as const,
    }),
  });
  assertRedacted(report, configuration);
  return report;
}

function assertRuntimeSkillExact(actual: RuntimeSkill, spec: ControlAuthority): void {
  const required = actual.toolPolicy.required;
  const forbidden = actual.toolPolicy.forbidden;
  if (
    actual.skillId !== spec.skillId ||
    String(actual.version) !== String(VERSION) ||
    !['enabled', 'disabled'].includes(actual.status) ||
    actual.sourceKind !== 'admin' ||
    !actual.validationPassed ||
    stable(actual.capabilities) !== stable([spec.capabilityId]) ||
    required.length !== 1 ||
    required[0]?.toolName !== spec.toolName ||
    actual.toolPolicy.optional.length !== 0 ||
    forbidden.length !== 1 ||
    forbidden[0]?.toolName !== FIRE_TOOL_NAME ||
    forbidden[0].serverId !== required[0].serverId ||
    actual.runtimePolicy['autoConfirmPlan'] !== false ||
    actual.runtimePolicy['maxMcpCalls'] !== 1
  )
    fail(
      'CONTROL_SKILL_NOT_EXACT',
      'Runtime control Skill does not match the exact safe authority.',
    );
}

function assertGovernedSkillExact(actual: GovernedSkill, spec: ControlAuthority): void {
  if (
    actual.skillId !== spec.skillId ||
    String(actual.version) !== String(VERSION) ||
    !['published', 'suspended'].includes(actual.status)
  )
    fail(
      'CONTROL_SKILL_GOVERNANCE_NOT_EXACT',
      'Governed control Skill is absent, drifted or in an unsupported lifecycle state.',
    );
}

function assertSkillLifecyclePair(runtimeStatus: string, governedStatus: string): void {
  if (!(
    (runtimeStatus === 'enabled' && governedStatus === 'published') ||
    (runtimeStatus === 'disabled' && governedStatus === 'suspended')
  ))
    fail(
      'CONTROL_SKILL_LIFECYCLE_INCONSISTENT',
      'Runtime and governance Skill lifecycle projections are inconsistent.',
    );
}

function assertCapabilityExact(actual: Capability, spec: ControlAuthority): void {
  if (
    actual.capabilityId !== spec.capabilityId ||
    actual.riskLevel !== spec.riskLevel ||
    !['published', 'suspended'].includes(actual.status)
  )
    fail(
      'CONTROL_CAPABILITY_NOT_EXACT',
      'Control Capability is absent, drifted or in an unsupported lifecycle state.',
    );
}

function assertImplementationExact(
  implementations: readonly z.infer<typeof ImplementationSchema>[],
  spec: ControlAuthority,
): void {
  const implementation = implementations[0];
  if (implementation === undefined)
    fail(
      'CONTROL_CAPABILITY_IMPLEMENTATION_NOT_EXACT',
      'Control Capability is missing its active exact Skill implementation.',
    );
  if (
    implementations.length !== 1 ||
    implementation.capabilityId !== spec.capabilityId ||
    implementation.implementationId !== spec.skillId ||
    String(implementation.implementationVersion) !== String(VERSION)
  )
    fail(
      'CONTROL_CAPABILITY_IMPLEMENTATION_NOT_EXACT',
      'Control Capability does not have exactly one active exact Skill implementation.',
    );
}

function assertReadinessIdentity(actual: Readiness, spec: ControlAuthority): void {
  if (actual.capabilityId !== spec.capabilityId)
    fail('CONTROL_READINESS_NOT_EXACT', 'Capability readiness identity is not exact.');
}

function assertSuspendedReadiness(actual: Readiness, spec: ControlAuthority): void {
  assertReadinessIdentity(actual, spec);
  if (!hasSuspendedReadiness(actual))
    fail(
      'READINESS_REVOCATION_NOT_EFFECTIVE',
      'Control Capability readiness is not suspended with a blocking reason.',
    );
}

function hasSuspendedReadiness(actual: Readiness | undefined): boolean {
  return (
    actual?.status === 'suspended' && actual.reasons.some(({ severity }) => severity === 'blocking')
  );
}

function governanceRevisionFromOperations(
  body: z.infer<typeof OperationCollectionSchema> | undefined,
  spec: ControlAuthority,
): number | undefined {
  if (body === undefined) return undefined;
  for (const operation of body.items) {
    if (
      operation.status !== 'succeeded' ||
      operation.operationType !== 'skill.publish' ||
      operation.target.type !== 'skill_version' ||
      operation.target.id !== spec.skillId ||
      operation.target.version !== String(VERSION)
    )
      continue;
    const revisions = new Set<number>();
    collectGovernanceRevisions(operation.result, spec.skillId, 'published', revisions);
    if (revisions.size === 1) return [...revisions][0];
    if (revisions.size > 1)
      fail(
        'SKILL_GOVERNANCE_REVISION_AMBIGUOUS',
        'The latest exact Skill lifecycle operation contains ambiguous revisions.',
      );
  }
  return undefined;
}

function collectGovernanceRevisions(
  value: unknown,
  skillId: string,
  status: string,
  revisions: Set<number>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectGovernanceRevisions(item, skillId, status, revisions);
    return;
  }
  if (!isRecord(value)) return;
  if (
    value['skillId'] === skillId &&
    String(value['version']) === String(VERSION) &&
    value['status'] === status &&
    Number.isSafeInteger(value['governanceRevision']) &&
    Number(value['governanceRevision']) >= 0
  )
    revisions.add(Number(value['governanceRevision']));
  for (const nested of Object.values(value))
    collectGovernanceRevisions(nested, skillId, status, revisions);
}

async function assertFireAuthorityAbsent(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  request: typeof fetch,
): Promise<void> {
  const [runtimeSkill, governedSkill, capability, readiness] = await Promise.all([
    getMaybeRuntimeSkill(configuration, FIRE_SKILL_ID, request),
    getMaybeGovernedSkill(configuration, FIRE_SKILL_ID, request),
    getMaybeCapability(configuration, FIRE_CAPABILITY_ID, request),
    getReadiness(configuration, FIRE_CAPABILITY_ID, request),
  ]);
  if (runtimeSkill !== undefined || governedSkill !== undefined || capability !== undefined)
    fail('FIRE_AUTHORITY_PRESENT', 'Fire Skill or Capability authority exists.');
  if (readiness !== undefined)
    fail('FIRE_READINESS_PRESENT', 'Fire Capability readiness authority exists.');
}

async function requireRuntimeSkill(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  skillId: string,
  request: typeof fetch,
): Promise<RuntimeSkill> {
  const value = await getMaybeRuntimeSkill(configuration, skillId, request);
  if (value === undefined)
    fail('CONTROL_RUNTIME_SKILL_NOT_FOUND', 'Exact Runtime Skill is missing.');
  return value;
}

async function getMaybeRuntimeSkill(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  skillId: string,
  request: typeof fetch,
): Promise<RuntimeSkill | undefined> {
  const response = await request(
    `${configuration.runtimeManagementBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/1`,
    { redirect: 'manual' },
  );
  if (response.status === 404) return undefined;
  return RuntimeSkillSchema.parse(await responseJson(response, 200));
}

async function requireGovernedSkill(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  skillId: string,
  request: typeof fetch,
): Promise<GovernedSkill> {
  const value = await getMaybeGovernedSkill(configuration, skillId, request);
  if (value === undefined)
    fail('CONTROL_GOVERNED_SKILL_NOT_FOUND', 'Exact governed Skill projection is missing.');
  return value;
}

async function getMaybeGovernedSkill(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  skillId: string,
  request: typeof fetch,
): Promise<GovernedSkill | undefined> {
  const response = await request(
    `${configuration.nodeControlBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/1`,
    { headers: controlHeaders(configuration), redirect: 'manual' },
  );
  if (response.status === 404) return undefined;
  return GovernedSkillSchema.parse(await responseJson(response, 200));
}

async function requireCapability(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  capabilityId: string,
  request: typeof fetch,
): Promise<CapabilityRead> {
  const value = await getMaybeCapability(configuration, capabilityId, request);
  if (value === undefined)
    fail('CONTROL_CAPABILITY_NOT_FOUND', 'Exact control Capability is missing.');
  return value;
}

async function getMaybeCapability(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  capabilityId: string,
  request: typeof fetch,
): Promise<CapabilityRead | undefined> {
  const response = await request(
    `${configuration.nodeControlBaseUrl}/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/1`,
    { headers: controlHeaders(configuration), redirect: 'manual' },
  );
  if (response.status === 404) return undefined;
  const capability = CapabilitySchema.parse(await responseJson(response, 200));
  const etag = response.headers.get('etag')?.trim();
  if (etag === undefined || etag === '' || etag.length > 512)
    fail('CAPABILITY_ETAG_MISSING', 'Exact Capability response did not include a bounded ETag.');
  return Object.freeze({ capability, etag });
}

async function listImplementations(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  capabilityId: string,
  request: typeof fetch,
) {
  return z
    .object({ items: z.array(ImplementationSchema) })
    .loose()
    .parse(
      await controlGet(
        configuration,
        `/api/v1/node-capabilities/${encodeURIComponent(capabilityId)}/versions/1/implementations?pageSize=100`,
        request,
      ),
    ).items;
}

async function getReadiness(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  capabilityId: string,
  request: typeof fetch,
): Promise<Readiness | undefined> {
  const response = await request(
    `${configuration.nodeControlBaseUrl}/api/v1/capability-readiness/${encodeURIComponent(capabilityId)}/1`,
    { headers: controlHeaders(configuration), redirect: 'manual' },
  );
  if (response.status === 404) return undefined;
  return ReadinessSchema.parse(await responseJson(response, 200));
}

async function listManagementOperations(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  request: typeof fetch,
) {
  return OperationCollectionSchema.parse(
    await controlGet(configuration, '/api/v1/management-operations?pageSize=200', request),
  );
}

async function controlGet(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      headers: controlHeaders(configuration),
      redirect: 'manual',
    }),
    200,
  );
}

async function controlCommand(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...controlHeaders(configuration),
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
    202,
  );
}

async function controlMutation(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  etag: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...controlHeaders(configuration),
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'if-match': etag,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
    202,
  );
}

function controlHeaders(
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
): Readonly<Record<string, string>> {
  return Object.freeze({ authorization: `Bearer ${configuration.nodeControlBearerToken}` });
}

function assertSucceeded(value: unknown, code: string): z.infer<typeof OperationSchema> {
  const operation = OperationSchema.parse(value);
  if (operation.status !== 'succeeded')
    fail(code, 'A public remediation operation did not complete successfully.');
  return operation;
}

async function responseJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    let code = `HTTP_${String(response.status)}`;
    try {
      code = z
        .object({ code: z.string().min(1) })
        .loose()
        .parse(await response.json()).code;
    } catch {
      // Endpoint, token and response details are deliberately not propagated.
    }
    return fail(
      code,
      `Remediation HTTP request was rejected with status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    return fail('HTTP_RESPONSE_INVALID', 'Remediation HTTP response was not JSON.');
  }
}

function validateConfiguration(
  input: UgvSmppControlAuthorityRemediationConfiguration,
): UgvSmppControlAuthorityRemediationConfiguration {
  if (input.nodeControlBearerToken.trim().length < 1 || input.nodeControlBearerToken.length > 4_096)
    fail('DRIVER_CONFIGURATION_INVALID', 'A bounded Node Control bearer token is required.');
  if (input.runId.trim().length < 8 || input.runId.length > 128)
    fail('DRIVER_CONFIGURATION_INVALID', 'A bounded unique remediation run ID is required.');
  return Object.freeze({
    ...input,
    nodeControlBearerToken: input.nodeControlBearerToken.trim(),
    runId: input.runId.trim(),
    nodeControlBaseUrl: managementBaseUrl(input.nodeControlBaseUrl),
    runtimeManagementBaseUrl: managementBaseUrl(input.runtimeManagementBaseUrl),
  });
}

function managementBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('DRIVER_CONFIGURATION_INVALID', 'Management URL must be absolute HTTP(S).');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    fail('DRIVER_CONFIGURATION_INVALID', 'Management URL contains unsupported components.');
  return url.origin;
}

function validTimestamp(value: string): string {
  const parsed = z.iso.datetime().safeParse(value);
  if (!parsed.success) fail('DRIVER_CLOCK_INVALID', 'Driver clock returned an invalid timestamp.');
  return parsed.data;
}

function runKey(runId: string, scope: string, identity: string): string {
  return `${runId}-${scope}-${sha256(identity).slice(0, 16)}`.slice(0, 256);
}

function stable(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRedacted(
  report: UgvSmppControlAuthorityRemediationReport,
  configuration: UgvSmppControlAuthorityRemediationConfiguration,
): void {
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    configuration.nodeControlBearerToken,
    configuration.nodeControlBaseUrl,
    configuration.runtimeManagementBaseUrl,
  ])
    if (serialized.includes(forbidden))
      fail('REPORT_REDACTION_FAILED', 'Remediation report contains sensitive configuration.');
  if (
    /https?:\/\//iu.test(serialized) ||
    /(?:(?:"authorization"|"access[_-]?token"|"refresh[_-]?token"|"password"|"credential[_-]?ref"))/iu.test(
      serialized,
    )
  )
    fail('REPORT_REDACTION_FAILED', 'Remediation report contains forbidden sensitive material.');
}

function fail(code: string, message: string): never {
  throw new UgvSmppControlAuthorityRemediationError(code, message);
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('DRIVER_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  const value = (inline ?? (file === undefined ? '' : await readFile(file, 'utf8'))).trim();
  if (value === '') fail('DRIVER_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    fail('DRIVER_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

export async function ugvSmppControlAuthorityRemediationConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<
  Readonly<{
    configuration: UgvSmppControlAuthorityRemediationConfiguration;
    reportFile: string;
  }>
> {
  return Object.freeze({
    configuration: Object.freeze({
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL'),
      nodeControlBearerToken: await secretFromEnvironment(environment, 'SDAR_CONTROL_API_TOKEN'),
      runtimeManagementBaseUrl: requiredEnvironment(
        environment,
        'SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL',
      ),
      runId: requiredEnvironment(environment, 'SDAR_UGV_REMEDIATION_RUN_ID'),
    }),
    reportFile:
      environment['SDAR_UGV_REMEDIATION_REPORT_FILE'] ??
      'reports/sdar-ugv-smpp-integration/control-authority-remediation.redacted.json',
  });
}

export async function writeRedactedUgvSmppControlAuthorityRemediationReport(
  reportFile: string,
  report: UgvSmppControlAuthorityRemediationReport,
): Promise<void> {
  const target = resolve(reportFile);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, target);
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } =
      await ugvSmppControlAuthorityRemediationConfigurationFromEnvironment();
    const report = await remediateUgvSmppControlAuthorities(configuration);
    await writeRedactedUgvSmppControlAuthorityRemediationReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof UgvSmppControlAuthorityRemediationError
        ? error.code
        : 'UGV_SMPP_CONTROL_AUTHORITY_REMEDIATION_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
