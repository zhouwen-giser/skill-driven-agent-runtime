import { hashCanonicalEvidenceJson } from '../../domain/src/evidence/canonical-evidence.js';
import {
  assertTaskBusinessIdentity,
  normalizeTaskBusinessView,
  projectTaskBusiness,
  taskBusinessContentDigest,
  taskBusinessObjectRef,
  taskBusinessRefKey,
  TASK_BUSINESS_LIMITS,
  TaskBusinessError,
  type TaskBusinessProjection,
  type TaskBusinessContent,
  type TaskBusinessIdentity,
} from '../../domain/src/task-business.js';
import type { BusinessEventInboxRecord, RemoteTaskBinding } from '../../domain/src/index.js';
import type { Clock } from './ports.js';
import type { FrozenTaskBusinessBindingInput } from './mcp-registry.js';
import type { TaskBusinessEvidencePolicy } from '../../domain/src/task-business-evidence.js';

export interface TaskBusinessTarget {
  readonly binding: RemoteTaskBinding;
  readonly providerId: string;
  readonly resourceId: string;
  readonly executionId?: string;
  readonly sourceTimeQualified?: boolean;
  readonly evidencePolicy?: TaskBusinessEvidencePolicy;
}
export interface TaskBusinessRepository {
  loadTarget(bindingId: string): Promise<TaskBusinessTarget | undefined>;
  find(bindingId: string): Promise<TaskBusinessProjection | undefined>;
  listByTask(taskId: string): Promise<readonly TaskBusinessProjection[]>;
  listRefreshable(limit: number, afterBindingId?: string): Promise<readonly string[]>;
  commit(input: TaskBusinessCommit): Promise<'applied' | 'stale'>;
  commitMany(
    inputs: readonly TaskBusinessCommit[],
    event: BusinessEventInboxRecord,
  ): Promise<'applied' | 'stale'>;
  markRefreshFailed(bindingId: string, errorCode: string, observedAt: string): Promise<void>;
  readContent(bindingId: string, digest: string): Promise<Uint8Array | undefined>;
}
export interface TaskBusinessCommit {
  readonly bindingId: string;
  readonly expectedBindingVersion: number;
  readonly observedBinding: RemoteTaskBinding;
  readonly expectedProjectionRevision: number;
  readonly projection: TaskBusinessProjection;
  readonly contents: readonly TaskBusinessContent[];
  readonly event?: BusinessEventInboxRecord;
}
export interface TaskBusinessReader {
  readRemoteTaskBusinessContext(input: FrozenTaskBusinessBindingInput): Promise<unknown>;
  readRemoteTaskBusinessArtifact(
    input: FrozenTaskBusinessBindingInput & Readonly<{ artifactId: string; revision: number }>,
  ): Promise<unknown>;
  readRemoteTaskBusinessArtifactContent(
    input: FrozenTaskBusinessBindingInput & Readonly<{ artifactId: string; revision: number }>,
  ): Promise<Uint8Array>;
}

/** Hydration is read-only and always starts from an already admitted native binding. */
export class TaskBusinessSyncService {
  readonly #repository: TaskBusinessRepository;
  readonly #reader: TaskBusinessReader;
  readonly #clock: Clock;
  readonly #running = new Map<string, Promise<'applied' | 'stale' | 'unsupported'>>();
  readonly #maxConcurrent: number;
  #stopped = false;
  readonly #controller = new AbortController();
  readonly #preparations = new Set<Promise<TaskBusinessCommit | 'unsupported'>>();

  constructor(
    input: Readonly<{
      repository: TaskBusinessRepository;
      reader: TaskBusinessReader;
      clock: Clock;
      maxConcurrent?: number;
    }>,
  ) {
    this.#repository = input.repository;
    this.#reader = input.reader;
    this.#clock = input.clock;
    this.#maxConcurrent = input.maxConcurrent ?? 4;
    if (
      !Number.isInteger(this.#maxConcurrent) ||
      this.#maxConcurrent < 1 ||
      this.#maxConcurrent > 16
    )
      throw new TaskBusinessError('TASK_BUSINESS_CONCURRENCY_INVALID');
  }
  async refresh(
    bindingId: string,
    event?: BusinessEventInboxRecord,
  ): Promise<'applied' | 'stale' | 'unsupported'> {
    if (this.#stopped) throw new TaskBusinessError('TASK_BUSINESS_SYNC_STOPPED');
    // Events retain separate durable checkpoints even when their network reads can be coalesced.
    const running = this.#running.get(bindingId);
    if (running !== undefined) {
      await running;
      if (event === undefined) return 'stale';
      return this.refresh(bindingId, event);
    }
    if (this.#running.size >= this.#maxConcurrent)
      throw new TaskBusinessError('TASK_BUSINESS_BACKPRESSURE');
    const promise = this.#refresh(bindingId, event);
    this.#running.set(bindingId, promise);
    try {
      return await promise;
    } catch (error: unknown) {
      await this.#repository.markRefreshFailed(
        bindingId,
        error instanceof Error && 'code' in error
          ? String(error.code)
          : 'TASK_BUSINESS_READ_FAILED',
        this.#clock.now(),
      );
      throw error;
    } finally {
      if (this.#running.get(bindingId) === promise) this.#running.delete(bindingId);
    }
  }
  async reconcile(
    limit = 32,
    afterBindingId?: string,
  ): Promise<
    Readonly<{
      examined: number;
      applied: number;
      failures: readonly Readonly<{ bindingId: string; errorCode: string }>[];
      lastBindingId?: string;
    }>
  > {
    const bindings = await this.#repository.listRefreshable(limit, afterBindingId);
    let applied = 0;
    const failures: { bindingId: string; errorCode: string }[] = [];
    for (const bindingId of bindings) {
      if (this.#stopped) break;
      try {
        if ((await this.refresh(bindingId)) === 'applied') applied += 1;
      } catch (error: unknown) {
        // refresh has persisted failure evidence; one unavailable Provider must not starve the rest.
        failures.push({
          bindingId,
          errorCode:
            error instanceof Error && 'code' in error
              ? String(error.code)
              : 'TASK_BUSINESS_READ_FAILED',
        });
      }
    }
    const lastBindingId = bindings.at(-1);
    return {
      examined: bindings.length,
      applied,
      failures,
      ...(lastBindingId === undefined ? {} : { lastBindingId }),
    };
  }
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#controller.abort();
    await Promise.allSettled([...this.#running.values()]);
    await Promise.allSettled([...this.#preparations]);
  }

  async #refresh(
    bindingId: string,
    event: BusinessEventInboxRecord | undefined,
  ): Promise<'applied' | 'stale' | 'unsupported'> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prepared = await this.prepare(bindingId, event);
      if (prepared === 'unsupported') return prepared;
      if ((await this.#repository.commit(prepared)) === 'applied') return 'applied';
    }
    return 'stale';
  }
  async prepare(
    bindingId: string,
    event?: BusinessEventInboxRecord,
    signal?: AbortSignal,
  ): Promise<TaskBusinessCommit | 'unsupported'> {
    if (this.#stopped) throw new TaskBusinessError('TASK_BUSINESS_SYNC_STOPPED');
    if (this.#preparations.size >= this.#maxConcurrent)
      throw new TaskBusinessError('TASK_BUSINESS_BACKPRESSURE');
    const promise = this.#prepare(bindingId, event, signal);
    this.#preparations.add(promise);
    try {
      return await promise;
    } finally {
      this.#preparations.delete(promise);
    }
  }
  async #prepare(
    bindingId: string,
    event: BusinessEventInboxRecord | undefined,
    signal: AbortSignal | undefined,
  ): Promise<TaskBusinessCommit | 'unsupported'> {
    const target = await this.#repository.loadTarget(bindingId);
    if (target === undefined) return 'unsupported';
    const { binding } = target;
    const previous = await this.#repository.find(bindingId);
    const read: FrozenTaskBusinessBindingInput = {
      signal: AbortSignal.any([this.#controller.signal, signal ?? AbortSignal.timeout(30_000)]),
      serverId: binding.serverId,
      operationName: binding.operationName,
      remoteTaskId: binding.remoteTaskId,
      resourceId: target.resourceId,
      executionContext: binding.executionContext,
      ...(binding.authoritySnapshot === undefined
        ? {}
        : { authoritySnapshot: binding.authoritySnapshot }),
      credentialRevision: binding.credentialRevision,
      protocolContract: binding.protocolContract,
    };
    let raw: unknown;
    try {
      raw = await this.#reader.readRemoteTaskBusinessContext(read);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'SMPP_BUSINESS_EXTENSION_UNAVAILABLE'
      )
        return 'unsupported';
      throw error;
    }
    const receivedAt = this.#clock.now();
    const expected = {
      taskId: binding.remoteTaskId,
      providerId: target.providerId,
      resourceId: target.resourceId,
      operationName: binding.operationName,
      ...(target.executionId === undefined ? {} : { executionId: target.executionId }),
    };
    const view = normalizeTaskBusinessView(raw, expected);
    if (previous !== undefined) {
      assertTaskBusinessIdentity(view.context.identity, previous.identity);
      if (view.context.contextRevision < previous.contextRevision)
        throw new TaskBusinessError('TASK_BUSINESS_CONTEXT_REGRESSED');
      if (
        view.context.contextRevision === previous.contextRevision &&
        hashCanonicalEvidenceJson(view.context) !== previous.contextDigest
      )
        throw new TaskBusinessError('TASK_BUSINESS_CONTEXT_CONFLICT');
    }
    const contents = new Map<string, TaskBusinessContent>();
    let totalBytes = 0;
    const append = (
      ref: TaskBusinessContent['ref'],
      identity: TaskBusinessIdentity,
      bytes: Uint8Array,
      metadata: Readonly<Record<string, unknown>>,
    ) => {
      assertTaskBusinessIdentity(identity, view.context.identity);
      totalBytes += bytes.byteLength;
      if (
        bytes.byteLength > TASK_BUSINESS_LIMITS.artifactBytes ||
        totalBytes > TASK_BUSINESS_LIMITS.refreshBytes
      )
        throw new TaskBusinessError('TASK_BUSINESS_CONTENT_LIMIT');
      const digest = taskBusinessContentDigest(bytes);
      const key = taskBusinessRefKey(ref);
      if (contents.has(key) && contents.get(key)?.digest !== digest)
        throw new TaskBusinessError('TASK_BUSINESS_OBJECT_CONFLICT');
      contents.set(key, { ref, identity, bytes, digest, metadata });
    };
    for (const object of view.objects) {
      const ref = taskBusinessObjectRef(object);
      if (ref.kind !== 'artifact')
        append(ref, object.value.identity, Buffer.from(JSON.stringify(object.value)), object.value);
    }
    const refs = new Map(
      [
        ...view.context.artifactRefs,
        ...Object.values(view.context.activeRefs).filter((ref) => ref.kind === 'artifact'),
      ].map((ref) => [taskBusinessRefKey(ref), ref]),
    );
    for (const ref of refs.values()) {
      const response = await this.#reader.readRemoteTaskBusinessArtifact({
        ...read,
        expectedExecutionId: view.context.identity.executionId,
        artifactId: ref.id,
        revision: ref.revision,
      });
      const artifact = readArtifact(response, view.context.identity, ref.id, ref.revision);
      // Unavailable content remains an unresolved scoped reference in the projection.
      // Other available artifacts can still be restored and verified independently.
      if (
        ['empty', 'not_produced_yet', 'unavailable', 'not_supported'].includes(
          String(artifact.metadata['availability']),
        )
      )
        continue;
      const bytes = await this.#reader.readRemoteTaskBusinessArtifactContent({
        ...read,
        expectedExecutionId: view.context.identity.executionId,
        artifactId: ref.id,
        revision: ref.revision,
      });
      append(ref, artifact.identity, bytes, artifact.metadata);
    }
    const projection = projectTaskBusiness({
      bindingId,
      taskId: binding.agentTaskId,
      view,
      contents: [...contents.values()],
      receivedAt,
      projectedAt: this.#clock.now(),
      ...(previous === undefined ? {} : { previous }),
      historyContinuous:
        previous?.quality.historyContinuous === true &&
        previous.snapshotWatermark.streamId === view.resumeFrom.streamId,
      sourceTimeQualified: target.sourceTimeQualified === true,
      bindingOutcome: binding,
      ...(target.evidencePolicy === undefined ? {} : { evidencePolicy: target.evidencePolicy }),
      ...(event === undefined
        ? {}
        : {
            appliedEvent: {
              inboxId: event.inboxId,
              eventId: event.eventId,
              streamId: readEventStream(event),
              sequence: event.sequence,
            },
          }),
    });
    return {
      bindingId,
      expectedBindingVersion: binding.version,
      observedBinding: binding,
      expectedProjectionRevision: previous?.projectionRevision ?? 0,
      projection,
      contents: [...contents.values()],
      ...(event === undefined ? {} : { event }),
    };
  }
}

function readArtifact(
  raw: unknown,
  expected: TaskBusinessIdentity,
  id: string,
  revision: number,
): Readonly<{ identity: TaskBusinessIdentity; metadata: Readonly<Record<string, unknown>> }> {
  if (!isRecord(raw) || !isRecord(raw['artifact']))
    throw new TaskBusinessError('TASK_BUSINESS_ARTIFACT_INVALID');
  const artifact = raw['artifact'];
  if (
    artifact['artifactId'] !== id ||
    artifact['revision'] !== revision ||
    !isRecord(artifact['identity'])
  )
    throw new TaskBusinessError('TASK_BUSINESS_ARTIFACT_INVALID');
  const identity = artifact['identity'] as unknown as TaskBusinessIdentity;
  assertTaskBusinessIdentity(identity, expected);
  return { identity, metadata: artifact };
}
function readEventStream(event: BusinessEventInboxRecord): string {
  if (!isRecord(event.envelope) || typeof event.envelope['streamId'] !== 'string')
    throw new TaskBusinessError('TASK_BUSINESS_EVENT_INVALID');
  return event.envelope['streamId'];
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
