import type { ZmqSiteStaticAuthority } from './zmq-site-profile.js';
import {
  createSkillVersion,
  createSkillUsageSpecification,
  hashCanonicalEvidenceJson,
  ZMQ_NATIVE_CONTROLS,
  zmqSkillId,
  zmqCapabilityId,
  type McpTool,
  type ZmqNativeTool,
  type SkillVersion,
} from '../../domain/src/index.js';
import type { ZmqConsumerAuthority } from './zmq-provider-profile.js';

export const ZMQ_REPORT_EVIDENCE = 'ugv.zmq.retained_report';
export const ZMQ_SKILL_CREATED_AT = '2026-10-25T00:00:00.000Z';
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Called only after the entire persisted native catalog and current Binding are verified. */
export function buildNativeZmqSkill(
  authority: ZmqConsumerAuthority | (ZmqSiteStaticAuthority & Readonly<{ validUntil?: string }>),
  name: ZmqNativeTool,
  tool: McpTool,
  version: number,
): SkillVersion {
  if (
    tool.serverId !== authority.localServerId ||
    tool.toolName !== name ||
    !record(tool.inputSchema) ||
    !record(tool.outputSchema) ||
    !tool.taskExecutionProfile
  )
    throw Error('ZMQ_SKILL_TOOL_AUTHORITY_INVALID');
  const profile = 'catalogProfile' in authority ? authority.catalogProfile : undefined;
  if (profile === 'zmq_v1_1_0_readonly_13' && ZMQ_NATIVE_CONTROLS.has(name))
    throw Error('ZMQ_SITE_READONLY_CONTROL_FORBIDDEN');
  const control = ZMQ_NATIVE_CONTROLS.has(name),
    skillId = zmqSkillId(name),
    capabilityId = zmqCapabilityId(name);
  const input = structuredClone(tool.inputSchema),
    properties = input['properties'];
  if (!record(properties) || !Array.isArray(input['required']))
    throw Error('ZMQ_SKILL_SCHEMA_INVALID');
  if (control) {
    properties['timeWindow'] = {
      type: 'object',
      additionalProperties: false,
      required: ['earliestStart', 'deadline'],
      properties: {
        earliestStart: { type: 'string', format: 'date-time' },
        deadline: { type: 'string', format: 'date-time' },
      },
    };
    input['required'] = [
      ...input['required'].map((key: unknown) => {
        if (typeof key !== 'string') throw Error('ZMQ_SKILL_SCHEMA_INVALID');
        return key;
      }),
      'timeWindow',
    ];
  }
  const output = {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'qualification',
      'resourceId',
      'toolName',
      'status',
      'providerResult',
      'missingEvidence',
      ...(profile ? ['catalogProfile'] : []),
    ],
    properties: {
      schemaVersion: { const: profile ? 'sdar.zmq-skill-report/2' : 'sdar.zmq-skill-report/1' },
      qualification: {
        const:
          profile === 'zmq_v1_1_0_readonly_13'
            ? 'site_readonly'
            : profile
              ? 'site_control'
              : 'isolated_simulator_only',
      },
      ...(profile ? { catalogProfile: { const: profile } } : {}),
      resourceId: { type: 'string', const: authority.resourceId },
      toolName: { type: 'string', const: name },
      status: {
        enum: profile
          ? ['completed', 'degraded', 'failed', 'cancelled']
          : ['completed', 'degraded', 'failed'],
      },
      providerResult: structuredClone(tool.outputSchema),
      missingEvidence: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
  };
  const { validUntil, ...lineage } = authority;
  void validUntil; // Freshness is re-read from current authority, never extended by an immutable Skill.
  const outcome = {
    schemaVersion: '1.0' as const,
    skillId,
    skillVersion: version,
    effects: [`effect.zmq.report.${name}`],
    evidence: [ZMQ_REPORT_EVIDENCE],
    artifacts: [],
    taskGoalPolicy: {
      requestedCapabilityId: capabilityId,
      taskType: name,
      mcpToolName: name,
      mcpProviderBindingId: authority.bindingId,
      ...lineage,
      taskBehavior: tool.taskExecutionProfile.taskBehavior,
      taskProfile: tool.taskExecutionProfile,
      executionSemantics: tool.executionSemantics,
    },
    confidencePolicy: {
      rejectSuccessWithoutRequiredEvidence: true,
      mcpAcceptanceIsTerminalSuccess: false,
      incompleteOutcome: 'degraded',
      completeSpatialEvidence: false,
    },
    sideEffectPolicy: control
      ? {
          sideEffecting: true,
          confirmation: 'required_before_execution',
          authorityKind: 'physical_control',
          autoConfirmPlan: false,
          exactResourceRequired: true,
          remoteTaskIdentityRequired: true,
          terminalObservationRequired: true,
          redispatchAfterUncertain: false,
        }
      : {
          sideEffecting: false,
          effect: 'read_only',
          confirmation: 'not_required',
          normalizedObservationRequired: true,
        },
  };
  const usage = createSkillUsageSpecification({
    apiVersion: 'sdar.io/v1alpha1',
    visibility: { userSelectable: true, composable: true, internalOnly: false },
    normative: {
      constraints: [
        'Use the exact persisted native catalog, resource, simulation and Skill version.',
        'Report retained Provider facts and every missing source; a report is not complete spatial coverage.',
      ],
      forbiddenActions: [
        'Fallback to legacy tools or another Provider.',
        'Replay an uncertain side effect.',
        profile
          ? 'Execute outside the exact site live domain.'
          : 'Execute outside the isolated simulation domain.',
        'Claim complete patrol coverage from a received frame.',
      ],
      requiredConfirmations: control
        ? ['Explicitly confirm the immutable plan before dispatch.']
        : [],
      noApplicableSkill: 'reject',
    },
    contextRequirements: [
      {
        requirementId: 'public-resource-id',
        description: 'Exact public native resource.',
        required: true,
        sourceOrder: ['authoritative_context'],
      },
      {
        requirementId: 'provider-binding-freshness',
        description: 'Current unexpired native Provider Binding.',
        required: true,
        sourceOrder: ['authoritative_context'],
      },
    ],
    taskBindings: [
      {
        bindingId: `task-binding-${skillId}-v${String(version)}`,
        taskType: name,
        providerPolicy: {
          selection: 'required',
          requiredProviderId: authority.localServerId,
          preferredProviderIds: [],
          forbiddenProviderIds: [],
          requiredAttributes: [
            `task_behavior:${tool.taskExecutionProfile.taskBehavior}`,
            `effect:${tool.executionSemantics.effect}`,
            `execution:${tool.executionSemantics.execution}`,
            `catalog_checksum:${authority.catalogChecksum}`,
          ],
        },
      },
    ],
    adaptive: {
      instructions: ['Preserve exact arguments and anchored parent deadlines.'],
      optimizationHints: [],
      allowPreferredProviderFallback: false,
    },
    modes: {
      supported: ['procedure'],
      defaultMode: 'procedure',
      procedure: {
        summary: 'Deterministic native ZMQ reporting procedure.',
        instructions: ['Invoke once; retain the original result and its evidence.'],
      },
    },
    evidencePolicy: {
      requirements: [
        {
          requirementId: 'native-report',
          evidenceType: ZMQ_REPORT_EVIDENCE,
          required: true,
          hardGate: true,
        },
      ],
      rejectSuccessWithoutRequiredEvidence: true,
    },
  });
  return createSkillVersion({
    skillId,
    version,
    ...(version === 1 ? {} : { previousVersion: version - 1 }),
    name: `ZMQ ${name}`,
    summary: `Source-qualified ${profile ? 'site' : 'isolated'} ${name} report.`,
    description: profile
      ? 'Native site ZMQ contract; explicit confirmation and retained source-qualified results.'
      : 'Native ZMQ contract; isolated simulation only; retained evidence and incomplete outcomes remain explicit.',
    capabilities: [capabilityId],
    workflowGuidance: 'Compile the deterministic procedure; require exact authority and evidence.',
    outputInstruction: 'Return the immutable Provider result in the native reporting wrapper.',
    inputSchema: input,
    outputSchema: output,
    toolPolicy: {
      required: [{ serverId: authority.localServerId, toolName: name }],
      optional: [],
      forbidden: [{ serverId: authority.localServerId, toolName: 'vehicle_fire_weapon' }],
    },
    runtimePolicy: {
      autoConfirmPlan: !control,
      maxReplans: 0,
      maxDurationSeconds: control ? 300 : 60,
      maxLlmCalls: 0,
      maxMcpCalls: 1,
      cancelStrategy: control ? 'try_interrupt' : 'wait_current',
      ...(control ? { pauseReplanThresholdSeconds: 0 } : {}),
    },
    usageSpecification: usage,
    outcomeSpecification: { ...outcome, specificationHash: hashCanonicalEvidenceJson(outcome) },
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: ZMQ_SKILL_CREATED_AT,
  });
}
