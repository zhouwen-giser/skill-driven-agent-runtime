import {
  EVIDENCE_RECORD_CATALOG,
  buildRuntimeSourceArtifact,
  canonicalizeSourceArtifactJson,
  createCognitiveSourceRef,
  createArtifactValidationResult,
  createCatalogEvidenceEnvelope,
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
  hashSourceArtifactJson,
  type CanonicalEvidenceEnvelope,
  type ArtifactReplayValidationResult,
  type ArtifactValidationResult,
  type EvidenceJsonValue,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import type { McpCapabilityEvidenceWriter } from './mcp-capability-evidence-projector.js';

export type ExperienceReplayArtifactSourceRow = Readonly<Record<string, EvidenceJsonValue>>;

export const EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION = '1.4.1-phase8.2' as const;

export type ExperienceReplayArtifactProjectionKind =
  | 'experience_task'
  | 'experience_pattern'
  | 'replay_case'
  | 'replay_dataset'
  | 'validation'
  | 'artifact'
  | 'retrieval'
  | 'usage'
  | 'feedback'
  | 'promotion';

export interface ExperienceReplayArtifactProjectionPartition {
  readonly kind: ExperienceReplayArtifactProjectionKind;
  readonly sourceFamily: 'experience' | 'replay' | 'artifact';
  readonly sourcePartition: string;
  readonly sourceId: string;
  readonly sourceVersion?: number;
  readonly episodeId?: string;
}

export interface ExperienceReplayArtifactEvidenceSnapshot {
  readonly partition: ExperienceReplayArtifactProjectionPartition;
  readonly task?: ExperienceReplayArtifactSourceRow;
  readonly checkpoint?: ExperienceReplayArtifactSourceRow;
  readonly episodes: readonly ExperienceReplayArtifactSourceRow[];
  readonly traces: readonly ExperienceReplayArtifactSourceRow[];
  readonly patterns: readonly ExperienceReplayArtifactSourceRow[];
  readonly corrections: readonly ExperienceReplayArtifactSourceRow[];
  readonly interactions: readonly ExperienceReplayArtifactSourceRow[];
  readonly replayCases: readonly ExperienceReplayArtifactSourceRow[];
  readonly datasets: readonly ExperienceReplayArtifactSourceRow[];
  readonly artifacts: readonly ExperienceReplayArtifactSourceRow[];
  readonly validationRuns: readonly ExperienceReplayArtifactSourceRow[];
  readonly caseResults: readonly ExperienceReplayArtifactSourceRow[];
  readonly counterexamples: readonly ExperienceReplayArtifactSourceRow[];
  readonly retrievals: readonly ExperienceReplayArtifactSourceRow[];
  readonly usages: readonly ExperienceReplayArtifactSourceRow[];
  readonly feedback: readonly ExperienceReplayArtifactSourceRow[];
  readonly promotions: readonly ExperienceReplayArtifactSourceRow[];
  readonly existingEvidence: readonly ExperienceReplayArtifactSourceRow[];
}

export interface ExperienceReplayArtifactEvidenceSource {
  pendingPartitions(limit: number): Promise<readonly ExperienceReplayArtifactProjectionPartition[]>;
  load(
    partition: ExperienceReplayArtifactProjectionPartition,
  ): Promise<ExperienceReplayArtifactEvidenceSnapshot | undefined>;
}

export interface ExperienceReplayArtifactEvidenceWriter extends McpCapabilityEvidenceWriter {
  resolveSourceQualityIssues(input: {
    readonly sourceTable: string;
    readonly sourceRecordId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void>;
}

export interface ExperienceReplayArtifactProjectionResult {
  readonly sourcePartition: string;
  readonly taskId?: string;
  readonly projectedRecordIds: readonly string[];
  readonly qualityIssueIds: readonly string[];
  readonly lastEvidenceSequence: string;
}

interface EvidenceScope {
  readonly tenantId?: string;
  readonly userScopeId?: string;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly episodeId?: string;
  readonly runId?: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly correlationId: string;
  readonly causationId?: string;
}

interface EmitInput {
  readonly type: string;
  readonly sourceId: string;
  readonly revision: EvidenceJsonValue;
  readonly occurredAt: string;
  readonly payload: ExperienceReplayArtifactSourceRow;
  readonly refs: readonly string[];
  readonly artifactRefs?: readonly string[];
  readonly scope: EvidenceScope;
}

interface RequiredReferenceTarget {
  readonly type: string;
  readonly sourceId: string;
  readonly alias?: boolean;
}

export class ExperienceReplayArtifactEvidenceProjector {
  readonly #source: ExperienceReplayArtifactEvidenceSource;
  readonly #writer: ExperienceReplayArtifactEvidenceWriter;
  readonly #environment: string;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(input: {
    readonly source: ExperienceReplayArtifactEvidenceSource;
    readonly writer: ExperienceReplayArtifactEvidenceWriter;
    readonly environment: string;
    readonly clock?: Readonly<{ now(): string }>;
  }) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#environment = requiredText(input.environment, 'environment');
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async projectPartition(
    partition: ExperienceReplayArtifactProjectionPartition,
  ): Promise<ExperienceReplayArtifactProjectionResult> {
    const snapshot = await this.#source.load(partition);
    if (snapshot === undefined)
      throw new Error(
        `Experience/Replay/Artifact source ${partition.sourcePartition} was not found.`,
      );
    if (snapshot.partition.sourcePartition !== partition.sourcePartition)
      throw new Error('Experience Evidence source partition drift.');
    const recordedAt = this.#clock.now();
    const authorityRevision = aggregateRevision(snapshot);
    const sourceCursor = aggregateCursor(snapshot);
    const taskId = optionalText(snapshot.task, 'task_id');
    const projected = new Map<string, CanonicalEvidenceEnvelope>();
    const aliases = new Map<string, string>();
    const sequences: string[] = [];
    const issueIds: string[] = [];
    const qualityScopes = new Map<
      string,
      {
        readonly sourceTable: string;
        readonly sourceRecordId: string;
        readonly recordType: string;
        readonly retainedIssueIds: string[];
      }
    >();
    const touchQualityScope = (recordType: string, sourceTable: string, sourceRecordId: string) => {
      const key = `${String(recordType.length)}:${recordType}|${String(sourceTable.length)}:${sourceTable}|${sourceRecordId}`;
      let current = qualityScopes.get(key);
      if (current === undefined) {
        current = { recordType, sourceTable, sourceRecordId, retainedIssueIds: [] };
        qualityScopes.set(key, current);
      }
      return current;
    };
    const existingByIdentity = new Map<string, string>();
    const existingWorkflowAliases = new Map<string, string>();
    for (const row of snapshot.existingEvidence) {
      const recordType = optionalText(row, 'record_type');
      const sourceRecordId = optionalText(row, 'source_record_id');
      const recordId = optionalText(row, 'record_id');
      if (recordType === undefined || sourceRecordId === undefined || recordId === undefined) {
        continue;
      }
      const identity = `${recordType}:${sourceRecordId}`;
      if (!existingByIdentity.has(identity)) existingByIdentity.set(identity, recordId);
      const workflowPatternId = nestedString(row, 'payload', 'workflowPatternId');
      if (
        workflowPatternId !== undefined &&
        !existingWorkflowAliases.has(`${recordType}:${workflowPatternId}`)
      ) {
        existingWorkflowAliases.set(`${recordType}:${workflowPatternId}`, recordId);
      }
    }
    const existing = (type: string, sourceId: string) =>
      existingByIdentity.get(`${type}:${sourceId}`);
    const existingAlias = (type: string, alias: string) =>
      existingWorkflowAliases.get(`${type}:${alias}`);
    const ref = (type: string, sourceId: string, alias = false) =>
      (alias ? aliases.get(`${type}:${sourceId}`) : undefined) ??
      projected.get(`${type}:${sourceId}`)?.recordId ??
      (alias ? existingAlias(type, sourceId) : existing(type, sourceId));
    const issue = async (
      recordType: string,
      sourceTable: string,
      sourceRecordId: string,
      detail: ExperienceReplayArtifactSourceRow,
      issueCode: EvidenceQualityIssue['issueCode'] = 'reference_unresolved',
      scope?: EvidenceScope,
    ) => {
      const sanitizedDetail = sanitize(detail) as ExperienceReplayArtifactSourceRow;
      const issueId = `quality_${hashCanonicalEvidenceJson([
        partition.sourcePartition,
        recordType,
        sourceTable,
        sourceRecordId,
        issueCode,
        sanitizedDetail,
      ]).slice(7)}`;
      const value: EvidenceQualityIssue = {
        issueId,
        issueCode,
        severity: 'blocking',
        recordType,
        ...(scope?.episodeId === undefined ? {} : { episodeId: scope.episodeId }),
        sourceSystem: 'runtime',
        sourceTable,
        sourceRecordId,
        detail: sanitizedDetail,
        createdAt: recordedAt,
      };
      await this.#writer.recordQualityIssue(value);
      issueIds.push(issueId);
      touchQualityScope(recordType, sourceTable, sourceRecordId).retainedIssueIds.push(issueId);
    };
    const requireRefs = async (
      recordType: string,
      sourceId: string,
      targets: readonly RequiredReferenceTarget[],
      scope: EvidenceScope,
      allowExternalized = false,
    ): Promise<readonly string[] | undefined> => {
      const catalog = catalogEntry(recordType);
      const values: string[] = [];
      for (const target of targets) {
        const resolved = ref(target.type, target.sourceId, target.alias ?? false);
        if (resolved === undefined) {
          await issue(
            recordType,
            catalog.sourceTable,
            sourceId,
            { missingReference: target.type, missingSourceId: target.sourceId },
            'reference_unresolved',
            scope,
          );
        } else {
          values.push(resolved);
        }
      }
      const unique = uniqueStrings(values);
      if (unique.length !== targets.length) return undefined;
      if (unique.length > 256 && !allowExternalized) {
        await issue(
          recordType,
          catalog.sourceTable,
          sourceId,
          { referenceCount: unique.length, maximumReferenceCount: 256 },
          'schema_invalid',
          scope,
        );
        return undefined;
      }
      return unique;
    };
    const emit = async (input: EmitInput) => {
      if (input.refs.length > 256)
        throw new Error(`Evidence ${input.type} exceeds the reference bound.`);
      const catalog = catalogEntry(input.type);
      touchQualityScope(input.type, catalog.sourceTable, input.sourceId);
      const scope = input.scope;
      let envelope: CanonicalEvidenceEnvelope;
      try {
        envelope = createCatalogEvidenceEnvelope({
          sourceRecordId: input.sourceId,
          sourceRevision: revision(input.revision),
          recordType: catalog.recordType,
          environment: this.#environment,
          ...optionalScope(scope),
          correlationId: scope.correlationId,
          occurredAt: input.occurredAt,
          recordedAt,
          evidenceRefs: uniqueStrings(input.refs),
          artifactRefs: uniqueStrings(input.artifactRefs ?? []),
          payload: sanitize(input.payload) as ExperienceReplayArtifactSourceRow,
        });
      } catch {
        await issue(
          input.type,
          catalog.sourceTable,
          input.sourceId,
          { catalogEnvelopeValidationFailed: true },
          'schema_invalid',
          scope,
        );
        return undefined;
      }
      sequences.push(await this.#writer.append(envelope, recordedAt, partition.sourcePartition));
      projected.set(`${input.type}:${input.sourceId}`, envelope);
      return envelope;
    };

    if (
      optionalText(snapshot.checkpoint, 'last_source_revision') === authorityRevision &&
      optionalText(snapshot.checkpoint, 'projector_version') ===
        EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION
    ) {
      await this.#writer.saveCheckpoint(
        checkpointFor(snapshot, authorityRevision, authorityRevision, sourceCursor, recordedAt),
      );
      return projectionResult(partition, taskId, projected, issueIds, sequences);
    }

    const runtimeEpisode = taskId === undefined ? undefined : existing('runtime.episode', taskId);
    const runtimeRequest = taskId === undefined ? undefined : existing('runtime.request', taskId);

    for (const row of snapshot.episodes) {
      const id = text(row, 'episode_id');
      const scope = taskScope(snapshot, row, id);
      const sourceRefs = cognitiveSourceRefs(row['source_refs']);
      if (runtimeEpisode === undefined) {
        await issue(
          'experience.episode',
          'goal_experience_episode',
          id,
          { missingReference: 'runtime.episode', missingSourceId: scope.taskId ?? id },
          'reference_unresolved',
          scope,
        );
        continue;
      }
      await emit({
        type: 'experience.episode',
        sourceId: id,
        revision: { revision: value(row, 'revision'), episodeHash: value(row, 'episode_hash') },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          episodeId: id,
          taskId: value(row, 'task_id'),
          contextId: value(row, 'context_id'),
          goalId: value(row, 'goal_id'),
          goalVersion: value(row, 'goal_version'),
          episodeType: value(row, 'episode_type'),
          revision: value(row, 'revision'),
          terminalOutcomeRef: value(row, 'terminal_outcome_ref'),
          sourceHash: value(row, 'source_hash'),
          episodeHash: value(row, 'episode_hash'),
          completeness: value(row, 'completeness'),
          status: value(row, 'status'),
          dataClassification: value(row, 'data_classification'),
          redactionCodes: value(row, 'redaction_codes'),
          sourceRefs,
          missingFactCodes: nestedArray(row, 'snapshot', 'missingFactCodes'),
        },
        refs: [runtimeEpisode],
        scope,
      });
    }

    for (const row of snapshot.traces) {
      const traceId = text(row, 'trace_id');
      const episodeId = text(row, 'source_episode_id');
      const compilationRunRefs = uniqueStrings(stringArray(row['compilation_run_refs']));
      const compilationRunId = compilationRunRefs.length === 1 ? compilationRunRefs[0] : undefined;
      const scope = taskScope(snapshot, row, episodeId, compilationRunId);
      if (compilationRunId === undefined) {
        await issue(
          'experience.trace',
          'experience_trace',
          traceId,
          { expectedUniqueCompilationRun: true, compilationRunRefs },
          'source_identity_missing',
          scope,
        );
        continue;
      }
      const episodeRef = ref('experience.episode', episodeId);
      if (episodeRef === undefined) {
        await issue(
          'experience.trace',
          'experience_trace',
          traceId,
          { missingReference: 'experience.episode', missingSourceId: episodeId },
          'reference_unresolved',
          scope,
        );
        continue;
      }
      const traceBody = record(row, 'trace');
      const events = records(traceBody['events']);
      const eventRecords = new Map<string, string>();
      const activityRecords = new Map<string, string>();
      for (const event of events) {
        const eventId = text(event, 'eventId');
        const eventSourceId = `${traceId}:${eventId}`;
        eventRecords.set(
          eventId,
          predictedRecordId('experience.trace_event', eventSourceId, {
            sourceHash: value(row, 'source_hash'),
            event,
          }),
        );
        const activity = event['activity'];
        if (isRecord(activity)) {
          activityRecords.set(
            eventId,
            predictedRecordId(
              'experience.activity',
              `${eventSourceId}:${text(activity, 'activityKey')}`,
              { sourceHash: value(row, 'source_hash'), activity },
            ),
          );
        }
      }
      let invalidParent = false;
      for (const event of events) {
        for (const parentId of stringArray(event['parentEventRefs'])) {
          if (!eventRecords.has(parentId)) {
            invalidParent = true;
            await issue(
              'experience.trace_event',
              'experience_trace.trace.events[]',
              `${traceId}:${text(event, 'eventId')}`,
              { missingParentEvent: parentId, traceId },
              'reference_unresolved',
              scope,
            );
          }
        }
      }
      if (invalidParent) continue;
      const trace = await emit({
        type: 'experience.trace',
        sourceId: traceId,
        revision: { sourceHash: value(row, 'source_hash') },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          traceId,
          sourceEpisodeId: episodeId,
          taskTypeRefs: value(row, 'task_type_refs'),
          goalFingerprint: value(row, 'goal_fingerprint'),
          capabilityFingerprint: value(row, 'capability_fingerprint'),
          environmentFingerprint: value(row, 'environment_fingerprint'),
          completeness: value(row, 'completeness'),
          dataClassification: value(row, 'data_classification'),
          redactionCodes: value(row, 'redaction_codes'),
          normalizerVersion: value(row, 'normalizer_version'),
          sourceHash: value(row, 'source_hash'),
          traceBody: {
            schemaVersion: value(traceBody, 'schemaVersion'),
            tenantId: value(traceBody, 'tenantId'),
            eventRecordIds: [...eventRecords.values()],
            correctionRefs: value(traceBody, 'correctionRefs'),
            outcomeRef: traceBody['outcomeRef'] ?? null,
            outcomeStatus: value(traceBody, 'outcomeStatus'),
            missingFactCodes: value(traceBody, 'missingFactCodes'),
            environmentClass: value(traceBody, 'environmentClass'),
            deviceClass: traceBody['deviceClass'] ?? null,
          },
        },
        refs: [episodeRef],
        scope,
      });
      if (trace === undefined) continue;
      for (const event of events) {
        const eventId = text(event, 'eventId');
        const eventSourceId = `${traceId}:${eventId}`;
        const parentRefs = stringArray(event['parentEventRefs']).map((id) => {
          const parent = eventRecords.get(id);
          if (parent === undefined) throw new Error('Validated parent Evidence ref disappeared.');
          return parent;
        });
        const eventRecord = await emit({
          type: 'experience.trace_event',
          sourceId: eventSourceId,
          revision: { sourceHash: value(row, 'source_hash'), event },
          occurredAt: timestamp(event, 'occurredAt'),
          payload: {
            traceId,
            eventId,
            sequence: value(event, 'sequence'),
            eventType: value(event, 'eventType'),
            actorType: value(event, 'actorType'),
            activityRecordId: activityRecords.get(eventId) ?? null,
            capabilityRefs: value(event, 'capabilityRefs'),
            authorityRefs: value(event, 'authorityRefs'),
            parentEventRefs: value(event, 'parentEventRefs'),
            concurrencyGroup: event['concurrencyGroup'] ?? null,
            branchRef: event['branchRef'] ?? null,
            payloadSummary: value(event, 'payloadSummary'),
          },
          refs: [trace.recordId, ...parentRefs],
          scope,
        });
        if (eventRecord === undefined) continue;
        const activity = event['activity'];
        if (isRecord(activity)) {
          await emit({
            type: 'experience.activity',
            sourceId: `${eventSourceId}:${text(activity, 'activityKey')}`,
            revision: { sourceHash: value(row, 'source_hash'), activity },
            occurredAt: timestamp(event, 'occurredAt'),
            payload: {
              traceId,
              eventId,
              activityKey: value(activity, 'activityKey'),
              activityKind: value(activity, 'activityKind'),
              objectiveSummary: value(activity, 'objectiveSummary'),
              sourcePlanNodeRef: activity['sourcePlanNodeRef'] ?? null,
              sourceSkillGoalRef: activity['sourceSkillGoalRef'] ?? null,
              sourceAttemptRef: activity['sourceAttemptRef'] ?? null,
              operationRef: activity['operationRef'] ?? null,
              capabilityRefs: value(activity, 'capabilityRefs'),
              effectRefs: value(activity, 'effectRefs'),
            },
            refs: [eventRecord.recordId],
            scope,
          });
        }
      }
    }

    for (const row of snapshot.patterns) {
      const patternId = text(row, 'pattern_id');
      const definition = record(row, 'definition');
      const cohort = record(definition, 'cohort');
      const discovered = record(definition, 'discoveredPattern');
      const workflow = record(definition, 'workflowPattern');
      const workflowPatternId = text(workflow, 'workflowPatternId');
      const tenantIds = stringArray(row['tenant_ids']);
      const cohortTenant = text(cohort, 'tenantId');
      const compilationRunRefs = uniqueStrings(stringArray(row['compilation_run_refs']));
      const compilationRunId = compilationRunRefs.length === 1 ? compilationRunRefs[0] : undefined;
      const scope = globalScope(
        { tenant_id: tenantIds.length === 1 ? (tenantIds[0] ?? null) : null },
        `experience-pattern:${patternId}`,
        compilationRunId,
      );
      if (tenantIds.length !== 1 || tenantIds[0] !== cohortTenant) {
        await issue(
          'experience.workflow_pattern',
          'pattern_candidate',
          patternId,
          { cohortTenant, supportTenantIds: tenantIds },
          'source_identity_missing',
          scope,
        );
        continue;
      }
      if (compilationRunId === undefined) {
        await issue(
          'experience.workflow_pattern',
          'pattern_candidate',
          patternId,
          { expectedUniqueCompilationRun: true, compilationRunRefs },
          'source_identity_missing',
          scope,
        );
        continue;
      }
      const patternArtifact = buildRuntimeSourceArtifact({
        sourceTable: 'pattern_candidate',
        sourceRecordId: patternId,
        sourceVersion: 1,
        value: definition,
      });
      if (
        patternArtifact.artifactRef.sha256 !== text(row, 'definition_content_hash') ||
        patternArtifact.artifactRef.byteSize !== integer(row, 'definition_uncompressed_bytes')
      ) {
        await issue(
          'experience.workflow_pattern',
          'pattern_candidate',
          patternId,
          {
            expectedHash: value(row, 'definition_content_hash'),
            expectedBytes: value(row, 'definition_uncompressed_bytes'),
            actualHash: patternArtifact.artifactRef.sha256,
            actualBytes: patternArtifact.artifactRef.byteSize,
          },
          'payload_hash_conflict',
          scope,
        );
        continue;
      }
      const patternDefinitionArtifactRef =
        patternArtifact.artifactRef as unknown as EvidenceJsonValue;
      const patternArtifactRefs = [patternArtifact.artifactRef.uri];
      const authoritativeSupportRefs = stringArray(discovered['supportRefs']);
      const authoritativeContradictionRefs = stringArray(discovered['contradictionRefs']);
      if (
        !sameStringSet(authoritativeSupportRefs, stringArray(row['support_refs'])) ||
        !sameStringSet(authoritativeContradictionRefs, stringArray(row['contradiction_refs']))
      ) {
        await issue(
          'experience.workflow_pattern',
          'pattern_candidate',
          patternId,
          { persistedReferenceSetsDoNotMatchDefinition: true },
          'payload_hash_conflict',
          scope,
        );
        continue;
      }
      const variants = records(definition['variants']);
      const variantRefs: string[] = [];
      for (const [variantIndex, variant] of variants.entries()) {
        const variantId = text(variant, 'variantId');
        const sourceId = `${patternId}:${variantId}`;
        const traceIds = stringArray(variant['traceRefs']);
        const traceTargets = traceIds.map((traceId) => ({
          type: 'experience.trace',
          sourceId: traceId,
        }));
        const resolvedTraceRefs = await requireRefs(
          'experience.process_variant',
          sourceId,
          traceTargets,
          scope,
          true,
        );
        if (resolvedTraceRefs === undefined) continue;
        const refs = resolvedTraceRefs.length <= 256 ? resolvedTraceRefs : [];
        const variantRecord = await emit({
          type: 'experience.process_variant',
          sourceId,
          revision: {
            patternHash: value(row, 'definition_content_hash'),
            variantId,
          },
          occurredAt: timestamp(row, 'created_at'),
          payload: {
            patternId,
            variantId,
            supportCount: value(variant, 'occurrenceCount'),
            occurrenceCount: value(variant, 'occurrenceCount'),
            activitySequence: patternCollection(
              patternArtifact.artifactRef.uri,
              `/variants/${String(variantIndex)}/activitySequence`,
              arrayValue(variant['activitySequence']),
            ),
            activityKindSequence: patternCollection(
              patternArtifact.artifactRef.uri,
              `/variants/${String(variantIndex)}/activityKindSequence`,
              arrayValue(variant['activityKindSequence']),
            ),
            concurrencyGroups: patternCollection(
              patternArtifact.artifactRef.uri,
              `/variants/${String(variantIndex)}/concurrencyGroups`,
              arrayValue(variant['concurrencyGroups']),
            ),
            branchSequence: patternCollection(
              patternArtifact.artifactRef.uri,
              `/variants/${String(variantIndex)}/branchSequence`,
              arrayValue(variant['branchSequence']),
            ),
            traceRefs: patternCollection(
              patternArtifact.artifactRef.uri,
              `/variants/${String(variantIndex)}/traceRefs`,
              traceIds,
            ),
            successCount: value(variant, 'successCount'),
            failureCount: value(variant, 'failureCount'),
            patternDefinitionArtifactRef,
          },
          refs,
          artifactRefs: patternArtifactRefs,
          scope,
        });
        if (variantRecord === undefined) continue;
        variantRefs.push(variantRecord.recordId);
      }
      if (variantRefs.length !== variants.length) continue;
      const pattern = await emit({
        type: 'experience.workflow_pattern',
        sourceId: patternId,
        revision: { contentHash: value(row, 'definition_content_hash') },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          patternId,
          patternType: value(row, 'pattern_type'),
          cohortFingerprint: value(row, 'cohort_fingerprint'),
          supportRefs: patternCollection(
            patternArtifact.artifactRef.uri,
            '/discoveredPattern/supportRefs',
            authoritativeSupportRefs,
          ),
          contradictionRefs: patternCollection(
            patternArtifact.artifactRef.uri,
            '/discoveredPattern/contradictionRefs',
            authoritativeContradictionRefs,
          ),
          confidence: value(row, 'confidence'),
          status: value(row, 'status'),
          workflowPatternId,
          taskTypeId: value(workflow, 'taskTypeId'),
          activityPatterns: patternCollection(
            patternArtifact.artifactRef.uri,
            '/workflowPattern/activityPatterns',
            arrayValue(workflow['activityPatterns']),
          ),
          sourcePatternRef: value(workflow, 'sourcePatternRef'),
          sourceTraceRefs: patternCollection(
            patternArtifact.artifactRef.uri,
            '/workflowPattern/sourceTraceRefs',
            arrayValue(workflow['sourceTraceRefs']),
          ),
          quality: value(workflow, 'quality'),
          sourceSnapshotHash: value(row, 'definition_content_hash'),
          processVariantSet: patternCollectionDescriptor(
            patternArtifact.artifactRef.uri,
            '/variants',
            variants,
          ),
          patternDefinitionArtifactRef,
        },
        refs: variantRefs.length <= 256 ? variantRefs : [],
        artifactRefs: patternArtifactRefs,
        scope,
      });
      if (pattern === undefined) continue;
      aliases.set(`experience.workflow_pattern:${workflowPatternId}`, pattern.recordId);
      aliases.set(
        `experience.workflow_pattern:${text(workflow, 'sourcePatternRef')}`,
        pattern.recordId,
      );
      for (const [dependencyIndex, dependency] of records(
        workflow['dependencyPatterns'],
      ).entries()) {
        const dependencyKey = stableChildKey('dependency', dependency);
        await emit({
          type: 'experience.workflow_pattern_dependency',
          sourceId: `${patternId}:${dependencyKey}`,
          revision: {
            patternHash: value(row, 'definition_content_hash'),
            dependencyKey,
          },
          occurredAt: timestamp(row, 'created_at'),
          payload: {
            patternId,
            dependencyKey,
            dependencyType: value(dependency, 'relation'),
            predecessorActivityKey: value(dependency, 'predecessorActivityKey'),
            successorActivityKey: value(dependency, 'successorActivityKey'),
            condition: dependency['condition'] ?? null,
            supportRefs: patternCollection(
              patternArtifact.artifactRef.uri,
              `/workflowPattern/dependencyPatterns/${String(dependencyIndex)}/supportRefs`,
              arrayValue(dependency['supportRefs']),
            ),
            contradictionRefs: patternCollection(
              patternArtifact.artifactRef.uri,
              `/workflowPattern/dependencyPatterns/${String(dependencyIndex)}/contradictionRefs`,
              arrayValue(dependency['contradictionRefs']),
            ),
            patternDefinitionArtifactRef,
          },
          refs: [pattern.recordId],
          artifactRefs: patternArtifactRefs,
          scope,
        });
      }
      for (const [recoveryIndex, recovery] of records(workflow['recoveryPatterns']).entries()) {
        const recoveryPatternId = stableChildKey('recovery', recovery);
        await emit({
          type: 'experience.recovery_pattern',
          sourceId: `${patternId}:${recoveryPatternId}`,
          revision: {
            patternHash: value(row, 'definition_content_hash'),
            recoveryPatternId,
          },
          occurredAt: timestamp(row, 'created_at'),
          payload: {
            patternId,
            recoveryPatternId,
            triggerActivityKey: value(recovery, 'triggerActivityKey'),
            resumeActivityKey: recovery['resumeActivityKey'] ?? null,
            activitySequence: patternCollection(
              patternArtifact.artifactRef.uri,
              `/workflowPattern/recoveryPatterns/${String(recoveryIndex)}/activitySequence`,
              arrayValue(recovery['activitySequence']),
            ),
            requiredCapabilityRefs: patternCollection(
              patternArtifact.artifactRef.uri,
              `/workflowPattern/recoveryPatterns/${String(recoveryIndex)}/requiredCapabilityRefs`,
              arrayValue(recovery['requiredCapabilityRefs']),
            ),
            supportRefs: patternCollection(
              patternArtifact.artifactRef.uri,
              `/workflowPattern/recoveryPatterns/${String(recoveryIndex)}/supportRefs`,
              arrayValue(recovery['supportRefs']),
            ),
            patternDefinitionArtifactRef,
          },
          refs: [pattern.recordId],
          artifactRefs: patternArtifactRefs,
          scope,
        });
      }
    }

    for (const row of snapshot.corrections) {
      const id = text(row, 'correction_id');
      const scope = taskScope(snapshot, row, taskId ?? id);
      const sourceRefs = cognitiveSourceRefs(row['source_refs']);
      const planTargets = sourceRefs
        .filter((source) => source['sourceKind'] === 'plan_revision')
        .map((source) => ({ type: 'runtime.plan', sourceId: text(source, 'sourceId') }));
      const episodeTargets = sourceRefs
        .filter((source) => source['sourceKind'] === 'goal_experience_episode')
        .map((source) => ({ type: 'experience.episode', sourceId: text(source, 'sourceId') }));
      if (planTargets.length === 0 || episodeTargets.length === 0) {
        await issue(
          'experience.planning_correction',
          'planning_correction_fact',
          id,
          { missingExactSourceKinds: ['plan_revision', 'goal_experience_episode'] },
          'reference_unresolved',
          scope,
        );
        continue;
      }
      const refs = await requireRefs(
        'experience.planning_correction',
        id,
        [...planTargets, ...episodeTargets],
        scope,
      );
      if (refs === undefined) continue;
      await emit({
        type: 'experience.planning_correction',
        sourceId: id,
        revision: { correctionHash: value(row, 'correction_hash') },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          correctionId: id,
          taskId: value(row, 'task_id'),
          correctionType: value(row, 'correction_type'),
          scope: value(row, 'scope'),
          target: value(row, 'target_scope'),
          accepted: value(row, 'accepted'),
          correctionHash: value(row, 'correction_hash'),
          patchHash: hashCanonicalEvidenceJson(value(row, 'structured_patch')),
          sourceRefs,
          counterexampleRefs: value(row, 'counterexample_refs'),
        },
        refs,
        scope,
      });
    }

    for (const row of snapshot.interactions) {
      const id = text(row, 'episode_id');
      const scope = taskScope(snapshot, row, taskId ?? id);
      const sourceRefs = cognitiveSourceRefs(row['source_refs']);
      if (runtimeEpisode === undefined) {
        await issue(
          'experience.interaction_episode',
          'planning_interaction_episode',
          id,
          { missingReference: 'runtime.episode', missingSourceId: scope.taskId ?? id },
          'reference_unresolved',
          scope,
        );
        continue;
      }
      await emit({
        type: 'experience.interaction_episode',
        sourceId: id,
        revision: { revision: value(row, 'revision'), episodeHash: value(row, 'episode_hash') },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          episodeId: id,
          taskId: value(row, 'task_id'),
          revision: value(row, 'revision'),
          goalId: row['goal_id'] ?? null,
          goalVersion: row['goal_version'] ?? null,
          completeness: value(row, 'completeness'),
          inductionFingerprint: value(row, 'induction_fingerprint'),
          episodeHash: value(row, 'episode_hash'),
          outcomeRef: row['outcome_ref'] ?? null,
          correctionIds: value(row, 'correction_ids'),
          counterexampleRefs: value(row, 'counterexample_refs'),
          sourceRefs,
        },
        refs: [runtimeEpisode],
        scope,
      });
    }

    for (const row of snapshot.replayCases) {
      const id = text(row, 'replay_case_id');
      const scope = taskScope(snapshot, row, text(row, 'primary_source_episode_id'));
      const content = record(row, 'content');
      const sourceEpisodes = stringArray(content['sourceEpisodeRefs']);
      const targets = sourceEpisodes.map((episodeId) => ({
        type: 'experience.episode',
        sourceId: episodeId,
      }));
      const refs = await requireRefs('replay.case', id, targets, scope);
      if (refs === undefined || refs.length === 0) {
        if (targets.length === 0)
          await issue(
            'replay.case',
            'artifact_replay_case',
            id,
            { missingReference: 'experience.episode' },
            'reference_unresolved',
            scope,
          );
        continue;
      }
      const artifact = buildRuntimeSourceArtifact({
        sourceTable: 'artifact_replay_case',
        sourceRecordId: id,
        sourceVersion: 1,
        value: content,
      });
      await emit({
        type: 'replay.case',
        sourceId: id,
        revision: { contentHash: value(row, 'content_hash') },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          replayCaseId: id,
          taskTypeId: value(row, 'task_type_id'),
          tenantId: value(row, 'tenant_id'),
          primarySourceEpisodeId: value(row, 'primary_source_episode_id'),
          sourceEpisodeRefs: value(content, 'sourceEpisodeRefs'),
          goalLineageHash: value(content, 'goalLineageHash'),
          environmentClass: value(content, 'environmentClass'),
          deviceClass: content['deviceClass'] ?? null,
          snapshotCompleteness: value(row, 'snapshot_completeness'),
          contentHash: value(row, 'content_hash'),
          sourceSnapshotHash: value(row, 'content_hash'),
          artifactRef: artifact.artifactRef as unknown as EvidenceJsonValue,
        },
        refs,
        artifactRefs: [artifact.artifactRef.uri],
        scope,
      });
    }

    for (const row of snapshot.artifacts) {
      const id = text(row, 'artifact_id');
      const version = integer(row, 'version');
      const sourceId = `${id}:${String(version)}`;
      const scope = globalScope(row, `artifact:${sourceId}`);
      const stored = record(row, 'definition');
      const storedArtifact = record(stored, 'artifact');
      const definition = value(storedArtifact, 'definition');
      const artifact = buildRuntimeSourceArtifact({
        sourceTable: 'compiled_artifact',
        sourceRecordId: id,
        sourceVersion: version,
        value: definition,
      });
      if (artifact.artifactRef.sha256 !== text(row, 'content_hash')) {
        await issue(
          'artifact.lifecycle',
          'compiled_artifact + artifact_lineage',
          sourceId,
          { expectedHash: value(row, 'content_hash'), actualHash: artifact.artifactRef.sha256 },
          'payload_hash_conflict',
          scope,
        );
        continue;
      }
      const lineage = record(row, 'lineage');
      const workflowPatternRefs = uniqueStrings(stringArray(row['workflow_pattern_refs']));
      if (workflowPatternRefs.length !== 1) {
        await issue(
          'artifact.lifecycle',
          'compiled_artifact + artifact_lineage',
          sourceId,
          {
            expectedUniqueWorkflowPatternReference: true,
            workflowPatternRefs,
            sourcePatternRefs: value(lineage, 'source_pattern_refs'),
          },
          'source_identity_missing',
          scope,
        );
        continue;
      }
      const workflowRefs = await requireRefs(
        'artifact.lifecycle',
        sourceId,
        workflowPatternRefs.map((sourcePatternId) => ({
          type: 'experience.workflow_pattern',
          sourceId: sourcePatternId,
          alias: true,
        })),
        scope,
      );
      if (workflowRefs === undefined) continue;
      const dependencySnapshot = record(storedArtifact, 'dependencySnapshot');
      const policyRefs = uniqueStrings([
        ...records(storedArtifact['requiredPolicies']).map(
          (policy) => `${text(policy, 'policyId')}@${text(policy, 'version')}`,
        ),
        ...stringArray(dependencySnapshot['policyVersionRefs']),
      ]);
      await emit({
        type: 'artifact.lifecycle',
        sourceId,
        revision: {
          version,
          contentHash: value(row, 'content_hash'),
          status: value(row, 'status'),
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          artifactId: id,
          version,
          contentHash: value(row, 'content_hash'),
          artifactType: value(row, 'artifact_type'),
          status: value(row, 'status'),
          tenantId: row['tenant_id'] ?? null,
          domain: value(row, 'domain'),
          riskLevel: value(row, 'risk_level'),
          policyRefs,
          authorityRef: `runtime-postgresql:compiled_artifact:${id}:${String(version)}`,
          artifactRef: artifact.artifactRef as unknown as EvidenceJsonValue,
          lineage: value(row, 'lineage'),
        },
        refs: workflowRefs,
        artifactRefs: [artifact.artifactRef.uri],
        scope,
      });
    }

    for (const row of snapshot.datasets) {
      const id = text(row, 'dataset_id');
      const version = integer(row, 'dataset_version');
      const sourceId = `${id}:${String(version)}`;
      const scope = globalScope(row, `replay-dataset:${sourceId}`);
      const caseTargets = stringArray(row['case_refs']).map((caseId) => ({
        type: 'replay.case',
        sourceId: caseId,
      }));
      const refs = await requireRefs('replay.dataset', sourceId, caseTargets, scope);
      if (refs === undefined || refs.length === 0) {
        if (caseTargets.length === 0)
          await issue(
            'replay.dataset',
            'replay_dataset_manifest',
            sourceId,
            { missingReference: 'replay.case' },
            'reference_unresolved',
            scope,
          );
        continue;
      }
      const content = value(row, 'content');
      const artifact = buildRuntimeSourceArtifact({
        sourceTable: 'replay_dataset_manifest',
        sourceRecordId: id,
        sourceVersion: version,
        value: content,
      });
      await emit({
        type: 'replay.dataset',
        sourceId,
        revision: {
          version,
          contentHash: value(row, 'content_hash'),
          invalidatedAt: row['invalidated_at'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          datasetId: id,
          datasetVersion: version,
          purpose: value(row, 'purpose'),
          tenantId: value(row, 'tenant_id'),
          caseRefs: value(row, 'case_refs'),
          contentHash: value(row, 'content_hash'),
          sourceSnapshotHash: value(row, 'source_hash'),
          leakageCheckRef: value(row, 'leakage_check_ref'),
          promotionEligible: value(row, 'promotion_eligible'),
          invalidatedAt: row['invalidated_at'] ?? null,
          invalidationReason: row['invalidation_reason'] ?? null,
          artifactRef: artifact.artifactRef as unknown as EvidenceJsonValue,
        },
        refs,
        artifactRefs: [artifact.artifactRef.uri],
        scope,
      });
    }

    for (const row of snapshot.validationRuns) {
      const runId = text(row, 'validation_run_id');
      const artifactId = text(row, 'artifact_id');
      const version = integer(row, 'artifact_version');
      const lifecycleSourceId = `${artifactId}:${String(version)}`;
      const scope = globalScope(row, `artifact-validation:${runId}`, runId);
      const replayBacked = isReplayBacked(row);
      const terminal = ['passed', 'failed'].includes(text(row, 'status'));
      let replayResult: ArtifactReplayValidationResult | undefined;
      if (replayBacked && terminal) {
        const resultPayload = row['result_payload'];
        try {
          const validated = createArtifactValidationResult(
            resultPayload as unknown as ArtifactValidationResult,
          );
          if (validated.validationType !== 'replay') {
            throw new Error('Replay-backed validation persisted a non-Replay result.');
          }
          replayResult = validated;
        } catch {
          await issue(
            'replay.run',
            'artifact_validation_run',
            runId,
            { invalidReplaySafetyResultContract: true },
            'schema_invalid',
            scope,
          );
          continue;
        }
        const expectedArtifactRef = `${artifactId}:v${String(version)}`;
        const expectedDatasetRef = `${text(row, 'dataset_ref')}:v${String(
          integer(row, 'dataset_version'),
        )}`;
        if (
          replayResult.validationRunId !== runId ||
          replayResult.artifactRef !== expectedArtifactRef ||
          replayResult.datasetRef !== expectedDatasetRef ||
          replayResult.artifactHash !== optionalText(row, 'artifact_hash') ||
          replayResult.datasetHash !== optionalText(row, 'dataset_hash') ||
          replayResult.resultHash !== optionalText(row, 'result_hash') ||
          replayResult.validatorVersion !== optionalText(row, 'validator_version') ||
          replayResult.metricCatalogVersion !== optionalText(row, 'metric_catalog_version') ||
          replayResult.result !== optionalText(row, 'result') ||
          replayResult.completedAt !== timestamp(row, 'completed_at') ||
          revision(replayResult.metrics) !== revision(value(row, 'metrics')) ||
          revision(replayResult.counterexampleRefs) !==
            revision(value(row, 'counterexample_refs')) ||
          (text(row, 'status') === 'passed') !== (replayResult.result === 'passed')
        ) {
          await issue(
            'replay.run',
            'artifact_validation_run',
            runId,
            {
              persistedReplayResultIdentityMismatch: true,
              expectedArtifactRef,
              expectedDatasetRef,
            },
            'payload_hash_conflict',
            scope,
          );
          continue;
        }
      }
      const lifecycleRefs = await requireRefs(
        'artifact.validation',
        runId,
        [{ type: 'artifact.lifecycle', sourceId: lifecycleSourceId }],
        scope,
      );
      if (lifecycleRefs === undefined) continue;
      const validation = await emit({
        type: 'artifact.validation',
        sourceId: runId,
        revision: row,
        occurredAt: timestamp(row, 'updated_at', 'started_at'),
        payload: {
          validationRunId: runId,
          artifactId,
          artifactVersion: version,
          validationType: value(row, 'validation_type'),
          datasetRef: value(row, 'dataset_ref'),
          datasetVersion: row['dataset_version'] ?? null,
          artifactHash: row['artifact_hash'] ?? null,
          datasetHash: row['dataset_hash'] ?? null,
          status: value(row, 'status'),
          result: row['result'] ?? null,
          metrics: value(row, 'metrics'),
          resultHash: row['result_hash'] ?? null,
          validatorVersion: row['validator_version'] ?? null,
          metricCatalogVersion: row['metric_catalog_version'] ?? null,
          counterexampleRefs: value(row, 'counterexample_refs'),
        },
        refs: lifecycleRefs,
        scope,
      });
      if (validation === undefined) continue;
      if (!replayBacked) continue;
      const datasetId = text(row, 'dataset_ref');
      const datasetVersion = integer(row, 'dataset_version');
      const replayScope = globalScope(row, `replay-run:${runId}`, runId);
      const runRefs = await requireRefs(
        'replay.run',
        runId,
        [
          { type: 'replay.dataset', sourceId: `${datasetId}:${String(datasetVersion)}` },
          { type: 'artifact.validation', sourceId: runId },
        ],
        replayScope,
      );
      if (runRefs === undefined) continue;
      const replaySafety = replayResult?.replaySafety;
      if (terminal && replaySafety === undefined) {
        await issue(
          'replay.run',
          'artifact_validation_run',
          runId,
          { missingReplaySafetyProof: true, resultHash: row['result_hash'] ?? null },
          'source_identity_missing',
          replayScope,
        );
        continue;
      }
      const replaySafetyPayload =
        replaySafety === undefined ? null : (replaySafety as unknown as EvidenceJsonValue);
      await emit({
        type: 'replay.run',
        sourceId: runId,
        revision: row,
        occurredAt: timestamp(row, 'updated_at', 'started_at'),
        payload: {
          validationRunId: runId,
          artifactId,
          artifactVersion: version,
          status: value(row, 'status'),
          datasetId,
          datasetVersion,
          sourceSnapshotHash: value(row, 'dataset_hash'),
          validatorVersion: row['validator_version'] ?? null,
          metricCatalogVersion: row['metric_catalog_version'] ?? null,
          resultHash: row['result_hash'] ?? null,
          replaySafetyStatus: terminal ? 'verified' : 'pending',
          replaySafety: replaySafetyPayload,
          noPhysicalSideEffects:
            replaySafetyPayload !== null ? hasReplayNoPhysicalProof(replaySafetyPayload) : null,
        },
        refs: runRefs,
        scope: replayScope,
      });

      for (const resultRow of snapshot.caseResults) {
        const caseId = text(resultRow, 'replay_case_id');
        const resultSourceId = `${runId}:${caseId}`;
        const resultScope = taskScope(
          snapshot,
          resultRow,
          text(resultRow, 'source_episode_id'),
          runId,
        );
        const resultRefs = await requireRefs(
          'replay.case_result',
          resultSourceId,
          [
            { type: 'replay.run', sourceId: runId },
            { type: 'replay.case', sourceId: caseId },
          ],
          resultScope,
        );
        if (resultRefs === undefined) continue;
        const result = await emit({
          type: 'replay.case_result',
          sourceId: resultSourceId,
          revision: { resultHash: value(resultRow, 'result_hash') },
          occurredAt: timestamp(resultRow, 'created_at'),
          payload: {
            validationRunId: runId,
            replayCaseId: caseId,
            resultHash: value(resultRow, 'result_hash'),
            evaluation: value(resultRow, 'evaluation'),
          },
          refs: resultRefs,
          scope: resultScope,
        });
        if (result === undefined) continue;
        for (const [metricKey, metricValue] of Object.entries(record(resultRow, 'metrics'))) {
          if (forbiddenKey(metricKey)) continue;
          await emit({
            type: 'replay.metric_result',
            sourceId: `${resultSourceId}:${metricKey}`,
            revision: { resultHash: value(resultRow, 'result_hash'), metricKey, metricValue },
            occurredAt: timestamp(resultRow, 'created_at'),
            payload: { validationRunId: runId, replayCaseId: caseId, metricKey, metricValue },
            refs: [result.recordId],
            scope: resultScope,
          });
        }
      }
      for (const counterexampleRow of snapshot.counterexamples) {
        const id = text(counterexampleRow, 'counterexample_id');
        const caseId = text(counterexampleRow, 'replay_case_id');
        const counterexampleScope = taskScope(
          snapshot,
          counterexampleRow,
          text(counterexampleRow, 'source_episode_id'),
          runId,
        );
        const refs = await requireRefs(
          'replay.counterexample',
          id,
          [
            { type: 'replay.case_result', sourceId: `${runId}:${caseId}` },
            {
              type: 'artifact.lifecycle',
              sourceId: `${text(counterexampleRow, 'artifact_id')}:${String(
                integer(counterexampleRow, 'artifact_version'),
              )}`,
            },
          ],
          counterexampleScope,
        );
        if (refs === undefined) continue;
        await emit({
          type: 'replay.counterexample',
          sourceId: id,
          revision: counterexampleRow,
          occurredAt: timestamp(counterexampleRow, 'created_at'),
          payload: {
            counterexampleId: id,
            artifactId: value(counterexampleRow, 'artifact_id'),
            artifactVersion: value(counterexampleRow, 'artifact_version'),
            replayCaseId: caseId,
            validationRunId: runId,
            failureId: value(counterexampleRow, 'failure_id'),
            conditionFingerprint: value(counterexampleRow, 'condition_fingerprint'),
            status: value(counterexampleRow, 'status'),
            content: value(counterexampleRow, 'content'),
          },
          refs,
          scope: counterexampleScope,
        });
      }
    }

    for (const row of snapshot.retrievals) {
      const id = text(row, 'match_id');
      const artifactId = text(row, 'candidate_artifact_id');
      const version = integer(row, 'artifact_version');
      const scope = taskScope(snapshot, row, text(row, 'task_id'));
      const refs = await requireRefs(
        'artifact.retrieval',
        id,
        [
          { type: 'artifact.lifecycle', sourceId: `${artifactId}:${String(version)}` },
          { type: 'runtime.request', sourceId: text(row, 'task_id') },
        ],
        scope,
      );
      if (refs === undefined || runtimeRequest === undefined) continue;
      await emit({
        type: 'artifact.retrieval',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          matchId: id,
          candidateArtifactId: artifactId,
          artifactVersion: version,
          decision: value(row, 'decision'),
          policySnapshotHash: value(row, 'policy_snapshot_hash'),
          requestId: value(row, 'request_id'),
          reasonCodes: value(row, 'reason_codes'),
          applicability: artifactApplicabilityPayload(value(row, 'applicability')),
          score: artifactMatchScorePayload(value(row, 'score')),
        },
        refs,
        scope,
      });
    }

    for (const row of snapshot.usages) {
      const id = text(row, 'artifact_execution_id');
      const artifactId = text(row, 'artifact_id');
      const version = integer(row, 'artifact_version');
      const scope = taskScope(snapshot, row, text(row, 'task_id'));
      const retrievalMatchId = optionalText(row, 'retrieval_match_id');
      const retrievalDecisionId = optionalText(row, 'retrieval_decision_id');
      const selected = optionalText(row, 'retrieval_selected_artifact_ref');
      const exactSelected =
        selected === `${artifactId}:${String(version)}` ||
        selected === `${artifactId}:v${String(version)}`;
      if (
        retrievalMatchId === undefined ||
        retrievalDecisionId === undefined ||
        optionalText(row, 'retrieval_task_id') !== text(row, 'task_id') ||
        optionalText(row, 'retrieval_artifact_id') !== artifactId ||
        optionalInteger(row, 'retrieval_artifact_version') !== version ||
        !exactSelected
      ) {
        await issue(
          'artifact.usage',
          'artifact_execution',
          id,
          {
            missingExactRetrievalLink: retrievalMatchId === undefined,
            retrievalDecisionId: retrievalDecisionId ?? null,
            retrievalMatchId: retrievalMatchId ?? null,
            retrievalArtifactVersion: row['retrieval_artifact_version'] ?? null,
            selectedArtifactRef: selected ?? null,
          },
          'reference_unresolved',
          scope,
        );
        continue;
      }
      const refs = await requireRefs(
        'artifact.usage',
        id,
        [
          { type: 'artifact.lifecycle', sourceId: `${artifactId}:${String(version)}` },
          { type: 'artifact.retrieval', sourceId: retrievalMatchId },
          { type: 'runtime.episode', sourceId: text(row, 'task_id') },
        ],
        scope,
      );
      if (refs === undefined) continue;
      await emit({
        type: 'artifact.usage',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'started_at'),
        payload: {
          artifactExecutionId: id,
          artifactId,
          artifactVersion: version,
          status: value(row, 'status'),
          taskId: value(row, 'task_id'),
          goalId: row['goal_id'] ?? null,
          goalVersion: row['goal_version'] ?? null,
          generatedPlanId: row['generated_plan_id'] ?? null,
          mode: value(row, 'mode'),
          retrievalDecisionId,
          retrievalMatchId,
        },
        refs,
        scope,
      });
    }

    for (const row of snapshot.feedback) {
      const id = text(row, 'feedback_id');
      const scope = taskScope(snapshot, row, text(row, 'task_id'));
      const usageId = text(row, 'artifact_execution_id');
      const refs = await requireRefs(
        'artifact.feedback',
        id,
        [{ type: 'artifact.usage', sourceId: usageId }],
        scope,
      );
      if (refs === undefined) continue;
      await emit({
        type: 'artifact.feedback',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          feedbackId: id,
          artifactExecutionId: usageId,
          artifactId: value(row, 'artifact_id'),
          artifactVersion: value(row, 'artifact_version'),
          feedbackType: value(row, 'feedback_type'),
          reasonCode: value(row, 'reason_code'),
          summary: value(row, 'summary'),
          impact: value(row, 'impact'),
          outcomeRef: row['outcome_ref'] ?? null,
        },
        refs,
        scope,
      });
    }

    for (const row of snapshot.promotions) {
      const id = text(row, 'promotion_package_id');
      const artifactId = text(row, 'artifact_id');
      const version = integer(row, 'artifact_version');
      const validationId = text(row, 'validation_summary_ref');
      const scope = globalScope(row, `artifact-promotion:${id}`);
      const validation = snapshot.validationRuns.find(
        (candidate) => candidate['validation_run_id'] === validationId,
      );
      if (
        validation === undefined ||
        optionalText(validation, 'result_hash') !== text(row, 'validation_summary_hash')
      ) {
        await issue(
          'artifact.promotion',
          'artifact_promotion_package + artifact_promotion_assessment',
          id,
          {
            validationSummaryRef: validationId,
            expectedValidationSummaryHash: value(row, 'validation_summary_hash'),
            actualValidationSummaryHash: validation?.['result_hash'] ?? null,
          },
          'payload_hash_conflict',
          scope,
        );
        continue;
      }
      const counterexampleSummary = records(row['validation_counterexamples']);
      const counterexampleIds = counterexampleSummary.map((entry) =>
        text(entry, 'counterexampleId'),
      );
      const actualCounterexampleSummaryHash = hashCanonicalEvidenceJson(
        counterexampleSummary.map((entry) => value(entry, 'content')),
      );
      if (actualCounterexampleSummaryHash !== text(row, 'counterexample_summary_hash')) {
        await issue(
          'artifact.promotion',
          'artifact_promotion_package + artifact_promotion_assessment',
          id,
          {
            counterexampleSummaryRef: value(row, 'counterexample_summary_ref'),
            expectedCounterexampleSummaryHash: value(row, 'counterexample_summary_hash'),
            actualCounterexampleSummaryHash,
          },
          'payload_hash_conflict',
          scope,
        );
        continue;
      }
      const refs = await requireRefs(
        'artifact.promotion',
        id,
        [
          { type: 'artifact.lifecycle', sourceId: `${artifactId}:${String(version)}` },
          { type: 'artifact.validation', sourceId: validationId },
          ...counterexampleIds.map((sourceId) => ({
            type: 'replay.counterexample',
            sourceId,
          })),
        ],
        scope,
      );
      if (refs === undefined) continue;
      await emit({
        type: 'artifact.promotion',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          promotionPackageId: id,
          artifactId,
          artifactVersion: version,
          artifactRef: value(row, 'artifact_ref'),
          artifactHash: value(row, 'artifact_hash'),
          eligibility: value(row, 'eligibility'),
          promotionPolicyVersion: value(row, 'promotion_policy_version'),
          validationSummaryRef: value(row, 'validation_summary_ref'),
          validationSummaryHash: value(row, 'validation_summary_hash'),
          shadowSummaryRef: value(row, 'shadow_summary_ref'),
          shadowSummaryHash: value(row, 'shadow_summary_hash'),
          counterexampleSummaryRef: value(row, 'counterexample_summary_ref'),
          counterexampleSummaryHash: value(row, 'counterexample_summary_hash'),
          riskReviewRef: value(row, 'risk_review_ref'),
          riskReviewHash: value(row, 'risk_review_hash'),
          dependencySnapshotRef: value(row, 'dependency_snapshot_ref'),
          dependencySnapshotHash: value(row, 'dependency_snapshot_hash'),
          evidenceHash: nestedValue(row, 'assessment', 'evidence_hash') ?? null,
          counterexampleRefs: counterexampleIds,
        },
        refs,
        scope,
      });
    }

    for (const scope of qualityScopes.values()) {
      await this.#writer.resolveSourceQualityIssues({
        sourceTable: scope.sourceTable,
        sourceRecordId: scope.sourceRecordId,
        recordTypePrefix: scope.recordType,
        retainedIssueIds: uniqueStrings(scope.retainedIssueIds),
        resolvedAt: recordedAt,
      });
    }
    const checkpointRevision =
      issueIds.length === 0 ? authorityRevision : `blocked:${authorityRevision.slice(7)}`;
    await this.#writer.saveCheckpoint(
      checkpointFor(snapshot, checkpointRevision, authorityRevision, sourceCursor, recordedAt),
    );
    return projectionResult(partition, taskId, projected, issueIds, sequences);
  }
}

function projectionResult(
  partition: ExperienceReplayArtifactProjectionPartition,
  taskId: string | undefined,
  projected: ReadonlyMap<string, CanonicalEvidenceEnvelope>,
  issueIds: readonly string[],
  sequences: readonly string[],
): ExperienceReplayArtifactProjectionResult {
  const lastEvidenceSequence = sequences.reduce(
    (max, current) => (BigInt(current) > BigInt(max) ? current : max),
    '0',
  );
  return Object.freeze({
    sourcePartition: partition.sourcePartition,
    ...(taskId === undefined ? {} : { taskId }),
    projectedRecordIds: Object.freeze([...projected.values()].map((record) => record.recordId)),
    qualityIssueIds: Object.freeze([...issueIds]),
    lastEvidenceSequence,
  });
}

function checkpointFor(
  snapshot: ExperienceReplayArtifactEvidenceSnapshot,
  revisionValue: string,
  payloadHash: string,
  cursor: Readonly<{ occurredAt?: string; sourceRecordId: string }>,
  recordedAt: string,
): EvidenceSourceCheckpoint {
  return {
    sourceFamily: snapshot.partition.sourceFamily,
    sourcePartition: snapshot.partition.sourcePartition,
    ...(cursor.occurredAt === undefined ? {} : { lastOccurredAt: cursor.occurredAt }),
    lastSourceRecordId: cursor.sourceRecordId,
    lastSourceRevision: revisionValue,
    lastPayloadHash: payloadHash as `sha256:${string}`,
    lastProjectedAt: recordedAt,
    projectorVersion: EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
  };
}

function aggregateRevision(snapshot: ExperienceReplayArtifactEvidenceSnapshot) {
  return hashSourceArtifactJson(
    sanitize({
      partition: snapshot.partition as unknown as EvidenceJsonValue,
      task: snapshot.task ?? null,
      episodes: snapshot.episodes,
      traces: snapshot.traces,
      patterns: snapshot.patterns,
      corrections: snapshot.corrections,
      interactions: snapshot.interactions,
      replayCases: snapshot.replayCases,
      datasets: snapshot.datasets,
      artifacts: snapshot.artifacts,
      validationRuns: snapshot.validationRuns,
      caseResults: snapshot.caseResults,
      counterexamples: snapshot.counterexamples,
      retrievals: snapshot.retrievals,
      usages: snapshot.usages,
      feedback: snapshot.feedback,
      promotions: snapshot.promotions,
    }),
  );
}

function aggregateCursor(snapshot: ExperienceReplayArtifactEvidenceSnapshot) {
  let occurredAt: string | undefined;
  for (const row of [
    ...snapshot.episodes,
    ...snapshot.traces,
    ...snapshot.patterns,
    ...snapshot.corrections,
    ...snapshot.interactions,
    ...snapshot.replayCases,
    ...snapshot.datasets,
    ...snapshot.artifacts,
    ...snapshot.validationRuns,
    ...snapshot.caseResults,
    ...snapshot.counterexamples,
    ...snapshot.retrievals,
    ...snapshot.usages,
    ...snapshot.feedback,
    ...snapshot.promotions,
  ]) {
    for (const field of ['updated_at', 'completed_at', 'created_at', 'started_at'] as const) {
      const value = row[field];
      if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
        const normalized = new Date(value).toISOString();
        if (occurredAt === undefined || normalized > occurredAt) occurredAt = normalized;
      }
    }
  }
  return Object.freeze({
    ...(occurredAt === undefined ? {} : { occurredAt }),
    sourceRecordId: partitionSourceRecordId(snapshot.partition),
  });
}

function catalogEntry(type: string) {
  const result = EVIDENCE_RECORD_CATALOG.find((entry) => entry.recordType === type);
  if (result === undefined) throw new Error(`Missing Evidence catalog ${type}.`);
  return result;
}

function revision(value: EvidenceJsonValue) {
  return hashCanonicalEvidenceJson(sanitize(value));
}

function stableChildKey(prefix: string, value: EvidenceJsonValue) {
  return `${prefix}_${hashSourceArtifactJson(sanitize(value)).slice(7)}`;
}

const PATTERN_INLINE_COLLECTION_MAX_BYTES = 8 * 1024;

function patternCollection(
  artifactRefUri: string,
  jsonPointer: string,
  collection: readonly EvidenceJsonValue[],
): EvidenceJsonValue {
  const canonicalBytes = new TextEncoder().encode(
    canonicalizeSourceArtifactJson(collection),
  ).byteLength;
  if (
    collection.length === 0 ||
    (collection.length <= 256 && canonicalBytes <= PATTERN_INLINE_COLLECTION_MAX_BYTES)
  ) {
    return collection;
  }
  return patternCollectionDescriptor(artifactRefUri, jsonPointer, collection);
}

function patternCollectionDescriptor(
  artifactRefUri: string,
  jsonPointer: string,
  collection: readonly EvidenceJsonValue[],
): EvidenceJsonValue {
  if (collection.length === 0) {
    throw new Error('An external Pattern collection descriptor cannot identify an empty array.');
  }
  return Object.freeze({
    artifactRefUri,
    jsonPointer,
    count: collection.length,
    sha256: hashSourceArtifactJson(collection),
  });
}

function predictedRecordId(type: string, sourceId: string, revisionValue: EvidenceJsonValue) {
  const catalog = catalogEntry(type);
  return createEvidenceRecordId({
    sourceSystem: catalog.sourceSystem,
    sourceTable: catalog.sourceTable,
    sourceRecordId: sourceId,
    sourceRevision: revision(revisionValue),
    schemaName: catalog.schemaName,
    schemaVersion: catalog.schemaVersion,
  });
}

function taskScope(
  snapshot: ExperienceReplayArtifactEvidenceSnapshot,
  row: ExperienceReplayArtifactSourceRow,
  correlationFallback: string,
  runId?: string,
): EvidenceScope {
  const task = snapshot.task;
  const taskId =
    optionalText(row, 'source_task_id') ??
    optionalText(row, 'task_id') ??
    optionalText(task, 'task_id');
  const contextId =
    optionalText(row, 'source_context_id') ??
    optionalText(row, 'context_id') ??
    optionalText(task, 'context_id');
  const tenantId =
    optionalText(row, 'source_tenant_id') ??
    optionalText(row, 'tenant_id') ??
    optionalText(row, 'artifact_tenant_id');
  const userScopeId =
    optionalText(row, 'source_user_scope_id') ??
    optionalText(row, 'user_scope_id') ??
    optionalText(row, 'user_id') ??
    optionalText(task, 'user_id');
  const goalId =
    optionalText(row, 'source_goal_id') ??
    optionalText(row, 'goal_id') ??
    optionalText(task, 'goal_id');
  const goalVersion =
    optionalInteger(row, 'source_goal_version') ??
    optionalInteger(row, 'goal_version') ??
    optionalInteger(task, 'goal_version');
  const planId = optionalText(row, 'source_plan_id') ?? optionalText(task, 'evidence_plan_id');
  const planVersion =
    optionalInteger(row, 'source_plan_version') ?? optionalInteger(task, 'evidence_plan_version');
  const correlationId = taskId ?? `source:${correlationFallback}`;
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(userScopeId === undefined ? {} : { userScopeId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(contextId === undefined ? {} : { contextId }),
    ...(taskId === undefined ? {} : { episodeId: taskId }),
    ...(runId === undefined ? {} : { runId }),
    ...(goalId === undefined ? {} : { goalId }),
    ...(goalVersion === undefined ? {} : { goalVersion }),
    ...(planId === undefined ? {} : { planId }),
    ...(planVersion === undefined ? {} : { planVersion }),
    correlationId,
  });
}

function globalScope(
  row: ExperienceReplayArtifactSourceRow,
  correlationId: string,
  runId?: string,
): EvidenceScope {
  const tenantId = optionalText(row, 'tenant_id') ?? optionalText(row, 'artifact_tenant_id');
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(runId === undefined ? {} : { runId }),
    correlationId,
  });
}

function optionalScope(scope: EvidenceScope) {
  return {
    ...(scope.tenantId === undefined ? {} : { tenantId: scope.tenantId }),
    ...(scope.userScopeId === undefined ? {} : { userScopeId: scope.userScopeId }),
    ...(scope.taskId === undefined ? {} : { taskId: scope.taskId }),
    ...(scope.contextId === undefined ? {} : { contextId: scope.contextId }),
    ...(scope.episodeId === undefined ? {} : { episodeId: scope.episodeId }),
    ...(scope.runId === undefined ? {} : { runId: scope.runId }),
    ...(scope.goalId === undefined ? {} : { goalId: scope.goalId }),
    ...(scope.goalVersion === undefined ? {} : { goalVersion: scope.goalVersion }),
    ...(scope.planId === undefined ? {} : { planId: scope.planId }),
    ...(scope.planVersion === undefined ? {} : { planVersion: scope.planVersion }),
    ...(scope.causationId === undefined ? {} : { causationId: scope.causationId }),
  };
}

function isReplayBacked(row: ExperienceReplayArtifactSourceRow) {
  const type = row['validation_type'];
  if (type === 'replay')
    return typeof row['dataset_version'] === 'number' && typeof row['dataset_hash'] === 'string';
  if (type !== 'revalidation' || !isRecord(row['result_payload'])) return false;
  return (
    row['result_payload']['validationType'] === 'replay' &&
    typeof row['dataset_version'] === 'number' &&
    typeof row['dataset_hash'] === 'string'
  );
}

function hasReplayNoPhysicalProof(value: EvidenceJsonValue) {
  if (!isRecord(value)) return false;
  const attempts = value['sideEffectAttemptCount'];
  return (
    value['provider'] === 'ReplayNoPhysicalProvider' &&
    value['physicalAdapterInvocationCount'] === 0 &&
    typeof attempts === 'number' &&
    Number.isSafeInteger(attempts) &&
    attempts >= 0 &&
    value['deniedBeforePhysicalBoundaryCount'] === attempts &&
    value['physicalOutcomeClaim'] === 'none'
  );
}

function partitionSourceRecordId(partition: ExperienceReplayArtifactProjectionPartition) {
  return partition.sourceVersion === undefined
    ? partition.sourceId
    : `${partition.sourceId}:${String(partition.sourceVersion)}`;
}

function value(row: ExperienceReplayArtifactSourceRow, field: string): EvidenceJsonValue {
  const result = row[field];
  if (result === undefined) throw new Error(`Experience Evidence source ${field} missing.`);
  return result;
}

function text(row: ExperienceReplayArtifactSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'string' || result.trim() === '')
    throw new Error(`Experience Evidence source ${field} invalid.`);
  return result;
}

function optionalText(row: ExperienceReplayArtifactSourceRow | undefined, field: string) {
  const result = row?.[field];
  return typeof result === 'string' && result.trim() !== '' ? result : undefined;
}

function nestedString(
  row: ExperienceReplayArtifactSourceRow | undefined,
  field: string,
  child: string,
) {
  const result = row?.[field];
  return isRecord(result) && typeof result[child] === 'string' ? result[child] : undefined;
}

function integer(row: ExperienceReplayArtifactSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'number' || !Number.isSafeInteger(result))
    throw new Error(`Experience Evidence source ${field} invalid.`);
  return result;
}

function boolean(row: ExperienceReplayArtifactSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'boolean')
    throw new Error(`Experience Evidence source ${field} boolean invalid.`);
  return result;
}

function probability(row: ExperienceReplayArtifactSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0 || result > 1) {
    throw new Error(`Experience Evidence source ${field} probability invalid.`);
  }
  return result;
}

function optionalInteger(row: ExperienceReplayArtifactSourceRow | undefined, field: string) {
  const result = row?.[field];
  return typeof result === 'number' && Number.isSafeInteger(result) ? result : undefined;
}

function timestamp(row: ExperienceReplayArtifactSourceRow, field: string, fallback?: string) {
  const result = row[field] ?? (fallback === undefined ? undefined : row[fallback]);
  if (typeof result !== 'string' || !Number.isFinite(Date.parse(result)))
    throw new Error(`Experience Evidence source ${field} timestamp invalid.`);
  return new Date(result).toISOString();
}

function record(row: ExperienceReplayArtifactSourceRow, field: string) {
  const result = value(row, field);
  if (!isRecord(result)) throw new Error(`Experience Evidence source ${field} object invalid.`);
  return result;
}

function records(
  value: EvidenceJsonValue | undefined,
): readonly ExperienceReplayArtifactSourceRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new Error('Experience Evidence source object array invalid.');
  }
  return value as readonly ExperienceReplayArtifactSourceRow[];
}

function cognitiveSourceRefs(
  value: EvidenceJsonValue | undefined,
): readonly ExperienceReplayArtifactSourceRow[] {
  return Object.freeze(
    records(value).map((source) => {
      if (source['schemaVersion'] !== '1.0') {
        throw new Error('Experience Evidence CognitiveSourceRef schemaVersion invalid.');
      }
      const contentHash = optionalText(source, 'contentHash');
      const canonical = createCognitiveSourceRef({
        schemaVersion: '1.0',
        sourceRefId: text(source, 'sourceRefId'),
        sourceKind: text(source, 'sourceKind'),
        sourceId: text(source, 'sourceId'),
        sourceRevision: integer(source, 'sourceRevision'),
        authority: text(source, 'authority'),
        dataClassification: text(source, 'dataClassification'),
        capturedAt: timestamp(source, 'capturedAt'),
        ...(contentHash === undefined ? {} : { contentHash }),
      } as never);
      return canonical as unknown as ExperienceReplayArtifactSourceRow;
    }),
  );
}

function artifactApplicabilityPayload(value: EvidenceJsonValue): EvidenceJsonValue {
  if (!isRecord(value)) throw new Error('Artifact applicability source object invalid.');
  return Object.freeze({
    artifactRef: text(value, 'artifactRef'),
    applicable: boolean(value, 'applicable'),
    confidence: probability(value, 'confidence'),
    satisfiedConditionIds: stringArray(value['satisfiedConditionIds']),
    missingConditionIds: stringArray(value['missingConditionIds']),
    violatedConditionIds: stringArray(value['violatedConditionIds']),
    uncertainConditionIds: stringArray(value['uncertainConditionIds']),
    outOfDistribution: boolean(value, 'outOfDistribution'),
    disposition: text(value, 'disposition'),
    reasonCodes: stringArray(value['reasonCodes']),
  });
}

function artifactMatchScorePayload(value: EvidenceJsonValue): EvidenceJsonValue {
  if (!isRecord(value)) throw new Error('Artifact match score source object invalid.');
  return Object.freeze({
    intentScore: probability(value, 'intentScore'),
    structuredConditionScore: probability(value, 'structuredConditionScore'),
    parameterCoverageScore: probability(value, 'parameterCoverageScore'),
    capabilityShapeScore: probability(value, 'capabilityShapeScore'),
    environmentSimilarityScore: probability(value, 'environmentSimilarityScore'),
    validationConfidenceScore: probability(value, 'validationConfidenceScore'),
    recentReliabilityScore: probability(value, 'recentReliabilityScore'),
    riskPenalty: probability(value, 'riskPenalty'),
    totalScore: probability(value, 'totalScore'),
  });
}

function nestedValue(row: ExperienceReplayArtifactSourceRow, field: string, child: string) {
  const parent = row[field];
  return isRecord(parent) ? parent[child] : undefined;
}

function nestedArray(row: ExperienceReplayArtifactSourceRow, field: string, child: string) {
  return arrayValue(nestedValue(row, field, child));
}

function arrayValue(value: EvidenceJsonValue | undefined): readonly EvidenceJsonValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Experience Evidence source array invalid.');
  return value as readonly EvidenceJsonValue[];
}

function stringArray(value: EvidenceJsonValue | undefined) {
  const values = arrayValue(value);
  if (values.some((item) => typeof item !== 'string')) {
    throw new Error('Experience Evidence source string array invalid.');
  }
  return values as readonly string[];
}

function requiredText(value: string, field: string) {
  const clean = value.trim();
  if (clean === '') throw new Error(`${field} missing.`);
  return clean;
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const normalizedLeft = uniqueStrings(left);
  const normalizedRight = uniqueStrings(right);
  return (
    normalizedLeft.length === left.length &&
    normalizedRight.length === right.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function isRecord(value: unknown): value is ExperienceReplayArtifactSourceRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitize(value: EvidenceJsonValue): EvidenceJsonValue {
  if (Array.isArray(value)) {
    const items = value as readonly EvidenceJsonValue[];
    return Object.freeze(items.map((item) => sanitize(item)));
  }
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(
      Object.keys(value)
        .filter((key) => !forbiddenKey(key))
        .map((key) => {
          const item = value[key];
          if (item === undefined) throw new Error('Experience Evidence JSON field missing.');
          return [key, sanitize(item)] as const;
        }),
    ),
  );
}

function forbiddenKey(key: string) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  if (normalized.endsWith('credentialref') || normalized.endsWith('secretref')) return false;
  return /(?:credential|password|passwd|accesstoken|refreshtoken|secret|authorization|apikey|privatekey|chainofthought|privatereasoning|reasoningcontent|hiddenreasoning)/u.test(
    normalized,
  );
}
