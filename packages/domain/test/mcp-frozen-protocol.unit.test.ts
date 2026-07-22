import { describe, expect, it } from 'vitest';
import {
  compareRuntimeRevisions,
  createMcpTool,
  createProviderEvidenceItem,
  frozenTaskObservationDedupeKey,
  validateFrozenTaskBehaviorOutcome,
  validateRuntimeRevision,
} from '../src/index.js';

const frozenProfile = {
  profileVersion: '1.0' as const,
  taskBehavior: 'task_required' as const,
  availability: 'dynamic' as const,
  supportsScheduling: true,
  supportsMaxElapsed: true,
  supportsObservations: true,
  supportsInputRequired: true,
  idempotency: 'client_request_key' as const,
};

describe('Frozen MCP domain contracts', () => {
  it('keeps legacy Tool projections isolated from Frozen profiles', () => {
    const legacy = createMcpTool({
      serverId: 'server-1',
      toolName: 'legacy.tool',
      inputSchema: {},
      discoveredAt: '2026-07-18T00:00:00.000Z',
    });
    expect(legacy.protocolMode).toBe('legacy_v11');

    const frozen = createMcpTool({
      serverId: 'server-1',
      toolName: 'frozen.tool',
      inputSchema: {},
      outputSchema: {},
      protocolMode: 'frozen_v1',
      taskExecutionProfile: frozenProfile,
      discoveredAt: '2026-07-18T00:00:00.000Z',
    });
    expect(frozen.taskExecutionProfile).toEqual(frozenProfile);

    expect(() =>
      createMcpTool({
        serverId: 'server-1',
        toolName: 'mixed.tool',
        inputSchema: {},
        protocolMode: 'frozen_v1',
        taskExecution: {
          execution: 'task_required',
          availability: 'dynamic',
          supportsScheduling: true,
          supportsMaxElapsed: true,
          supportsObservations: true,
          cancellation: 'task_cancel',
          revision: '1.0',
        },
        taskExecutionProfile: frozenProfile,
        discoveredAt: '2026-07-18T00:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'TOOL_PROFILE_FIELD_MISMATCH' }));
  });

  it('enforces the Frozen taskBehavior result matrix', () => {
    expect(() => {
      validateFrozenTaskBehaviorOutcome('synchronous_only', 'task');
    }).toThrow(expect.objectContaining({ code: 'TASK_BEHAVIOR_PROFILE_MISMATCH' }));
    expect(() => {
      validateFrozenTaskBehaviorOutcome('task_required', 'synchronous_success');
    }).toThrow(expect.objectContaining({ code: 'TASK_BEHAVIOR_PROFILE_MISMATCH' }));
    expect(() => {
      validateFrozenTaskBehaviorOutcome('task_required', 'pre_admission_error');
    }).not.toThrow();
    expect(() => {
      validateFrozenTaskBehaviorOutcome('server_directed', 'task');
    }).not.toThrow();
  });

  it('compares unbounded canonical runtime revisions and builds the normative dedupe key', () => {
    expect(compareRuntimeRevisions('999999999999999999999', '1000000000000000000000')).toBe(-1);
    expect(compareRuntimeRevisions('42', '42')).toBe(0);
    expect(frozenTaskObservationDedupeKey('task-1', '42')).toBe('task-1\u000042');
    for (const invalid of ['', '-1', '+1', '01', '1.0'])
      expect(() => validateRuntimeRevision(invalid)).toThrow(
        expect.objectContaining({ code: 'MCP_RUNTIME_REVISION_INVALID' }),
      );
  });

  it('keeps requirementId out of Provider evidence', () => {
    const item = createProviderEvidenceItem({
      evidenceId: 'evidence-1',
      evidenceType: 'position.observation',
      observedAt: '2026-07-18T03:12:00.000Z',
      payloadRef: { kind: 'structured_content', jsonPointer: '/finalPosition' },
    });
    expect(item.evidenceType).toBe('position.observation');
    expect(() =>
      createProviderEvidenceItem({
        evidenceId: 'evidence-1',
        evidenceType: 'position.observation',
        observedAt: '2026-07-18T03:12:00.000Z',
        payloadRef: { kind: 'structured_content', jsonPointer: '/finalPosition' },
        requirementId: 'local-only',
      } as never),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_EVIDENCE_REQUIREMENT_ID_FORBIDDEN' }));
  });
});
