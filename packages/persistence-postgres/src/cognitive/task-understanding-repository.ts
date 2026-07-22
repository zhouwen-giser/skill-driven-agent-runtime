import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { TaskUnderstandingRepository } from '../../../application/src/cognitive/index.js';
import {
  createCognitiveSourceRef,
  createGenericTaskUnderstandingRevision,
  type CognitiveSourceRef,
  type GenericTaskUnderstandingRevision,
  type PlanningAssumption,
  type TaskUnderstandingDisposition,
} from '../../../domain/src/index.js';

interface UnderstandingRow extends QueryResultRow {
  understanding_id: string;
  task_id: string;
  revision: number;
  disposition: TaskUnderstandingDisposition;
  objective: string;
  model_invocation_id: string;
  policy_version: string;
  state_hash: string;
  snapshot: unknown;
  source_refs: unknown;
  created_at: Date | string;
}

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

const UnderstandingSnapshotSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    understandingId: z.string(),
    taskId: z.string(),
    revision: z.number().int(),
    originalRequest: z.string(),
    objective: z.string(),
    taskTypeCandidates: z.array(
      z
        .object({
          taskTypeId: z.string(),
          version: z.number().int(),
          confidence: z.number(),
          rationale: z.string(),
        })
        .strict(),
    ),
    capabilityRequirements: z.array(
      z
        .object({
          capabilityId: z.string(),
          description: z.string(),
          required: z.boolean(),
          available: z.boolean(),
        })
        .strict(),
    ),
    knownConstraints: z.array(z.string()),
    knownDimensions: z.array(
      z
        .object({
          kind: DimensionKindSchema,
          value: z.string(),
          source: z.enum([
            'user_request',
            'conversation_context',
            'world_state',
            'task_type',
            'low_risk_preference',
            'model_candidate',
          ]),
        })
        .strict(),
    ),
    assumptions: z.array(
      z
        .object({
          assumptionId: z.string(),
          statement: z.string(),
          risk: z.enum(['low', 'medium', 'high']),
          dimensionKind: DimensionKindSchema.optional(),
        })
        .strict(),
    ),
    missingDimensions: z.array(
      z
        .object({
          dimensionId: z.string(),
          kind: DimensionKindSchema,
          severity: z.enum(['blocking', 'conditional', 'non_blocking']),
          question: z.string(),
          answered: z.boolean(),
          authorizationSensitive: z.boolean(),
        })
        .strict(),
    ),
    confidence: z.number(),
    disposition: z.enum([
      'clarification_required',
      'confirmation_required',
      'contract_candidate',
      'rejected',
    ]),
    sourceRefs: z.array(SourceRefSchema),
    modelInvocationId: z.string(),
    policyVersion: z.string(),
    stateHash: z.string(),
    createdAt: z.string(),
  })
  .strict();

export class PostgresTaskUnderstandingRepository implements TaskUnderstandingRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findCurrent(taskId: string): Promise<GenericTaskUnderstandingRevision | undefined> {
    const rows = await findRows(this.#pool, taskId, true);
    return rows[0] === undefined ? undefined : mapUnderstanding(rows[0]);
  }

  async listRevisions(taskId: string): Promise<readonly GenericTaskUnderstandingRevision[]> {
    return (await findRows(this.#pool, taskId, false)).map(mapUnderstanding);
  }

  async saveRevision(
    revision: GenericTaskUnderstandingRevision,
    expectedCurrentRevision?: number,
  ): Promise<void> {
    const candidate = createGenericTaskUnderstandingRevision(revision);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:understanding:' || $1))",
        [candidate.taskId],
      );
      const duplicate = await client.query<{ understanding_id: string }>(
        'SELECT understanding_id FROM generic_task_understanding WHERE task_id=$1 AND state_hash=$2',
        [candidate.taskId, candidate.stateHash],
      );
      if (duplicate.rows[0] !== undefined) {
        await client.query('COMMIT');
        return;
      }
      const current = await client.query<{ revision: number }>(
        'SELECT revision FROM generic_task_understanding WHERE task_id=$1 ORDER BY revision DESC LIMIT 1',
        [candidate.taskId],
      );
      if ((current.rows[0]?.revision ?? 0) !== (expectedCurrentRevision ?? 0)) {
        throw new Error('TASK_UNDERSTANDING_REVISION_CONFLICT');
      }
      await insertUnderstanding(client, candidate);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertUnderstanding(
  client: PoolClient,
  candidate: GenericTaskUnderstandingRevision,
): Promise<void> {
  await client.query(
    `INSERT INTO generic_task_understanding(
       understanding_id,task_id,revision,disposition,objective,model_invocation_id,
       policy_version,state_hash,snapshot,source_refs,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      candidate.understandingId,
      candidate.taskId,
      candidate.revision,
      candidate.disposition,
      candidate.objective,
      candidate.modelInvocationId,
      candidate.policyVersion,
      candidate.stateHash,
      JSON.stringify(candidate),
      JSON.stringify(candidate.sourceRefs),
      candidate.createdAt,
    ],
  );
  for (const dimension of candidate.missingDimensions) {
    await client.query(
      `INSERT INTO generic_task_understanding_dimension(
         understanding_id,dimension_id,kind,severity,question,answered,authorization_sensitive
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        candidate.understandingId,
        dimension.dimensionId,
        dimension.kind,
        dimension.severity,
        dimension.question,
        dimension.answered,
        dimension.authorizationSensitive,
      ],
    );
  }
  const eventId = `task.understanding_created:${candidate.understandingId}`;
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at
     ) VALUES ($1,'task.understanding_created','generic_task_understanding',$2,$3,$4,$5,$6)`,
    [
      eventId,
      candidate.understandingId,
      candidate.revision,
      JSON.stringify({ correlationId: eventId, taskId: candidate.taskId }),
      JSON.stringify({
        taskId: candidate.taskId,
        disposition: candidate.disposition,
        stateHash: candidate.stateHash,
        modelInvocationId: candidate.modelInvocationId,
      }),
      candidate.createdAt,
    ],
  );
}

async function findRows(
  queryable: Pick<Pool, 'query'>,
  taskId: string,
  currentOnly: boolean,
): Promise<readonly UnderstandingRow[]> {
  const result = await queryable.query<UnderstandingRow>(
    `SELECT understanding_id,task_id,revision,disposition,objective,model_invocation_id,
            policy_version,state_hash,snapshot,source_refs,created_at
     FROM generic_task_understanding WHERE task_id=$1
     ORDER BY revision ${currentOnly ? 'DESC LIMIT 1' : 'ASC'}`,
    [taskId],
  );
  return result.rows;
}

function mapUnderstanding(row: UnderstandingRow): GenericTaskUnderstandingRevision {
  const snapshot = UnderstandingSnapshotSchema.parse(row.snapshot);
  const sourceRefs = z.array(SourceRefSchema).parse(row.source_refs).map(normalizeSourceRef);
  const assumptions = snapshot.assumptions.map((assumption): PlanningAssumption =>
    assumption.dimensionKind === undefined
      ? {
          assumptionId: assumption.assumptionId,
          statement: assumption.statement,
          risk: assumption.risk,
        }
      : { ...assumption, dimensionKind: assumption.dimensionKind },
  );
  return createGenericTaskUnderstandingRevision({
    ...snapshot,
    understandingId: row.understanding_id,
    taskId: row.task_id,
    revision: row.revision,
    disposition: row.disposition,
    objective: row.objective,
    modelInvocationId: row.model_invocation_id,
    policyVersion: row.policy_version,
    stateHash: row.state_hash,
    assumptions,
    sourceRefs,
    createdAt: toIsoString(row.created_at),
  });
}

function normalizeSourceRef(value: z.infer<typeof SourceRefSchema>): CognitiveSourceRef {
  return createCognitiveSourceRef(
    value.contentHash === undefined
      ? {
          schemaVersion: value.schemaVersion,
          sourceRefId: value.sourceRefId,
          sourceKind: value.sourceKind,
          sourceId: value.sourceId,
          sourceRevision: value.sourceRevision,
          authority: value.authority,
          dataClassification: value.dataClassification,
          capturedAt: value.capturedAt,
        }
      : { ...value, contentHash: value.contentHash },
  );
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
