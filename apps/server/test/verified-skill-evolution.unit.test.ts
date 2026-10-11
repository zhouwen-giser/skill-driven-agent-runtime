import { describe, expect, it } from 'vitest';
import type { McpServer, McpTool } from '../../../packages/domain/src/index.js';
import {
  evolutionAuthorityFixture,
  timestamp,
  tool,
} from '../../../packages/application/test/skill-evolution-fixture.js';
import { verifiedEvolutionFixture } from './verified-skill-evolution-fixture.js';

describe('verified Skill evolution orchestration', () => {
  it.each([false, true])(
    'validates the actual candidate and publishes once (new Skill: %s)',
    async (newSkill) => {
      const fixture = setup(newSkill);
      const published = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
      expect(published.status, JSON.stringify(published.validationReport)).toBe('published');
      expect(published.publishedSkillVersion).toBe(newSkill ? 1 : 2);
      expect(published.validationReport?.executionValidation?.executions).toHaveLength(11);
      expect(published.validationReport?.cases.map((item) => item.kind)).toEqual([
        'static_validation',
        'source_experience',
        'source_experience',
        'source_experience',
        'historical_replay',
        'historical_replay',
        'historical_replay',
        'historical_replay',
        'historical_replay',
        'normal',
        'boundary',
        'exception',
      ]);
      expect(fixture.candidateCalls()).toBe(11);
      expect(published.validationReport?.cases).toContainEqual(
        expect.objectContaining({
          caseId: 'history-history-4',
          kind: 'historical_replay',
          expectedOutcome: 'success',
          passed: true,
        }),
      );
      expect(fixture.inductionInputs[0]).toContain('replayCorpus');
      expect(fixture.inductionInputs[0]).toContain('DEVICE_OFFLINE');
      const calls = fixture.modelCalls();
      expect(await fixture.service.evaluateAndPublish(fixture.initial.candidateId)).toEqual(
        published,
      );
      expect(fixture.modelCalls()).toBe(calls);
      expect(fixture.commits).toHaveLength(1);
    },
  );

  it('does not count a succeeded but unmet-Goal round as an execution exception', async () => {
    const fixture = setup(false);
    fixture.setExceptionInput('not-achieved');
    const candidate = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
    expect(candidate.status).toBe('validation_failed');
    expect(candidate.publishedSkillId).toBeUndefined();
    expect(candidate.validationReport?.cases).toContainEqual(
      expect.objectContaining({ caseId: 'exception', kind: 'exception', passed: false }),
    );
  });

  it('selects an achieved normal recording when an unmet-Goal round has the same input', async () => {
    const fixture = setup(false);
    const unmet = fixture.histories.pop();
    if (unmet === undefined || unmet.successful) throw new Error('Unmet-Goal fixture missing');
    fixture.histories.unshift({ ...unmet, input: { id: 'normal' } });
    const candidate = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
    expect(candidate.status, JSON.stringify(candidate.validationReport?.cases)).toBe('published');
    expect(candidate.validationReport?.executionValidation?.executions).toContainEqual(
      expect.objectContaining({
        caseId: 'normal',
        experienceId: 'history-0',
        recordedInstanceStatus: 'succeeded',
      }),
    );
  });

  it('feeds persisted failed corrections back into subsequent induction', async () => {
    const fixture = setup(false);
    fixture.setWrongResult(true);
    const failed = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
    if (failed.proposedSkill === undefined) throw new Error('Missing candidate');
    const correction = await fixture.service.correctAndRevalidate(failed.candidateId, {
      actor: 'operator',
      summary: 'First correction needs more work',
      proposedSkill: { ...failed.proposedSkill, workflowGuidance: 'Still invalid output' },
    });
    expect(correction.candidate.status).toBe('validation_failed');
    await fixture.service.evaluateAndPublish(failed.candidateId);
    expect(fixture.inductionInputs[1]).toContain(correction.correction.correctionId);
    expect(fixture.inductionInputs[1]).toContain('Still invalid output');
    expect(fixture.inductionInputs[1]).toContain('First correction needs more work');
  });

  it('retains failed candidate assertions and commits a corrected candidate with its correction atomically', async () => {
    const fixture = setup(false);
    fixture.setWrongResult(true);
    const failed = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
    expect(failed.status).toBe('validation_failed');
    expect(failed.publishedSkillId).toBeUndefined();
    expect(failed.validationReport?.cases.some((item) => !item.passed)).toBe(true);
    if (failed.proposedSkill === undefined) throw new Error('Missing candidate');
    fixture.setWrongResult(false);
    const corrected = await fixture.service.correctAndRevalidate(fixture.initial.candidateId, {
      actor: 'test-operator',
      summary: 'Use both recorded Tools and return their observed output.',
      proposedSkill: { ...failed.proposedSkill, workflowGuidance: 'Corrected full workflow' },
    });
    expect(corrected.candidate.status).toBe('published');
    expect(corrected.correction.outcome).toBe('published');
    expect(fixture.commits[1]?.correction).toEqual(corrected.correction);
    expect(corrected.correction.validationReport).toEqual(corrected.candidate.validationReport);
  });
});

function setup(newSkill: boolean) {
  const { base } = evolutionAuthorityFixture();
  const server: McpServer = {
    serverId: tool.serverId,
    name: 'Recorded local fixture',
    endpoint: 'http://127.0.0.1:1/unreachable',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const registered: McpTool = {
    ...tool,
    inputSchema: base.inputSchema,
    outputSchema: base.outputSchema,
    discoveredAt: timestamp,
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'allowed',
      source: 'mcp_declared',
    },
  };
  return verifiedEvolutionFixture({ base, server, tool: registered, newSkill });
}
