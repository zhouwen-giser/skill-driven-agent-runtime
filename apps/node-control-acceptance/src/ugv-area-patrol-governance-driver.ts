import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  SkillPackageImporter,
  SkillPackageValidator,
} from '../../../packages/application/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import {
  createNodeCapabilityDefinition,
  nodeCapabilityEtag,
  createA2aExposureVersion,
  a2aExposureEtag,
  type JsonObject,
} from '../../../packages/node-control-domain/src/index.js';
import {
  controlGet,
  controlCommand,
  controlCreate,
  controlMutation,
  type UgvSmppCapabilityGovernanceConfiguration,
} from './ugv-smpp-capability-governance-driver.js';

const object = z.record(z.string(), z.unknown());
const capabilitySchema = z
  .object({
    capabilityId: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string(),
    inputSchema: object,
    outputSchema: object,
    constraints: z.array(object),
  })
  .loose();
const exposureSchema = z
  .object({
    exposureId: z.string(),
    version: z.number().int().positive(),
    capabilityId: z.string(),
    capabilityVersion: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'suspended', 'retired']),
    exposureHash: z.string(),
  })
  .loose();
const skillSchema = z
  .object({
    skillId: z.string(),
    version: z.number().int().positive(),
    status: z.string(),
    outcomeSpecification: object,
  })
  .loose();
const operation = z.object({ status: z.literal('succeeded'), result: z.unknown() }).loose();

/** Append-only native Skill/Capability/Exposure publication; performs no physical Tool calls. */
export async function governUgvAreaPatrol(
  configuration: UgvSmppCapabilityGovernanceConfiguration &
    Readonly<{ initialPatrolPackageRoot: string; patrolPackageRoot: string }>,
  dependencies: Readonly<{ fetch?: typeof fetch }> = {},
) {
  const request = dependencies.fetch ?? fetch,
    c = configuration;
  const packageSchema: unknown = JSON.parse(
    await readFile(resolve('schemas/skill-package.schema.json'), 'utf8'),
  );
  const template = await new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({ schemas: new AjvJsonSchemaValidator(), packageSchema }),
    clock: { now: () => new Date().toISOString() },
  }).import(c.patrolPackageRoot);
  const runtimeGet = async (path: string) => {
    const response = await request(c.runtimeManagementBaseUrl + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && path.endsWith('/versions')) return { items: [] };
    if (!response.ok) throw Error('PATROL_RUNTIME_READ_FAILED');
    return response.json();
  };
  const command = async (path: string, key: string, body: unknown) =>
    operation.parse(await controlCommand(c, path, `${c.runId}:patrol:${key}`, body, request))
      .result;
  const capabilities = z
    .object({ items: z.array(capabilitySchema) })
    .loose()
    .parse(await controlGet(c, '/api/v1/node-capabilities?pageSize=1000', request)).items;
  const exposures = z
    .object({ items: z.array(exposureSchema) })
    .loose()
    .parse(await controlGet(c, '/api/v1/a2a-exposures?pageSize=1000', request)).items;
  const children: Record<string, string | number>[] = [];
  let provider: Record<string, unknown> | undefined;
  const childProviders: Record<string, unknown>[] = [];
  for (const [skillId, capabilityId] of [
    ['embodied.move_to', 'embodied.move'],
    ['embodied.inspect_area', 'embodied.inspect_area'],
  ] as const) {
    const capability = capabilities
      .filter((entry) => entry.capabilityId === capabilityId && entry.status === 'published')
      .sort((a, b) => b.version - a.version)[0];
    if (!capability) throw Error('PATROL_CAPABILITY_DEPENDENCY_MISSING');
    const implementation = z
      .object({
        items: z.array(
          z
            .object({
              implementationType: z.literal('skill'),
              implementationId: z.string(),
              implementationVersion: z.string(),
              status: z.literal('active'),
              role: z.literal('primary'),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(
        await controlGet(
          c,
          `/api/v1/node-capabilities/${capabilityId}/versions/${String(capability.version)}/implementations`,
          request,
        ),
      );
    if (implementation.items.length !== 1 || implementation.items[0]?.implementationId !== skillId)
      throw Error('PATROL_CHILD_IMPLEMENTATION_NOT_EXACT');
    const skillVersion = Number(implementation.items[0].implementationVersion);
    const skills = z
      .object({ items: z.array(skillSchema) })
      .loose()
      .parse(await runtimeGet(`/api/v1/skills/${skillId}/versions`)).items;
    const current = skills.sort((a, b) => b.version - a.version)[0];
    if (current?.version !== skillVersion || current.status !== 'enabled')
      throw Error('PATROL_CHILD_SKILL_NOT_CURRENT');
    const exposure = exposures
      .filter(
        (entry) =>
          entry.capabilityId === capabilityId &&
          entry.capabilityVersion === capability.version &&
          entry.status === 'published',
      )
      .sort((a, b) => b.version - a.version)[0];
    if (!exposure) throw Error('PATROL_CHILD_EXPOSURE_MISSING');
    children.push({
      skillId,
      skillVersion,
      capabilityId,
      capabilityVersion: capability.version,
      exposureId: exposure.exposureId,
      exposureVersion: exposure.version,
    });
    const childProvider = capability.constraints.find(
      (constraint) => constraint['type'] === 'provider_binding_policy',
    );
    if (!childProvider) throw Error('PATROL_CHILD_PROVIDER_MISSING');
    childProviders.push(childProvider);
    if (capabilityId === 'embodied.inspect_area') provider = childProvider;
  }
  if (
    !provider ||
    provider['mcpProviderBindingId'] !== c.bindingId ||
    typeof provider['catalogChecksum'] !== 'string' ||
    childProviders.some((child) =>
      [
        'mcpProviderBindingId',
        'localServerId',
        'bindingRevision',
        'catalogRevision',
        'catalogChecksum',
        'allowedResourceIds',
      ].some((key) => canonical(child[key]) !== canonical(provider[key])),
    )
  )
    throw Error('PATROL_PROVIDER_AUTHORITY_NOT_EXACT');
  let parentVersions = z
    .object({ items: z.array(skillSchema) })
    .loose()
    .parse(await runtimeGet('/api/v1/skills/embodied.area_patrol/versions')).items;
  if (parentVersions.length === 0) {
    await command('/api/v1/skills/import', 'seed-v1', {
      reason: 'Preserve the repository-owned patrol version before append-only succession.',
      payload: { packageRoot: resolve(c.initialPatrolPackageRoot) },
    });
    parentVersions = z
      .object({ items: z.array(skillSchema) })
      .loose()
      .parse(await runtimeGet('/api/v1/skills/embodied.area_patrol/versions')).items;
  }
  const previous = parentVersions.sort((a, b) => b.version - a.version)[0];
  if (!previous) throw Error('PATROL_PREVIOUS_VERSION_MISSING');
  const authority = {
    requestedCapabilityId: 'embodied.area_patrol',
    resourceId: c.resourceId ?? 'vehicle:ugv1',
    providerBinding: provider,
    children,
    subregions: 'one_legal_requested_region',
    maximumInspectionElapsedMs: 300000,
  };
  const raw: unknown = JSON.parse(
    await readFile(join(c.patrolPackageRoot, 'manifest.json'), 'utf8'),
  );
  const manifest = object.parse(raw),
    skill = object.parse(manifest['skill']);
  skill['status'] = 'draft';
  skill['toolPolicy'] = { required: [], optional: [], forbidden: [] };
  const inputSchema = object.parse(skill['inputSchema']),
    inputProperties = object.parse(inputSchema['properties']);
  inputProperties['resourceId'] = { type: 'string', const: authority.resourceId };
  inputSchema['properties'] = inputProperties;
  skill['inputSchema'] = inputSchema;
  const outputSchema = object.parse(skill['outputSchema']),
    outputProperties = object.parse(outputSchema['properties']);
  outputProperties['resourceId'] = { type: 'string', const: authority.resourceId };
  outputSchema['properties'] = outputProperties;
  skill['outputSchema'] = outputSchema;
  const same =
    previous.version >= 2 &&
    canonical(previous.outcomeSpecification['taskGoalPolicy']) === canonical(authority) &&
    canonical(previous['usageSpecification']) ===
      canonical(template.skillVersion.usageSpecification) &&
    canonical(previous['runtimePolicy']) === canonical(template.skillVersion.runtimePolicy) &&
    canonical(previous['inputSchema']) === canonical(inputSchema) &&
    canonical(previous['outputSchema']) === canonical(outputSchema) &&
    canonical(previous['toolPolicy']) === canonical(skill['toolPolicy']);
  const skillVersion = same ? previous.version : previous.version + 1;
  skill['version'] = skillVersion;
  skill['previousVersion'] = skillVersion - 1;
  const outcome = object.parse(skill['outcomeSpecification']);
  outcome['skillVersion'] = skillVersion;
  outcome['taskGoalPolicy'] = authority;
  delete outcome['specificationHash'];
  outcome['specificationHash'] = 'sha256:' + hash(canonical(outcome));
  skill['outcomeSpecification'] = outcome;
  manifest['skill'] = skill;
  const packageRoot = join(
    c.packageWorkspaceRoot,
    'embodied.area_patrol',
    'v' + String(skillVersion),
  );
  await mkdir(packageRoot, { recursive: true, mode: 0o700 });
  const files = object.parse(manifest['files']);
  for (const metadata of Object.values(files)) {
    const entry = object.parse(metadata),
      path = z.string().parse(entry['path']);
    if (!/^[a-z]+\.json$/.test(path)) throw Error('PATROL_PACKAGE_PATH_INVALID');
    const bytes = await readFile(join(c.patrolPackageRoot, path));
    if (hash(bytes) !== entry['sha256']) throw Error('PATROL_PACKAGE_CHECKSUM_INVALID');
    await writeFile(join(packageRoot, path), bytes, { mode: 0o600 });
  }
  const markdown = await readFile(join(c.patrolPackageRoot, 'SKILL.md'));
  if (hash(markdown) !== manifest['skillMarkdownSha256'])
    throw Error('PATROL_MARKDOWN_CHECKSUM_INVALID');
  await writeFile(join(packageRoot, 'SKILL.md'), markdown, { mode: 0o600 });
  await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  if (!same)
    await command('/api/v1/skills/import', `import-v${String(skillVersion)}`, {
      reason: 'Import the exact governed patrol successor and child authority.',
      payload: { packageRoot },
    });
  if (!same || previous.status !== 'enabled')
    await command(
      `/api/v1/skills/embodied.area_patrol/versions/${String(skillVersion)}/publish`,
      `publish-v${String(skillVersion)}`,
      { reason: 'Publish the exact governed patrol successor.', expectedRevision: 0 },
    );
  const oldCapability = capabilities
    .filter((entry) => entry.capabilityId === 'embodied.area_patrol')
    .sort((a, b) => b.version - a.version)[0];
  const proposed = (version: number) =>
    createNodeCapabilityDefinition({
      capabilityId: 'embodied.area_patrol',
      version,
      ...(version === 1 ? {} : { previousVersion: version - 1 }),
      domain: 'embodied',
      name: 'Governed area patrol',
      description: String(skill['description']),
      inputSchema: inputSchema as JsonObject,
      outputSchema: outputSchema as JsonObject,
      successCriteria: [
        { type: 'output_schema_valid', required: true },
        {
          type: 'patrol_report_outcome',
          required: true,
          incompleteOutcome: 'degraded',
          fullSuccessRequires: [
            'native_child_tasks',
            'scoped_inspection_report',
            'actual_trajectory',
          ],
        },
      ],
      requiredEvidence: [
        { type: 'native_patrol_child_reports', evidenceType: 'patrol.report', required: true },
      ],
      effects: ['effect.patrol_reported'],
      artifacts: [],
      constraints: [
        {
          type: 'resource_policy',
          identifierAuthority: 'public_smpp_tool_schema',
          selection: 'exact_value',
          allowedResourceIds: [authority.resourceId],
          downstreamResourceBinding: 'forbidden',
        },
        provider as JsonObject,
        {
          type: 'exact_skill_version',
          skillId: 'embodied.area_patrol',
          skillVersion,
          taskType: 'embodied.area_patrol',
        },
        {
          type: 'confirmation_policy',
          required: true,
          stage: 'before_execution',
          autoConfirmPlan: false,
        },
        {
          type: 'composed_side_effect_policy',
          sideEffecting: true,
          exactChildConfirmationRequired: true,
          replay: 'forbidden',
        },
        {
          type: 'composition_authority_policy',
          version: 1,
          children,
          maximumSubregions: 1,
          requiredTrajectory: 'retained_actual_navigation',
        },
        {
          type: 'runtime_execution_mode_policy',
          mode: c.runtimeExecutionContext?.mode ?? 'live',
          ...(c.runtimeExecutionContext?.simulationId === undefined
            ? {}
            : { simulationId: c.runtimeExecutionContext.simulationId }),
        },
      ],
      supportedModes: ['plan_confirmed', 'composition'],
      riskLevel: 'medium',
      status: 'draft',
      createdBy: 'ugv-area-patrol-governance-driver',
      createdAt: new Date().toISOString(),
    });
  const candidate = proposed(oldCapability?.version ?? 1);
  const reuse = oldCapability?.definitionHash === candidate.definitionHash;
  const capabilityVersion = reuse ? oldCapability.version : (oldCapability?.version ?? 0) + 1;
  const definition = proposed(capabilityVersion);
  let capability = reuse
    ? oldCapability
    : capabilitySchema.parse(
        await controlCreate(
          c,
          '/api/v1/node-capabilities',
          `${c.runId}:patrol:capability-v${String(capabilityVersion)}`,
          definition,
          request,
        ),
      );
  if (!reuse)
    await controlCreate(
      c,
      `/api/v1/node-capabilities/embodied.area_patrol/versions/${String(capabilityVersion)}/implementations`,
      `${c.runId}:patrol:implementation-v${String(capabilityVersion)}`,
      {
        bindingId: `capability-binding-embodied.area_patrol-v${String(capabilityVersion)}`,
        capabilityId: 'embodied.area_patrol',
        capabilityVersion,
        implementationType: 'skill',
        implementationId: 'embodied.area_patrol',
        implementationVersion: String(skillVersion),
        role: 'primary',
        priority: 0,
        providerPolicyOverride: {
          selection: 'required',
          mcpProviderBindingId: c.bindingId,
          localServerId: provider['localServerId'],
          mcpToolName: 'vehicle_inspect_area',
          allowedResourceIds: [authority.resourceId],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
        status: 'active',
        revision: 1,
      },
      request,
    );
  for (const action of ['validate', 'publish'] as const)
    if (
      (action === 'validate' && capability.status === 'draft') ||
      (action === 'publish' && capability.status !== 'published')
    ) {
      const result = await controlMutation(
        c,
        `/api/v1/node-capabilities/embodied.area_patrol/versions/${String(capabilityVersion)}/${action}`,
        `${c.runId}:patrol:${action}-v${String(capabilityVersion)}`,
        { reason: 'Validate/publish exact governed patrol composition.' },
        nodeCapabilityEtag(capability),
        action === 'publish' ? 202 : 200,
        request,
      );
      if (action === 'publish') {
        operation.parse(result);
        capability = capabilitySchema.parse(
          await controlGet(
            c,
            `/api/v1/node-capabilities/embodied.area_patrol/versions/${String(capabilityVersion)}`,
            request,
          ),
        );
        if (
          capability.status !== 'published' ||
          capability.definitionHash !== definition.definitionHash
        )
          throw Error('PATROL_CAPABILITY_PUBLICATION_NOT_EXACT');
      } else capability = capabilitySchema.parse(result);
    }
  const graph = z
    .object({ items: z.array(object) })
    .loose()
    .parse(await runtimeGet('/api/v1/skill-graph')).items;
  for (const child of children)
    if (
      !graph.some(
        (entry) =>
          entry['sourceSkillId'] === 'embodied.area_patrol' &&
          entry['targetSkillId'] === child['skillId'] &&
          entry['relationType'] === 'parent_child' &&
          canonical(entry['metadata']) ===
            canonical({
              governedCapability: child['capabilityId'],
              capabilityVersion: child['capabilityVersion'],
              parentSkillVersion: skillVersion,
              childSkillVersion: child['skillVersion'],
            }),
      )
    ) {
      const response = await request(c.runtimeManagementBaseUrl + '/api/v1/skill-graph/relations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSkillId: 'embodied.area_patrol',
          targetSkillId: child['skillId'],
          relationType: 'parent_child',
          metadata: {
            governedCapability: child['capabilityId'],
            capabilityVersion: child['capabilityVersion'],
            parentSkillVersion: skillVersion,
            childSkillVersion: child['skillVersion'],
          },
        }),
        redirect: 'manual',
      });
      if (response.status !== 201) throw Error('PATROL_COMPOSITION_RELATION_REJECTED');
    }
  let ready = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const readiness = z
      .object({
        status: z.string(),
        availableImplementations: z.array(z.string()),
        unavailableImplementations: z.array(z.string()),
        reasons: z.array(z.object({ code: z.string() }).loose()),
      })
      .loose()
      .parse(
        await command(
          `/api/v1/capability-readiness/embodied.area_patrol/${String(capabilityVersion)}/evaluate`,
          `readiness-v${String(capabilityVersion)}-${String(attempt)}`,
          { reason: 'Evaluate exact admitted patrol child composition.' },
        ),
      );
    if (
      readiness.status === 'available' &&
      readiness.availableImplementations.length === 1 &&
      readiness.availableImplementations[0] ===
        `capability-binding-embodied.area_patrol-v${String(capabilityVersion)}` &&
      readiness.unavailableImplementations.length === 0
    ) {
      ready = true;
      break;
    }
    if (
      attempt === 0 &&
      readiness.reasons.some((reason) => reason.code === 'READINESS_STABILITY_WINDOW')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10250));
      continue;
    }
    throw Error('PATROL_READINESS_NOT_AVAILABLE:' + JSON.stringify(readiness.reasons));
  }
  if (!ready) throw Error('PATROL_READINESS_NOT_AVAILABLE');
  const prior = exposures
    .filter((entry) => entry.exposureId === 'a2a.embodied.area_patrol')
    .sort((a, b) => b.version - a.version)[0];
  const exposureFor = (version: number) =>
    createA2aExposureVersion({
      exposureId: 'a2a.embodied.area_patrol',
      version,
      capabilityId: 'embodied.area_patrol',
      capabilityVersion,
      agentSkillId: 'embodied.area_patrol',
      name: 'Governed area patrol',
      description: String(skill['summary']),
      tags: ['ugv', 'area-patrol', 'governed-composition'],
      examples: ['Patrol one authorized WGS84 subregion within its time window.'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      requestSchema: definition.inputSchema,
      resultSchema: definition.outputSchema,
      visibility: 'public',
      requesterPolicy: {
        allowAnonymous: true,
        requiredAuthorities: ['plan_confirmation', 'physical_control.confirm'],
      },
      readinessPublicationPolicy: 'publish_when_available',
      status: 'draft',
    });
  const exposureCandidate = exposureFor(prior?.version ?? 1),
    exposureSame = prior?.exposureHash === exposureCandidate.exposureHash;
  const exposureVersion = exposureSame ? prior.version : (prior?.version ?? 0) + 1,
    proposedExposure = exposureFor(exposureVersion);
  let exposure = exposureSame
    ? prior
    : exposureSchema.parse(
        await controlCreate(
          c,
          '/api/v1/a2a-exposures',
          `${c.runId}:patrol:exposure-v${String(exposureVersion)}`,
          proposedExposure,
          request,
        ),
      );
  if (exposure.status !== 'published')
    exposure = exposureSchema.parse(
      operation.parse(
        await controlMutation(
          c,
          `/api/v1/a2a-exposures/a2a.embodied.area_patrol/versions/${String(exposureVersion)}/publish`,
          `${c.runId}:patrol:exposure-publish-v${String(exposureVersion)}`,
          { reason: 'Publish exact governed patrol composition.' },
          a2aExposureEtag(exposure),
          202,
          request,
        ),
      ).result,
    );
  if (exposure.status !== 'published' || exposure.exposureHash !== proposedExposure.exposureHash)
    throw Error('PATROL_PUBLISHED_EXPOSURE_NOT_EXACT');
  for (const old of exposures.filter(
    (e) =>
      e.exposureId === exposure.exposureId &&
      e.version !== exposure.version &&
      e.status === 'published',
  ))
    operation.parse(
      await controlMutation(
        c,
        `/api/v1/a2a-exposures/${old.exposureId}/versions/${String(old.version)}/suspend`,
        `${c.runId}:patrol:withdraw-v${String(old.version)}`,
        { reason: 'Withdraw superseded public patrol authority while retaining version history.' },
        a2aExposureEtag(old),
        202,
        request,
      ),
    );
  await command('/api/v1/a2a-agent-card-revisions/rebuild', `card-v${String(exposureVersion)}`, {
    reason: 'Activate inspection and the exact governed patrol successor.',
  });
  return {
    status: 'passed',
    skillId: 'embodied.area_patrol',
    skillVersion,
    capabilityVersion,
    exposureVersion,
    children,
    physicalToolInvocationCount: 0,
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value !== null)
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
