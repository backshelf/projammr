/**
 * The API's own loopback origin, known once the process is listening.
 * `requireMcpAuth` fetches the provider's JWKS over HTTP; the public
 * `BETTER_AUTH_URL` is not reachable from inside the container (the proxy's
 * certificate is signed by a CA the API does not trust), so the keys are
 * fetched from this process directly.
 */
let origin: string | undefined;

/** Records the port `Bun.serve` bound, so `selfUrl` can address it. */
export function setListeningPort(port: number): void {
  origin = `http://127.0.0.1:${port}`;
}

/** An absolute URL on this process's own listener; throws before it listens. */
export function selfUrl(path: string): string {
  if (!origin) {
    throw new Error(`selfUrl(${path}) called before the server is listening`);
  }
  return new URL(path, origin).href;
}
