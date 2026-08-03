import type { Response } from 'express';

import type { ConfigurationRevision } from '../../../packages/node-control-domain/src/index.js';

export class RevisionHintBroker {
  readonly #subscribers = new Set<Response>();

  subscribe(response: Response): () => void {
    this.#subscribers.add(response);
    return () => this.#subscribers.delete(response);
  }

  publish(revision: ConfigurationRevision): void {
    const eventId = `${revision.targetType}:${revision.targetId}:${String(revision.revision)}`;
    const data = JSON.stringify({
      eventId,
      targetType: revision.targetType,
      targetId: revision.targetId,
      revision: revision.revision,
      checksum: revision.checksum,
    });
    for (const response of this.#subscribers) {
      response.write(`id: ${eventId}\nevent: revision-hint\ndata: ${data}\n\n`);
    }
  }
}
