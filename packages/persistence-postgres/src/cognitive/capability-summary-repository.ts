import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  CapabilityCatalogChangeSource,
  CapabilitySummaryRepository,
} from '../../../application/src/cognitive/index.js';
import {
  createRuntimeCapabilitySummarySnapshot,
  type CapabilitySummaryStatus,
  type CognitiveSourceRef,
  type RuntimeCapabilitySummaryItem,
  type RuntimeCapabilitySummarySnapshot,
} from '../../../domain/src/index.js';

interface SummaryRow extends QueryResultRow {
  summary_id: string;
  revision: number;
  catalog_hash: string;
  generation_policy_version: string;
  status: CapabilitySummaryStatus;
  schema_version: '1.0';
  source_refs: unknown;
  built_at: Date | string;
}

interface ItemRow extends QueryResultRow {
  definition: unknown;
}

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
    sourceRevision: z.number().int().positive(),
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

const CapabilityItemSchema = z
  .object({
    capabilityId: z.string(),
    domain: z.string(),
    title: z.string(),
    shortDescription: z.string(),
    public: z.boolean(),
    effects: z.array(z.string()),
    evidence: z.array(z.string()),
    artifacts: z.array(z.string()),
    contexts: z.array(z.string()),
    modes: z.array(z.string()),
    taskTypes: z.array(z.string()),
    composition: z.array(z.string()),
    limitations: z.array(
      z
        .object({
          limitationId: z.string(),
          reasonCode: z.enum([
            'missing_outcome_specification',
            'internal_only',
            'confirmation_required',
            'not_composable',
            'no_enabled_skill',
          ]),
          detail: z.string(),
        })
        .strict(),
    ),
    exactSkillVersionRefs: z.array(z.string()),
  })
  .strict();

export class PostgresCapabilitySummaryRepository implements CapabilitySummaryRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findActive(): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return this.#findOne("WHERE status='active'");
  }

  async findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return this.#findOne('WHERE catalog_hash=$1 AND generation_policy_version=$2', [
      catalogHash,
      generationPolicyVersion,
    ]);
  }

  async saveAndActivate(
    snapshot: RuntimeCapabilitySummarySnapshot,
    expectedActiveRevision?: number,
  ): Promise<RuntimeCapabilitySummarySnapshot> {
    const candidate = createRuntimeCapabilitySummarySnapshot(snapshot);
    if (candidate.status !== 'building') {
      throw new Error('CAPABILITY_SUMMARY_SAVE_REQUIRES_BUILDING');
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar:v123:capability-summary'))");
      const existing = await findSummaryRow(
        client,
        'WHERE catalog_hash=$1 AND generation_policy_version=$2',
        [candidate.catalogHash, candidate.generationPolicyVersion],
      );
      if (existing !== undefined) {
        await activateSummary(client, existing.summary_id);
        const saved = await loadSummary(client, { ...existing, status: 'active' });
        await client.query('COMMIT');
        return saved;
      }

      const active = await findSummaryRow(client, "WHERE status='active'");
      if (expectedActiveRevision !== undefined && active?.revision !== expectedActiveRevision) {
        throw new Error('CAPABILITY_SUMMARY_ACTIVE_REVISION_CONFLICT');
      }
      await client.query(
        `INSERT INTO runtime_capability_summary(
           summary_id,revision,catalog_hash,generation_policy_version,status,
           schema_version,source_refs,built_at
         ) VALUES ($1,$2,$3,$4,'building',$5,$6,$7)`,
        [
          candidate.summaryId,
          candidate.revision,
          candidate.catalogHash,
          candidate.generationPolicyVersion,
          candidate.schemaVersion,
          JSON.stringify(candidate.sourceRefs),
          candidate.builtAt,
        ],
      );
      for (const [ordinal, item] of candidate.items.entries()) {
        await client.query(
          `INSERT INTO runtime_capability_summary_item(
             summary_id,capability_id,ordinal,title,definition
           ) VALUES ($1,$2,$3,$4,$5)`,
          [candidate.summaryId, item.capabilityId, ordinal, item.title, JSON.stringify(item)],
        );
        for (const limitation of item.limitations) {
          await client.query(
            `INSERT INTO runtime_capability_limitation(
               summary_id,capability_id,limitation_id,reason_code,detail
             ) VALUES ($1,$2,$3,$4,$5)`,
            [
              candidate.summaryId,
              item.capabilityId,
              limitation.limitationId,
              limitation.reasonCode,
              limitation.detail,
            ],
          );
        }
      }
      await activateSummary(client, candidate.summaryId);
      const eventId = `capability.summary_built:${candidate.summaryId}`;
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at
         ) VALUES ($1,'capability.summary_built','runtime_capability_summary',$2,$3,$4,$5,$6)`,
        [
          eventId,
          candidate.summaryId,
          candidate.revision,
          JSON.stringify({ correlationId: eventId }),
          JSON.stringify({
            catalogHash: candidate.catalogHash,
            generationPolicyVersion: candidate.generationPolicyVersion,
          }),
          candidate.builtAt,
        ],
      );
      const saved = createRuntimeCapabilitySummarySnapshot({
        ...candidate,
        status: 'active',
      });
      await client.query('COMMIT');
      return saved;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #findOne(
    where: string,
    parameters: readonly unknown[] = [],
  ): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    const row = await findSummaryRow(this.#pool, where, parameters);
    if (row === undefined) return undefined;
    return loadSummary(this.#pool, row);
  }
}

async function loadSummary(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  row: SummaryRow,
): Promise<RuntimeCapabilitySummarySnapshot> {
  const items = await queryable.query<ItemRow>(
    `SELECT definition
     FROM runtime_capability_summary_item
     WHERE summary_id=$1 ORDER BY ordinal`,
    [row.summary_id],
  );
  return mapSummary(
    row,
    items.rows.map((item) => item.definition),
  );
}

export class PostgresCapabilityCatalogChangeSource implements CapabilityCatalogChangeSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listPendingCatalogChangeEventIds(limit: number): Promise<readonly string[]> {
    const result = await this.#pool.query<{ event_id: string }>(
      `SELECT event_id
       FROM cognitive_runtime_outbox
       WHERE event_type='skill.catalog_changed' AND published_at IS NULL
       ORDER BY occurred_at,event_id LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => row.event_id);
  }

  async markCatalogChangeEventsPublished(
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<void> {
    if (eventIds.length === 0) return;
    const result = await this.#pool.query(
      `UPDATE cognitive_runtime_outbox
       SET published_at=$2
       WHERE event_type='skill.catalog_changed'
         AND published_at IS NULL
         AND event_id=ANY($1::text[])`,
      [eventIds, publishedAt],
    );
    if (result.rowCount !== eventIds.length) {
      throw new Error('CAPABILITY_CATALOG_CHANGE_PUBLISH_CONFLICT');
    }
  }
}

async function activateSummary(client: PoolClient, summaryId: string): Promise<void> {
  await client.query(
    `UPDATE runtime_capability_summary
     SET status='superseded'
     WHERE status='active' AND summary_id<>$1`,
    [summaryId],
  );
  await client.query(`UPDATE runtime_capability_summary SET status='active' WHERE summary_id=$1`, [
    summaryId,
  ]);
}

async function findSummaryRow(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  where: string,
  parameters: readonly unknown[] = [],
): Promise<SummaryRow | undefined> {
  const result = await queryable.query<SummaryRow>(
    `SELECT summary_id,revision,catalog_hash,generation_policy_version,status,
            schema_version,source_refs,built_at
     FROM runtime_capability_summary ${where}
     ORDER BY built_at DESC,summary_id DESC LIMIT 1`,
    [...parameters],
  );
  return result.rows[0];
}

function mapSummary(
  row: SummaryRow,
  rawItems: readonly unknown[],
): RuntimeCapabilitySummarySnapshot {
  return createRuntimeCapabilitySummarySnapshot({
    schemaVersion: row.schema_version,
    summaryId: row.summary_id,
    revision: row.revision,
    catalogHash: row.catalog_hash,
    generationPolicyVersion: row.generation_policy_version,
    status: row.status,
    items: rawItems.map((item) => CapabilityItemSchema.parse(item) as RuntimeCapabilitySummaryItem),
    sourceRefs: z.array(SourceRefSchema).parse(row.source_refs) as readonly CognitiveSourceRef[],
    builtAt: toIsoString(row.built_at),
  });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
