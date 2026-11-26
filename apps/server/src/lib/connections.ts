/**
 * Seconds a connection may go without sending or receiving a byte before
 * `Bun.serve` closes it. A response that stays open until its client leaves,
 * such as an event stream, has to write more often than this.
 */
export const IDLE_TIMEOUT_SECONDS = 10;

const shutdown = new AbortController();

/**
 * Aborts once the process starts shutting down. `server.stop()` waits for
 * every response in flight, so a response that stays open until its client
 * leaves has to end on this signal too, or the stop never finishes.
 */
export const shutdownSignal = shutdown.signal;

/** Ends every response watching `shutdownSignal`. There is no undoing it. */
export function beginShutdown(): void {
  shutdown.abort();
}
