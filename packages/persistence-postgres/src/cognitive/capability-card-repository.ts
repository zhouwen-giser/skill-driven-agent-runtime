import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { CapabilityCardRepository } from '../../../application/src/cognitive/index.js';
import {
  createPublicCapabilityCardSnapshot,
  type CapabilityCardStatus,
  type PublicCapabilityCardSnapshot,
} from '../../../domain/src/index.js';

interface CardRow extends QueryResultRow {
  snapshot_id: string;
  revision: number;
  summary_id: string;
  catalog_hash: string;
  generation_policy_version: string;
  status: CapabilityCardStatus;
  card: unknown;
  card_content_hash: string;
  source_skill_refs: unknown;
  generation_mode: PublicCapabilityCardSnapshot['generationMode'];
  created_at: Date | string;
}

const PublicLimitationSchema = z
  .object({
    code: z.enum(['confirmation_required', 'not_composable']),
    message: z.string(),
  })
  .strict();

const PublicCapabilityProfileSchema = z
  .object({
    profileVersion: z.literal('1.0'),
    catalogHash: z.string(),
    domains: z.array(z.string()),
    capabilities: z.array(
      z
        .object({
          capabilityId: z.string(),
          domain: z.string(),
          title: z.string(),
          description: z.string(),
          effects: z.array(z.string()),
          evidence: z.array(z.string()),
          artifacts: z.array(z.string()),
          modes: z.array(z.string()),
          taskTypes: z.array(z.string()),
          limitations: z.array(PublicLimitationSchema),
        })
        .strict(),
    ),
    limitations: z.array(PublicLimitationSchema),
    generatedAt: z.string(),
  })
  .strict();

const PublicCardJsonSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    cardId: z.string(),
    revision: z.number().int(),
    summaryId: z.string(),
    catalogHash: z.string(),
    generationPolicyVersion: z.string(),
    profileVersion: z.literal('1.0'),
    status: z.enum(['candidate', 'active', 'superseded', 'failed']),
    agentName: z.string(),
    description: z.string(),
    profile: PublicCapabilityProfileSchema,
    publicSkills: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          tags: z.array(z.string()),
          inputModes: z.array(z.string()),
          outputModes: z.array(z.string()),
        })
        .strict(),
    ),
    sourceSkillRefs: z.array(z.string()),
    generationMode: z.enum(['deterministic', 'model_narrative', 'deterministic_fallback']),
    cardContentHash: z.string(),
    generatedAt: z.string(),
  })
  .strict();

export class PostgresCapabilityCardRepository implements CapabilityCardRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findActive(): Promise<PublicCapabilityCardSnapshot | undefined> {
    return this.#findOne(
      `WHERE public_capability_card_snapshot.status='active' AND EXISTS(
         SELECT 1 FROM runtime_capability_summary summary
         WHERE summary.summary_id=public_capability_card_snapshot.summary_id
           AND summary.catalog_hash=public_capability_card_snapshot.catalog_hash
           AND summary.generation_policy_version=public_capability_card_snapshot.generation_policy_version
           AND summary.status='active'
       )`,
    );
  }

  async findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<PublicCapabilityCardSnapshot | undefined> {
    return this.#findOne('WHERE catalog_hash=$1 AND generation_policy_version=$2', [
      catalogHash,
      generationPolicyVersion,
    ]);
  }

  async activate(
    snapshot: PublicCapabilityCardSnapshot,
    expectedActiveRevision?: number,
  ): Promise<PublicCapabilityCardSnapshot> {
    const candidate = createPublicCapabilityCardSnapshot(snapshot);
    if (candidate.status !== 'candidate')
      throw new Error('CAPABILITY_CARD_ACTIVATE_REQUIRES_CANDIDATE');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar:v123:capability-card'))");
      await assertActiveSummaryBinding(client, candidate);
      const existing = await findCardRow(
        client,
        'WHERE catalog_hash=$1 AND generation_policy_version=$2',
        [candidate.catalogHash, candidate.generationPolicyVersion],
      );
      if (existing !== undefined) {
        await activateCard(client, existing.snapshot_id);
        const active = mapCard({ ...existing, status: 'active' });
        await client.query('COMMIT');
        return active;
      }
      const current = await findCardRow(client, "WHERE status='active'");
      if (expectedActiveRevision !== undefined && current?.revision !== expectedActiveRevision) {
        throw new Error('CAPABILITY_CARD_ACTIVE_REVISION_CONFLICT');
      }
      await client.query(
        `INSERT INTO public_capability_card_snapshot(
           snapshot_id,revision,summary_id,catalog_hash,generation_policy_version,status,
           card,card_content_hash,source_skill_refs,generation_mode,created_at
         ) VALUES ($1,$2,$3,$4,$5,'candidate',$6,$7,$8,$9,$10)`,
        [
          candidate.cardId,
          candidate.revision,
          candidate.summaryId,
          candidate.catalogHash,
          candidate.generationPolicyVersion,
          JSON.stringify(candidate),
          candidate.cardContentHash,
          JSON.stringify(candidate.sourceSkillRefs),
          candidate.generationMode,
          candidate.generatedAt,
        ],
      );
      await activateCard(client, candidate.cardId);
      const eventId = `capability.card_published:${candidate.cardId}`;
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at
         ) VALUES ($1,'capability.card_published','public_capability_card',$2,$3,$4,$5,$6)`,
        [
          eventId,
          candidate.cardId,
          candidate.revision,
          JSON.stringify({ correlationId: eventId }),
          JSON.stringify({
            summaryId: candidate.summaryId,
            catalogHash: candidate.catalogHash,
            generationPolicyVersion: candidate.generationPolicyVersion,
            cardContentHash: candidate.cardContentHash,
          }),
          candidate.generatedAt,
        ],
      );
      const active = createPublicCapabilityCardSnapshot({ ...candidate, status: 'active' });
      await client.query('COMMIT');
      return active;
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
  ): Promise<PublicCapabilityCardSnapshot | undefined> {
    const row = await findCardRow(this.#pool, where, parameters);
    return row === undefined ? undefined : mapCard(row);
  }
}

async function assertActiveSummaryBinding(
  client: PoolClient,
  candidate: PublicCapabilityCardSnapshot,
): Promise<void> {
  const result = await client.query<{ matched: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM runtime_capability_summary
       WHERE summary_id=$1 AND catalog_hash=$2 AND generation_policy_version=$3 AND status='active'
     ) AS matched`,
    [candidate.summaryId, candidate.catalogHash, candidate.generationPolicyVersion],
  );
  if (result.rows[0]?.matched !== true) throw new Error('CAPABILITY_CARD_SUMMARY_BINDING_MISMATCH');
}

async function activateCard(client: PoolClient, cardId: string): Promise<void> {
  await client.query(
    `UPDATE public_capability_card_snapshot
     SET status='superseded' WHERE status='active' AND snapshot_id<>$1`,
    [cardId],
  );
  await client.query(
    `UPDATE public_capability_card_snapshot SET status='active' WHERE snapshot_id=$1`,
    [cardId],
  );
}

async function findCardRow(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  where: string,
  parameters: readonly unknown[] = [],
): Promise<CardRow | undefined> {
  const result = await queryable.query<CardRow>(
    `SELECT snapshot_id,revision,summary_id,catalog_hash,generation_policy_version,status,
            card,card_content_hash,source_skill_refs,generation_mode,created_at
     FROM public_capability_card_snapshot ${where}
     ORDER BY created_at DESC,snapshot_id DESC LIMIT 1`,
    [...parameters],
  );
  return result.rows[0];
}

function mapCard(row: CardRow): PublicCapabilityCardSnapshot {
  const card = PublicCardJsonSchema.parse(row.card);
  const sourceSkillRefs = z.array(z.string()).parse(row.source_skill_refs);
  return createPublicCapabilityCardSnapshot({
    ...card,
    cardId: row.snapshot_id,
    revision: row.revision,
    summaryId: row.summary_id,
    catalogHash: row.catalog_hash,
    generationPolicyVersion: row.generation_policy_version,
    status: row.status,
    sourceSkillRefs,
    generationMode: row.generation_mode,
    cardContentHash: row.card_content_hash,
    generatedAt: toIsoString(row.created_at),
  });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
