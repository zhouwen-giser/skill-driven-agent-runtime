import { z } from 'zod';
import { createSkillVersion } from './skill.js';
import { createSkillUsageSpecification } from './skill-usage.js';
import { hashCanonicalEvidenceJson } from './evidence/canonical-evidence.js';
import {
  ZMQ_PATROL_SKILL,
  ZMQ_PATROL_CAPABILITY,
  ZMQ_PATROL_CHILDREN,
  zmqPatrolInputSchema,
} from './zmq-area-patrol.js';

const child = z
  .object({
    skillId: z.string(),
    skillVersion: z.number().int().positive(),
    capabilityId: z.string(),
    capabilityVersion: z.number().int().positive(),
    exposureId: z.string(),
    exposureVersion: z.number().int().positive(),
  })
  .strict();
export type ZmqPatrolChildAuthority = z.infer<typeof child>;
export function parseZmqPatrolChildren(value: unknown) {
  const children = z.array(child).length(2).parse(value);
  for (const [index, item] of children.entries()) {
    const skillId = ZMQ_PATROL_CHILDREN[index];
    if (!skillId) throw Error('ZMQ_PATROL_CHILD_AUTHORITY_INVALID');
    const capabilityId = `vehicle.ugv.zmq.${skillId.slice('ugv.zmq.'.length)}`;
    if (
      item.skillId !== skillId ||
      item.capabilityId !== capabilityId ||
      item.exposureId !== `a2a.${capabilityId}`
    )
      throw Error('ZMQ_PATROL_CHILD_AUTHORITY_INVALID');
  }
  return children;
}
export const ZMQ_PATROL_RUNTIME_POLICY = {
  autoConfirmPlan: false,
  maxReplans: 0,
  maxDurationSeconds: 3600,
  maxMcpCalls: 2,
  maxLlmCalls: 0,
  cancelStrategy: 'try_interrupt',
  pauseReplanThresholdSeconds: 0,
} as const;
export const ZMQ_PATROL_SUCCESS_CRITERIA = [
  { type: 'output_schema_valid', required: true },
  {
    type: 'patrol_report_outcome',
    required: true,
    incompleteOutcome: 'degraded',
    fullSuccessRequires: ['native_child_tasks', 'scoped_inspection_report', 'actual_trajectory'],
  },
] as const;
export const ZMQ_PATROL_REQUIRED_EVIDENCE = [
  {
    type: 'native_patrol_child_reports',
    requirementId: 'native-child-reports',
    evidenceType: 'patrol.report',
    required: true,
  },
] as const;
export function zmqPatrolUsage(value: readonly ZmqPatrolChildAuthority[]) {
  const children = parseZmqPatrolChildren(value);
  return createSkillUsageSpecification({
    apiVersion: 'sdar.io/v1alpha1',
    visibility: { userSelectable: true, composable: true, internalOnly: false },
    normative: {
      constraints: [
        'Navigate to the admitted entry point, confirm native success and stop, then inspect this one region.',
        'Preserve the exact resource, child versions, parent deadline and original Provider evidence.',
      ],
      forbiddenActions: [
        'Replay an uncertain physical action.',
        'Start inspection without confirmed navigation and stop.',
        'Replace actual trajectory or coverage with a requested route.',
        'Switch Provider, region or execution identity.',
      ],
      requiredConfirmations: [
        'Confirm the immutable parent plan including both exact child actions.',
      ],
      noApplicableSkill: 'reject',
    },
    adaptive: {
      instructions: ['Return degraded evidence honestly.'],
      optimizationHints: [],
      allowPreferredProviderFallback: false,
    },
    contextRequirements: [
      {
        requirementId: 'public-resource-id',
        description: 'Exact admitted public resource.',
        required: true,
        sourceOrder: ['authoritative_context'],
      },
      {
        requirementId: 'provider-binding-freshness',
        description: 'Current exact native site Binding.',
        required: true,
        sourceOrder: ['authoritative_context'],
      },
    ],
    taskBindings: [],
    modes: {
      supported: ['procedure'],
      defaultMode: 'procedure',
      procedure: {
        summary: 'Deterministic single-region native patrol.',
        instructions: ['Execute the two admitted child Tasks once in order.'],
      },
    },
    composition: {
      maxDepth: 2,
      capabilitySlots: [],
      fixedDependencies: children.map((c, index) => ({
        dependencyId: index === 0 ? 'navigate-entry' : 'inspect-region',
        skillId: c.skillId,
        skillVersion: c.skillVersion,
        failurePolicy: index === 0 ? 'recoverable' : 'degraded',
        inputMappings: (index === 0
          ? ['resourceId', 'entryPoint', 'speedLimitMps', 'obstacleAvoidance', 'timeWindow']
          : ['resourceId', 'area', 'timeWindow']
        ).map((key) => ({ sourcePath: key, targetPath: key })),
        outputMappings: [
          {
            sourcePath: 'status',
            targetPath: `evidence.${index === 0 ? 'navigation' : 'inspection'}`,
          },
        ],
      })),
    },
    evidencePolicy: {
      rejectSuccessWithoutRequiredEvidence: true,
      requirements: [
        {
          requirementId: 'navigation',
          evidenceType: 'patrol.navigation',
          required: true,
          hardGate: true,
        },
        {
          requirementId: 'inspection',
          evidenceType: 'patrol.inspection',
          required: true,
          hardGate: true,
        },
      ],
    },
  });
}
const strings = { type: 'array', items: { type: 'string' } } as const;
const jsonValue = { $ref: '#/$defs/zmqPatrolJsonValue' } as const;
const jsonObject = { type: 'object', additionalProperties: jsonValue } as const;
export function zmqPatrolOutputSchema(resourceId: string) {
  const properties = {
    schemaVersion: { const: 'sdar.zmq-patrol-report/1' },
    resourceId: { const: resourceId },
    status: { enum: ['completed', 'degraded', 'failed', 'cancelled'] },
    navigationSucceeded: { type: 'boolean' },
    inspectionExecuted: { type: 'boolean' },
    coveredSubregions: strings,
    missingSubregions: strings,
    missingEffects: strings,
    missingEvidence: strings,
    trajectory: { type: 'array', maxItems: 4096, items: jsonObject },
    trajectorySourceRefs: strings,
    anomalies: { type: 'array', maxItems: 256, items: jsonObject },
    childTasks: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'taskId',
          'skillId',
          'skillVersion',
          'status',
          'missingEvidence',
          'mcpTasks',
          'reportRef',
        ],
        properties: {
          taskId: { type: 'string' },
          skillId: { enum: ZMQ_PATROL_CHILDREN },
          skillVersion: { type: 'integer', minimum: 1 },
          status: { enum: ['completed', 'failed', 'canceled', 'unavailable'] },
          missingEvidence: strings,
          reportRef: { type: 'string' },
          mcpTasks: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['taskId', 'executionId', 'providerId', 'operationName'],
              properties: {
                taskId: { type: 'string' },
                executionId: { type: 'string' },
                providerId: { type: 'string' },
                operationName: { type: 'string' },
              },
            },
          },
        },
      },
    },
    inspectionReports: { type: 'array', maxItems: 1, items: jsonObject },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
    $defs: {
      zmqPatrolJsonValue: {
        anyOf: [
          { type: 'null' },
          { type: 'boolean' },
          { type: 'number' },
          { type: 'string' },
          { type: 'array', items: jsonValue },
          jsonObject,
        ],
      },
    },
  };
}
export function zmqPatrolConstraints(
  resourceId: string,
  version: number,
  provider: Readonly<Record<string, unknown>>,
  children: readonly ZmqPatrolChildAuthority[],
) {
  parseZmqPatrolChildren(children);
  return [
    provider,
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: [resourceId],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'exact_skill_version',
      skillId: ZMQ_PATROL_SKILL,
      skillVersion: version,
      taskType: ZMQ_PATROL_SKILL,
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
      version: 2,
      maximumSubregions: 1,
      requiredTrajectory: 'retained_actual_navigation',
      catalogProfile: 'zmq_v1_2_0_site_control_13',
      children,
    },
    { type: 'runtime_execution_mode_policy', mode: 'live' },
  ];
}
export function buildZmqPatrolSkill(
  resourceId: string,
  version: number,
  provider: Readonly<Record<string, unknown>>,
  children: readonly ZmqPatrolChildAuthority[],
) {
  const outcome = {
    schemaVersion: '1.0' as const,
    skillId: ZMQ_PATROL_SKILL,
    skillVersion: version,
    effects: ['effect.patrol_reported'],
    evidence: ['patrol.report'],
    artifacts: [],
    taskGoalPolicy: {
      requestedCapabilityId: ZMQ_PATROL_CAPABILITY,
      resourceId,
      providerBinding: provider,
      catalogProfile: 'zmq_v1_2_0_site_control_13',
      children,
      maximumSubregions: 1,
      maximumChildElapsedMs: 300000,
    },
    confidencePolicy: {
      rejectSuccessWithoutRequiredEvidence: true,
      requireSchemaValidation: true,
      incompleteOutcome: 'degraded',
    },
    sideEffectPolicy: {
      sideEffecting: true,
      confirmation: 'required_before_execution',
      autoConfirmPlan: false,
      exactChildConfirmationRequired: true,
      redispatchAfterUncertain: false,
    },
  };
  return createSkillVersion({
    skillId: ZMQ_PATROL_SKILL,
    version,
    ...(version === 1 ? {} : { previousVersion: version - 1 }),
    name: '无人车 ZMQ 单区域巡逻',
    summary: '先导航至入区点，停稳后执行一次区域检查。',
    description: '使用精确发布的原生导航和检查子任务，保留执行事实、原始来源及完整性缺口。',
    capabilities: [ZMQ_PATROL_CAPABILITY],
    workflowGuidance:
      'Execute exactly navigation then inspection under immutable parent confirmation.',
    outputInstruction:
      'Return retained child task identities, actual evidence and missing subregions.',
    inputSchema: zmqPatrolInputSchema(resourceId),
    outputSchema: zmqPatrolOutputSchema(resourceId),
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: ZMQ_PATROL_RUNTIME_POLICY,
    usageSpecification: zmqPatrolUsage(children),
    outcomeSpecification: { ...outcome, specificationHash: hashCanonicalEvidenceJson(outcome) },
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-10-28T00:00:00.000Z',
  });
}
