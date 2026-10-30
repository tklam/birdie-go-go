/**
 * Runs async tasks one at a time, in the order they were queued (pure, no
 * DOM). A failed task doesn't stop the ones after it.
 */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
