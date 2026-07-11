import {
  AgentCard,
  TaskState,
  TaskStatusUpdateEvent,
  protobufPackage,
  taskStateToJSON,
} from '@a2a-js/sdk';

export const A2A_PROTOCOL_BASELINE = '1.0' as const;
export const A2A_SPEC_PATCH_BASELINE = '1.0.1' as const;

export interface EnabledSkillSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export function buildAgentCard(
  skills: readonly EnabledSkillSummary[],
  endpoint = 'http://127.0.0.1:3000/a2a',
): AgentCard {
  return AgentCard.fromJSON({
    name: 'Skill-Driven Agent Runtime',
    description: 'Skill-driven A2A provider backed by a constrained workflow runtime.',
    supportedInterfaces: [
      {
        url: endpoint,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_BASELINE,
      },
    ],
    version: '0.0.0',
    capabilities: { streaming: true, pushNotifications: false, extensions: [] },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [...skill.tags],
      examples: [],
      inputModes: ['text/plain'],
      outputModes: ['text/plain', 'application/json'],
      securityRequirements: [],
    })),
    signatures: [],
  });
}

export function buildStatusUpdate(
  taskId: string,
  contextId: string,
  state: TaskState,
  timestamp: string,
): TaskStatusUpdateEvent {
  return TaskStatusUpdateEvent.fromJSON({
    taskId,
    contextId,
    status: { state: taskStateToJSON(state), timestamp },
  });
}

export function inspectA2aCompatibility(): Readonly<{
  protobufPackage: string;
  protocolVersion: typeof A2A_PROTOCOL_BASELINE;
  specPatchBaseline: typeof A2A_SPEC_PATCH_BASELINE;
  standardStates: readonly string[];
}> {
  const states = [
    TaskState.TASK_STATE_SUBMITTED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_CANCELED,
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_REJECTED,
    TaskState.TASK_STATE_AUTH_REQUIRED,
  ].map((state) => taskStateToJSON(state));

  return {
    protobufPackage,
    protocolVersion: A2A_PROTOCOL_BASELINE,
    specPatchBaseline: A2A_SPEC_PATCH_BASELINE,
    standardStates: states,
  };
}
