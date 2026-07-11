export class ContextSerialExecutor {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(contextId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(contextId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(contextId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(contextId) === tail) this.#tails.delete(contextId);
    }
  }
}
