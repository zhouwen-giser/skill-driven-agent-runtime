import {
  ZMQ_PATROL_SKILL,
  ZMQ_PATROL_CAPABILITY,
  ZMQ_PATROL_CHILDREN,
} from '../../../packages/domain/src/zmq-area-patrol.js';
import {
  buildZmqPatrolSkill,
  parseZmqPatrolChildren,
  zmqPatrolConstraints,
  ZMQ_PATROL_SUCCESS_CRITERIA,
  ZMQ_PATROL_REQUIRED_EVIDENCE,
} from '../../../packages/domain/src/zmq-patrol-contract.js';
import {
  materializeZmqSiteProvider,
  type ZmqSiteMaterializationConfiguration,
} from './zmq-site-materialization.js';
import type { ZmqSiteAuthority } from '../../../packages/ugv-profile/src/zmq-site-profile.js';
import { reviewedZmqCatalog } from '../../../packages/ugv-profile/src/zmq-catalogs.js';
import type { ZmqConsumerAuthority } from '../../../packages/ugv-profile/src/zmq-provider-profile.js';
import type { McpTool, ZmqNativeTool } from '../../../packages/domain/src/index.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import {
  SkillPackageImporter,
  SkillPackageValidator,
  canonicalHash,
} from '../../../packages/application/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';
import {
  ZMQ_NATIVE_TOOLS,
  ZMQ_NATIVE_CONTROLS,
  zmqCapabilityId,
  zmqSkillId,
  type SkillVersion,
} from '../../../packages/domain/src/index.js';
import {
  buildNativeZmqSkill,
  ZMQ_REPORT_EVIDENCE,
  ZMQ_SKILL_CREATED_AT,
} from '../../../packages/ugv-profile/src/zmq-skill.js';
import {
  createNodeCapabilityDefinition,
  createA2aExposureVersion,
  nodeCapabilityEtag,
  a2aExposureEtag,
  type JsonObject,
} from '../../../packages/node-control-domain/src/index.js';
import { explicitProviderJsonDictionaries } from './provider-json-schema.js';
import {
  materializeZmqProvider,
  type ZmqProviderMaterializationConfiguration,
} from './zmq-provider-materialization.js';
import {
  controlGet,
  controlCommand,
  controlCreate,
  controlMutation,
} from './ugv-smpp-capability-governance-driver.js';

const object = z.record(z.string(), z.unknown());
const operation = z.object({ status: z.literal('succeeded'), result: z.unknown() }).loose();
const skillSchema = z
  .object({ skillId: z.string(), version: z.number().int().positive(), status: z.string() })
  .loose();
const capabilitySchema = z
  .object({
    capabilityId: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
    definitionHash: z.string(),
  })
  .loose();
const exposureSchema = z
  .object({
    exposureId: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['draft', 'published', 'suspended', 'retired']),
    exposureHash: z.string(),
  })
  .loose();

/** Existing Node Control CAS/import/publish APIs own every mutation. This entry is loopback simulation only. */
export async function governNativeZmqSkills(
  c: ZmqProviderMaterializationConfiguration & Readonly<{ packageWorkspaceRoot: string }>,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
    pause?: (ms: number) => Promise<void>;
  }> = {},
) {
  return governZmqSkillSet(c, () => materializeZmqProvider(c, dependencies), dependencies);
}

export async function governSiteZmqSkills(
  c: ZmqSiteMaterializationConfiguration & Readonly<{ packageWorkspaceRoot: string }>,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
    pause?: (ms: number) => Promise<void>;
  }> = {},
) {
  return governZmqSkillSet(c, () => materializeZmqSiteProvider(c, dependencies), dependencies);
}
async function governZmqSkillSet(
  c: Readonly<{
    nodeControlBaseUrl: string;
    nodeControlBearerToken: string;
    runtimeManagementBaseUrl: string;
    packageWorkspaceRoot: string;
    runId: string;
  }>,
  materialize: () => Promise<
    Readonly<{
      candidate: Readonly<{ authority: ZmqConsumerAuthority | ZmqSiteAuthority }>;
      tools: readonly McpTool[];
    }>
  >,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
    pause?: (ms: number) => Promise<void>;
  }>,
) {
  if (!isAbsolute(c.packageWorkspaceRoot)) throw Error('ZMQ_PACKAGE_WORKSPACE_MUST_BE_ABSOLUTE');
  const request = dependencies.fetch ?? fetch;
  const materialized = await materialize(),
    a = materialized.candidate.authority;
  const profile = 'catalogProfile' in a ? a.catalogProfile : undefined;
  const packageSchema: unknown = JSON.parse(
    await readFile('schemas/skill-package.schema.json', 'utf8'),
  );
  const importer = new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({ schemas: new AjvJsonSchemaValidator(), packageSchema }),
    clock: { now: dependencies.now ?? (() => new Date().toISOString()) },
  });
  const runtimeGet = async (path: string, missing = false): Promise<unknown> => {
    const response = await request(c.runtimeManagementBaseUrl + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (missing && response.status === 404) return { items: [] };
    if (!response.ok) throw Error('ZMQ_GOVERNANCE_RUNTIME_READ_FAILED');
    return response.json();
  };
  const command = async (path: string, key: string, body: unknown) =>
    operation.parse(await controlCommand(c, path, `${c.runId}:zmq:${key}`, body, request)).result;
  const capabilities = z
    .object({ items: z.array(capabilitySchema), nextCursor: z.null().optional() })
    .loose()
    .parse(await controlGet(c, '/api/v1/node-capabilities?pageSize=1000', request)).items;
  const exposures = z
    .object({ items: z.array(exposureSchema), nextCursor: z.null().optional() })
    .loose()
    .parse(await controlGet(c, '/api/v1/a2a-exposures?pageSize=1000', request)).items;
  const published: {
    skillId: string;
    skillVersion: number;
    capabilityId: string;
    capabilityVersion: number;
    exposureId: string;
    exposureVersion: number;
  }[] = [];
  const nativeNames: readonly ZmqNativeTool[] = profile
    ? reviewedZmqCatalog(profile)
        .tools.filter(
          (t) => profile !== 'zmq_v1_1_0_readonly_13' || !ZMQ_NATIVE_CONTROLS.has(t.name),
        )
        .map((t) => t.name as ZmqNativeTool)
    : ZMQ_NATIVE_TOOLS;
  const names = [
    ...nativeNames,
    ...(profile === 'zmq_v1_2_0_site_control_13' ? ['area_patrol' as const] : []),
  ];
  for (const name of names) {
    const patrol = name === 'area_patrol';
    const toolName = patrol ? 'vehicle_zmq_inspect_area' : name;
    const tool = materialized.tools.find((t) => t.toolName === toolName);
    if (!tool) throw Error('ZMQ_GOVERNANCE_TOOL_MISSING');
    const skillId = patrol ? ZMQ_PATROL_SKILL : zmqSkillId(toolName),
      capabilityId = patrol ? ZMQ_PATROL_CAPABILITY : zmqCapabilityId(toolName),
      exposureId = `a2a.${capabilityId}`,
      control = patrol || ZMQ_NATIVE_CONTROLS.has(toolName);
    const provider = {
      type: 'provider_binding_policy',
      mcpProviderBindingId: a.bindingId,
      localServerId: a.localServerId,
      mcpToolName: toolName,
      allowedResourceIds: [a.resourceId],
      bindingRevision: a.bindingRevision,
      ...('registryRevision' in a
        ? { registryRevision: a.registryRevision, registryChecksum: a.registryChecksum }
        : {}),
      catalogRevision: a.catalogRevision,
      catalogChecksum: a.catalogChecksum,
      taskBehavior: tool.taskExecutionProfile?.taskBehavior,
      executionSemantics: { ...tool.executionSemantics },
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    };
    const children = patrol
      ? parseZmqPatrolChildren(
          ZMQ_PATROL_CHILDREN.map((id) => {
            const child = published.find((entry) => entry.skillId === id);
            if (!child) throw Error('ZMQ_PATROL_CHILD_PUBLICATION_MISSING');
            return child;
          }),
        )
      : [];
    const versions = z
      .object({ items: z.array(skillSchema) })
      .loose()
      .parse(await runtimeGet(`/api/v1/skills/${skillId}/versions`, true)).items;
    const latest = versions.sort((x, y) => y.version - x.version)[0];
    const buildSkill = (version: number) => {
      const built = patrol
        ? buildZmqPatrolSkill(a.resourceId, version, provider, children)
        : buildNativeZmqSkill(a, toolName, tool, version);
      // All source values are validated JSON schemas; dictionaries stay finite JSON data.
      return {
        ...built,
        outputSchema: explicitProviderJsonDictionaries(built.outputSchema as JsonObject),
      };
    };
    const same = latest !== undefined && sameContract(latest, buildSkill(latest.version));
    if (same && !['draft', 'enabled'].includes(latest.status))
      throw Error('ZMQ_SKILL_LIFECYCLE_REQUIRES_REVIEW');
    const skillVersion = same ? latest.version : (latest?.version ?? 0) + 1,
      skill = buildSkill(skillVersion);
    const packageRoot = join(c.packageWorkspaceRoot, skillId, `v${String(skillVersion)}`);
    await writeNativeZmqPackage(packageRoot, skill);
    const checked = await importer.import(packageRoot);
    if (!sameContract(checked.skillVersion, skill))
      throw Error('ZMQ_PACKAGE_IMPORT_CONTRACT_MISMATCH');
    if (!same)
      await command('/api/v1/skills/import', `${name}:import:${String(skillVersion)}`, {
        reason: `Import the exact native ZMQ Skill contract for ${profile ?? 'isolated simulation'}.`,
        payload: { packageRoot },
      });
    if (!same || latest.status === 'draft')
      await command(
        `/api/v1/skills/${skillId}/versions/${String(skillVersion)}/publish`,
        `${name}:skill-publish:${String(skillVersion)}`,
        {
          reason: `Publish the exact native Skill for ${profile ?? 'isolated simulation'}.`,
          expectedRevision: 0,
        },
      );
    const enabled = z
      .object({ items: z.array(skillSchema) })
      .loose()
      .parse(await runtimeGet(`/api/v1/skills/${skillId}/versions`))
      .items.sort((x, y) => y.version - x.version)[0];
    if (enabled?.status !== 'enabled' || !sameContract(enabled, skill))
      throw Error('ZMQ_SKILL_PUBLICATION_NOT_EXACT');
    const prior = capabilities
      .filter((e) => e.capabilityId === capabilityId)
      .sort((x, y) => y.version - x.version)[0];
    const capabilityFor = (version: number) =>
      createNodeCapabilityDefinition({
        capabilityId,
        version,
        ...(version === 1 ? {} : { previousVersion: version - 1 }),
        domain: 'vehicle.ugv.zmq',
        name: skill.name,
        description: skill.summary,
        inputSchema: skill.inputSchema as JsonObject,
        outputSchema: skill.outputSchema,
        effects: [...(skill.outcomeSpecification?.effects ?? [])],
        artifacts: [],
        successCriteria: patrol
          ? ([...ZMQ_PATROL_SUCCESS_CRITERIA] as JsonObject[])
          : [
              { type: 'output_schema_valid', required: true },
              { type: 'resource_identity_matches_request', required: true },
              { type: 'zmq_report_outcome', required: true, incompleteOutcome: 'degraded' },
              { type: 'required_evidence_complete', required: true },
              { type: 'mcp_acceptance_is_terminal_success', value: false },
              ...(control
                ? [
                    { type: 'remote_task_identity_present', required: true },
                    { type: 'remote_terminal_observation_present', required: true },
                    { type: 'external_command_dispatch_count', minimum: 1, maximum: 1 },
                  ]
                : [{ type: 'normalized_observation_present', required: true }]),
            ],
        requiredEvidence: patrol
          ? ([...ZMQ_PATROL_REQUIRED_EVIDENCE] as JsonObject[])
          : control
            ? [
                {
                  type: 'required_evidence',
                  requirementId: 'native-report',
                  evidenceType: ZMQ_REPORT_EVIDENCE,
                  required: true,
                  hardGate: true,
                },
              ]
            : [
                {
                  type: 'provider_result',
                  requirementId: 'native-report',
                  field: 'providerResult',
                  inputField: 'resourceId',
                  serverId: a.localServerId,
                  toolName: name,
                  evidenceType: ZMQ_REPORT_EVIDENCE,
                  required: true,
                  hardGate: true,
                },
              ],
        constraints: patrol
          ? (zmqPatrolConstraints(a.resourceId, skillVersion, provider, children) as JsonObject[])
          : [
              provider as JsonObject,
              {
                type: 'resource_policy',
                identifierAuthority: 'public_smpp_tool_schema',
                selection: 'exact_value',
                allowedResourceIds: [a.resourceId],
                downstreamResourceBinding: 'forbidden',
              },
              {
                type: 'zmq_input_adapter',
                version: profile ? 2 : 1,
                toolName: name,
                maxElapsedMs: 300000,
                ...(profile ? { catalogProfile: profile } : {}),
              },
              {
                type: 'runtime_execution_mode_policy',
                mode: profile ? 'live' : 'simulation',
                ...(profile ? {} : { simulationId: a.simulationId }),
              },
              { type: 'exact_skill_version', skillId, skillVersion, taskType: name },
              {
                type: 'confirmation_policy',
                required: control,
                stage: control ? 'before_execution' : 'not_applicable',
                authorityKind: 'physical_control',
                autoConfirmPlan: !control,
              },
              ...(control
                ? [
                    {
                      type: 'physical_side_effect_policy',
                      sideEffecting: true,
                      dispatchMaximum: 1,
                      uncertainDispatchPolicy: 'reconcile_never_redispatch',
                      remoteTaskTerminalEvidenceRequired: true,
                    },
                  ]
                : [{ type: 'side_effect_policy', sideEffecting: false }]),
            ],
        supportedModes: patrol
          ? ['plan_confirmed', 'composition']
          : control
            ? ['plan_confirmed', 'remote_task']
            : ['deterministic'],
        riskLevel: control ? 'high' : 'low',
        status: 'draft',
        createdBy: 'native-zmq-governance',
        createdAt: ZMQ_SKILL_CREATED_AT,
      });
    const reuse = prior?.definitionHash === capabilityFor(prior?.version ?? 1).definitionHash;
    if (reuse && !['draft', 'validating', 'published'].includes(prior.status))
      throw Error('ZMQ_CAPABILITY_LIFECYCLE_REQUIRES_REVIEW');
    const capabilityVersion = reuse ? prior.version : (prior?.version ?? 0) + 1,
      definition = capabilityFor(capabilityVersion),
      path = `/api/v1/node-capabilities/${capabilityId}/versions/${String(capabilityVersion)}`;
    let capability = reuse
      ? prior
      : capabilitySchema.parse(
          await controlCreate(
            c,
            '/api/v1/node-capabilities',
            `${c.runId}:zmq:${name}:capability:${String(capabilityVersion)}`,
            definition,
            request,
          ),
        );
    const implementation = {
      bindingId: `capability-binding-${capabilityId}-v${String(capabilityVersion)}`,
      capabilityId,
      capabilityVersion,
      implementationType: 'skill',
      implementationId: skillId,
      implementationVersion: String(skillVersion),
      role: 'primary',
      priority: 0,
      providerPolicyOverride: {
        selection: 'required',
        mcpProviderBindingId: a.bindingId,
        localServerId: a.localServerId,
        mcpToolName: toolName,
        allowedResourceIds: [a.resourceId],
        requireActive: true,
        requireAvailable: true,
        requireUnexpiredFreshness: true,
        denyFallback: true,
      },
      status: 'active',
      revision: 1,
    };
    if (!reuse)
      await controlCreate(
        c,
        path + '/implementations',
        `${c.runId}:zmq:${name}:implementation:${String(capabilityVersion)}`,
        implementation,
        request,
      );
    const implementations = z
      .object({ items: z.array(object) })
      .loose()
      .parse(await controlGet(c, path + '/implementations', request)).items;
    if (
      implementations.length !== 1 ||
      canonicalHash(implementations[0]) !== canonicalHash(implementation)
    )
      throw Error('ZMQ_IMPLEMENTATION_BINDING_NOT_EXACT');
    for (const action of ['validate', 'publish'] as const) {
      if (
        (action === 'validate' && capability.status !== 'draft') ||
        (action === 'publish' && capability.status === 'published')
      )
        continue;
      const response = await controlMutation(
        c,
        path + '/' + action,
        `${c.runId}:zmq:${name}:${action}:${String(capabilityVersion)}`,
        { reason: 'Validate/publish the exact isolated native ZMQ contract.' },
        nodeCapabilityEtag(capability),
        action === 'publish' ? 202 : 200,
        request,
      );
      if (action === 'publish') operation.parse(response);
      capability = capabilitySchema.parse(
        action === 'publish' ? await controlGet(c, path, request) : response,
      );
    }
    if (
      capability.status !== 'published' ||
      capability.definitionHash !== definition.definitionHash
    )
      throw Error('ZMQ_CAPABILITY_PUBLICATION_NOT_EXACT');
    for (let attempt = 0; ; attempt++) {
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
            `/api/v1/capability-readiness/${capabilityId}/${String(capabilityVersion)}/evaluate`,
            `${name}:readiness:${String(attempt)}:${String(capabilityVersion)}`,
            { reason: 'Evaluate exact current native Skill and Provider authority.' },
          ),
        );
      if (
        readiness.status === 'available' &&
        readiness.availableImplementations.length === 1 &&
        readiness.availableImplementations[0] === implementation.bindingId &&
        readiness.unavailableImplementations.length === 0
      )
        break;
      if (attempt !== 0 || !readiness.reasons.some((r) => r.code === 'READINESS_STABILITY_WINDOW'))
        throw Error('ZMQ_CAPABILITY_NOT_READY:' + readiness.reasons.map((r) => r.code).join(','));
      await (dependencies.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
        10250,
      );
    }
    const oldExposure = exposures
      .filter((e) => e.exposureId === exposureId)
      .sort((x, y) => y.version - x.version)[0];
    const exposureFor = (version: number) =>
      createA2aExposureVersion({
        exposureId,
        version,
        capabilityId,
        capabilityVersion,
        agentSkillId: skillId,
        name: skill.name,
        description: skill.summary,
        tags: ['ugv', 'zmq', profile ?? 'isolated-simulation'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
        requestSchema: definition.inputSchema,
        resultSchema: definition.outputSchema,
        visibility: 'public',
        requesterPolicy: {
          allowAnonymous: true,
          requiredAuthorities: control ? ['plan_confirmation', 'physical_control.confirm'] : [],
        },
        readinessPublicationPolicy: 'publish_when_available',
        status: 'draft',
      });
    const exposureReuse =
      oldExposure?.exposureHash === exposureFor(oldExposure?.version ?? 1).exposureHash;
    if (exposureReuse && !['draft', 'published'].includes(oldExposure.status))
      throw Error('ZMQ_EXPOSURE_LIFECYCLE_REQUIRES_REVIEW');
    const exposureVersion = exposureReuse ? oldExposure.version : (oldExposure?.version ?? 0) + 1,
      exposureDefinition = exposureFor(exposureVersion);
    let exposure = exposureReuse
      ? oldExposure
      : exposureSchema.parse(
          await controlCreate(
            c,
            '/api/v1/a2a-exposures',
            `${c.runId}:zmq:${name}:exposure:${String(exposureVersion)}`,
            exposureDefinition,
            request,
          ),
        );
    if (exposure.status !== 'published')
      exposure = exposureSchema.parse(
        operation.parse(
          await controlMutation(
            c,
            `/api/v1/a2a-exposures/${exposureId}/versions/${String(exposureVersion)}/publish`,
            `${c.runId}:zmq:${name}:exposure-publish:${String(exposureVersion)}`,
            { reason: `Publish the native ZMQ exposure for ${profile ?? 'isolated simulation'}.` },
            a2aExposureEtag(exposure),
            202,
            request,
          ),
        ).result,
      );
    if (
      exposure.status !== 'published' ||
      exposure.exposureHash !== exposureDefinition.exposureHash
    )
      throw Error('ZMQ_EXPOSURE_PUBLICATION_NOT_EXACT');
    for (const previous of exposures.filter(
      (e) =>
        e.exposureId === exposureId && e.version !== exposureVersion && e.status === 'published',
    )) {
      const current = exposureSchema.parse(
        await controlGet(
          c,
          `/api/v1/a2a-exposures/${exposureId}/versions/${String(previous.version)}`,
          request,
        ),
      );
      if (current.status !== 'published') continue;
      const withdrawn = exposureSchema.parse(
        operation.parse(
          await controlMutation(
            c,
            `/api/v1/a2a-exposures/${exposureId}/versions/${String(previous.version)}/suspend`,
            `${c.runId}:zmq:${name}:superseded-exposure:${String(previous.version)}`,
            { reason: 'Withdraw the superseded native exposure; preserve its immutable history.' },
            a2aExposureEtag(current),
            202,
            request,
          ),
        ).result,
      );
      if (withdrawn.status !== 'suspended') throw Error('ZMQ_SUPERSEDED_EXPOSURE_STILL_PUBLISHED');
    }
    if (patrol) {
      const graph = z
        .object({ items: z.array(object) })
        .loose()
        .parse(await runtimeGet('/api/v1/skill-graph')).items;
      for (const child of children) {
        const metadata = {
          governedCapability: child.capabilityId,
          capabilityVersion: child.capabilityVersion,
          parentSkillVersion: skillVersion,
          childSkillVersion: child.skillVersion,
        };
        if (
          graph.some(
            (entry) =>
              entry['sourceSkillId'] === skillId &&
              entry['targetSkillId'] === child.skillId &&
              entry['relationType'] === 'parent_child' &&
              canonicalHash(entry['metadata']) === canonicalHash(metadata),
          )
        )
          continue;
        const response = await request(
          c.runtimeManagementBaseUrl + '/api/v1/skill-graph/relations',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            redirect: 'manual',
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
              sourceSkillId: skillId,
              targetSkillId: child.skillId,
              relationType: 'parent_child',
              metadata,
            }),
          },
        );
        if (response.status !== 201) throw Error('ZMQ_PATROL_COMPOSITION_RELATION_REJECTED');
      }
    }
    published.push({
      skillId,
      skillVersion,
      capabilityId,
      capabilityVersion,
      exposureId,
      exposureVersion,
    });
  }
  const rechecked = await materialize();
  const { validUntil: admittedUntil, ...admittedAuthority } = a;
  const { validUntil: recheckedUntil, ...currentAuthority } = rechecked.candidate.authority;
  void admittedUntil;
  void recheckedUntil;
  if (canonicalHash(admittedAuthority) !== canonicalHash(currentAuthority))
    throw Error('ZMQ_GOVERNANCE_AUTHORITY_CHANGED');
  await command('/api/v1/a2a-agent-card-revisions/rebuild', 'card', {
    reason: `Activate exact native ZMQ exposures for ${profile ?? 'isolated simulation'}.`,
  });
  return {
    schemaVersion: profile ? 'sdar.zmq-skill-governance/2' : 'sdar.zmq-skill-governance/1',
    qualification: profile ?? 'isolated_simulator_only',
    ...(profile ? { authority: rechecked.candidate.authority } : {}),
    published,
    physicalToolInvocationCount: 0,
    fieldDispatchAuthorized: false,
  } as const;
}

function sameContract(
  actual: Readonly<Record<string, unknown>> | SkillVersion,
  expected: SkillVersion,
) {
  const fields = [
    'skillId',
    'version',
    'previousVersion',
    'name',
    'summary',
    'description',
    'capabilities',
    'workflowGuidance',
    'outputInstruction',
    'inputSchema',
    'outputSchema',
    'toolPolicy',
    'runtimePolicy',
    'usageSpecification',
    'outcomeSpecification',
    'sourceKind',
    'validationPassed',
    'createdAt',
  ] as const;
  return (
    canonicalHash(fields.map((key) => actual[key as keyof typeof actual] ?? null)) ===
    canonicalHash(fields.map((key) => expected[key] ?? null))
  );
}

export async function writeNativeZmqPackage(root: string, skill: SkillVersion) {
  const usage = skill.usageSpecification;
  if (!usage || !isAbsolute(root)) throw Error('ZMQ_SKILL_PACKAGE_INVALID');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const documents = {
    normative: {
      visibility: usage.visibility,
      normative: usage.normative,
      contextRequirements: usage.contextRequirements,
      taskBindings: usage.taskBindings,
    },
    adaptive: { adaptive: usage.adaptive },
    modes: usage.modes,
    evidence: usage.evidencePolicy,
    ...(usage.composition ? { composition: usage.composition } : {}),
  };
  const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
  const files: Record<string, { path: string; sha256: string }> = {};
  for (const [key, value] of Object.entries(documents)) {
    const bytes = stableDocument(value);
    files[key] = { path: key + '.json', sha256: digest(bytes) };
    await writeExact(join(root, key + '.json'), bytes);
  }
  const markdown = `# ${skill.name}\n\n${skill.description}\n\n${skill.workflowGuidance}\n`;
  const { usageSpecification, ...manifestSkill } = skill;
  void usageSpecification;
  await writeExact(join(root, 'SKILL.md'), markdown);
  await writeExact(
    join(root, 'manifest.json'),
    stableDocument({
      apiVersion: 'sdar.io/v1alpha1',
      kind: 'SkillPackage',
      skill: manifestSkill,
      skillMarkdownSha256: digest(markdown),
      files,
    }),
  );
}
function stableDocument(value: unknown): string {
  const sorted = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sorted)
      : item !== null && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, sorted(child)]),
          )
        : item;
  return JSON.stringify(sorted(value), null, 2) + '\n';
}
async function writeExact(path: string, bytes: string) {
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    if ((await readFile(path, 'utf8')) !== bytes)
      throw Error('ZMQ_EXISTING_PACKAGE_BYTES_DIFFER', { cause: error });
  }
}
