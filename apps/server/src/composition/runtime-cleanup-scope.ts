/** Owns only resources opened by one server assembly; not an execution-state authority. */
export class RuntimeCleanupScope {
  readonly #operations: (() => Promise<void>)[] = [];
  readonly #synchronous: (() => void)[] = [];

  register(operation: () => Promise<void>): () => Promise<void> {
    let completion: Promise<void> | undefined;
    const close = (): Promise<void> => {
      completion ??= Promise.resolve().then(operation);
      return completion;
    };
    this.#operations.push(close);
    return close;
  }

  registerSync(operation: () => void): () => void {
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      operation();
    };
    this.#synchronous.push(close);
    return close;
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const close of [...this.#synchronous].reverse()) {
      try {
        close();
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    for (const close of [...this.#operations].reverse()) {
      try {
        await close();
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'RUNTIME_RESOURCE_CLEANUP_FAILED');
  }
}
