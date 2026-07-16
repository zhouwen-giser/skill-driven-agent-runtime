import { AgentCard, Message, Task, TaskState, TaskStatusUpdateEvent } from '@a2a-js/sdk';
import { validateVersion } from '@a2a-js/sdk/server';
import { describe, expect, it } from 'vitest';

import {
  buildAgentCard,
  buildStatusUpdate,
  inspectA2aCompatibility,
} from '../src/compatibility.js';
import { taskPhaseToA2AState, toA2ATask, toSubmitTaskCommand } from '../src/task-mapping.js';

describe('A2A 1.0.1 compatibility baseline', () => {
  it('uses the v1 protobuf namespace and standard task states', () => {
    const compatibility = inspectA2aCompatibility();

    expect(compatibility.protobufPackage).toBe('lf.a2a.v1');
    expect(compatibility.protocolVersion).toBe('1.0');
    expect(compatibility.specPatchBaseline).toBe('1.0.1');
    expect(compatibility.standardStates).toEqual([
      'TASK_STATE_SUBMITTED',
      'TASK_STATE_WORKING',
      'TASK_STATE_COMPLETED',
      'TASK_STATE_FAILED',
      'TASK_STATE_CANCELED',
      'TASK_STATE_INPUT_REQUIRED',
      'TASK_STATE_REJECTED',
      'TASK_STATE_AUTH_REQUIRED',
    ]);
  });

  it('serializes an Agent Card with enabled skills and the 1.0 interface version', () => {
    const card = buildAgentCard([
      {
        id: 'skill.read-device',
        name: 'Read device',
        description: 'Reads device status without side effects.',
        tags: ['device', 'read-only'],
      },
    ]);

    const wire = AgentCard.toJSON(card);
    expect(wire).toMatchObject({
      name: 'Skill-Driven Agent Runtime',
      supportedInterfaces: [{ protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
      skills: [{ id: 'skill.read-device', name: 'Read device' }],
    });
  });

  it('accepts only the declared A2A major/minor protocol version', () => {
    const card = buildAgentCard([]);

    expect(() => {
      validateVersion('1.0', card, 'HTTP+JSON');
    }).not.toThrow();
    expect(() => {
      validateVersion('0.3', card, 'HTTP+JSON');
    }).toThrow();
    expect(() => {
      validateVersion('1.1', card, 'HTTP+JSON');
    }).toThrow();
  });

  it('serializes standard streaming status updates without a legacy final flag', () => {
    const update = buildStatusUpdate(
      'task-1',
      'context-1',
      TaskState.TASK_STATE_WORKING,
      '2026-07-11T09:00:00.000Z',
    );
    const wire = TaskStatusUpdateEvent.toJSON(update);

    expect(wire).toMatchObject({
      taskId: 'task-1',
      contextId: 'context-1',
      status: { state: 'TASK_STATE_WORKING' },
    });
    expect(wire).not.toHaveProperty('final');
  });

  it('maps A2A text and optional user metadata to an application-owned command', () => {
    const message = Message.fromJSON({
      messageId: 'message-1',
      role: 'ROLE_USER',
      parts: [{ text: 'Inspect device.', mediaType: 'text/plain' }],
      metadata: { user_id: 'user-1', trace_hint: 'visible' },
    });

    expect(toSubmitTaskCommand(message, 'task-1', 'context-1')).toEqual({
      taskId: 'task-1',
      contextId: 'context-1',
      userId: 'user-1',
      messageText: 'Inspect device.',
      metadata: { user_id: 'user-1', trace_hint: 'visible' },
    });
  });

  it('maps explicit Skill creation requests to draft-only application intent', () => {
    const message = Message.fromJSON({
      messageId: 'message-draft',
      role: 'ROLE_USER',
      parts: [{ text: 'Create a device Skill.', mediaType: 'text/plain' }],
      metadata: { sdar_action: 'create_skill_draft' },
    });

    expect(toSubmitTaskCommand(message, 'task-draft', 'context-draft')).toMatchObject({
      skillDraftIntent: 'create',
    });
  });

  it('projects internal phases and dual-form output to official A2A types', () => {
    const projected = toA2ATask({
      taskId: 'task-1',
      contextId: 'context-1',
      userId: 'anonymous',
      requestText: 'Inspect status.',
      requestMetadata: {},
      phase: 'completed',
      phaseMessage: 'Task completed.',
      output: { text: 'Online.', structured: { status: 'online' } },
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:01:00.000Z',
    });

    expect(projected.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(projected.artifacts[0]?.parts).toHaveLength(2);
    expect(projected.metadata).toMatchObject({ internalPhase: 'completed', userId: 'anonymous' });
    expect(taskPhaseToA2AState('awaiting_plan_confirmation')).toBe(
      TaskState.TASK_STATE_INPUT_REQUIRED,
    );
  });

  it('projects capability gap as failed with structured terminal guidance', () => {
    const projected = toA2ATask({
      taskId: 'task-gap',
      contextId: 'context-gap',
      userId: 'anonymous',
      requestText: 'Read pressure.',
      requestMetadata: {},
      phase: 'capability_gap',
      phaseMessage: 'Required capability is unavailable: Read pressure.',
      capabilityGap: {
        evaluationSummary: 'No registered Tool can read pressure.',
        missingCapability: 'Read pressure.',
        suggestedToolContract: {
          name: 'read_pressure',
          description: 'Read device pressure.',
          inputSchema: { type: 'object', required: ['deviceId'] },
        },
      },
      errorCode: 'CAPABILITY_GAP',
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:01:00.000Z',
    });

    expect(projected.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(projected.metadata).toMatchObject({
      internalPhase: 'capability_gap',
      errorCode: 'CAPABILITY_GAP',
      capabilityGap: {
        missingCapability: 'Read pressure.',
        suggestedToolContract: { name: 'read_pressure' },
      },
      nextAction: 'register-capability-and-submit-new-task',
    });
  });

  it('rejects an incomplete capability-gap projection at the A2A boundary', () => {
    expect(() =>
      toA2ATask({
        taskId: 'task-gap-invalid',
        contextId: 'context-gap',
        userId: 'anonymous',
        requestText: 'Read pressure.',
        requestMetadata: {},
        phase: 'capability_gap',
        phaseMessage: 'Capability unavailable.',
        createdAt: '2026-07-11T10:00:00.000Z',
        updatedAt: '2026-07-11T10:01:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'A2A_CAPABILITY_GAP_EVIDENCE_INVALID' }));
  });

  it('projects only necessary process summaries and never internal request or planning evidence', () => {
    const wire = Task.toJSON(
      toA2ATask({
        taskId: 'task-private-boundary',
        contextId: 'context-private-boundary',
        userId: 'anonymous',
        requestText: 'Private operator request.',
        requestMetadata: { private_reasoning: 'must not cross A2A' },
        phase: 'awaiting_plan_confirmation',
        phaseMessage: 'Plan confirmation is required.',
        goalId: 'goal-internal',
        goalVersion: 2,
        planId: 'plan-internal',
        createdAt: '2026-07-11T10:00:00.000Z',
        updatedAt: '2026-07-11T10:01:00.000Z',
      }),
    );

    const serialized = JSON.stringify(wire);
    expect(serialized).toContain('Plan confirmation is required.');
    expect(serialized).not.toMatch(
      /Private operator request|private_reasoning|goal-internal|plan-internal/u,
    );
  });
});
