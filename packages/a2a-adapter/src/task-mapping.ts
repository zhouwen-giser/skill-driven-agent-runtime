import { Artifact, Message, Task, TaskState, type Part } from '@a2a-js/sdk';
import { z } from 'zod';

import type { SubmitTaskCommand, TaskFollowUpAction } from '../../application/src/index.js';
import type { AgentTask, TaskOutput, TaskPhase } from '../../domain/src/index.js';

const MetadataSchema = z.record(z.string(), z.unknown());
const FollowUpActionSchema = z.enum([
  'confirm_plan',
  'reject_plan',
  'revise_plan',
  'patch_goal',
  'cancel_goal',
  'provide_input',
  'pause',
  'resume',
]);
const SkillDraftActionSchema = z.enum(['create_skill_draft', 'update_skill_draft']);

export class A2AMappingError extends Error {
  readonly code:
    | 'A2A_MESSAGE_TEXT_REQUIRED'
    | 'A2A_METADATA_INVALID'
    | 'A2A_ACTION_INVALID'
    | 'A2A_USER_ID_INVALID';

  constructor(code: A2AMappingError['code'], message: string) {
    super(message);
    this.name = 'A2AMappingError';
    this.code = code;
  }
}

export function toTaskFollowUp(
  message: Message,
): Readonly<{ action: TaskFollowUpAction; messageText: string; inputRequestId?: string }> {
  const command = toSubmitTaskCommand(message, 'follow-up', 'follow-up');
  const result = FollowUpActionSchema.safeParse(command.metadata['sdar_action']);
  if (!result.success) {
    throw new A2AMappingError(
      'A2A_ACTION_INVALID',
      'A2A follow-up metadata sdar_action must name a supported task action.',
    );
  }
  const inputRequestId = command.metadata['input_request_id'];
  if (inputRequestId !== undefined && typeof inputRequestId !== 'string')
    throw new A2AMappingError(
      'A2A_METADATA_INVALID',
      'A2A follow-up metadata input_request_id must be a string.',
    );
  return {
    action: result.data,
    messageText: command.messageText,
    ...(inputRequestId === undefined ? {} : { inputRequestId }),
  };
}

export function toSubmitTaskCommand(
  message: Message,
  taskId: string,
  contextId: string,
): SubmitTaskCommand {
  const text = message.parts
    .filter(
      (part): part is Part & { content: { $case: 'text'; value: string } } =>
        part.content?.$case === 'text',
    )
    .map((part) => part.content.value)
    .join('\n')
    .trim();
  if (text === '') {
    throw new A2AMappingError('A2A_MESSAGE_TEXT_REQUIRED', 'A2A message requires a text part.');
  }

  const rawMetadata: unknown = message.metadata;
  const metadataResult = MetadataSchema.safeParse(rawMetadata ?? {});
  if (!metadataResult.success) {
    throw new A2AMappingError('A2A_METADATA_INVALID', 'A2A metadata must be a JSON object.');
  }
  const metadata = metadataResult.data;
  const rawUserId = metadata['user_id'];
  if (rawUserId !== undefined && typeof rawUserId !== 'string') {
    throw new A2AMappingError('A2A_USER_ID_INVALID', 'A2A metadata user_id must be a string.');
  }

  return {
    taskId,
    contextId,
    ...(rawUserId === undefined ? {} : { userId: rawUserId }),
    messageText: text,
    metadata,
    ...(SkillDraftActionSchema.safeParse(metadata['sdar_action']).success
      ? {
          skillDraftIntent:
            metadata['sdar_action'] === 'create_skill_draft'
              ? ('create' as const)
              : ('update' as const),
        }
      : {}),
  };
}

export function toA2ATask(task: AgentTask): Task {
  const statusMessage = Message.fromJSON({
    messageId: `${task.taskId}:status:${task.updatedAt}`,
    contextId: task.contextId,
    taskId: task.taskId,
    role: 'ROLE_AGENT',
    parts: [{ text: task.phaseMessage, mediaType: 'text/plain' }],
  });
  const artifacts = task.output === undefined ? [] : [toResultArtifact(task.taskId, task.output)];
  return Task.fromJSON({
    id: task.taskId,
    contextId: task.contextId,
    status: {
      state: taskPhaseToA2AState(task.phase),
      message: Message.toJSON(statusMessage),
      timestamp: task.updatedAt,
    },
    artifacts: artifacts.map((artifact) => Artifact.toJSON(artifact)),
    history: [],
    metadata: {
      internalPhase: task.phase,
      userId: task.userId,
      ...(task.errorCode === undefined ? {} : { errorCode: task.errorCode }),
      ...(task.capabilityGap === undefined ? {} : { capabilityGap: task.capabilityGap }),
    },
  });
}

export function taskPhaseToA2AState(phase: TaskPhase): TaskState {
  if (phase === 'queued') return TaskState.TASK_STATE_SUBMITTED;
  if (phase === 'completed') return TaskState.TASK_STATE_COMPLETED;
  if (phase === 'canceled') return TaskState.TASK_STATE_CANCELED;
  if (phase === 'failed' || phase === 'invalidated') return TaskState.TASK_STATE_FAILED;
  if (
    phase === 'awaiting_plan_confirmation' ||
    phase === 'awaiting_user_input' ||
    phase === 'paused' ||
    phase === 'capability_gap'
  ) {
    return TaskState.TASK_STATE_INPUT_REQUIRED;
  }
  return TaskState.TASK_STATE_WORKING;
}

function toResultArtifact(taskId: string, output: TaskOutput): Artifact {
  return Artifact.fromJSON({
    artifactId: `${taskId}:result`,
    name: 'result',
    description: 'Natural-language and structured task result.',
    parts: [
      { text: output.text, mediaType: 'text/plain' },
      { data: output.structured, mediaType: 'application/json' },
    ],
  });
}
