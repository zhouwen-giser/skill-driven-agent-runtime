import type { ArtifactRegistryService } from './artifact-registry.js';

export interface ArtifactOutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface ArtifactOutboxCursor {
  readonly lastEventId?: string;
  readonly version: number;
}

export interface ArtifactOutboxConsumerRepository {
  loadCursor(consumerName: string): Promise<ArtifactOutboxCursor>;
  readAfter(
    lastEventId: string | undefined,
    limit: number,
  ): Promise<readonly ArtifactOutboxEvent[]>;
  advanceCursor(
    consumerName: string,
    expectedVersion: number,
    eventId: string,
    updatedAt: string,
  ): Promise<void>;
}

export interface ArtifactOutboxEventHandler {
  apply(event: ArtifactOutboxEvent): Promise<void>;
}

export class ArtifactOutboxConsumer {
  readonly #consumerName: string;
  readonly #repository: ArtifactOutboxConsumerRepository;
  readonly #handler: ArtifactOutboxEventHandler;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      consumerName: string;
      repository: ArtifactOutboxConsumerRepository;
      handler: ArtifactOutboxEventHandler;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    if (dependencies.consumerName.trim().length === 0) {
      throw new Error('ARTIFACT_OUTBOX_CONSUMER_NAME_INVALID');
    }
    this.#consumerName = dependencies.consumerName;
    this.#repository = dependencies.repository;
    this.#handler = dependencies.handler;
    this.#clock = dependencies.clock;
  }

  async consume(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('ARTIFACT_OUTBOX_LIMIT_INVALID');
    }
    let cursor = await this.#repository.loadCursor(this.#consumerName);
    const events = await this.#repository.readAfter(cursor.lastEventId, limit);
    for (const event of events) {
      await this.#handler.apply(event);
      await this.#repository.advanceCursor(
        this.#consumerName,
        cursor.version,
        event.eventId,
        this.#clock.now(),
      );
      cursor = { lastEventId: event.eventId, version: cursor.version + 1 };
    }
    return events.length;
  }
}

export class ArtifactRegistryProjectionEventHandler implements ArtifactOutboxEventHandler {
  readonly #registry: Pick<ArtifactRegistryService, 'invalidateDependency' | 'rebuildProjection'>;
  readonly #processed = new Set<string>();

  constructor(
    registry: Pick<ArtifactRegistryService, 'invalidateDependency' | 'rebuildProjection'>,
  ) {
    this.#registry = registry;
  }

  async apply(event: ArtifactOutboxEvent): Promise<void> {
    if (this.#processed.has(event.eventId)) return;
    const dependencyRef = event.payload['dependencyRef'];
    if (typeof dependencyRef === 'string') {
      await this.#registry.invalidateDependency(dependencyRef);
    } else if (
      event.eventType === 'artifact.activated' ||
      event.eventType === 'artifact.deprecated'
    ) {
      await this.#registry.rebuildProjection();
    }
    this.#processed.add(event.eventId);
  }
}
