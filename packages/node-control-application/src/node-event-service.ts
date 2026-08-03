import type { NodeEventEnvelope } from '../../node-control-domain/src/index.js';

export interface NodeEventPage {
  readonly items: readonly NodeEventEnvelope[];
  readonly lastEventId?: string;
}

export interface NodeControlEventRepository {
  listAfter(lastEventId: string | undefined, limit: number): Promise<NodeEventPage>;
}

export class NodeControlEventService {
  readonly #repository: NodeControlEventRepository;

  constructor(repository: NodeControlEventRepository) {
    this.#repository = repository;
  }

  listAfter(lastEventId: string | undefined, limit = 100): Promise<NodeEventPage> {
    const cursor = lastEventId?.trim();
    if (cursor !== undefined && (cursor === '' || cursor.length > 512))
      throw Object.assign(new Error('Node Event cursor is invalid.'), {
        code: 'NODE_EVENT_CURSOR_INVALID',
        status: 400,
      });
    return this.#repository.listAfter(cursor, bounded(limit));
  }
}

function bounded(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 200 ? value : 100;
}
