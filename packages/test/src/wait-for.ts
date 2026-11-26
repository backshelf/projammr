/**
 * Retries `callback` until it stops throwing (and its promise, if any, resolves),
 * then returns its result. Throws the last error once `timeout` ms have passed.
 */
export async function waitFor<T>(
  callback: () => T | Promise<T>,
  {
    timeout = 1000,
    interval = 50,
  }: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      return await callback();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}
