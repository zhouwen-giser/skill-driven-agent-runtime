import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { ManagementOperation } from '../../node-control-domain/src/index.js';
import type {
  NodeControlRuntimeGovernanceClient,
  RuntimePlanTemplateVersionView,
  RuntimeGovernanceCommand,
  SkillVersionView,
} from '../../node-control-application/src/index.js';

const SkillVersionSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.union([z.string().min(1), z.number().int().positive()]),
    name: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    status: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    usageSpecification: z.record(z.string(), z.unknown()).optional(),
    outcomeSpecification: z.record(z.string(), z.unknown()).optional(),
    toolPolicy: z.record(z.string(), z.unknown()).optional(),
    providerPolicy: z.record(z.string(), z.unknown()).optional(),
    validationPassed: z.boolean().optional(),
    checksum: z.string().optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .loose();

const SkillCollectionSchema = z.object({ items: z.array(SkillVersionSchema) }).loose();
const PlanTemplateVersionSchema = z
  .object({
    artifactId: z.string().min(1),
    authorityArtifactId: z.string().min(1),
    version: z.string().min(1),
    name: z.string().optional(),
    status: z.enum([
      'candidate',
      'validated',
      'approved',
      'active',
      'suspended',
      'deprecated',
      'retired',
    ]),
    checksum: z.string().min(1),
    validationSummary: z.record(z.string(), z.unknown()).optional(),
    activePointer: z.boolean().optional(),
    createdAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const PlanTemplateCollectionSchema = z
  .object({
    items: z.array(PlanTemplateVersionSchema),
    nextPageToken: z.string().optional(),
    totalEstimate: z.number().int().nonnegative().optional(),
    asOf: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const ManagementOperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationType: z.string().min(1),
    target: z
      .object({
        type: z.string().min(1),
        id: z.string().min(1),
        version: z.string().optional(),
        revision: z.number().int().positive().optional(),
      })
      .strict(),
    status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
    actorId: z.string().min(1),
    reason: z.string().min(1),
    idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    result: z.unknown().optional(),
    errorCode: z.string().optional(),
    createdAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export class HttpRuntimeGovernanceClient implements NodeControlRuntimeGovernanceClient {
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(configuration: Readonly<{ baseUrl: string; serviceToken: string }>) {
    this.#baseUrl = configuration.baseUrl.replace(/\/+$/u, '');
    this.#serviceToken = configuration.serviceToken;
  }

  async listSkills(): Promise<readonly SkillVersionView[]> {
    const body = SkillCollectionSchema.parse(await this.#get('/api/v1/skills'));
    return Object.freeze(body.items.map(projectSkill));
  }

  async listSkillVersions(skillId: string): Promise<readonly SkillVersionView[]> {
    const body = SkillCollectionSchema.parse(
      await this.#get(`/api/v1/skills/${encodeURIComponent(skillId)}/versions`),
    );
    return Object.freeze(body.items.map(projectSkill));
  }

  async getSkillVersion(skillId: string, version: string): Promise<SkillVersionView> {
    return projectSkill(
      SkillVersionSchema.parse(
        await this.#get(
          `/api/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}`,
        ),
      ),
    );
  }

  async listPlanTemplates(): Promise<readonly RuntimePlanTemplateVersionView[]> {
    const items: RuntimePlanTemplateVersionView[] = [];
    let pageToken: string | undefined;
    do {
      const path = new URL(`${this.#baseUrl}/internal/v1/plan-templates`);
      path.searchParams.set('pageSize', '200');
      if (pageToken !== undefined) path.searchParams.set('pageToken', pageToken);
      const body = PlanTemplateCollectionSchema.parse(await this.#get(path));
      items.push(...body.items.map(projectPlanTemplate));
      pageToken = body.nextPageToken;
    } while (pageToken !== undefined);
    return Object.freeze(items);
  }

  importSkill(command: RuntimeGovernanceCommand): Promise<ManagementOperation> {
    return this.#post('/internal/v1/skills/import', command);
  }

  governSkill(
    operation: 'publish' | 'suspend' | 'deprecate',
    skillId: string,
    version: string,
    command: RuntimeGovernanceCommand,
  ): Promise<ManagementOperation> {
    return this.#post(
      `/internal/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/${operation}`,
      command,
    );
  }

  governPlanTemplate(
    operation: 'publish' | 'revalidate' | 'suspend',
    artifactId: string,
    version: string,
    command: RuntimeGovernanceCommand,
  ): Promise<ManagementOperation> {
    return this.#post(
      `/internal/v1/plan-templates/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(version)}/${operation}`,
      command,
    );
  }

  async #get(path: string | URL): Promise<unknown> {
    const response = await globalThis.fetch(
      typeof path === 'string' ? `${this.#baseUrl}${path}` : path,
      {
        headers: this.#headers(),
        redirect: 'manual',
      },
    );
    return responseJson(response);
  }

  async #post(path: string, command: RuntimeGovernanceCommand): Promise<ManagementOperation> {
    const response = await globalThis.fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.#headers(),
        'content-type': 'application/json',
        'idempotency-key': command.idempotencyKey,
      },
      body: JSON.stringify({
        reason: command.reason,
        ...(command.payload === undefined ? {} : { payload: command.payload }),
        ...(command.expectedRevision === undefined
          ? {}
          : { expectedRevision: command.expectedRevision }),
      }),
      redirect: 'manual',
    });
    return projectManagementOperation(
      ManagementOperationSchema.parse(await responseJson(response)),
    );
  }

  #headers(): Readonly<Record<string, string>> {
    return Object.freeze({ authorization: `Bearer ${this.#serviceToken}` });
  }
}

function projectSkill(input: z.infer<typeof SkillVersionSchema>): SkillVersionView {
  const version = String(input.version);
  const status = governedStatus(input.status, input.validationPassed === true);
  const description = input.description ?? input.summary;
  const content = {
    skillId: input.skillId,
    version,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(description === undefined ? {} : { description }),
    status,
    inputSchema: Object.freeze(structuredClone(input.inputSchema)),
    outputSchema: Object.freeze(structuredClone(input.outputSchema)),
    ...(input.usageSpecification === undefined
      ? {}
      : { usageSpecification: Object.freeze(structuredClone(input.usageSpecification)) }),
    ...(input.outcomeSpecification === undefined
      ? {}
      : { outcomeSpecification: Object.freeze(structuredClone(input.outcomeSpecification)) }),
    evidencePolicy: Object.freeze({
      requiredEvidence:
        input.outcomeSpecification?.['evidence'] === undefined
          ? Object.freeze([])
          : structuredClone(input.outcomeSpecification['evidence']),
    }),
    providerPolicy: Object.freeze(
      structuredClone(input.providerPolicy ?? input.toolPolicy ?? Object.freeze({})),
    ),
    createdAt: input.createdAt,
  };
  return Object.freeze({
    ...content,
    checksum: input.checksum ?? createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  });
}

function projectPlanTemplate(
  input: z.infer<typeof PlanTemplateVersionSchema>,
): RuntimePlanTemplateVersionView {
  return Object.freeze({
    artifactId: input.artifactId,
    authorityArtifactId: input.authorityArtifactId,
    version: input.version,
    ...(input.name === undefined ? {} : { name: input.name }),
    status: input.status,
    checksum: input.checksum,
    ...(input.validationSummary === undefined
      ? {}
      : { validationSummary: Object.freeze(structuredClone(input.validationSummary)) }),
    ...(input.activePointer === undefined ? {} : { activePointer: input.activePointer }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

function projectManagementOperation(
  input: z.infer<typeof ManagementOperationSchema>,
): ManagementOperation {
  return Object.freeze({
    operationId: input.operationId,
    operationType: input.operationType,
    target: Object.freeze({
      type: input.target.type,
      id: input.target.id,
      ...(input.target.version === undefined ? {} : { version: input.target.version }),
      ...(input.target.revision === undefined ? {} : { revision: input.target.revision }),
    }),
    status: input.status,
    actorId: input.actorId,
    reason: input.reason,
    idempotencyKeyHash: input.idempotencyKeyHash,
    inputHash: input.inputHash,
    ...(input.result === undefined ? {} : { result: input.result }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    createdAt: input.createdAt,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
  });
}

function governedStatus(status: string, validationPassed: boolean): SkillVersionView['status'] {
  if (status === 'enabled' || status === 'published') return 'published';
  if (status === 'disabled' || status === 'suspended') return 'suspended';
  if (status === 'deprecated') return 'deprecated';
  if (status === 'retired') return 'retired';
  if (status === 'validated' || validationPassed) return 'validated';
  return 'draft';
}

async function responseJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = runtimeErrorCode(body) ?? `RUNTIME_GOVERNANCE_HTTP_${String(response.status)}`;
    throw new RuntimeGovernanceHttpError(code, response.status);
  }
  return body;
}

function runtimeErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  if ('code' in body && typeof body.code === 'string') return body.code;
  if (
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'code' in body.error &&
    typeof body.error.code === 'string'
  )
    return body.error.code;
  return undefined;
}

export class RuntimeGovernanceHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`Runtime governance request failed with ${code}.`);
    this.name = 'RuntimeGovernanceHttpError';
    this.code = code;
    this.status = status;
  }
}
