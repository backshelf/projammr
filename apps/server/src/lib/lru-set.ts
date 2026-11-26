/**
 * A bounded set that forgets its least recently touched member once full,
 * for the "log this once, but don't grow forever" shape — a refused CORS
 * origin, say. Backed by a `Map`, whose keys iterate in insertion order, so
 * the first key is always the next one to fall; both `has` and `add` count as
 * a touch, so a value that keeps recurring survives eviction even though it
 * is never re-added.
 */
export class LruSet<T> {
  readonly #order = new Map<T, true>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  has(value: T): boolean {
    if (!this.#order.has(value)) return false;
    this.#touch(value);
    return true;
  }

  add(value: T): void {
    this.#touch(value);
    if (this.#order.size <= this.#capacity) return;
    const oldest = this.#order.keys().next().value as T;
    this.#order.delete(oldest);
  }

  get size(): number {
    return this.#order.size;
  }

  #touch(value: T): void {
    this.#order.delete(value);
    this.#order.set(value, true);
  }
}
