import type { SkillCompositionInputMappingPolicy } from '../../application/src/skill-composition.js';
import { ZMQ_PATROL_SKILL, ZMQ_PATROL_CHILDREN } from '../../domain/src/zmq-area-patrol.js';
import {
  buildZmqPatrolSkill,
  parseZmqPatrolChildren,
} from '../../domain/src/zmq-patrol-contract.js';
import { explicitProviderJsonDictionaries } from '../../domain/src/schema-json-dictionaries.js';
import type { McpTool, ZmqNativeTool } from '../../domain/src/index.js';
import { reviewedZmqCatalog } from './zmq-catalogs.js';
import { ZmqSiteStaticAuthoritySchema, type ZmqSiteStaticAuthority } from './zmq-site-profile.js';
import { buildNativeZmqSkill } from './zmq-skill.js';
import { zmqContractChecksum } from './zmq-provider-profile.js';
const record = (v: unknown): v is Readonly<Record<string, unknown>> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Reifies only the checked-in native contract; discovered data never supplies executable adapters. */
export function reviewedNativeZmqTool(
  authority: ZmqSiteStaticAuthority,
  name: ZmqNativeTool,
): McpTool {
  const t = reviewedZmqCatalog(authority.catalogProfile).tools.find((t) => t.name === name);
  if (!t) throw Error('ZMQ_PATROL_CHILD_TOOL_UNREVIEWED');
  const semantics = t._meta['io.sdar/tool-execution-semantics'];
  if (!record(semantics)) throw Error('ZMQ_PATROL_CHILD_SEMANTICS_INVALID');
  const inputSchema = structuredClone(t.inputSchema);
  if (
    !record(inputSchema) ||
    !record(inputSchema['properties']) ||
    !record(inputSchema['properties']['resourceId'])
  )
    throw Error('ZMQ_PATROL_CHILD_SCHEMA_INVALID');
  const schema = {
    ...inputSchema,
    properties: {
      ...inputSchema['properties'],
      resourceId: { ...inputSchema['properties']['resourceId'], const: authority.resourceId },
    },
  };
  // These types come solely from the two checked-in, exact reviewed catalog snapshots.
  return {
    serverId: authority.localServerId,
    toolName: name,
    inputSchema: schema,
    outputSchema: t.outputSchema,
    protocolMode: 'frozen_v1',
    taskExecutionProfile: t._meta['io.sdar/taskExecution'],
    executionSemantics: { ...semantics, source: 'mcp_declared' },
    discoveredAt: '2026-10-28T00:00:00.000Z',
  } as McpTool;
}

/** Exact named deterministic translation, assessed before generic declarative mapping checks. */
export const nativeZmqPatrolInputMappingPolicy: SkillCompositionInputMappingPolicy = (
  parent,
  child,
  mappings,
) => {
  if (parent.skillId !== ZMQ_PATROL_SKILL) return undefined;
  try {
    const goal = parent.outcomeSpecification?.taskGoalPolicy,
      childGoal = child.outcomeSpecification?.taskGoalPolicy;
    const provider = goal?.['providerBinding'];
    if (!goal || !childGoal || !record(provider) || typeof goal['resourceId'] !== 'string')
      return false;
    const children = parseZmqPatrolChildren(goal['children']);
    if (
      !ZMQ_PATROL_CHILDREN.some((id) => id === child.skillId) ||
      !children.some((c) => c.skillId === child.skillId && c.skillVersion === child.version)
    )
      return false;
    const expectedParent = buildZmqPatrolSkill(
      goal['resourceId'],
      parent.version,
      provider,
      children,
    );
    for (const key of [
      'inputSchema',
      'outputSchema',
      'toolPolicy',
      'runtimePolicy',
      'usageSpecification',
      'outcomeSpecification',
    ] as const)
      if (zmqContractChecksum(parent[key]) !== zmqContractChecksum(expectedParent[key]))
        return false;
    const declared = parent.usageSpecification?.composition?.fixedDependencies.find(
      (d) => d.skillId === child.skillId,
    );
    if (!declared || zmqContractChecksum(mappings) !== zmqContractChecksum(declared.inputMappings))
      return false;
    const keys = [
      'catalogProfile',
      'bindingId',
      'providerId',
      'resourceId',
      'localServerId',
      'bindingRevision',
      'catalogRevision',
      'catalogChecksum',
      'executionMode',
      'simulationId',
      'originType',
      'smppSourceId',
      'externalServerId',
      'registryRevision',
      'registryChecksum',
    ];
    const authority = ZmqSiteStaticAuthoritySchema.parse(
      Object.fromEntries(
        keys.filter((k) => childGoal[k] !== undefined).map((k) => [k, childGoal[k]]),
      ),
    );
    if (
      authority.catalogProfile !== 'zmq_v1_2_0_site_control_13' ||
      authority.resourceId !== goal['resourceId'] ||
      [
        ['bindingId', 'mcpProviderBindingId'],
        ['localServerId', 'localServerId'],
        ['bindingRevision', 'bindingRevision'],
        ['catalogRevision', 'catalogRevision'],
        ['catalogChecksum', 'catalogChecksum'],
      ].some(([a, p]) => authority[a as keyof typeof authority] !== provider[p ?? ''])
    )
      return false;
    if (
      authority.originType === 'smpp_registry' &&
      (authority.registryRevision !== provider['registryRevision'] ||
        authority.registryChecksum !== provider['registryChecksum'])
    )
      return false;
    const name =
      child.skillId === ZMQ_PATROL_CHILDREN[0]
        ? 'vehicle_zmq_navigate'
        : 'vehicle_zmq_inspect_area';
    const expectedChild = buildNativeZmqSkill(
      authority,
      name,
      reviewedNativeZmqTool(authority, name),
      child.version,
    );
    const expected = {
      ...expectedChild,
      outputSchema: explicitProviderJsonDictionaries(
        expectedChild.outputSchema as Readonly<Record<string, unknown>>,
      ),
    };
    return (
      [
        'inputSchema',
        'outputSchema',
        'toolPolicy',
        'runtimePolicy',
        'usageSpecification',
        'outcomeSpecification',
      ] as const
    ).every((key) => zmqContractChecksum(child[key]) === zmqContractChecksum(expected[key]));
  } catch {
    return false;
  }
};
