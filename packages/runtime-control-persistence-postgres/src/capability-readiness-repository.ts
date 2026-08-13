import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  CapabilityReadinessReason,
  CapabilityReadinessStatus,
  RuntimeCapabilityReadinessCommand,
  RuntimeCapabilityReadinessInput,
  RuntimeCapabilityReadinessRepository,
  RuntimeImplementationReadiness,
  StoredCapabilityReadiness,
} from '../../runtime-control-application/src/index.js';
import { parseMcpProviderBindingPolicyOverride } from '../../node-control-domain/src/index.js';
import type { RuntimeMcpCatalogAuthorityReader } from './runtime-mcp-catalog-authority-reader.js';

interface ReadinessRow {
  capability_id: string;
  capability_version: number;
  snapshot_version: number;
  status: CapabilityReadinessStatus;
  raw_status: CapabilityReadinessStatus;
  candidate_status: CapabilityReadinessStatus | null;
  candidate_since: Date | null;
  evaluated_at: Date;
  valid_until: Date;
  catalog_hash: string;
  policy_hash: string;
  snapshot_hash: string;
  reasons: CapabilityReadinessReason[];
  available_implementations: string[];
  unavailable_implementations: string[];
  evaluation_input: RuntimeCapabilityReadinessInput;
}

interface SkillDependencyRow {
  exists: boolean;
  enabled: boolean;
  validation_passed: boolean;
  tool_policy: Readonly<{
    required?: readonly Readonly<{ serverId: string; toolName: string }>[];
    optional?: readonly Readonly<{ serverId: string; toolName: string }>[];
  }> | null;
  runtime_policy: unknown;
}

interface CurrentBindingAuthorityRepository {
  findCurrentAuthority(
    input: Readonly<{ bindingId?: string; localServerId: string; observedAt: string }>,
  ): Promise<
    | Readonly<{
        binding: Readonly<{
          bindingId: string;
          revision: number;
          localServerId: string;
          endpointRef: string;
          catalogRevision: string;
          catalogChecksum: string;
          operationCount: number;
          availabilityValidUntil: string;
        }>;
      }>
    | undefined
  >;
}

export class PostgresRuntimeCapabilityReadinessRepository implements RuntimeCapabilityReadinessRepository {
  readonly #pool: Pool;
  readonly #providerBindings: CurrentBindingAuthorityRepository | undefined;
  readonly #runtimeMcp: RuntimeMcpCatalogAuthorityReader | undefined;
  constructor(
    pool: Pool,
    providerBindings?: CurrentBindingAuthorityRepository,
    runtimeMcp?: RuntimeMcpCatalogAuthorityReader,
  ) {
    this.#pool = pool;
    this.#providerBindings = providerBindings;
    this.#runtimeMcp = runtimeMcp;
  }

  async findLatest(capabilityId: string, capabilityVersion: number) {
    const result = await this.#pool.query<ReadinessRow>(
      `${selectColumns}
         FROM capability_readiness_snapshot
        WHERE capability_id=$1 AND capability_version=$2
        ORDER BY snapshot_version DESC LIMIT 1`,
      [capabilityId, capabilityVersion],
    );
    return result.rows[0] === undefined ? undefined : mapRow(result.rows[0]);
  }

  async findReplay(command: RuntimeCapabilityReadinessCommand) {
    return this.findReplayFrom(this.#pool, command);
  }

  async listLatest(status: CapabilityReadinessStatus | undefined, limit: number) {
    const result = await this.#pool.query<ReadinessRow>(
      `${selectColumns}
         FROM capability_readiness_snapshot snapshot
        WHERE snapshot.snapshot_version=(
          SELECT MAX(candidate.snapshot_version) FROM capability_readiness_snapshot candidate
           WHERE candidate.capability_id=snapshot.capability_id
             AND candidate.capability_version=snapshot.capability_version)
          AND ($1::text IS NULL OR snapshot.status=$1)
        ORDER BY snapshot.capability_id,snapshot.capability_version DESC LIMIT $2`,
      [status ?? null, limit],
    );
    return Object.freeze(result.rows.map(mapRow));
  }

  async listExpired(limit: number, now: string) {
    const result = await this.#pool.query<ReadinessRow>(
      `${selectColumns}
         FROM capability_readiness_snapshot snapshot
        WHERE snapshot.snapshot_version=(
          SELECT MAX(candidate.snapshot_version) FROM capability_readiness_snapshot candidate
           WHERE candidate.capability_id=snapshot.capability_id
             AND candidate.capability_version=snapshot.capability_version)
          AND snapshot.valid_until <= $1
        ORDER BY snapshot.valid_until LIMIT $2`,
      [now, limit],
    );
    return Object.freeze(result.rows.map(mapRow));
  }

  async assessImplementations(input: RuntimeCapabilityReadinessInput, evaluatedAt: string) {
    const assessments: RuntimeImplementationReadiness[] = [];
    for (const binding of input.implementations) {
      if (binding.status !== 'active') continue;
      assessments.push(
        binding.implementationType === 'skill'
          ? await this.assessSkill(
              binding.bindingId,
              binding.implementationId,
              binding.implementationVersion,
              binding.providerPolicyOverride,
              evaluatedAt,
              input.ttlMs,
            )
          : await this.assessPlanTemplate(
              binding.bindingId,
              binding.implementationId,
              binding.implementationVersion,
              binding.providerPolicyOverride,
            ),
      );
    }
    return Object.freeze(assessments);
  }

  async save(record: StoredCapabilityReadiness, command?: RuntimeCapabilityReadinessCommand) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `capability-readiness:${record.snapshot.capabilityId}:${String(record.snapshot.capabilityVersion)}`,
      ]);
      if (command !== undefined) {
        const replay = await this.findReplayFrom(client, command);
        if (replay !== undefined) {
          await client.query('COMMIT');
          return replay;
        }
      }
      const current = await client.query<{ version: number; status: CapabilityReadinessStatus }>(
        `SELECT snapshot_version AS version,status FROM capability_readiness_snapshot
          WHERE capability_id=$1 AND capability_version=$2
          ORDER BY snapshot_version DESC LIMIT 1`,
        [record.snapshot.capabilityId, record.snapshot.capabilityVersion],
      );
      if ((current.rows[0]?.version ?? 0) + 1 !== record.snapshot.snapshotVersion)
        throw new Error('CAPABILITY_READINESS_CONCURRENT_EVALUATION');
      await client.query(
        `INSERT INTO capability_readiness_snapshot(
           capability_id,capability_version,snapshot_version,status,raw_status,candidate_status,
           candidate_since,evaluated_at,valid_until,catalog_hash,policy_hash,snapshot_hash,reasons,
           available_implementations,unavailable_implementations,evaluation_input,trigger_reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17)`,
        [
          record.snapshot.capabilityId,
          record.snapshot.capabilityVersion,
          record.snapshot.snapshotVersion,
          record.snapshot.status,
          record.rawStatus,
          record.candidateStatus ?? null,
          record.candidateSince ?? null,
          record.snapshot.evaluatedAt,
          record.snapshot.validUntil,
          record.snapshot.catalogHash,
          record.snapshot.policyHash,
          record.snapshotHash,
          JSON.stringify(record.snapshot.reasons),
          JSON.stringify(record.snapshot.availableImplementations ?? []),
          JSON.stringify(record.snapshot.unavailableImplementations ?? []),
          JSON.stringify(record.input),
          record.input.trigger,
        ],
      );
      if (current.rows[0]?.status !== record.snapshot.status) await insertEvent(client, record);
      if (command !== undefined)
        await client.query(
          `INSERT INTO capability_readiness_command_receipt(
             idempotency_key,request_hash,capability_id,capability_version,snapshot_version,created_at)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [
            command.idempotencyKey,
            command.requestHash,
            record.snapshot.capabilityId,
            record.snapshot.capabilityVersion,
            record.snapshot.snapshotVersion,
            record.snapshot.evaluatedAt,
          ],
        );
      await client.query('COMMIT');
      return record;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findReplayFrom(
    database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    command: RuntimeCapabilityReadinessCommand,
  ) {
    const receipt = await database.query<{
      request_hash: string;
      capability_id: string;
      capability_version: number;
      snapshot_version: number;
    }>(
      `SELECT request_hash,capability_id,capability_version,snapshot_version
         FROM capability_readiness_command_receipt WHERE idempotency_key=$1`,
      [command.idempotencyKey],
    );
    const row = receipt.rows[0];
    if (row === undefined) return undefined;
    if (row.request_hash !== command.requestHash)
      throw new Error('CAPABILITY_READINESS_IDEMPOTENCY_KEY_REUSED');
    const result = await database.query<ReadinessRow>(
      `${selectColumns} FROM capability_readiness_snapshot
        WHERE capability_id=$1 AND capability_version=$2 AND snapshot_version=$3`,
      [row.capability_id, row.capability_version, row.snapshot_version],
    );
    if (result.rows[0] === undefined) throw new Error('CAPABILITY_READINESS_RECEIPT_DANGLING');
    return mapRow(result.rows[0]);
  }

  private async assessSkill(
    bindingId: string,
    skillId: string,
    implementationVersion: string,
    providerPolicyOverride: unknown,
    evaluatedAt: string,
    ttlMs: number,
  ): Promise<RuntimeImplementationReadiness> {
    const result = await this.#pool.query<SkillDependencyRow>(
      `SELECT true AS exists,
              COALESCE(
                governance.lifecycle_status,
                CASE version.status
                  WHEN 'enabled' THEN 'published'
                  WHEN 'disabled' THEN 'suspended'
                  ELSE version.status
                END
              )='published' AS enabled,
              version.validation_passed,
              version.tool_policy_json AS tool_policy,
              version.runtime_policy_json AS runtime_policy
         FROM skill_version version
         LEFT JOIN runtime_skill_version_governance governance
           ON governance.skill_id=version.skill_id
          AND governance.skill_version=version.version
        WHERE version.skill_id=$1 AND version.version=$2`,
      [skillId, Number(implementationVersion)],
    );
    const row = result.rows[0];
    const reasons: CapabilityReadinessReason[] = [];
    if (row === undefined || !row.enabled || !row.validation_passed)
      reasons.push(
        reason('SKILL_VERSION_UNAVAILABLE', 'blocking', `${skillId}@${implementationVersion}`),
      );
    const toolPolicy = row?.tool_policy;
    const required = toolPolicy?.required ?? [];
    const optional = toolPolicy?.optional ?? [];
    const catalogParts: string[] = [];
    const bindingPolicyParts: string[] = [];
    let requiredUnavailable = false;
    let optionalUnavailable = false;
    const providerBindingPolicy = parseMcpProviderBindingPolicyOverride(providerPolicyOverride);
    const exactBindingTools = providerBindingPolicy.requirements.map((policy) =>
      required.find(
        (reference) =>
          reference.serverId === policy.localServerId && reference.toolName === policy.mcpToolName,
      ),
    );
    for (const reference of [...required, ...optional]) {
      if (exactBindingTools.includes(reference)) continue;
      const tool = await this.#pool.query<{
        status: string;
        tool_revision: number;
        updated_at: Date;
        tool_exists: boolean;
      }>(
        `SELECT server.status,server.tool_revision,server.updated_at,
                EXISTS(SELECT 1 FROM mcp_tool tool WHERE tool.server_id=server.server_id AND tool.tool_name=$2) AS tool_exists
           FROM mcp_server server WHERE server.server_id=$1`,
        [reference.serverId, reference.toolName],
      );
      const fact = tool.rows[0];
      const fresh =
        fact !== undefined && Date.parse(evaluatedAt) - fact.updated_at.getTime() <= ttlMs;
      const available = fact?.status === 'enabled' && fact.tool_exists && fresh;
      catalogParts.push(
        `${reference.serverId}:${reference.toolName}:${fact?.status ?? 'missing'}:${String(fact?.tool_revision ?? 0)}:${fresh ? 'fresh' : 'stale'}`,
      );
      if (!available) {
        const isRequired = required.some(
          (value) => value.serverId === reference.serverId && value.toolName === reference.toolName,
        );
        requiredUnavailable ||= isRequired;
        optionalUnavailable ||= !isRequired;
        reasons.push(
          reason(
            fresh ? 'MCP_TOOL_UNAVAILABLE' : 'PROVIDER_AVAILABILITY_EXPIRED',
            isRequired ? 'blocking' : 'warning',
            `${reference.serverId}/${reference.toolName}`,
          ),
        );
      }
    }
    if (providerPolicyOverride !== undefined) {
      const exactRequiredTools =
        exactBindingTools.every((reference) => reference !== undefined) &&
        (providerBindingPolicy.mode !== 'required_all' ||
          (required.length === 2 && optional.length === 0));
      if (
        providerBindingPolicy.mode === 'absent' ||
        providerBindingPolicy.mode === 'invalid' ||
        !exactRequiredTools
      ) {
        requiredUnavailable = true;
        reasons.push(
          reason(
            'MCP_PROVIDER_BINDING_POLICY_INVALID',
            'blocking',
            `${skillId}@${implementationVersion}`,
          ),
        );
      } else {
        for (const policy of providerBindingPolicy.requirements) {
          bindingPolicyParts.push(JSON.stringify(policy));
          if (this.#providerBindings === undefined) {
            requiredUnavailable = true;
            reasons.push(
              reason('MCP_PROVIDER_BINDING_NOT_CURRENT', 'blocking', policy.mcpProviderBindingId),
            );
            continue;
          }
          let authority: Awaited<
            ReturnType<CurrentBindingAuthorityRepository['findCurrentAuthority']>
          >;
          try {
            authority = await this.#providerBindings.findCurrentAuthority({
              bindingId: policy.mcpProviderBindingId,
              localServerId: policy.localServerId,
              observedAt: evaluatedAt,
            });
          } catch {
            authority = undefined;
          }
          if (
            authority?.binding.bindingId !== policy.mcpProviderBindingId ||
            authority.binding.localServerId !== policy.localServerId ||
            Date.parse(authority.binding.availabilityValidUntil) <= Date.parse(evaluatedAt)
          ) {
            requiredUnavailable = true;
            reasons.push(
              reason('MCP_PROVIDER_BINDING_NOT_CURRENT', 'blocking', policy.mcpProviderBindingId),
            );
            continue;
          }
          if (this.#runtimeMcp === undefined) {
            requiredUnavailable = true;
            reasons.push(
              reason(
                'MCP_PROVIDER_BINDING_RUNTIME_AUTHORITY_UNAVAILABLE',
                'blocking',
                policy.mcpProviderBindingId,
              ),
            );
            continue;
          }
          let runtimeAuthority: Awaited<
            ReturnType<RuntimeMcpCatalogAuthorityReader['loadCurrentAuthority']>
          >;
          try {
            runtimeAuthority = await this.#runtimeMcp.loadCurrentAuthority(policy.localServerId);
          } catch {
            runtimeAuthority = undefined;
          }
          if (
            runtimeAuthority?.status !== 'enabled' ||
            runtimeAuthority.protocolMode !== 'frozen_v1' ||
            runtimeAuthority.snapshotToolRevision !== runtimeAuthority.toolRevision
          ) {
            requiredUnavailable = true;
            reasons.push(
              reason(
                'MCP_PROVIDER_BINDING_RUNTIME_AUTHORITY_UNAVAILABLE',
                'blocking',
                policy.mcpProviderBindingId,
              ),
            );
          } else if (
            runtimeAuthority.snapshotValidUntil === undefined ||
            !Number.isFinite(Date.parse(runtimeAuthority.snapshotValidUntil)) ||
            Date.parse(runtimeAuthority.snapshotValidUntil) <= Date.parse(evaluatedAt)
          ) {
            requiredUnavailable = true;
            reasons.push(
              reason(
                'PROVIDER_AVAILABILITY_EXPIRED',
                'blocking',
                `${policy.localServerId}/${policy.mcpToolName}`,
              ),
            );
          } else if (!runtimeAuthority.toolNames.includes(policy.mcpToolName)) {
            requiredUnavailable = true;
            reasons.push(
              reason(
                'MCP_TOOL_UNAVAILABLE',
                'blocking',
                `${policy.localServerId}/${policy.mcpToolName}`,
              ),
            );
          } else if (runtimeAuthority.endpoint !== authority.binding.endpointRef) {
            requiredUnavailable = true;
            reasons.push(
              reason(
                'MCP_PROVIDER_BINDING_ENDPOINT_DRIFT',
                'blocking',
                policy.mcpProviderBindingId,
              ),
            );
          } else if (
            runtimeAuthority.catalogRevision !== authority.binding.catalogRevision ||
            runtimeAuthority.catalogChecksum !== authority.binding.catalogChecksum ||
            runtimeAuthority.operationCount !== authority.binding.operationCount
          ) {
            requiredUnavailable = true;
            reasons.push(
              reason('MCP_PROVIDER_BINDING_CATALOG_DRIFT', 'blocking', policy.mcpProviderBindingId),
            );
          } else {
            catalogParts.push(
              `binding:${authority.binding.bindingId}:${String(authority.binding.revision)}:${authority.binding.catalogRevision}:${authority.binding.catalogChecksum}:${authority.binding.availabilityValidUntil}`,
            );
          }
        }
      }
    }
    const model = await this.#pool.query<{ available: boolean; fingerprint: string }>(
      `SELECT COUNT(*) > 0 AS available,
              COALESCE(string_agg(route.stage||':'||route.operation||':'||provider.provider_id||':'||provider.model,','
                ORDER BY route.stage,route.operation,provider.provider_id),'none') AS fingerprint
         FROM stage_model_route route
         JOIN model_provider provider ON provider.provider_id=route.provider_id
        WHERE provider.enabled`,
    );
    const modelAvailable = model.rows[0]?.available === true;
    const modelRequired = !hasZeroLlmBudget(row?.runtime_policy);
    if (modelRequired && !modelAvailable)
      reasons.push(reason('MODEL_ROUTE_UNAVAILABLE', 'warning', 'runtime-model-catalog'));
    return Object.freeze({
      bindingId,
      available: row !== undefined && row.enabled && row.validation_passed && !requiredUnavailable,
      degraded: optionalUnavailable || (modelRequired && !modelAvailable),
      catalogParts: Object.freeze([...catalogParts, model.rows[0]?.fingerprint ?? 'none']),
      policyParts: Object.freeze([
        JSON.stringify(row?.runtime_policy ?? null),
        ...bindingPolicyParts,
      ]),
      reasons: Object.freeze(reasons),
    });
  }

  private async assessPlanTemplate(
    bindingId: string,
    artifactId: string,
    implementationVersion: string,
    providerPolicyOverride: unknown,
  ): Promise<RuntimeImplementationReadiness> {
    if (providerPolicyOverride !== undefined)
      return Object.freeze({
        bindingId,
        available: false,
        degraded: false,
        catalogParts: Object.freeze([]),
        policyParts: Object.freeze([JSON.stringify(providerPolicyOverride)]),
        reasons: Object.freeze([
          reason('MCP_PROVIDER_BINDING_POLICY_INVALID', 'blocking', bindingId),
        ]),
      });
    const result = await this.#pool.query<{ content_hash: string; dependency_snapshot: unknown }>(
      `SELECT artifact.content_hash,artifact.dependency_snapshot
         FROM compiled_artifact artifact
         JOIN artifact_active_pointer pointer
           ON pointer.artifact_key=artifact.artifact_key AND pointer.artifact_id=artifact.artifact_id
          AND pointer.artifact_version=artifact.version
        WHERE artifact.artifact_id=$1 AND artifact.version=$2 AND artifact.artifact_type='plan_template'
          AND artifact.status='active'`,
      [artifactId, Number(implementationVersion)],
    );
    const row = result.rows[0];
    return Object.freeze({
      bindingId,
      available: row !== undefined,
      degraded: false,
      catalogParts: Object.freeze([
        row?.content_hash ?? `missing:${artifactId}@${implementationVersion}`,
      ]),
      policyParts: Object.freeze([JSON.stringify(row?.dependency_snapshot ?? null)]),
      reasons: Object.freeze(
        row === undefined
          ? [
              reason(
                'PLAN_TEMPLATE_UNAVAILABLE',
                'blocking',
                `${artifactId}@${implementationVersion}`,
              ),
            ]
          : [],
      ),
    });
  }
}

const selectColumns = `SELECT capability_id,capability_version,snapshot_version,status,raw_status,
  candidate_status,candidate_since,evaluated_at,valid_until,catalog_hash,policy_hash,snapshot_hash,
  reasons,available_implementations,unavailable_implementations,evaluation_input`;

function mapRow(row: ReadinessRow): StoredCapabilityReadiness {
  return Object.freeze({
    snapshot: Object.freeze({
      capabilityId: row.capability_id,
      capabilityVersion: row.capability_version,
      snapshotVersion: row.snapshot_version,
      status: row.status,
      evaluatedAt: row.evaluated_at.toISOString(),
      validUntil: row.valid_until.toISOString(),
      catalogHash: row.catalog_hash,
      policyHash: row.policy_hash,
      reasons: Object.freeze(row.reasons),
      availableImplementations: Object.freeze(row.available_implementations),
      unavailableImplementations: Object.freeze(row.unavailable_implementations),
    }),
    snapshotHash: row.snapshot_hash,
    rawStatus: row.raw_status,
    ...(row.candidate_status === null ? {} : { candidateStatus: row.candidate_status }),
    ...(row.candidate_since === null ? {} : { candidateSince: row.candidate_since.toISOString() }),
    input: row.evaluation_input,
  });
}

function hasZeroLlmBudget(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'maxLlmCalls' in value && value.maxLlmCalls === 0
  );
}

function reason(
  code: string,
  severity: 'warning' | 'blocking',
  dependencyRef: string,
): CapabilityReadinessReason {
  return Object.freeze({ code, severity, dependencyRef });
}

function insertEvent(client: PoolClient, record: StoredCapabilityReadiness) {
  return client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,correlation,payload,occurred_at)
     VALUES($1,'node.capability.readiness_changed','capability_readiness',$2,$3,'{}'::jsonb,$4::jsonb,$5)`,
    [
      randomUUID(),
      `${record.snapshot.capabilityId}:${String(record.snapshot.capabilityVersion)}`,
      record.snapshot.snapshotVersion,
      JSON.stringify({
        capabilityId: record.snapshot.capabilityId,
        capabilityVersion: record.snapshot.capabilityVersion,
        snapshotVersion: record.snapshot.snapshotVersion,
        status: record.snapshot.status,
        snapshotHash: record.snapshotHash,
      }),
      record.snapshot.evaluatedAt,
    ],
  );
}
