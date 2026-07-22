import type {
  BusinessEventsRuntimePort,
  BusinessEventsRuntimeContinuity,
} from '../../application/src/index.js';
import type { BusinessEventEnvelope } from '../../domain/src/index.js';

import { FrozenBusinessEventsClient } from './business-events-client.js';

export class FrozenBusinessEventsRuntimeAdapter implements BusinessEventsRuntimePort {
  readonly #client: FrozenBusinessEventsClient;

  constructor(input: Readonly<{ client?: FrozenBusinessEventsClient }> = {}) {
    this.#client = input.client ?? new FrozenBusinessEventsClient();
  }

  async discover(
    input: Parameters<BusinessEventsRuntimePort['discover']>[0],
  ): ReturnType<BusinessEventsRuntimePort['discover']> {
    const discovery = await this.#client.discover(input);
    return { profileVersion: discovery.profileVersion };
  }

  async run(input: Parameters<BusinessEventsRuntimePort['run']>[0]): Promise<void> {
    const connection = {
      endpoint: input.endpoint,
      headers: input.headers,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    };
    const stream = await this.#client.listen({
      ...connection,
      ...('cursor' in input ? { cursor: input.cursor } : { startPosition: input.startPosition }),
    });
    await input.onAck({
      streamId: stream.ack.streamId,
      generationStatus: stream.ack.generationStatus,
      acceptedAfterSequence: stream.ack.acceptedAfterSequence,
      currentSequence: stream.ack.currentSequence,
    });
    for await (const message of stream.messages) {
      if (message.method === 'notifications/io.sdar/businessEvents/continuity')
        await input.onContinuity(mapContinuity(message.params));
      else await input.onEvent(mapEvent(message.params));
    }
  }

  async resolveRelatedTasks(
    input: Parameters<BusinessEventsRuntimePort['resolveRelatedTasks']>[0],
  ): ReturnType<BusinessEventsRuntimePort['resolveRelatedTasks']> {
    return this.#client.relatedTasks(input).then((page) => ({
      streamId: page.streamId,
      eventId: page.eventId,
      projectionToken: page.projectionToken,
      items: page.items,
      total: page.total,
      ...(page.nextAfterTaskId === undefined ? {} : { nextAfterTaskId: page.nextAfterTaskId }),
    }));
  }
}

function mapEvent(
  input: Readonly<Record<string, unknown>> &
    Readonly<{
      streamId: string;
      eventId: string;
      sequence: string;
      sourceId: string;
      eventType: string;
      occurredAt: string;
      scope: 'task' | 'resource';
      description: string;
    }>,
): BusinessEventEnvelope {
  const severityHint = severity(input['severityHint']);
  const common = {
    streamId: input.streamId,
    eventId: input.eventId,
    sequence: input.sequence,
    sourceId: input.sourceId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    description: input.description,
    ...(typeof input['reasonCode'] === 'string' ? { reasonCode: input['reasonCode'] } : {}),
    ...(severityHint === undefined ? {} : { severityHint }),
    ...(input['rawPayload'] === undefined ? {} : { rawPayload: input['rawPayload'] }),
  };
  if (input.scope === 'task') return { ...common, scope: 'task', taskId: String(input['taskId']) };
  return {
    ...common,
    scope: 'resource',
    resourceRef: String(input['resourceRef']),
    relatedTaskIds: Array.isArray(input['relatedTaskIds'])
      ? input['relatedTaskIds'].map(String)
      : [],
    relatedTaskCount: Number(input['relatedTaskCount']),
    relationTruncated: input['relationTruncated'] === true,
  };
}

function mapContinuity(
  input: Readonly<{
    previousStreamId: string;
    newStreamId: string;
    reasonCode: BusinessEventsRuntimeContinuity['reasonCode'];
    affectedSourceIds: readonly string[];
    gapDetectedAt: string;
    lastReplayableSequence: string;
    lastContinuousSequence?: string | undefined;
  }>,
): BusinessEventsRuntimeContinuity {
  return {
    previousStreamId: input.previousStreamId,
    newStreamId: input.newStreamId,
    reasonCode: input.reasonCode,
    affectedSourceIds: input.affectedSourceIds,
    gapDetectedAt: input.gapDetectedAt,
    lastReplayableSequence: input.lastReplayableSequence,
    ...(input.lastContinuousSequence === undefined
      ? {}
      : { lastContinuousSequence: input.lastContinuousSequence }),
  };
}

function severity(value: unknown): 'info' | 'warning' | 'critical' | undefined {
  return value === 'info' || value === 'warning' || value === 'critical' ? value : undefined;
}
