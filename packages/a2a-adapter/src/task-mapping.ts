import { Artifact, Message, Task, TaskState, type Part } from '@a2a-js/sdk';
import { z } from 'zod';

import type { SubmitTaskCommand, TaskFollowUpAction } from '../../application/src/index.js';
import {
  snapshotRemoteTaskInputValue,
  type AgentTask,
  type TaskOutput,
  type TaskPhase,
} from '../../domain/src/index.js';

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
const FollowUpMetadataSchema = z.strictObject({
  sdar_action: FollowUpActionSchema,
  input_request_id: z.string().min(1).max(1_024).optional(),
  user_id: z.string().min(1).max(1_024).optional(),
});
const SkillDraftActionSchema = z.enum(['create_skill_draft', 'update_skill_draft']);

export class A2AMappingError extends Error {
  readonly code:
    | 'A2A_MESSAGE_TEXT_REQUIRED'
    | 'A2A_METADATA_INVALID'
    | 'A2A_ACTION_INVALID'
    | 'A2A_INPUT_CONTENT_INVALID'
    | 'A2A_CAPABILITY_GAP_EVIDENCE_INVALID'
    | 'A2A_USER_ID_INVALID';

  constructor(code: A2AMappingError['code'], message: string) {
    super(message);
    this.name = 'A2AMappingError';
    this.code = code;
  }
}

export function toTaskFollowUp(message: Message): Readonly<{
  action: TaskFollowUpAction;
  messageText: string;
  inputRequestId?: string;
  inputContent?: unknown;
}> {
  const metadata = messageMetadata(message);
  const result = FollowUpMetadataSchema.safeParse(metadata);
  if (!result.success) {
    if (!FollowUpActionSchema.safeParse(metadata['sdar_action']).success)
      throw new A2AMappingError(
        'A2A_ACTION_INVALID',
        'A2A follow-up metadata sdar_action must name a supported task action.',
      );
    throw new A2AMappingError(
      'A2A_METADATA_INVALID',
      'A2A follow-up metadata may contain only bounded sdar_action, input_request_id and user_id fields.',
    );
  }
  const messageText = textContent(message);
  const dataParts = message.parts.filter(
    (part): part is Part & { content: { $case: 'data'; value: unknown } } =>
      part.content?.$case === 'data',
  );
  if (dataParts.length > 1)
    throw new A2AMappingError(
      'A2A_INPUT_CONTENT_INVALID',
      'A2A provide_input accepts at most one structured data part.',
    );
  if (result.data.sdar_action !== 'provide_input' && dataParts.length > 0)
    throw new A2AMappingError(
      'A2A_INPUT_CONTENT_INVALID',
      'Structured data is accepted only for the provide_input follow-up action.',
    );
  if (messageText === '' && dataParts.length === 0)
    throw new A2AMappingError(
      'A2A_MESSAGE_TEXT_REQUIRED',
      'A2A follow-up requires text or structured input content.',
    );
  let inputContent: unknown;
  if (result.data.sdar_action === 'provide_input') {
    try {
      inputContent = snapshotRemoteTaskInputValue(dataParts[0]?.content.value ?? messageText);
    } catch {
      throw new A2AMappingError(
        'A2A_INPUT_CONTENT_INVALID',
        'A2A structured input must be bounded JSON.',
      );
    }
  }
  return {
    action: result.data.sdar_action,
    messageText,
    ...(result.data.input_request_id === undefined
      ? {}
      : { inputRequestId: result.data.input_request_id }),
    ...(inputContent === undefined ? {} : { inputContent }),
  };
}

export function toSubmitTaskCommand(
  message: Message,
  taskId: string,
  contextId: string,
): SubmitTaskCommand {
  const text = textContent(message);
  if (text === '') {
    throw new A2AMappingError('A2A_MESSAGE_TEXT_REQUIRED', 'A2A message requires a text part.');
  }

  const metadata = messageMetadata(message);
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

function textContent(message: Message): string {
  return message.parts
    .filter(
      (part): part is Part & { content: { $case: 'text'; value: string } } =>
        part.content?.$case === 'text',
    )
    .map((part) => part.content.value)
    .join('\n')
    .trim();
}

function messageMetadata(message: Message): Readonly<Record<string, unknown>> {
  const rawMetadata: unknown = message.metadata;
  const metadataResult = MetadataSchema.safeParse(rawMetadata ?? {});
  if (!metadataResult.success)
    throw new A2AMappingError('A2A_METADATA_INVALID', 'A2A metadata must be a JSON object.');
  return metadataResult.data;
}

export function toA2ATask(task: AgentTask): Task {
  if (
    task.phase === 'capability_gap' &&
    (task.errorCode !== 'CAPABILITY_GAP' || task.capabilityGap === undefined)
  )
    throw new A2AMappingError(
      'A2A_CAPABILITY_GAP_EVIDENCE_INVALID',
      'A terminal capability-gap Task requires its stable error code and structured evidence.',
    );
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
      ...(task.phase === 'capability_gap'
        ? { nextAction: 'register-capability-and-submit-new-task' }
        : {}),
    },
  });
}

export function taskPhaseToA2AState(phase: TaskPhase): TaskState {
  if (phase === 'queued') return TaskState.TASK_STATE_SUBMITTED;
  if (phase === 'completed') return TaskState.TASK_STATE_COMPLETED;
  if (phase === 'canceled') return TaskState.TASK_STATE_CANCELED;
  if (phase === 'capability_gap' || phase === 'failed' || phase === 'invalidated')
    return TaskState.TASK_STATE_FAILED;
  if (
    phase === 'awaiting_plan_confirmation' ||
    phase === 'awaiting_user_input' ||
    phase === 'paused'
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
