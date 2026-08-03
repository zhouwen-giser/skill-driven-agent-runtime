import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  A2aCommandContext,
  RuntimeAgentCardDeployment,
} from '../../node-control-application/src/index.js';
import type { JsonObject, RuntimeAgentCardCandidate } from '../../node-control-domain/src/index.js';

export class PostgresRuntimeAgentCardRepository implements RuntimeAgentCardDeployment {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async stage(candidate: RuntimeAgentCardCandidate, command: A2aCommandContext): Promise<void> {
    if (hash(canonical(candidate.card)) !== candidate.revision.contentHash)
      throw new Error('AGENT_CARD_CONTENT_HASH_MISMATCH');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime-agent-card'))");
      if (await replay(client, `${command.scope}:stage`, command, candidate.revision.revision)) {
        await client.query('COMMIT');
        return;
      }
      await client.query(
        `INSERT INTO runtime_agent_card_revision(
           revision,node_id,exposure_refs,content_hash,capability_catalog_hash,status,card,generated_at)
         VALUES($1,$2,$3::jsonb,$4,$5,'staged',$6::jsonb,$7)`,
        [
          candidate.revision.revision,
          candidate.revision.nodeId,
          JSON.stringify(candidate.revision.exposureRefs ?? []),
          candidate.revision.contentHash,
          candidate.revision.capabilityCatalogHash,
          JSON.stringify(candidate.card),
          candidate.revision.generatedAt,
        ],
      );
      for (const exposure of candidate.exposureSnapshots ?? []) {
        await client.query(
          `INSERT INTO runtime_agent_card_exposure_snapshot(
             revision,exposure_id,exposure_version,capability_id,capability_version,agent_skill_id,
             request_schema,result_schema,requester_policy,exposure_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
          [
            candidate.revision.revision,
            exposure.exposureId,
            exposure.version,
            exposure.capabilityId,
            exposure.capabilityVersion,
            exposure.agentSkillId,
            JSON.stringify(exposure.requestSchema),
            JSON.stringify(exposure.resultSchema),
            exposure.requesterPolicy === undefined
              ? null
              : JSON.stringify(exposure.requesterPolicy),
            exposure.exposureHash,
          ],
        );
      }
      await receipt(client, `${command.scope}:stage`, command, candidate.revision.revision);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async activate(revision: number, command: A2aCommandContext): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime-agent-card'))");
      const replayed = await replay(client, `${command.scope}:activate`, command, revision);
      const staged = await client.query<{ status: string }>(
        'SELECT status FROM runtime_agent_card_revision WHERE revision=$1 FOR UPDATE',
        [revision],
      );
      if (replayed && staged.rows[0]?.status === 'active') {
        await client.query('COMMIT');
        return;
      }
      if (staged.rows[0]?.status !== 'staged') throw new Error('AGENT_CARD_REVISION_NOT_STAGED');
      await client.query(
        "UPDATE runtime_agent_card_revision SET status='superseded' WHERE status='active' AND revision<>$1",
        [revision],
      );
      await client.query(
        "UPDATE runtime_agent_card_revision SET status='active',activated_at=$2 WHERE revision=$1",
        [revision, command.occurredAt],
      );
      if (!replayed) await receipt(client, `${command.scope}:activate`, command, revision);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rollback(revision: number, priorRevision: number | undefined): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime-agent-card'))");
      const current = await client.query<{ status: string }>(
        'SELECT status FROM runtime_agent_card_revision WHERE revision=$1 FOR UPDATE',
        [revision],
      );
      if (current.rows[0]?.status === 'active') {
        await client.query(
          "UPDATE runtime_agent_card_revision SET status='staged',activated_at=NULL WHERE revision=$1",
          [revision],
        );
      } else if (current.rows[0]?.status !== 'staged') {
        throw new Error('AGENT_CARD_ROLLBACK_TARGET_INVALID');
      }
      if (priorRevision !== undefined) {
        const restored = await client.query(
          "UPDATE runtime_agent_card_revision SET status='active' WHERE revision=$1 AND status='superseded'",
          [priorRevision],
        );
        if (restored.rowCount !== 1) throw new Error('AGENT_CARD_ROLLBACK_LKG_NOT_FOUND');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveCard(): Promise<JsonObject | undefined> {
    const result = await this.#pool.query<{ card: JsonObject }>(
      "SELECT card FROM runtime_agent_card_revision WHERE status='active' ORDER BY revision DESC LIMIT 1",
    );
    return result.rows[0]?.card;
  }
}

async function replay(
  client: PoolClient,
  scope: string,
  command: A2aCommandContext,
  revision: number,
): Promise<boolean> {
  const result = await client.query<{ request_hash: string; revision: string }>(
    `SELECT request_hash::text,revision FROM runtime_agent_card_command_receipt
      WHERE scope=$1 AND idempotency_key=$2`,
    [scope, command.idempotencyKey],
  );
  const row = result.rows[0];
  if (row === undefined) return false;
  if (row.request_hash.trim() !== command.requestHash || Number(row.revision) !== revision)
    throw new Error('AGENT_CARD_IDEMPOTENCY_KEY_REUSED');
  return true;
}

function receipt(client: PoolClient, scope: string, command: A2aCommandContext, revision: number) {
  return client.query(
    `INSERT INTO runtime_agent_card_command_receipt(scope,idempotency_key,request_hash,revision,created_at)
     VALUES($1,$2,$3,$4,$5)`,
    [scope, command.idempotencyKey, command.requestHash, revision, command.occurredAt],
  );
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
