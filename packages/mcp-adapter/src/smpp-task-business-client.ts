import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { z } from 'zod';

import {
  SMPP_TASK_BUSINESS_EXTENSION,
  SMPP_TASK_BUSINESS_PROFILE_VERSION,
  type FrozenMcpMethod,
  type FrozenV1McpClient,
} from './frozen-v1-mcp-client.js';

/**
 * SMPP v1.3's public TaskBusiness consumer. This composes SDAR's existing
 * frozen MCP transport; it does not bypass Registry/Task authorization or
 * create another Provider connection.
 *
 * No physical action is issued by a read. Mutation methods require an
 * explicit governance callback, an existing Task, and exact current objects.
 */
const object = z.record(z.string(), z.unknown());
const refSchema = z
  .object({
    kind: z.enum(['artifact', 'action', 'input_request', 'intervention']),
    id: z.string().min(1),
    revision: z.number().int().positive(),
  })
  .strict();
const cursorSchema = z
  .object({
    streamId: z.string().min(1),
    afterSequence: z.string().regex(/^(0|[1-9][0-9]*)$/u),
  })
  .strict();
const identitySchema = z
  .object({
    taskId: z.string().min(1),
    executionId: z.string().min(1),
    providerId: z.string().min(1),
    resourceId: z.string().min(1),
    operationName: z.string().min(1),
  })
  .passthrough();
const contextSchema = z
  .object({
    identity: identitySchema,
    contextRevision: z.number().int().nonnegative(),
    effectivePlanRevision: z.number().int().nonnegative(),
    summary: z
      .object({
        status: z.enum(['in_progress', 'finalized']),
        properties: object.optional(),
      })
      .passthrough(),
    activeRefs: z.record(z.string(), refSchema),
    requiredInputRefs: z.array(refSchema),
    interventionRefs: z.array(refSchema),
  })
  .passthrough();
const versionSchema = z
  .object({
    kind: refSchema.shape.kind,
    value: z
      .object({
        identity: identitySchema,
        revision: z.number().int().positive(),
      })
      .passthrough(),
  })
  .strict();
const descriptorSchema = z
  .object({ ref: refSchema })
  .passthrough();
const pageSchema = z
  .object({
    resultType: z.literal('complete'),
    profileVersion: z.literal(SMPP_TASK_BUSINESS_PROFILE_VERSION),
    snapshotToken: z.string().min(1).optional(),
    snapshot: z
      .object({
        contextRevision: z.number().int().nonnegative(),
        context: z.unknown().optional(),
        contextDescriptor: z.unknown().optional(),
        objects: z.array(versionSchema).default([]),
        objectDescriptors: z.array(descriptorSchema).default([]),
        nextCursor: z.string().min(1).optional(),
      })
      .passthrough(),
    resumeFrom: cursorSchema,
  })
  .passthrough();
const contentSchema = z
  .object({
    encoding: z.literal('base64'),
    bytes: z.string(),
    totalBytes: z.string().regex(/^(0|[1-9][0-9]*)$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    offset: z.number().int().nonnegative(),
    nextOffset: z.string().regex(/^[1-9][0-9]*$/u).optional(),
  })
  .passthrough();
const partSchema = z
  .object({
    resultType: z.literal('complete'),
    profileVersion: z.literal(SMPP_TASK_BUSINESS_PROFILE_VERSION),
    part: contentSchema,
  })
  .passthrough();
const artifactSchema = z
  .object({
    resultType: z.literal('complete'),
    profileVersion: z.literal(SMPP_TASK_BUSINESS_PROFILE_VERSION),
    artifact: z
      .object({
        identity: identitySchema,
        artifactId: z.string().min(1),
        revision: z.number().int().positive(),
      })
      .passthrough(),
    content: contentSchema.optional(),
  })
  .passthrough();
const receiptSchema = z
  .object({
    resultType: z.literal('complete'),
    profileVersion: z.literal(SMPP_TASK_BUSINESS_PROFILE_VERSION),
    receipt: z
      .object({
        commandId: z.string().min(1),
        commandSequence: z.number().int().positive(),
        commandState: z.string().min(1),
        durablyAccepted: z.literal(true),
        businessApplied: z.literal(false),
        duplicate: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

const semanticSchema = z
  .object({
    schemaVersion: z.literal('ugv.business-semantics/1'),
    missionTaskState: z.enum([
      'idle', 'starting', 'running', 'paused', 'cancelled', 'succeeded', 'failed', 'unknown',
    ]),
    reconPhase: z.enum([
      'idle', 'configuring', 'ready', 'starting', 'running', 'resuming', 'pausing', 'paused',
      'cancelled', 'failed', 'completed', 'stopping', 'manual_intervention', 'unknown',
    ]),
    visualLockState: z.enum(['unlocked', 'locking', 'locked', 'unknown']),
    sensorMode: z.enum(['adaptive', 'visible', 'infrared', 'dc', 'unknown']),
    payloadHealth: z.enum(['normal', 'fault', 'offline', 'unknown']),
    payloadLoadState: z.enum(['fault', 'unknown']),
    native: object,
  })
  .passthrough();
export type SmppUgvBusinessSemantics = z.infer<typeof semanticSchema>;
export type SmppBusinessContext = z.infer<typeof contextSchema>;
export type SmppBusinessVersion = z.infer<typeof versionSchema>;
export type SmppBusinessCursor = z.infer<typeof cursorSchema>;
export type SmppBusinessRef = z.infer<typeof refSchema>;

export interface SmppBusinessView {
  readonly context: SmppBusinessContext;
  readonly objects: readonly SmppBusinessVersion[];
  readonly resumeFrom: SmppBusinessCursor;
  readonly businessSemantics?: SmppUgvBusinessSemantics;
}

export interface SmppBusinessEndpoint {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface SmppBusinessMutationAuthority {
  /**
   * The owner must have checked its exact Source/Provider/Capability successor
   * and Task authorization. Returning false rejects the command before dispatch.
   */
  authorize(input: Readonly<{
    taskId: string;
    executionId: string;
    operation: 'input_response' | 'navigation_adjust_plan';
  }>): Promise<boolean>;
}

export interface SmppTaskBusinessOptions extends SmppBusinessEndpoint {
  readonly client: FrozenV1McpClient;
  readonly now: () => string;
  readonly expectedProviderId: string;
  readonly expectedResourceId: string;
  readonly mutationAuthority?: SmppBusinessMutationAuthority;
}

const MAX_PAGES = 64;
const MAX_CONTENT = 8 * 1_048_576;

export class SmppTaskBusinessClient {
  readonly #client: FrozenV1McpClient;
  readonly #endpoint: SmppBusinessEndpoint;
  readonly #now: () => string;
  readonly #providerId: string;
  readonly #resourceId: string;
  readonly #mutationAuthority: SmppBusinessMutationAuthority | undefined;
  #methods: Readonly<Record<string, string>> | undefined;

  constructor(options: SmppTaskBusinessOptions) {
    this.#client = options.client;
    this.#endpoint = { endpoint: options.endpoint, headers: options.headers };
    this.#now = options.now;
    this.#providerId = options.expectedProviderId;
    this.#resourceId = options.expectedResourceId;
    this.#mutationAuthority = options.mutationAuthority;
  }

  async discover(): Promise<Readonly<Record<string, string>>> {
    const discovered = await this.#client.discover(this.#endpoint);
    const extension = discovered.capabilities.extensions[SMPP_TASK_BUSINESS_EXTENSION];
    const parsed = z
      .object({
        profileVersion: z.literal(SMPP_TASK_BUSINESS_PROFILE_VERSION),
        methods: z.record(z.string(), z.string()),
      })
      .passthrough()
      .safeParse(extension);
    if (!parsed.success) throw new SmppBusinessError('SMPP_BUSINESS_EXTENSION_UNAVAILABLE');
    const catalog = discovered.capabilities.extensions['io.sdar/providerCatalog'];
    if (!isRecord(catalog) || catalog['providerId'] !== this.#providerId) {
      throw new SmppBusinessError('SMPP_PROVIDER_ID_MISMATCH');
    }
    this.#methods = parsed.data.methods;
    return this.#methods;
  }

  async getContext(input: Readonly<{ taskId: string; maxPageBytes?: number }>): Promise<SmppBusinessView> {
    await this.#requireMethod('contextGet', 'io.sdar/taskBusiness/context/get');
    const seenCursors = new Set<string>();
    const objects = new Map<string, SmppBusinessVersion>();
    let pageCursor: string | undefined;
    let revision: number | undefined;
    let resumeFrom: SmppBusinessCursor | undefined;
    let context: SmppBusinessContext | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const raw = await this.#client.request({
        ...this.#endpoint,
        method: 'io.sdar/taskBusiness/context/get',
        params: {
          taskId: input.taskId,
          maxPageBytes: input.maxPageBytes ?? 65_536,
          ...(pageCursor === undefined ? {} : { pageCursor }),
        },
      });
      const current = pageSchema.safeParse(raw);
      if (!current.success) throw new SmppBusinessError('SMPP_CONTEXT_RESPONSE_INVALID');
      const data = current.data;
      if (
        (revision !== undefined && revision !== data.snapshot.contextRevision) ||
        (resumeFrom !== undefined && !isDeepStrictEqual(resumeFrom, data.resumeFrom))
      ) {
        throw new SmppBusinessError('SMPP_CONTEXT_SNAPSHOT_CHANGED');
      }
      revision = data.snapshot.contextRevision;
      resumeFrom = data.resumeFrom;
      if (data.snapshot.context !== undefined) {
        const parsed = contextSchema.safeParse(data.snapshot.context);
        if (!parsed.success) throw new SmppBusinessError('SMPP_CONTEXT_INVALID');
        if (context && !isDeepStrictEqual(context, parsed.data))
          throw new SmppBusinessError('SMPP_CONTEXT_SNAPSHOT_CHANGED');
        context = parsed.data;
      }
      if (data.snapshot.contextDescriptor !== undefined) {
        if (!data.snapshotToken) throw new SmppBusinessError('SMPP_SNAPSHOT_TOKEN_MISSING');
        const value = await this.#readSnapshotJson(input.taskId, data.snapshotToken);
        const parsed = contextSchema.safeParse(value);
        if (!parsed.success) throw new SmppBusinessError('SMPP_CONTEXT_INVALID');
        if (context && !isDeepStrictEqual(context, parsed.data))
          throw new SmppBusinessError('SMPP_CONTEXT_SNAPSHOT_CHANGED');
        context = parsed.data;
      }
      for (const item of data.snapshot.objects) {
        this.#appendObject(objects, item, input.taskId);
      }
      for (const descriptor of data.snapshot.objectDescriptors) {
        if (!data.snapshotToken) throw new SmppBusinessError('SMPP_SNAPSHOT_TOKEN_MISSING');
        const value = await this.#readSnapshotJson(input.taskId, data.snapshotToken, descriptor.ref);
        const parsed = versionSchema.safeParse(value);
        if (!parsed.success || !sameRef(parsed.data, descriptor.ref))
          throw new SmppBusinessError('SMPP_SNAPSHOT_OBJECT_INVALID');
        this.#appendObject(objects, parsed.data, input.taskId);
      }
      if (!data.snapshot.nextCursor) {
        if (!context || !resumeFrom || context.contextRevision !== revision)
          throw new SmppBusinessError('SMPP_CONTEXT_INCOMPLETE');
        this.#validateIdentity(context.identity, input.taskId);
        const semantics = context.summary.properties?.['businessSemantics'];
        const parsedSemantics =
          semantics === undefined ? undefined : semanticSchema.safeParse(semantics);
        if (parsedSemantics && !parsedSemantics.success)
          throw new SmppBusinessError('SMPP_BUSINESS_SEMANTICS_INVALID');
        return {
          context,
          objects: [...objects.values()],
          resumeFrom,
          ...(parsedSemantics?.success ? { businessSemantics: parsedSemantics.data } : {}),
        };
      }
      if (seenCursors.has(data.snapshot.nextCursor))
        throw new SmppBusinessError('SMPP_CONTEXT_CURSOR_LOOP');
      seenCursors.add(data.snapshot.nextCursor);
      pageCursor = data.snapshot.nextCursor;
    }
    throw new SmppBusinessError('SMPP_CONTEXT_PAGE_LIMIT');
  }

  async getArtifact(input: Readonly<{
    taskId: string;
    artifactId: string;
    revision: number;
    includeContent?: boolean;
  }>): Promise<z.infer<typeof artifactSchema>> {
    await this.#requireMethod('artifactGet', 'io.sdar/taskBusiness/artifacts/get');
    const raw = await this.#client.request({
      ...this.#endpoint,
      method: 'io.sdar/taskBusiness/artifacts/get',
      params: {
        taskId: input.taskId,
        artifactId: input.artifactId,
        revision: input.revision,
        includeContent: input.includeContent ?? false,
      },
    });
    const parsed = artifactSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.artifact.artifactId !== input.artifactId ||
      parsed.data.artifact.revision !== input.revision
    ) {
      throw new SmppBusinessError('SMPP_ARTIFACT_REVISION_MISMATCH');
    }
    this.#validateIdentity(parsed.data.artifact.identity, input.taskId);
    // Content is not assumed complete merely because metadata was returned.
    if (parsed.data.content !== undefined) {
      const content = parsed.data.content;
      if (content.offset !== 0 || content.nextOffset !== undefined)
        throw new SmppBusinessError('SMPP_ARTIFACT_CONTENT_INCOMPLETE');
      verifyContent(content);
    }
    return parsed.data;
  }

  async respondToRequiredInput(input: Readonly<{
    taskId: string;
    executionId: string;
    requestId: string;
    requestKey: string;
    expectedRequestRevision: number;
    expectedSubjectBinding: unknown;
    action: 'accept' | 'decline' | 'cancel';
    content?: unknown;
  }>): Promise<Readonly<{ acceptedByRuntime: true; businessConfirmed: false }>> {
    const view = await this.getContext({ taskId: input.taskId });
    this.#checkExecution(view, input.taskId, input.executionId);
    const ref = view.context.activeRefs['input:visualLock'];
    const exact = view.objects.find(
      (item) => item.kind === 'input_request' &&
        item.value['requestId'] === input.requestId &&
        item.value['requestKey'] === input.requestKey &&
        item.value.revision === input.expectedRequestRevision,
    );
    if (
      !ref || !exact ||
      !sameRef(exact, ref) ||
      exact.value['state'] !== 'pending' ||
      !isDeepStrictEqual(exact.value['subjectBinding'], input.expectedSubjectBinding) ||
      !isRecord(exact.value['identity'])
    ) {
      throw new SmppBusinessError('SMPP_INPUT_BINDING_INVALID');
    }
    const deadline = exact.value['deadlineAt'];
    if (typeof deadline === 'string' && Date.parse(this.#now()) >= Date.parse(deadline))
      throw new SmppBusinessError('SMPP_INPUT_EXPIRED');
    if (input.action === 'accept') {
      this.#validateInputSchema(exact.value['inputSchema'], input.content);
    } else if (input.content !== undefined) {
      throw new SmppBusinessError('SMPP_INPUT_CONTENT_UNEXPECTED');
    }
    const taskRaw = await this.#client.request({
      ...this.#endpoint,
      method: 'tasks/get',
      params: { taskId: input.taskId },
    });
    const task = z.object({
      taskId: z.string(),
      status: z.string(),
      inputRequests: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().safeParse(taskRaw);
    if (
      !task.success ||
      task.data.taskId !== input.taskId ||
      task.data.status !== 'input_required' ||
      !(input.requestKey in (task.data.inputRequests ?? {}))
    ) {
      throw new SmppBusinessError('SMPP_INPUT_NOT_CURRENT');
    }
    await this.#authorize(input.taskId, input.executionId, 'input_response');
    const raw = await this.#client.request({
      ...this.#endpoint,
      method: 'tasks/update',
      params: {
        taskId: input.taskId,
        inputResponses: {
          [input.requestKey]: {
            action: input.action,
            ...(input.action === 'accept' ? { content: input.content } : {}),
          },
        },
      },
    });
    if (!isRecord(raw) || raw['resultType'] !== 'complete')
      throw new SmppBusinessError('SMPP_INPUT_RECEIPT_INVALID');
    return { acceptedByRuntime: true, businessConfirmed: false };
  }

  async applyNavigationAdjustment(input: Readonly<{
    taskId: string;
    executionId: string;
    interventionId: string;
    expectedInterventionRevision: number;
    expectedEffectivePlanRevision: number;
    commandId: string;
    waypoints: readonly Readonly<{ longitude: number; latitude: number }>[];
    density: string;
  }>): Promise<z.infer<typeof receiptSchema>['receipt']> {
    await this.#requireMethod('interventionApply', 'io.sdar/taskBusiness/interventions/apply');
    const view = await this.getContext({ taskId: input.taskId });
    this.#checkExecution(view, input.taskId, input.executionId);
    if (view.context.effectivePlanRevision !== input.expectedEffectivePlanRevision)
      throw new SmppBusinessError('SMPP_PLAN_REVISION_CONFLICT');
    const currentRef = view.context.activeRefs['navigation.adjust_plan'];
    const intervention = view.objects.find(
      (item) =>
        item.kind === 'intervention' &&
        item.value['interventionId'] === input.interventionId &&
        item.value.revision === input.expectedInterventionRevision,
    );
    if (
      !currentRef ||
      !intervention ||
      !sameRef(intervention, currentRef) ||
      intervention.value['interventionType'] !== 'navigation.adjust_plan' ||
      intervention.value['state'] !== 'available'
    ) {
      throw new SmppBusinessError('SMPP_INTERVENTION_NOT_CURRENT');
    }
    const expiration = intervention.value['validUntil'];
    if (typeof expiration === 'string' && Date.parse(this.#now()) >= Date.parse(expiration))
      throw new SmppBusinessError('SMPP_INTERVENTION_EXPIRED');
    const payload = { waypoints: input.waypoints, density: input.density };
    this.#validateInputSchema(intervention.value['inputSchema'], payload);
    await this.#authorize(input.taskId, input.executionId, 'navigation_adjust_plan');
    const raw = await this.#client.request({
      ...this.#endpoint,
      method: 'io.sdar/taskBusiness/interventions/apply',
      params: {
        schemaVersion: 'sdar.runtime-intervention-command/1.0-rc2',
        commandId: input.commandId,
        taskId: input.taskId,
        executionId: input.executionId,
        interventionId: input.interventionId,
        guard: {
          mode: 'semantic',
          expectedInterventionRevision: input.expectedInterventionRevision,
          expectedEffectivePlanRevision: input.expectedEffectivePlanRevision,
        },
        input: payload,
      },
    });
    const receipt = receiptSchema.safeParse(raw);
    if (!receipt.success || receipt.data.receipt.commandId !== input.commandId)
      throw new SmppBusinessError('SMPP_INTERVENTION_RECEIPT_INVALID');
    // Durably accepted != applied. Observe the new Context/Intervention revision.
    return receipt.data.receipt;
  }

  async #readSnapshotJson(taskId: string, token: string, ref?: SmppBusinessRef): Promise<unknown> {
    await this.#requireMethod('snapshotPartGet', 'io.sdar/taskBusiness/snapshotParts/get');
    let offset = 0;
    let expectedTotal: number | undefined;
    let expectedHash: string | undefined;
    const chunks: Buffer[] = [];
    for (let i = 0; i < 256; i += 1) {
      const raw = await this.#client.request({
        ...this.#endpoint,
        method: 'io.sdar/taskBusiness/snapshotParts/get',
        params: { taskId, snapshotToken: token, offset, maxBytes: 65_536,
          ...(ref === undefined ? {} : { objectRef: ref }) },
      });
      const parsed = partSchema.safeParse(raw);
      if (!parsed.success) throw new SmppBusinessError('SMPP_SNAPSHOT_PART_INVALID');
      const part = parsed.data.part;
      const total = Number(part.totalBytes);
      if (
        !Number.isSafeInteger(total) || total > MAX_CONTENT ||
        part.offset !== offset ||
        (expectedTotal !== undefined && expectedTotal !== total) ||
        (expectedHash !== undefined && expectedHash !== part.sha256)
      ) throw new SmppBusinessError('SMPP_SNAPSHOT_PART_CONFLICT');
      expectedTotal = total;
      expectedHash = part.sha256;
      const bytes = canonicalBase64(part.bytes);
      offset += bytes.length;
      if (offset > total) throw new SmppBusinessError('SMPP_SNAPSHOT_PART_OVERFLOW');
      chunks.push(bytes);
      if (part.nextOffset === undefined) {
        if (offset !== total) throw new SmppBusinessError('SMPP_SNAPSHOT_PART_INCOMPLETE');
        const assembled = Buffer.concat(chunks);
        if (createHash('sha256').update(assembled).digest('hex') !== expectedHash)
          throw new SmppBusinessError('SMPP_SNAPSHOT_PART_HASH_MISMATCH');
        try { return JSON.parse(assembled.toString('utf8')) as unknown; }
        catch { throw new SmppBusinessError('SMPP_SNAPSHOT_PART_JSON_INVALID'); }
      }
      if (Number(part.nextOffset) !== offset || bytes.length === 0)
        throw new SmppBusinessError('SMPP_SNAPSHOT_PART_OFFSET_INVALID');
    }
    throw new SmppBusinessError('SMPP_SNAPSHOT_PART_LIMIT');
  }

  #appendObject(store: Map<string, SmppBusinessVersion>, item: SmppBusinessVersion, taskId: string): void {
    this.#validateIdentity(item.value.identity, taskId);
    const id = businessVersionId(item);
    if (!id) throw new SmppBusinessError('SMPP_SNAPSHOT_OBJECT_INVALID');
    const key = JSON.stringify([item.kind, id, item.value.revision]);
    const old = store.get(key);
    if (old && !isDeepStrictEqual(old, item))
      throw new SmppBusinessError('SMPP_SNAPSHOT_OBJECT_CONFLICT');
    store.set(key, item);
  }

  #checkExecution(view: SmppBusinessView, taskId: string, executionId: string): void {
    this.#validateIdentity(view.context.identity, taskId);
    if (view.context.identity.executionId !== executionId)
      throw new SmppBusinessError('SMPP_EXECUTION_BINDING_INVALID');
  }

  #validateIdentity(identity: z.infer<typeof identitySchema>, taskId: string): void {
    if (
      identity.taskId !== taskId ||
      identity.providerId !== this.#providerId ||
      identity.resourceId !== this.#resourceId
    ) throw new SmppBusinessError('SMPP_BUSINESS_IDENTITY_MISMATCH');
  }

  async #requireMethod(key: string, method: FrozenMcpMethod): Promise<void> {
    const methods = this.#methods ?? await this.discover();
    if (methods[key] !== method) throw new SmppBusinessError('SMPP_BUSINESS_METHOD_UNAVAILABLE');
  }

  async #authorize(taskId: string, executionId: string,
    operation: 'input_response' | 'navigation_adjust_plan'): Promise<void> {
    if (
      !this.#mutationAuthority ||
      !(await this.#mutationAuthority.authorize({ taskId, executionId, operation }))
    ) throw new SmppBusinessError('SMPP_BUSINESS_GOVERNANCE_REQUIRED');
  }

  #validateInputSchema(schema: unknown, value: unknown): void {
    try {
      const validator = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
      if (!validator(value)) throw new Error('input-schema-rejected');
    } catch { throw new SmppBusinessError('SMPP_BUSINESS_INPUT_SCHEMA_INVALID'); }
  }
}

export class SmppBusinessError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SmppBusinessError';
  }
}

function sameRef(item: SmppBusinessVersion, ref: SmppBusinessRef): boolean {
  return item.kind === ref.kind && businessVersionId(item) === ref.id &&
    item.value.revision === ref.revision;
}

function businessVersionId(item: SmppBusinessVersion): string | undefined {
  const field = item.kind === 'artifact' ? 'artifactId' :
    item.kind === 'action' ? 'actionId' :
    item.kind === 'input_request' ? 'requestId' : 'interventionId';
  const value = item.value[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalBase64(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new SmppBusinessError('SMPP_BASE64_INVALID');
  return bytes;
}

function verifyContent(content: z.infer<typeof contentSchema>): void {
  const bytes = canonicalBase64(content.bytes);
  if (String(bytes.length) !== content.totalBytes ||
      createHash('sha256').update(bytes).digest('hex') !== content.sha256)
    throw new SmppBusinessError('SMPP_ARTIFACT_CONTENT_INVALID');
}
