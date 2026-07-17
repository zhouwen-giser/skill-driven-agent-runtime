import type { SkillExecutionRepository } from '../../application/src/index.js';
import {
  assertSkillExecutionStatusTransition,
  createSkillExecutionEvent,
  createSkillExecutionRecord,
  createSkillExecutionReference,
  DomainError,
  type SkillExecutionEvent,
  type SkillExecutionRecord,
  type SkillExecutionReference,
  type SkillExecutionStatus,
  type SkillExecutionView,
} from '../../domain/src/index.js';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

const JsonRecordSchema = z.record(z.string(), z.unknown());
const StringArraySchema = z.array(z.string());

interface RecordRow extends QueryResultRow {
  execution_id: string;
  parent_execution_id: string | null;
  task_id: string;
  goal_id: string;
  goal_version: number;
  skill_id: string;
  skill_version: number;
  selection_ref: string;
  applicability_status: SkillExecutionRecord['applicabilityStatus'];
  usage_policy_json: unknown;
  workflow_plan_id: string;
  workflow_definition_id: string;
  workflow_definition_version: number;
  created_at: Date | string;
}

interface EventRow extends QueryResultRow {
  event_id: string;
  execution_id: string;
  event_type: SkillExecutionEvent['eventType'];
  status_after: SkillExecutionStatus | null;
  summary: string;
  details_json: unknown;
  occurred_at: Date | string;
}

interface ReferenceRow extends QueryResultRow {
  link_id: string;
  execution_id: string;
  kind: SkillExecutionReference['kind'];
  reference_id: string;
  reference_type: string;
  source_system: string;
  uri: string | null;
  checksum: string | null;
  produced_at: Date | string | null;
  producer_refs_json: unknown;
  metadata_json: unknown;
  created_at: Date | string;
}

export class PostgresSkillExecutionRepository implements SkillExecutionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async create(
    inputRecord: SkillExecutionRecord,
    inputEvents: readonly SkillExecutionEvent[],
    inputReferences: readonly SkillExecutionReference[],
  ): Promise<SkillExecutionView> {
    const record = createSkillExecutionRecord(inputRecord);
    const events = inputEvents.map(createSkillExecutionEvent);
    const references = inputReferences.map(createSkillExecutionReference);
    if (events.find((event) => event.statusAfter !== undefined)?.statusAfter !== 'selected')
      invalid('A Skill execution must begin with a selected status event.');
    for (const event of events)
      if (event.executionId !== record.executionId)
        invalid('Initial Skill execution events must belong to the created execution.');
    for (const reference of references)
      if (reference.executionId !== record.executionId)
        invalid('Initial Skill execution references must belong to the created execution.');
    validateStatusSequence(events);

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO skill_execution_record
          (execution_id,parent_execution_id,task_id,goal_id,goal_version,skill_id,skill_version,
           selection_ref,applicability_status,usage_policy_json,workflow_plan_id,
           workflow_definition_id,workflow_definition_version,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)`,
        [
          record.executionId,
          record.parentExecutionId ?? null,
          record.taskId,
          record.goalId,
          record.goalVersion,
          record.skillId,
          record.skillVersion,
          record.selectionRef,
          record.applicabilityStatus,
          JSON.stringify(record.usagePolicy),
          record.workflowPlanId,
          record.workflowDefinitionId,
          record.workflowDefinitionVersion,
          record.createdAt,
        ],
      );
      for (const event of events) await insertEvent(client, event);
      for (const reference of references) await insertReference(client, reference);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return requiredView(await this.find(record.executionId));
  }

  async appendEvent(input: SkillExecutionEvent): Promise<SkillExecutionView> {
    const event = createSkillExecutionEvent(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const record = await client.query<RecordRow>(
        `SELECT * FROM skill_execution_record WHERE execution_id=$1 FOR UPDATE`,
        [event.executionId],
      );
      if (record.rows[0] === undefined) invalid('Skill execution does not exist.');
      const current = await currentStatus(client, event.executionId);
      if (event.statusAfter !== undefined)
        assertSkillExecutionStatusTransition(current, event.statusAfter);
      await insertEvent(client, event);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return requiredView(await this.find(event.executionId));
  }

  async appendReference(input: SkillExecutionReference): Promise<SkillExecutionView> {
    const reference = createSkillExecutionReference(input);
    await insertReference(this.#pool, reference);
    return requiredView(await this.find(reference.executionId));
  }

  async find(executionId: string): Promise<SkillExecutionView | undefined> {
    const result = await this.#pool.query<RecordRow>(
      `SELECT * FROM skill_execution_record WHERE execution_id=$1`,
      [executionId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.#hydrate(row);
  }

  async findByPlan(workflowPlanId: string): Promise<SkillExecutionView | undefined> {
    const result = await this.#pool.query<RecordRow>(
      `SELECT * FROM skill_execution_record WHERE workflow_plan_id=$1 ORDER BY created_at,execution_id LIMIT 1`,
      [workflowPlanId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.#hydrate(row);
  }

  async listByTask(taskId: string): Promise<readonly SkillExecutionView[]> {
    const result = await this.#pool.query<RecordRow>(
      `SELECT * FROM skill_execution_record WHERE task_id=$1 ORDER BY created_at,execution_id`,
      [taskId],
    );
    return Promise.all(result.rows.map((row) => this.#hydrate(row)));
  }

  async listChildren(parentExecutionId: string): Promise<readonly SkillExecutionView[]> {
    const result = await this.#pool.query<RecordRow>(
      `SELECT * FROM skill_execution_record WHERE parent_execution_id=$1 ORDER BY created_at,execution_id`,
      [parentExecutionId],
    );
    return Promise.all(result.rows.map((row) => this.#hydrate(row)));
  }

  async #hydrate(row: RecordRow): Promise<SkillExecutionView> {
    const [eventResult, referenceResult] = await Promise.all([
      this.#pool.query<EventRow>(
        `SELECT * FROM skill_execution_event WHERE execution_id=$1 ORDER BY sequence_number`,
        [row.execution_id],
      ),
      this.#pool.query<ReferenceRow>(
        `SELECT * FROM skill_execution_reference WHERE execution_id=$1 ORDER BY created_at,link_id`,
        [row.execution_id],
      ),
    ]);
    const record = mapRecord(row);
    const events = eventResult.rows.map(mapEvent);
    const status = lastStatus(events);
    return Object.freeze({
      ...record,
      status,
      events: Object.freeze(events),
      references: Object.freeze(referenceResult.rows.map(mapReference)),
    });
  }
}

function validateStatusSequence(events: readonly SkillExecutionEvent[]): void {
  let current: SkillExecutionStatus | undefined;
  for (const event of events) {
    if (event.statusAfter === undefined) continue;
    if (current !== undefined) assertSkillExecutionStatusTransition(current, event.statusAfter);
    current = event.statusAfter;
  }
}

async function currentStatus(
  client: PoolClient,
  executionId: string,
): Promise<SkillExecutionStatus> {
  const result = await client.query<{ status_after: SkillExecutionStatus }>(
    `SELECT status_after FROM skill_execution_event
     WHERE execution_id=$1 AND status_after IS NOT NULL
     ORDER BY sequence_number DESC LIMIT 1`,
    [executionId],
  );
  const status = result.rows[0]?.status_after;
  if (status === undefined) invalid('Skill execution has no authoritative status event.');
  return status;
}

async function insertEvent(client: Pick<Pool, 'query'> | PoolClient, event: SkillExecutionEvent) {
  await client.query(
    `INSERT INTO skill_execution_event
      (event_id,execution_id,event_type,status_after,summary,details_json,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      event.eventId,
      event.executionId,
      event.eventType,
      event.statusAfter ?? null,
      event.summary,
      JSON.stringify(event.details),
      event.occurredAt,
    ],
  );
}

async function insertReference(
  client: Pick<Pool, 'query'> | PoolClient,
  reference: SkillExecutionReference,
) {
  await client.query(
    `INSERT INTO skill_execution_reference
      (link_id,execution_id,kind,reference_id,reference_type,source_system,uri,checksum,
       produced_at,producer_refs_json,metadata_json,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
    [
      reference.linkId,
      reference.executionId,
      reference.kind,
      reference.referenceId,
      reference.referenceType,
      reference.sourceSystem,
      reference.uri ?? null,
      reference.checksum ?? null,
      reference.producedAt ?? null,
      JSON.stringify(reference.producerRefs),
      JSON.stringify(reference.metadata),
      reference.createdAt,
    ],
  );
}

function mapRecord(row: RecordRow): SkillExecutionRecord {
  return createSkillExecutionRecord({
    executionId: row.execution_id,
    ...(row.parent_execution_id === null ? {} : { parentExecutionId: row.parent_execution_id }),
    taskId: row.task_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    selectionRef: row.selection_ref,
    applicabilityStatus: row.applicability_status,
    usagePolicy: JsonRecordSchema.parse(
      row.usage_policy_json,
    ) as unknown as SkillExecutionRecord['usagePolicy'],
    workflowPlanId: row.workflow_plan_id,
    workflowDefinitionId: row.workflow_definition_id,
    workflowDefinitionVersion: row.workflow_definition_version,
    createdAt: toIso(row.created_at),
  });
}

function mapEvent(row: EventRow): SkillExecutionEvent {
  return createSkillExecutionEvent({
    eventId: row.event_id,
    executionId: row.execution_id,
    eventType: row.event_type,
    ...(row.status_after === null ? {} : { statusAfter: row.status_after }),
    summary: row.summary,
    details: JsonRecordSchema.parse(row.details_json),
    occurredAt: toIso(row.occurred_at),
  });
}

function mapReference(row: ReferenceRow): SkillExecutionReference {
  return createSkillExecutionReference({
    linkId: row.link_id,
    executionId: row.execution_id,
    kind: row.kind,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    sourceSystem: row.source_system,
    ...(row.uri === null ? {} : { uri: row.uri }),
    ...(row.checksum === null ? {} : { checksum: row.checksum }),
    ...(row.produced_at === null ? {} : { producedAt: toIso(row.produced_at) }),
    producerRefs: StringArraySchema.parse(row.producer_refs_json),
    metadata: JsonRecordSchema.parse(row.metadata_json),
    createdAt: toIso(row.created_at),
  });
}

function lastStatus(events: readonly SkillExecutionEvent[]): SkillExecutionStatus {
  const status = [...events]
    .reverse()
    .find((event) => event.statusAfter !== undefined)?.statusAfter;
  if (status === undefined) invalid('Skill execution has no authoritative status event.');
  return status;
}

function requiredView(view: SkillExecutionView | undefined): SkillExecutionView {
  if (view === undefined) invalid('Skill execution could not be reloaded.');
  return view;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function invalid(message: string): never {
  throw new DomainError('SKILL_EXECUTION_RECORD_INVALID', message);
}
