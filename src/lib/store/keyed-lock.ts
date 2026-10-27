// Serialises tasks that share a key inside ONE process. Used by every case store so that a
// read-modify-write on a case (the agent finishing while the merchant clicks Approve) cannot
// interleave with another one on the same case.
//
// Scope, stated once: this is an in-process lock. On a deployment with several serverless
// instances two instances do not see each other's queue. The file store has the same limit
// (one disk per instance); the object store narrows it with a conditional write when the
// backend supports one (see object-case-store.ts).

export type KeyedLock = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function createKeyedLock(): KeyedLock {
  const queues = new Map<string, Promise<unknown>>();
  return function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  };
}
