/** Composition-only link for callbacks whose owning service is assembled later. */
export class RuntimeValueRef<T> {
  #current: Readonly<{ value: T }> | undefined;
  readonly #name: string;
  constructor(name: string) {
    this.#name = name;
  }
  get value(): T {
    if (this.#current === undefined) throw new Error('RUNTIME_PORT_NOT_BOUND:' + this.#name);
    return this.#current.value;
  }
  set value(value: T) {
    this.#current = { value };
  }
}
