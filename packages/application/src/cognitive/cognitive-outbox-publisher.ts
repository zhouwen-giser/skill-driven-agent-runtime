import {
  createCognitiveDomainEvent,
  type CognitiveDomainEvent,
} from '../../../domain/src/index.js';
import type { CognitiveOutboxRepository } from './ports.js';

export class CognitiveOutboxPublisher {
  readonly #repository: CognitiveOutboxRepository;

  constructor(dependencies: Readonly<{ repository: CognitiveOutboxRepository }>) {
    this.#repository = dependencies.repository;
  }

  append(event: CognitiveDomainEvent): Promise<void> {
    return this.#repository.append(createCognitiveDomainEvent(event));
  }
}
