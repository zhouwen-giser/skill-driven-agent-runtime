import type {
  AgentTask,
  ImplicitFeedbackKind,
  ImplicitFeedbackRecord,
} from '../../domain/src/index.js';
import type { Clock, ImplicitFeedbackRepository } from './ports.js';

const LOW_CONFIDENCE = 0.35;

export class ImplicitFeedbackService {
  readonly #repository: ImplicitFeedbackRepository;
  readonly #clock: Clock;
  readonly #nextId: () => string;
  constructor(
    dependencies: Readonly<{
      repository: ImplicitFeedbackRepository;
      clock: Clock;
      nextId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async observeSubmission(task: AgentTask): Promise<ImplicitFeedbackRecord | undefined> {
    const previous = await this.#repository.findPreviousTerminal(task.contextId, task.taskId);
    if (previous === undefined) return undefined;
    const repeated = normalize(previous.requestText) === normalize(task.requestText);
    return this.#record(
      repeated ? 'repeated_submission' : 'accepted_result',
      previous.taskId,
      task.taskId,
      task.contextId,
      repeated
        ? 'A new Task repeated the previous request in the same context.'
        : 'A new request followed a terminal Task without requesting modification or redo.',
    );
  }

  observeRevision(task: AgentTask, message: string): Promise<ImplicitFeedbackRecord> {
    const redo = /\b(redo|retry|start over|again)\b|\u91cd\u505a|\u91cd\u65b0/u.test(
      message.toLowerCase(),
    );
    return this.#record(
      redo ? 'requested_redo' : 'continued_modification',
      task.taskId,
      task.taskId,
      task.contextId,
      redo
        ? 'The revision text requested a redo.'
        : 'The user continued modifying the current Task.',
    );
  }

  observeSkillSwitch(
    task: AgentTask,
    previousSkillId: string,
    replacementSkillId: string,
  ): Promise<ImplicitFeedbackRecord> {
    return this.#record(
      'switched_skill',
      task.taskId,
      task.taskId,
      task.contextId,
      `The Task switched Skill from ${previousSkillId} to ${replacementSkillId}.`,
    );
  }

  listByTask(taskId: string) {
    return this.#repository.listByTask(taskId);
  }

  #record(
    kind: ImplicitFeedbackKind,
    sourceTaskId: string,
    triggerTaskId: string,
    contextId: string,
    evidenceSummary: string,
  ): Promise<ImplicitFeedbackRecord> {
    const record: ImplicitFeedbackRecord = {
      feedbackId: this.#nextId(),
      kind,
      sourceTaskId,
      triggerTaskId,
      contextId,
      confidence: LOW_CONFIDENCE,
      evidenceSummary,
      createdAt: this.#clock.now(),
    };
    return this.#repository.save(record).then(() => record);
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}
