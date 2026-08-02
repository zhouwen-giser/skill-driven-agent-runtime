import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  ControlledModelRouteResolution,
  ControlledModelRouteResolver,
  ModelProviderRecord,
} from '../../application/src/index.js';
import type { ModelStage } from '../../domain/src/index.js';
import type {
  LlmModelDefinition,
  LlmProviderDefinition,
  ModelRouteBudgetPolicy,
  ModelRouteCandidate,
  ModelRouteDefinition,
  ModelRouteStage,
} from '../../node-control-domain/src/index.js';
import type { RuntimeModelControlPort } from '../../runtime-control-application/src/index.js';

export interface RuntimeEncryptedCredentialResolver {
  resolveEncryptedCredential(credentialRef: string): Promise<string | undefined>;
}

export class PostgresExistingModelCredentialResolver implements RuntimeEncryptedCredentialResolver {
  readonly #pool: Pool;
  readonly #fallback: RuntimeEncryptedCredentialResolver | undefined;

  constructor(pool: Pool, fallback?: RuntimeEncryptedCredentialResolver) {
    this.#pool = pool;
    this.#fallback = fallback;
  }

  async resolveEncryptedCredential(credentialRef: string): Promise<string | undefined> {
    const providerId = /^runtime-model-provider:\/\/(.+)$/u.exec(credentialRef)?.[1];
    if (providerId !== undefined) {
      const result = await this.#pool.query<{ encrypted_credential: string }>(
        'SELECT encrypted_credential FROM model_provider WHERE provider_id=$1 AND enabled=true',
        [providerId],
      );
      return result.rows[0]?.encrypted_credential;
    }
    return this.#fallback?.resolveEncryptedCredential(credentialRef);
  }
}

interface ProviderCatalogRow extends QueryResultRow {
  configuration_id: string;
  revision: string;
  provider_id: string;
  provider_type: LlmProviderDefinition['providerType'];
  base_url: string;
  encrypted_credential: string;
  model_catalog: readonly LlmModelDefinition[];
  health_policy: LlmProviderDefinition['healthPolicy'];
}

interface RuntimeModelCandidateRef extends ModelRouteCandidate {
  readonly providerConfigurationId: string;
  readonly providerRevision: number;
}

interface RouteRow extends QueryResultRow {
  route_configuration_id: string;
  route_revision: string;
  route_checksum: string;
  candidates: readonly RuntimeModelCandidateRef[];
  budget_policy: ModelRouteBudgetPolicy;
}

interface BindingRow extends QueryResultRow {
  route_configuration_id: string;
  route_revision: string;
  route_checksum: string;
  candidates: readonly RuntimeModelCandidateRef[];
  budget_policy: ModelRouteBudgetPolicy;
}

interface AppliedConfigurationRow extends QueryResultRow {
  identity: string;
  checksum: string;
  is_active: boolean;
}

export class PostgresRuntimeModelControl
  implements RuntimeModelControlPort, ControlledModelRouteResolver
{
  readonly #pool: Pool;
  readonly #credentials: RuntimeEncryptedCredentialResolver;
  readonly #now: () => string;

  constructor(
    pool: Pool,
    credentials: RuntimeEncryptedCredentialResolver,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#pool = pool;
    this.#credentials = credentials;
    this.#now = now;
  }

  async applyProvider(
    definition: LlmProviderDefinition,
    configuration: Readonly<{ configurationId: string; revision: number; checksum: string }>,
  ): Promise<Readonly<{ providerId: string; modelCount: number }>> {
    const replay = await readAppliedConfiguration(
      this.#pool,
      'runtime_model_provider_catalog',
      'provider_id',
      configuration,
    );
    if (replay !== undefined) {
      assertReplay(replay, definition.providerId, configuration.checksum);
      return Object.freeze({
        providerId: definition.providerId,
        modelCount: definition.models.length,
      });
    }
    const encryptedCredential = await this.#credentials.resolveEncryptedCredential(
      definition.credentialRef,
    );
    if (encryptedCredential === undefined) throw coded('MODEL_CREDENTIAL_REF_UNAVAILABLE');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `runtime-model-provider:${definition.providerId}`,
      ]);
      const lockedReplay = await readAppliedConfiguration(
        client,
        'runtime_model_provider_catalog',
        'provider_id',
        configuration,
      );
      if (lockedReplay !== undefined) {
        assertReplay(lockedReplay, definition.providerId, configuration.checksum);
        await client.query('COMMIT');
        return Object.freeze({
          providerId: definition.providerId,
          modelCount: definition.models.length,
        });
      }
      await client.query(
        'UPDATE runtime_model_provider_catalog SET is_active=false WHERE provider_id=$1 AND is_active',
        [definition.providerId],
      );
      await client.query(
        `INSERT INTO runtime_model_provider_catalog(
           configuration_id,revision,provider_id,provider_type,base_url,credential_ref,
           encrypted_credential,model_catalog,health_policy,rate_limit_policy,checksum,is_active,applied_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,true,$12)`,
        [
          configuration.configurationId,
          configuration.revision,
          definition.providerId,
          definition.providerType,
          definition.baseUrl,
          definition.credentialRef,
          encryptedCredential,
          JSON.stringify(definition.models),
          JSON.stringify(definition.healthPolicy),
          JSON.stringify(definition.rateLimitPolicy),
          configuration.checksum,
          this.#now(),
        ],
      );
      await client.query('COMMIT');
      return Object.freeze({
        providerId: definition.providerId,
        modelCount: definition.models.length,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async applyRoute(
    definition: ModelRouteDefinition,
    configuration: Readonly<{ configurationId: string; revision: number; checksum: string }>,
  ): Promise<Readonly<{ routeId: string; candidateCount: number }>> {
    const replay = await readAppliedConfiguration(
      this.#pool,
      'runtime_model_route_snapshot',
      'route_id',
      configuration,
    );
    if (replay !== undefined) {
      assertReplay(replay, definition.routeId, configuration.checksum);
      return Object.freeze({
        routeId: definition.routeId,
        candidateCount: 1 + definition.fallbacks.length,
      });
    }
    const requestedCandidates = Object.freeze([definition.primary, ...definition.fallbacks]);
    const candidates: RuntimeModelCandidateRef[] = [];
    const requiredCapability = definition.stage === 'embedding' ? 'embedding' : 'structured_output';
    for (const candidate of requestedCandidates) {
      const provider = await this.findProvider(candidate.providerId);
      if (provider === undefined) throw coded('MODEL_ROUTE_CANDIDATE_UNAVAILABLE');
      const model = provider.model_catalog.find((item) => item.modelId === candidate.modelId);
      if (model?.enabled !== true || !model.capabilities.includes(requiredCapability))
        throw coded('MODEL_ROUTE_CANDIDATE_UNAVAILABLE');
      candidates.push(
        Object.freeze({
          ...candidate,
          providerConfigurationId: provider.configuration_id,
          providerRevision: Number(provider.revision),
        }),
      );
    }
    const selector = definition.budgetPolicy.selector;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `runtime-model-route:${definition.stage}:${selector.scope}:${selector.key ?? ''}`,
      ]);
      const lockedReplay = await readAppliedConfiguration(
        client,
        'runtime_model_route_snapshot',
        'route_id',
        configuration,
      );
      if (lockedReplay !== undefined) {
        assertReplay(lockedReplay, definition.routeId, configuration.checksum);
        await client.query('COMMIT');
        return Object.freeze({
          routeId: definition.routeId,
          candidateCount: candidates.length,
        });
      }
      await client.query(
        `UPDATE runtime_model_route_snapshot SET is_active=false
          WHERE stage=$1 AND scope_type=$2 AND scope_key=$3 AND is_active`,
        [definition.stage, selector.scope, selector.key ?? ''],
      );
      await client.query(
        `INSERT INTO runtime_model_route_snapshot(
           configuration_id,revision,route_id,stage,scope_type,scope_key,candidates,
           budget_policy,checksum,is_active,applied_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,true,$10)`,
        [
          configuration.configurationId,
          configuration.revision,
          definition.routeId,
          definition.stage,
          selector.scope,
          selector.key ?? '',
          JSON.stringify(candidates),
          JSON.stringify(definition.budgetPolicy),
          configuration.checksum,
          this.#now(),
        ],
      );
      await client.query('COMMIT');
      return Object.freeze({ routeId: definition.routeId, candidateCount: candidates.length });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(
    input: Parameters<ControlledModelRouteResolver['resolve']>[0],
  ): Promise<ControlledModelRouteResolution | undefined> {
    const broadStage = broadStageFor(input.stage, input.operation);
    const route =
      input.taskId === undefined
        ? await this.findActiveRoute(broadStage, input.routeContext)
        : await this.findOrBindTaskRoute(
            input.taskId,
            input.stage,
            broadStage,
            input.routeContext,
            input.boundAt,
          );
    if (route === undefined) return undefined;
    const candidates: ModelProviderRecord[] = [];
    for (const candidate of route.candidates) {
      const provider = await this.findProviderRevision(
        candidate.providerConfigurationId,
        candidate.providerRevision,
      );
      const model = provider?.model_catalog.find(
        (item) => item.modelId === candidate.modelId && item.enabled,
      );
      if (provider === undefined || model === undefined) continue;
      const capability = input.operation === 'embedding' ? 'embedding' : 'structured_output';
      if (!model.capabilities.includes(capability)) continue;
      candidates.push(
        Object.freeze({
          configuration: Object.freeze({
            providerId: provider.provider_id,
            name: provider.provider_id,
            kind:
              provider.provider_type === 'local'
                ? 'local'
                : provider.provider_type === 'openai_compatible'
                  ? 'openai_compatible'
                  : 'other_vendor',
            apiStyle:
              provider.provider_type === 'anthropic'
                ? 'anthropic_messages'
                : 'openai_chat_completions',
            baseUrl: provider.base_url,
            model: model.modelId,
            enabled: true,
            timeoutMs: Math.min(provider.health_policy.timeoutMs, route.budget_policy.timeoutMs),
            createdAt: input.boundAt,
            updatedAt: input.boundAt,
          }),
          encryptedCredential: provider.encrypted_credential,
        }),
      );
    }
    return Object.freeze({
      routeRef: `${route.route_configuration_id}:${route.route_revision}`,
      candidates: Object.freeze(candidates),
      maxAttempts: route.budget_policy.maxAttempts,
      timeoutMs: route.budget_policy.timeoutMs,
      fallbackOn: route.budget_policy.fallbackOn,
    });
  }

  private async findProvider(providerId: string): Promise<ProviderCatalogRow | undefined> {
    const result = await this.#pool.query<ProviderCatalogRow>(
      'SELECT * FROM runtime_model_provider_catalog WHERE provider_id=$1 AND is_active',
      [providerId],
    );
    return result.rows[0];
  }

  private async findProviderRevision(
    configurationId: string,
    revision: number,
  ): Promise<ProviderCatalogRow | undefined> {
    const result = await this.#pool.query<ProviderCatalogRow>(
      `SELECT * FROM runtime_model_provider_catalog
        WHERE configuration_id=$1 AND revision=$2`,
      [configurationId, revision],
    );
    return result.rows[0];
  }

  private async findActiveRoute(
    stage: ModelRouteStage,
    context?: Readonly<{ taskType?: string; caseType?: string }>,
  ): Promise<RouteRow | undefined> {
    const result = await this.#pool.query<RouteRow>(
      `SELECT configuration_id AS route_configuration_id,
              revision::text AS route_revision,
              checksum::text AS route_checksum,
              candidates,budget_policy
         FROM runtime_model_route_snapshot
        WHERE stage=$1 AND is_active AND (
          (scope_type='case' AND scope_key=$2) OR
          (scope_type='task' AND scope_key=$3) OR
          scope_type='stage'
        )
        ORDER BY CASE scope_type WHEN 'case' THEN 1 WHEN 'task' THEN 2 ELSE 3 END
        LIMIT 1`,
      [stage, context?.caseType ?? '', context?.taskType ?? ''],
    );
    return result.rows[0];
  }

  private async findOrBindTaskRoute(
    taskId: string,
    modelStage: ModelStage,
    broadStage: ModelRouteStage,
    context: Readonly<{ taskType?: string; caseType?: string }> | undefined,
    boundAt: string,
  ): Promise<BindingRow | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
        taskId,
        modelStage,
      ]);
      let binding = await readBinding(client, taskId, modelStage);
      if (binding === undefined) {
        const route = await findActiveRouteWithClient(client, broadStage, context);
        if (route === undefined) {
          await client.query('COMMIT');
          return undefined;
        }
        await client.query(
          `INSERT INTO runtime_task_model_route_binding(
             task_id,model_stage,route_configuration_id,route_revision,route_checksum,
             candidates,budget_policy,bound_at)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
          [
            taskId,
            modelStage,
            route.route_configuration_id,
            Number(route.route_revision),
            route.route_checksum,
            JSON.stringify(route.candidates),
            JSON.stringify(route.budget_policy),
            boundAt,
          ],
        );
        binding = await readBinding(client, taskId, modelStage);
      }
      await client.query('COMMIT');
      return binding;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findActiveRouteWithClient(
  client: PoolClient,
  stage: ModelRouteStage,
  context?: Readonly<{ taskType?: string; caseType?: string }>,
): Promise<RouteRow | undefined> {
  const result = await client.query<RouteRow>(
    `SELECT configuration_id AS route_configuration_id,
            revision::text AS route_revision,
            checksum::text AS route_checksum,
            candidates,budget_policy
       FROM runtime_model_route_snapshot
      WHERE stage=$1 AND is_active AND (
        (scope_type='case' AND scope_key=$2) OR
        (scope_type='task' AND scope_key=$3) OR scope_type='stage')
      ORDER BY CASE scope_type WHEN 'case' THEN 1 WHEN 'task' THEN 2 ELSE 3 END
      LIMIT 1`,
    [stage, context?.caseType ?? '', context?.taskType ?? ''],
  );
  return result.rows[0];
}

async function readBinding(
  client: PoolClient,
  taskId: string,
  modelStage: ModelStage,
): Promise<BindingRow | undefined> {
  const result = await client.query<BindingRow>(
    `SELECT route_configuration_id,route_revision::text,route_checksum::text,candidates,budget_policy
       FROM runtime_task_model_route_binding WHERE task_id=$1 AND model_stage=$2`,
    [taskId, modelStage],
  );
  return result.rows[0];
}

function broadStageFor(
  stage: ModelStage,
  operation: 'structured_generation' | 'embedding',
): ModelRouteStage {
  if (operation === 'embedding') return 'embedding';
  if (
    [
      'intent',
      'goal',
      'task_understanding',
      'task_clarification',
      'goal_contract_generation',
    ].includes(stage)
  )
    return 'understanding';
  if (
    [
      'goal_planning',
      'workflow_planning',
      'skill_authoring',
      'skill_selection',
      'skill_input_resolution',
      'interactive_plan_patch',
      'task_type_induction',
      'capability_pattern_induction',
      'knowledge_promotion_assessment',
    ].includes(stage)
  )
    return 'planning';
  if (['execution_decision', 'tool_enhancement'].includes(stage)) return 'execution';
  if (
    ['goal_evaluation', 'evaluation', 'experience_observation', 'experience_reflection'].includes(
      stage,
    )
  )
    return 'evaluation';
  return 'summary';
}

function coded(code: string): Error & { code: string } {
  return Object.assign(new Error('Runtime Model Control operation failed.'), { code });
}

async function readAppliedConfiguration(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  table: 'runtime_model_provider_catalog' | 'runtime_model_route_snapshot',
  identityColumn: 'provider_id' | 'route_id',
  configuration: Readonly<{ configurationId: string; revision: number }>,
): Promise<AppliedConfigurationRow | undefined> {
  const result = await database.query<AppliedConfigurationRow>(
    `SELECT ${identityColumn} AS identity,checksum::text,is_active
       FROM ${table} WHERE configuration_id=$1 AND revision=$2`,
    [configuration.configurationId, configuration.revision],
  );
  return result.rows[0];
}

function assertReplay(
  existing: AppliedConfigurationRow,
  expectedIdentity: string,
  expectedChecksum: string,
): void {
  if (existing.identity !== expectedIdentity || existing.checksum.trim() !== expectedChecksum)
    throw coded('MODEL_CONFIGURATION_REPLAY_CONFLICT');
  if (!existing.is_active) throw coded('MODEL_CONFIGURATION_REVISION_STALE');
}
