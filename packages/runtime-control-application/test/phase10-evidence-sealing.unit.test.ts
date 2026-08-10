import { describe, expect, it } from 'vitest';

import type {
  CanonicalEvidenceEnvelope,
  EpisodeEvidenceManifest,
  EvidenceExpectedRecord,
  EvidenceExpectationStage,
  EvidenceQualityIssue,
  EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  EpisodeEvidenceCoverageService,
  EvidenceInfrastructureProjector,
  EvidenceQualityEvaluator,
  evidenceInfrastructureSourcePartition,
  type EpisodeEvidenceCoverageRepository,
  type EvidenceInfrastructureProjectionPartition,
  type EvidenceInfrastructureSnapshot,
  type EvidenceInfrastructureWriter,
  type EvidenceQualityAuthoritySource,
  type EvidenceQualityFinding,
  type EvidenceQualityIssueWriter,
  type EvidenceQualityRule,
} from '../src/index.js';

describe('Phase 10 evidence sealing', () => {
  it('seals incomplete, degraded and complete stages idempotently', async () => {
    let stage: EvidenceExpectationStage = 'exported_unacknowledged';
    let degraded = false;
    let previousManifest: EpisodeEvidenceManifest | undefined;
    const saved: EpisodeEvidenceManifest[] = [];
    const repository: EpisodeEvidenceCoverageRepository = {
      refreshEpisodeExpectations: () =>
        Promise.resolve({
          expectedRecords: [expectedRuntimeOutcome(stage)],
          qualityIssues: degraded ? [degradedQualityIssue()] : [],
          lastEvidenceSequence: stage === 'acknowledged' ? '12' : '11',
          sourceSnapshotHash: sha256(degraded ? 'c' : stage === 'acknowledged' ? 'b' : 'a'),
          ...(previousManifest === undefined ? {} : { previousManifest }),
        }),
      saveManifest: (manifest) => {
        saved.push(manifest);
        previousManifest = manifest;
        return Promise.resolve();
      },
    };
    const service = new EpisodeEvidenceCoverageService({
      repository,
      clock: { now: () => '2026-08-10T02:00:00.000Z' },
    });
    const input = {
      episodeId: 'episode-phase10',
      taskId: 'task-phase10',
      terminalOutcomeId: 'outcome-phase10',
      sealRequested: true,
    } as const;

    const incomplete = await service.reconcile(input);
    stage = 'acknowledged';
    degraded = true;
    const degradedManifest = await service.reconcile(input);
    degraded = false;
    const complete = await service.reconcile(input);
    const unchanged = await service.reconcile(input);

    expect(incomplete).toMatchObject({
      revision: 1,
      status: 'incomplete',
      pendingRequiredRecords: 1,
      missingFamilies: ['runtime'],
    });
    expect(degradedManifest).toMatchObject({
      revision: 2,
      status: 'degraded',
      projectedRequiredRecords: 1,
      pendingRequiredRecords: 0,
      qualityIssueIds: ['quality-phase10-degraded'],
    });
    expect(complete).toMatchObject({
      revision: 3,
      status: 'complete',
      projectedRequiredRecords: 1,
      pendingRequiredRecords: 0,
      completedFamilies: ['runtime'],
    });
    expect(unchanged).toBe(complete);
    expect(saved).toEqual([incomplete, degradedManifest, complete]);
  });

  it('upserts one authority finding and resolves it when the finding disappears', async () => {
    let active = true;
    const finding: EvidenceQualityFinding = {
      ruleId: 'experience_missing_fact',
      identity: 'episode-phase10:task-phase10',
      sourceSystem: 'runtime',
      sourceTable: 'experience_trace',
      sourceRecordId: 'task-phase10',
      recordType: 'experience.episode',
      episodeId: 'episode-phase10',
      detail: { missingFact: 'experience.episode', taskId: 'task-phase10' },
    };
    const source: EvidenceQualityAuthoritySource = {
      findings: (ruleId) => Promise.resolve(active && ruleId === finding.ruleId ? [finding] : []),
    };
    const open = new Map<string, { ruleId: EvidenceQualityRule; issue: EvidenceQualityIssue }>();
    const resolutions: {
      ruleId: EvidenceQualityRule;
      retainedIssueIds: readonly string[];
    }[] = [];
    const writer: EvidenceQualityIssueWriter = {
      recordQualityIssue: (issue, ruleId) => {
        open.set(issue.issueId, { ruleId, issue });
        return Promise.resolve();
      },
      resolveQualityRuleIssues: ({ ruleId, retainedIssueIds }) => {
        resolutions.push({ ruleId, retainedIssueIds });
        const retained = new Set(retainedIssueIds);
        for (const [issueId, stored] of open) {
          if (stored.ruleId === ruleId && !retained.has(issueId)) open.delete(issueId);
        }
        return Promise.resolve();
      },
    };
    const evaluator = new EvidenceQualityEvaluator({
      source,
      writer,
      clock: { now: () => '2026-08-10T02:01:00.000Z' },
    });

    const observed = await evaluator.evaluate();
    const issueId = observed.issueIds[0] ?? 'missing-issue-id';
    expect(open.get(issueId)?.issue).toMatchObject({
      severity: 'degraded',
      episodeId: 'episode-phase10',
      detail: { ruleId: 'experience_missing_fact', identity: finding.identity },
    });

    active = false;
    const resolved = await evaluator.evaluate();

    expect(observed).toMatchObject({ evaluatedRules: 10, openIssues: 1 });
    expect(resolved).toMatchObject({ evaluatedRules: 10, openIssues: 0 });
    expect(open.size).toBe(0);
    const experienceResolutions = resolutions.filter(
      ({ ruleId }) => ruleId === 'experience_missing_fact',
    );
    expect(experienceResolutions).toEqual([
      { ruleId: 'experience_missing_fact', retainedIssueIds: [issueId] },
      { ruleId: 'experience_missing_fact', retainedIssueIds: [] },
    ]);
  });

  it('projects one persisted quality issue and advances its evidence checkpoint', async () => {
    const sourceRecordId = 'quality-issue-phase10';
    const partition: EvidenceInfrastructureProjectionPartition = {
      kind: 'quality_issue',
      recordType: 'evidence.quality_issue',
      sourceRecordId,
      sourcePartition: evidenceInfrastructureSourcePartition('quality_issue', sourceRecordId),
    };
    const snapshot: EvidenceInfrastructureSnapshot = {
      partition,
      occurredAt: '2026-08-10T02:02:00.000Z',
      references: [],
      row: {
        issue_id: sourceRecordId,
        revision: 1,
        issue_code: 'source_identity_missing',
        rule_id: 'sequence_gap',
        severity: 'blocking',
        episode_id: 'episode-phase10',
        record_type: 'runtime.outcome',
        record_id: `evidence_${'a'.repeat(64)}`,
        source_system: 'runtime',
        source_table: 'evidence_outbox',
        source_record_id: 'batch-phase10',
        detail: { expectedSequence: '11', observedSequence: '12' },
        created_at: '2026-08-10T02:02:00.000Z',
        resolved_at: null,
      },
    };
    const records: CanonicalEvidenceEnvelope[] = [];
    let checkpoint: EvidenceSourceCheckpoint | undefined;
    const writer: EvidenceInfrastructureWriter = {
      hasRecord: () => Promise.resolve(true),
      append: (envelope) => {
        records.push(envelope);
        return Promise.resolve('42');
      },
      saveCheckpoint: (saved) => {
        checkpoint = saved;
        return Promise.resolve();
      },
    };
    const projector = new EvidenceInfrastructureProjector({
      source: {
        pendingPartitions: () => Promise.resolve([partition]),
        load: () => Promise.resolve(snapshot),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-10T02:03:00.000Z' },
    });

    const result = await projector.projectPartition(partition);

    expect(result).toMatchObject({ evidenceSequence: '42', skipped: false });
    expect(records[0]).toMatchObject({
      recordType: 'evidence.quality_issue',
      sourceRecordId,
      episodeId: 'episode-phase10',
      observationGeneration: 1,
      evidenceRefs: [],
      payload: {
        issueId: sourceRecordId,
        revision: 1,
        issueCode: 'source_identity_missing',
        ruleId: 'sequence_gap',
        resolvedAt: null,
      },
    });
    expect(checkpoint).toMatchObject({
      sourceFamily: 'evidence',
      sourcePartition: partition.sourcePartition,
      lastSourceRecordId: sourceRecordId,
      lastPayloadHash: records[0]?.payloadHash,
      projectorVersion: 'evidence-infrastructure/v1',
    });
  });
});

function expectedRuntimeOutcome(stage: EvidenceExpectationStage): EvidenceExpectedRecord {
  return {
    recordType: 'runtime.outcome',
    recordFamily: 'runtime',
    sourceSystem: 'runtime',
    sourceTable: 'goal_outcome',
    evaluationRole: 'required',
    requirementLevel: 'required',
    applicable: true,
    stage,
    sourceRecordId: 'outcome-phase10',
    ...(stage === 'acknowledged' ? { recordId: `evidence_${'c'.repeat(64)}` } : {}),
  };
}

function degradedQualityIssue(): EvidenceQualityIssue {
  return {
    issueId: 'quality-phase10-degraded',
    issueCode: 'source_identity_missing',
    severity: 'degraded',
    episodeId: 'episode-phase10',
    sourceSystem: 'runtime',
    sourceTable: 'experience_trace',
    sourceRecordId: 'trace-phase10',
    detail: { ruleId: 'experience_missing_fact' },
    createdAt: '2026-08-10T02:00:00.000Z',
  };
}

function sha256(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
