import { createHash } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { TaskTypeRepository } from '../../../application/src/cognitive/ports.js';
import {
  createKnowledgeEvidence,
  createTaskTypeDefinitionSnapshot,
  type KnowledgeEvidence,
  type TaskTypeDefinitionSnapshot,
} from '../../../domain/src/index.js';

const DimensionKindSchema = z.enum([
  'target',
  'scope',
  'time_range',
  'priority',
  'criteria',
  'artifact',
  'evidence',
  'side_effect_authorization',
  'risk_tolerance',
  'degradation_policy',
  'uncovered_case_policy',
  'human_confirmation_policy',
]);
const SourceRefSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    sourceRefId: z.string(),
    sourceKind: z.enum([
      'task_request',
      'task_understanding',
      'capability_summary',
      'task_type_definition',
      'user_preference',
      'goal_contract',
      'plan_revision',
      'skill_attempt',
      'workflow_outcome',
      'runtime_terminal_outcome',
      'recovery_decision',
      'business_event',
      'planning_correction',
      'model_invocation',
      'goal_experience_episode',
      'knowledge_revision',
      'skill_version',
    ]),
    sourceId: z.string(),
    sourceRevision: z.number().int(),
    authority: z.enum([
      'runtime_fact',
      'user_instruction',
      'user_confirmation',
      'domain_rule',
      'model_candidate',
      'promoted_knowledge',
      'skill_declaration',
    ]),
    dataClassification: z.enum(['public', 'internal', 'user_scoped', 'restricted']),
    capturedAt: z.string(),
    contentHash: z.string().optional(),
  })
  .strict();
const TaskTypeSnapshotSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    taskTypeId: z.string(),
    revision: z.number().int(),
    status: z.enum(['candidate', 'validating', 'active', 'deprecated', 'rejected']),
    origin: z.enum(['fixture', 'induced']),
    inductionMode: z.enum(['offline_batch', 'online_candidate']),
    fingerprint: z.string(),
    title: z.string(),
    summary: z.string(),
    recognition: z
      .object({
        hints: z.array(z.string()),
        positiveExamples: z.array(z.string()),
        negativeExamples: z.array(z.string()),
      })
      .strict(),
    requiredDimensions: z.array(DimensionKindSchema),
    optionalDimensions: z.array(DimensionKindSchema),
    criteriaTemplate: z.array(z.string()),
    capabilityRequirements: z.array(z.string()),
    goalPattern: z.string(),
    dependencyPattern: z.array(z.string()),
    incompatibleConstraints: z.array(z.string()),
    exemplars: z.array(
      z
        .object({
          episodeId: z.string(),
          goalId: z.string(),
          goalVersion: z.number().int(),
          summary: z.string(),
        })
        .strict(),
    ),
    sourceRefs: z.array(SourceRefSchema),
    modelInvocationId: z.string().optional(),
    createdAt: z.string(),
  })
  .strict();

interface TaskTypeRow extends QueryResultRow {
  knowledge_id: string;
  revision: number;
  status: string;
  fingerprint: string;
  definition: unknown;
  definition_origin: string;
  model_invocation_id: string | null;
}

export class PostgresTaskTypeRepository implements TaskTypeRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findByFingerprint(fingerprint: string): Promise<TaskTypeDefinitionSnapshot | undefined> {
    const result = await this.#pool.query<TaskTypeRow>(
      `SELECT knowledge_id,revision,status,fingerprint,definition,
              definition_origin,model_invocation_id
       FROM task_type_definition
       WHERE fingerprint=$1 AND definition_origin IN ('task_type_induction','fixture')
       ORDER BY revision DESC,created_at DESC,knowledge_id LIMIT 1`,
      [fingerprint],
    );
    return result.rows[0] === undefined ? undefined : mapTaskType(result.rows[0]);
  }

  async list(limit = 100): Promise<readonly TaskTypeDefinitionSnapshot[]> {
    const result = await this.#pool.query<TaskTypeRow>(
      `SELECT knowledge_id,revision,status,fingerprint,definition,
              definition_origin,model_invocation_id
       FROM task_type_definition
       WHERE definition_origin IN ('task_type_induction','fixture')
       ORDER BY created_at DESC,knowledge_id,revision DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapTaskType);
  }

  async saveCandidate(input: TaskTypeDefinitionSnapshot): Promise<boolean> {
    const candidate = createTaskTypeDefinitionSnapshot(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `task-type:${candidate.fingerprint}`,
      ]);
      const exact = await client.query<TaskTypeRow>(
        `SELECT knowledge_id,revision,status,fingerprint,definition,
                definition_origin,model_invocation_id
         FROM task_type_definition WHERE knowledge_id=$1 AND revision=$2`,
        [candidate.taskTypeId, candidate.revision],
      );
      if (exact.rows[0] !== undefined) {
        const existing = mapTaskType(exact.rows[0]);
        if (JSON.stringify(existing) === JSON.stringify(candidate)) {
          await client.query('COMMIT');
          return false;
        }
        throw new Error('TASK_TYPE_REVISION_CONFLICT');
      }
      const latest = await client.query<
        { knowledge_id: string; revision: number } & QueryResultRow
      >(
        `SELECT knowledge_id,revision FROM task_type_definition
         WHERE fingerprint=$1 AND definition_origin IN ('task_type_induction','fixture')
         ORDER BY revision DESC,created_at DESC,knowledge_id LIMIT 1`,
        [candidate.fingerprint],
      );
      const prior = latest.rows[0];
      if (
        (candidate.revision === 1 && prior !== undefined) ||
        (candidate.revision > 1 &&
          (prior?.knowledge_id !== candidate.taskTypeId ||
            prior.revision !== candidate.revision - 1))
      ) {
        throw new Error('TASK_TYPE_REVISION_CONFLICT');
      }
      const episodeIds = candidate.exemplars.map((exemplar) => exemplar.episodeId);
      const persistedEpisodes = await client.query<{ episode_id: string } & QueryResultRow>(
        'SELECT episode_id FROM goal_experience_episode WHERE episode_id=ANY($1::text[])',
        [episodeIds],
      );
      if (persistedEpisodes.rowCount !== episodeIds.length) {
        throw new Error('TASK_TYPE_EXEMPLAR_SOURCE_MISSING');
      }
      await client.query(
        `INSERT INTO task_type_definition(
           knowledge_id,revision,status,scope,tenant_id,user_id,risk,fingerprint,
           definition,version,created_at,definition_origin,model_invocation_id)
         VALUES($1,$2,'candidate','global_candidate',NULL,NULL,'low',$3,$4::jsonb,$2,$5,$6,$7)`,
        [
          candidate.taskTypeId,
          candidate.revision,
          candidate.fingerprint,
          JSON.stringify(candidate),
          candidate.createdAt,
          candidate.origin === 'fixture' ? 'fixture' : 'task_type_induction',
          candidate.modelInvocationId ?? null,
        ],
      );
      for (const exemplar of candidate.exemplars) {
        const evidence = exemplarEvidence(candidate, exemplar.episodeId);
        await client.query(
          `INSERT INTO task_type_evidence(
             knowledge_id,knowledge_revision,evidence_id,polarity,source_ref,created_at)
           VALUES($1,$2,$3,'support',$4::jsonb,$5)`,
          [
            candidate.taskTypeId,
            candidate.revision,
            evidence.evidenceId,
            JSON.stringify(evidence),
            candidate.createdAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES($1,'knowledge.candidate_created','task_type',$2,$3::integer,
           jsonb_build_object('correlationId',$2::text),
           jsonb_build_object(
             'knowledgeKind','task_type','knowledgeId',$2::text,'revision',$3::integer,
             'fingerprint',$4::text,'exemplarCount',$5::integer
           ),
           $6,NULL)`,
        [
          stableId('outbox-task-type-candidate', candidate.taskTypeId, candidate.revision),
          candidate.taskTypeId,
          candidate.revision,
          candidate.fingerprint,
          candidate.exemplars.length,
          candidate.createdAt,
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapTaskType(row: TaskTypeRow): TaskTypeDefinitionSnapshot {
  const parsed = TaskTypeSnapshotSchema.parse(row.definition);
  if (
    row.knowledge_id !== parsed.taskTypeId ||
    row.revision !== parsed.revision ||
    row.status !== parsed.status ||
    row.fingerprint !== parsed.fingerprint ||
    row.model_invocation_id !== (parsed.modelInvocationId ?? null) ||
    row.definition_origin !== (parsed.origin === 'fixture' ? 'fixture' : 'task_type_induction')
  ) {
    throw new Error('TASK_TYPE_PERSISTENCE_INTEGRITY_VIOLATION');
  }
  const { sourceRefs, modelInvocationId, ...snapshot } = parsed;
  return createTaskTypeDefinitionSnapshot({
    ...snapshot,
    sourceRefs: sourceRefs.map(({ contentHash, ...source }) => ({
      ...source,
      ...(contentHash === undefined ? {} : { contentHash }),
    })),
    ...(modelInvocationId === undefined ? {} : { modelInvocationId }),
  });
}

function exemplarEvidence(
  candidate: TaskTypeDefinitionSnapshot,
  episodeId: string,
): KnowledgeEvidence {
  const exemplar = candidate.exemplars.find((item) => item.episodeId === episodeId);
  if (exemplar === undefined) throw new Error('TASK_TYPE_EXEMPLAR_MISSING');
  const sourceRefs = candidate.sourceRefs.filter(
    (source) => source.sourceId === episodeId || source.sourceKind === 'goal_experience_episode',
  );
  const selectedSourceRefs =
    sourceRefs.length === 0 ? candidate.sourceRefs.slice(0, 1) : sourceRefs;
  return createKnowledgeEvidence({
    evidenceId: stableId('task-type-evidence', candidate.taskTypeId, candidate.revision, episodeId),
    polarity: 'support',
    observationId: stableId('task-type-induction', episodeId),
    statementIds: [stableId('task-type-signal', episodeId)],
    sourceEpisodeIds: [episodeId],
    sourceRefIds: selectedSourceRefs.map((source) => source.sourceRefId),
    sourceRefs: selectedSourceRefs,
    outcomeRefs: [stableId('task-type-outcome', exemplar.goalId, exemplar.goalVersion)],
    summary: exemplar.summary,
    createdAt: candidate.createdAt,
  });
}

function stableId(prefix: string, ...values: readonly (string | number)[]): string {
  return `${prefix}-${createHash('sha256')
    .update(values.map(String).join(':'))
    .digest('hex')
    .slice(0, 24)}`;
}
