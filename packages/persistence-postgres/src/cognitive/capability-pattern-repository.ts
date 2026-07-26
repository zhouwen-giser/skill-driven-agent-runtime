import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { CapabilityPatternRepository } from '../../../application/src/cognitive/ports.js';
import {
  createCapabilityGapCandidateSnapshot,
  createCapabilityPatternDefinitionSnapshot,
  type CapabilityGapCandidateSnapshot,
  type CapabilityPatternDefinitionSnapshot,
} from '../../../domain/src/index.js';

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

const EvidenceSchema = z
  .object({
    level: z.enum(['declared', 'observed', 'validated']),
    summary: z.string(),
    sourceRefIds: z.array(z.string()),
    episodeId: z.string().optional(),
    exactSkillVersionRef: z.string().optional(),
  })
  .strict();

const MappingSchema = z
  .object({
    exactSkillVersionRef: z.string(),
    mappingBasis: z.literal('declared_capability'),
    requiresCurrentReadiness: z.literal(true),
    compatibilityStatus: z.literal('requires_current_check'),
  })
  .strict();

const CapabilityPatternSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    patternId: z.string(),
    revision: z.number().int(),
    version: z.number().int(),
    status: z.enum(['candidate', 'validating', 'active', 'deprecated', 'rejected']),
    fingerprint: z.string(),
    catalogHash: z.string(),
    policyVersion: z.string(),
    capabilityId: z.string(),
    title: z.string(),
    summary: z.string(),
    applicableConditions: z.array(z.string()),
    effects: z.array(z.string()),
    evidenceRequirements: z.array(z.string()),
    artifacts: z.array(z.string()),
    prerequisites: z.array(z.string()),
    dependencies: z.array(z.string()),
    failures: z.array(z.string()),
    limitations: z.array(z.string()),
    evidenceByLevel: z
      .object({
        declared: z.array(EvidenceSchema),
        observed: z.array(EvidenceSchema),
        validated: z.array(EvidenceSchema),
      })
      .strict(),
    exactSkillVersionMappings: z.array(MappingSchema),
    requiresCurrentReadiness: z.literal(true),
    sourceRefs: z.array(SourceRefSchema),
    modelInvocationId: z.string(),
    createdAt: z.string(),
  })
  .strict();

const CapabilityGapSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    gapId: z.string(),
    status: z.literal('candidate'),
    fingerprint: z.string(),
    patternId: z.string(),
    patternRevision: z.number().int(),
    capabilityId: z.string(),
    catalogHash: z.string(),
    exactSkillVersionRefs: z.tuple([]),
    executable: z.literal(false),
    authoringProposal: z
      .object({
        proposalId: z.string(),
        status: z.literal('proposed'),
        reviewMode: z.literal('manual'),
        publishAllowed: z.literal(false),
        capabilityId: z.string(),
        title: z.string(),
        summary: z.string(),
      })
      .strict(),
    sourceRefs: z.array(SourceRefSchema),
    createdAt: z.string(),
  })
  .strict();

interface PatternRow extends QueryResultRow {
  knowledge_id: string;
  revision: number;
  status: string;
  catalog_hash: string;
  version: number;
  capability_id: string | null;
  fingerprint: string | null;
  definition: unknown;
  definition_origin: string;
  model_invocation_id: string | null;
}

interface GapRow extends QueryResultRow {
  gap_id: string;
  fingerprint: string;
  status: string;
  capability_id: string;
  pattern_id: string;
  pattern_revision: number;
  catalog_hash: string;
  definition: unknown;
}

export class PostgresCapabilityPatternRepository implements CapabilityPatternRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findLatest(capabilityId: string): Promise<CapabilityPatternDefinitionSnapshot | undefined> {
    const result = await this.#pool.query<PatternRow>(
      `${patternSelect}
       WHERE capability_id=$1
         AND definition_origin IN ('capability_pattern_induction','fixture')
       ORDER BY revision DESC,created_at DESC,knowledge_id LIMIT 1`,
      [capabilityId],
    );
    return result.rows[0] === undefined ? undefined : mapPattern(result.rows[0]);
  }

  async list(limit = 100): Promise<readonly CapabilityPatternDefinitionSnapshot[]> {
    const result = await this.#pool.query<PatternRow>(
      `${patternSelect}
       WHERE definition_origin IN ('capability_pattern_induction','fixture')
       ORDER BY created_at DESC,knowledge_id,revision DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapPattern);
  }

  async listGaps(limit = 100): Promise<readonly CapabilityGapCandidateSnapshot[]> {
    const result = await this.#pool.query<GapRow>(
      `SELECT gap_id,fingerprint,status,capability_id,pattern_id,pattern_revision,
              catalog_hash,definition
       FROM capability_gap_candidate
       ORDER BY created_at DESC,gap_id LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapGap);
  }

  async findGapByFingerprint(
    fingerprint: string,
  ): Promise<CapabilityGapCandidateSnapshot | undefined> {
    const result = await this.#pool.query<GapRow>(
      `SELECT gap_id,fingerprint,status,capability_id,pattern_id,pattern_revision,
              catalog_hash,definition
       FROM capability_gap_candidate WHERE fingerprint=$1`,
      [fingerprint],
    );
    return result.rows[0] === undefined ? undefined : mapGap(result.rows[0]);
  }

  async saveCandidate(input: CapabilityPatternDefinitionSnapshot): Promise<boolean> {
    const candidate = createCapabilityPatternDefinitionSnapshot(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `capability-pattern:${candidate.capabilityId}`,
      ]);
      const exact = await client.query<PatternRow>(
        `${patternSelect} WHERE knowledge_id=$1 AND revision=$2`,
        [candidate.patternId, candidate.revision],
      );
      if (exact.rows[0] !== undefined) {
        if (JSON.stringify(mapPattern(exact.rows[0])) === JSON.stringify(candidate)) {
          await client.query('COMMIT');
          return false;
        }
        throw new Error('CAPABILITY_PATTERN_REVISION_CONFLICT');
      }
      const latest = await client.query<PatternRow>(
        `${patternSelect}
         WHERE capability_id=$1
           AND definition_origin IN ('capability_pattern_induction','fixture')
         ORDER BY revision DESC,created_at DESC,knowledge_id LIMIT 1`,
        [candidate.capabilityId],
      );
      const prior = latest.rows[0];
      if (
        (candidate.revision === 1 && prior !== undefined) ||
        (candidate.revision > 1 &&
          (prior?.knowledge_id !== candidate.patternId ||
            prior.revision !== candidate.revision - 1))
      ) {
        throw new Error('CAPABILITY_PATTERN_REVISION_CONFLICT');
      }
      await verifyEpisodeSources(client, candidate);
      await verifyCurrentSkillMappings(client, candidate);
      await client.query(
        `INSERT INTO capability_pattern_definition(
           knowledge_id,revision,status,scope,tenant_id,user_id,risk,catalog_hash,
           definition,version,created_at,capability_id,fingerprint,definition_origin,
           model_invocation_id)
         VALUES($1,$2,'candidate','global_candidate',NULL,NULL,'low',$3,$4::jsonb,
           $5,$6,$7,$8,'capability_pattern_induction',$9)`,
        [
          candidate.patternId,
          candidate.revision,
          candidate.catalogHash,
          JSON.stringify(candidate),
          candidate.version,
          candidate.createdAt,
          candidate.capabilityId,
          candidate.fingerprint,
          candidate.modelInvocationId,
        ],
      );
      await saveEvidence(client, candidate);
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES($1,'knowledge.candidate_created','capability_pattern',$2,$3::integer,
           jsonb_build_object('correlationId',$2::text),
           jsonb_build_object(
             'knowledgeKind','capability_pattern','knowledgeId',$2::text,
             'revision',$3::integer,'capabilityId',$4::text,
             'catalogHash',$5::text,'mappingCount',$6::integer
           ),$7,NULL)`,
        [
          stableId('outbox-capability-pattern-candidate', candidate.patternId, candidate.revision),
          candidate.patternId,
          candidate.revision,
          candidate.capabilityId,
          candidate.catalogHash,
          candidate.exactSkillVersionMappings.length,
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

  async saveGapCandidate(input: CapabilityGapCandidateSnapshot): Promise<boolean> {
    const gap = createCapabilityGapCandidateSnapshot(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `capability-gap:${gap.fingerprint}`,
      ]);
      const existing = await client.query<GapRow>(
        `SELECT gap_id,fingerprint,status,capability_id,pattern_id,pattern_revision,
                catalog_hash,definition
         FROM capability_gap_candidate WHERE fingerprint=$1`,
        [gap.fingerprint],
      );
      if (existing.rows[0] !== undefined) {
        if (JSON.stringify(mapGap(existing.rows[0])) === JSON.stringify(gap)) {
          await client.query('COMMIT');
          return false;
        }
        throw new Error('CAPABILITY_GAP_FINGERPRINT_CONFLICT');
      }
      await client.query(
        `INSERT INTO capability_gap_candidate(
           gap_id,fingerprint,status,capability_id,pattern_id,pattern_revision,
           catalog_hash,definition,created_at,updated_at)
         VALUES($1,$2,'candidate',$3,$4,$5,$6,$7::jsonb,$8,$8)`,
        [
          gap.gapId,
          gap.fingerprint,
          gap.capabilityId,
          gap.patternId,
          gap.patternRevision,
          gap.catalogHash,
          JSON.stringify(gap),
          gap.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES($1,'capability.gap_candidate_created','capability_gap',$2,1,
           jsonb_build_object('correlationId',$2::text),
           jsonb_build_object(
             'gapId',$2::text,'capabilityId',$3::text,'patternId',$4::text,
             'patternRevision',$5::integer,'publishAllowed',false,'executable',false
           ),$6,NULL)`,
        [
          stableId('outbox-capability-gap-candidate', gap.gapId),
          gap.gapId,
          gap.capabilityId,
          gap.patternId,
          gap.patternRevision,
          gap.createdAt,
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

  async invalidateByCatalog(input: {
    catalogHash: string;
    policyVersion: string;
    occurredAt: string;
  }): Promise<number> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query<PatternRow>(
        `${patternSelect}
         WHERE status='active'
           AND definition_origin IN ('capability_pattern_induction','fixture')
         ORDER BY knowledge_id,revision FOR UPDATE`,
      );
      let count = 0;
      for (const row of active.rows) {
        const pattern = mapPattern(row);
        if (
          pattern.catalogHash === input.catalogHash &&
          pattern.policyVersion === input.policyVersion
        ) {
          continue;
        }
        const nextVersion = pattern.version + 1;
        const reason =
          pattern.policyVersion === input.policyVersion ? 'catalog_changed' : 'policy_changed';
        const updated = await client.query(
          `UPDATE capability_pattern_definition
           SET status='validating',
               version=$4,
               definition=jsonb_set(
                 jsonb_set(definition,'{status}','"validating"'::jsonb,false),
                 '{version}',to_jsonb($4::integer),false
               )
           WHERE knowledge_id=$1 AND revision=$2 AND status='active' AND version=$3`,
          [pattern.patternId, pattern.revision, pattern.version, nextVersion],
        );
        if (updated.rowCount !== 1) throw new Error('CAPABILITY_PATTERN_INVALIDATION_CONFLICT');
        const transitionId = stableId(
          'capability-pattern-invalidation',
          pattern.patternId,
          pattern.revision,
          nextVersion,
        );
        await client.query(
          `INSERT INTO knowledge_status_transition(
             transition_id,knowledge_kind,knowledge_id,knowledge_revision,expected_version,
             from_status,to_status,reason,actor_id,human_approved,occurred_at)
           VALUES($1,'capability_pattern',$2,$3,$4,'active','validating',$5,
             'system.capability-pattern-invalidator',false,$6)`,
          [
            transitionId,
            pattern.patternId,
            pattern.revision,
            pattern.version,
            reason,
            input.occurredAt,
          ],
        );
        await client.query(
          `INSERT INTO cognitive_runtime_outbox(
             event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
             correlation,payload,occurred_at,published_at)
           VALUES($1,'knowledge.validating','capability_pattern',$2,$3::integer,
             jsonb_build_object('correlationId',$2::text),
             jsonb_build_object(
               'knowledgeKind','capability_pattern','knowledgeId',$2::text,
               'revision',$4::integer,'reason',$5::text,
               'currentCatalogHash',$6::text,'currentPolicyVersion',$7::text
             ),$8,NULL)`,
          [
            stableId('outbox-capability-pattern-validating', pattern.patternId, nextVersion),
            pattern.patternId,
            nextVersion,
            pattern.revision,
            reason,
            input.catalogHash,
            input.policyVersion,
            input.occurredAt,
          ],
        );
        count += 1;
      }
      await client.query('COMMIT');
      return count;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const patternSelect = `SELECT knowledge_id,revision,status,catalog_hash,version,
  capability_id,fingerprint,definition,definition_origin,model_invocation_id
  FROM capability_pattern_definition`;

function mapPattern(row: PatternRow): CapabilityPatternDefinitionSnapshot {
  const parsed = CapabilityPatternSchema.parse(row.definition);
  if (
    row.knowledge_id !== parsed.patternId ||
    row.revision !== parsed.revision ||
    row.status !== parsed.status ||
    row.catalog_hash !== parsed.catalogHash ||
    row.version !== parsed.version ||
    row.capability_id !== parsed.capabilityId ||
    row.fingerprint !== parsed.fingerprint ||
    row.model_invocation_id !== parsed.modelInvocationId ||
    !['capability_pattern_induction', 'fixture'].includes(row.definition_origin)
  ) {
    throw new Error('CAPABILITY_PATTERN_PERSISTENCE_INTEGRITY_VIOLATION');
  }
  return createCapabilityPatternDefinitionSnapshot(normalizePattern(parsed));
}

function mapGap(row: GapRow): CapabilityGapCandidateSnapshot {
  const parsed = CapabilityGapSchema.parse(row.definition);
  if (
    row.gap_id !== parsed.gapId ||
    row.fingerprint !== parsed.fingerprint ||
    row.status !== parsed.status ||
    row.capability_id !== parsed.capabilityId ||
    row.pattern_id !== parsed.patternId ||
    row.pattern_revision !== parsed.patternRevision ||
    row.catalog_hash !== parsed.catalogHash
  ) {
    throw new Error('CAPABILITY_GAP_PERSISTENCE_INTEGRITY_VIOLATION');
  }
  return createCapabilityGapCandidateSnapshot(normalizeGap(parsed));
}

async function verifyEpisodeSources(
  client: PoolClient,
  candidate: CapabilityPatternDefinitionSnapshot,
): Promise<void> {
  const episodeIds = [...candidate.evidenceByLevel.observed, ...candidate.evidenceByLevel.validated]
    .map((evidence) => evidence.episodeId)
    .filter((episodeId): episodeId is string => episodeId !== undefined);
  const persisted = await client.query(
    'SELECT episode_id FROM goal_experience_episode WHERE episode_id=ANY($1::text[])',
    [episodeIds],
  );
  if (persisted.rowCount !== new Set(episodeIds).size) {
    throw new Error('CAPABILITY_PATTERN_EPISODE_SOURCE_MISSING');
  }
}

async function verifyCurrentSkillMappings(
  client: PoolClient,
  candidate: CapabilityPatternDefinitionSnapshot,
): Promise<void> {
  for (const mapping of candidate.exactSkillVersionMappings) {
    const separator = mapping.exactSkillVersionRef.lastIndexOf(':');
    const skillId = mapping.exactSkillVersionRef.slice(0, separator);
    const version = Number(mapping.exactSkillVersionRef.slice(separator + 1));
    const result = await client.query(
      `SELECT 1
       FROM skill s
       JOIN skill_version v
         ON v.skill_id=s.skill_id AND v.version=s.current_version
       WHERE v.skill_id=$1 AND v.version=$2 AND v.status='enabled'
         AND v.capabilities_json ? $3`,
      [skillId, version, candidate.capabilityId],
    );
    if (result.rowCount !== 1) throw new Error('CAPABILITY_PATTERN_SKILL_MAPPING_STALE');
  }
}

async function saveEvidence(
  client: PoolClient,
  candidate: CapabilityPatternDefinitionSnapshot,
): Promise<void> {
  for (const evidence of [
    ...candidate.evidenceByLevel.declared,
    ...candidate.evidenceByLevel.observed,
    ...candidate.evidenceByLevel.validated,
  ]) {
    const identity = evidence.exactSkillVersionRef ?? evidence.episodeId;
    if (identity === undefined) throw new Error('CAPABILITY_PATTERN_EVIDENCE_IDENTITY_MISSING');
    const evidenceId = stableId(
      'capability-pattern-evidence',
      candidate.patternId,
      candidate.revision,
      evidence.level,
      identity,
    );
    await client.query(
      `INSERT INTO capability_pattern_evidence(
         knowledge_id,knowledge_revision,evidence_id,polarity,source_ref,created_at)
       VALUES($1,$2,$3,'support',$4::jsonb,$5)`,
      [
        candidate.patternId,
        candidate.revision,
        evidenceId,
        JSON.stringify(evidence),
        candidate.createdAt,
      ],
    );
    await client.query(
      `INSERT INTO capability_experience_evidence(
         evidence_id,capability_id,level,exact_skill_version_ref,source_ref,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        stableId(
          'capability-experience-evidence',
          candidate.patternId,
          candidate.revision,
          evidenceId,
        ),
        candidate.capabilityId,
        evidence.level,
        evidence.exactSkillVersionRef ?? null,
        JSON.stringify(evidence),
        candidate.createdAt,
      ],
    );
  }
}

function normalizePattern(parsed: z.infer<typeof CapabilityPatternSchema>) {
  return {
    ...parsed,
    sourceRefs: parsed.sourceRefs.map(normalizeSourceRef),
    evidenceByLevel: {
      declared: parsed.evidenceByLevel.declared.map(normalizeEvidence),
      observed: parsed.evidenceByLevel.observed.map(normalizeEvidence),
      validated: parsed.evidenceByLevel.validated.map(normalizeEvidence),
    },
  };
}

function normalizeGap(parsed: z.infer<typeof CapabilityGapSchema>) {
  return {
    ...parsed,
    sourceRefs: parsed.sourceRefs.map(normalizeSourceRef),
  };
}

function normalizeSourceRef(input: z.infer<typeof SourceRefSchema>) {
  const { contentHash, ...source } = input;
  return { ...source, ...(contentHash === undefined ? {} : { contentHash }) };
}

function normalizeEvidence(input: z.infer<typeof EvidenceSchema>) {
  const { episodeId, exactSkillVersionRef, ...evidence } = input;
  return {
    ...evidence,
    ...(episodeId === undefined ? {} : { episodeId }),
    ...(exactSkillVersionRef === undefined ? {} : { exactSkillVersionRef }),
  };
}

function stableId(prefix: string, ...values: readonly (string | number)[]): string {
  return `${prefix}-${createHash('sha256')
    .update(values.map(String).join(':'))
    .digest('hex')
    .slice(0, 24)}`;
}
