import {
  createTaskWaitPolicy,
  type AgentTask,
  type TaskWaitPolicy,
} from '../../domain/src/index.js';

import type { Clock, TaskWaitPolicyRepository } from './ports.js';

export class TaskWaitTimeoutService {
  readonly #repository: TaskWaitPolicyRepository;
  readonly #clock: Clock;

  constructor(dependencies: Readonly<{ repository: TaskWaitPolicyRepository; clock: Clock }>) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  getPolicy(): Promise<TaskWaitPolicy> {
    return this.#repository.get();
  }

  async updatePolicy(timeoutSeconds: number): Promise<TaskWaitPolicy> {
    const policy = createTaskWaitPolicy(timeoutSeconds, this.#clock.now());
    await this.#repository.update(policy);
    return policy;
  }

  async sweep(): Promise<readonly AgentTask[]> {
    const policy = await this.#repository.get();
    const timestamp = this.#clock.now();
    const cutoff = new Date(
      new Date(timestamp).getTime() - policy.timeoutSeconds * 1000,
    ).toISOString();
    return this.#repository.expireWaiting(cutoff, timestamp);
  }
}
