/** Minimal observable value shared between the content script and the sidebar (useSyncExternalStore). */
export interface ValueStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
  set(value: T): void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}
