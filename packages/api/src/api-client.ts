import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./v1";

/**
 * A plain fetch call. Narrower than `typeof fetch`, which under Bun's types also
 * carries `fetch.preconnect` — a wrapper has no reason to provide it.
 */
export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before the first retry (default: 100) */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffFactor?: number;
  /** Maximum delay in ms between retries (default: 3000) */
  maxDelayMs?: number;
  /** HTTP status codes that trigger a retry (default: [502, 503, 504, 408]) */
  retryOnStatus?: number[];
  /** Custom underlying fetch implementation (default: globalThis.fetch) */
  fetch?: FetchFn;
  /** Optional callback fired before a retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** The fields Node and undici hang off an `Error` to describe a socket failure. */
type NodeError = { code?: string; errno?: number; cause?: unknown };

const isNodeError = (value: unknown): value is NodeError =>
  typeof value === "object" &&
  value !== null &&
  ("code" in value || "errno" in value || "cause" in value);

const asNodeError = (value: unknown): NodeError | null =>
  isNodeError(value) ? value : null;

const TRANSIENT_CODES = new Set<string>([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_REQ_TIMEOUT",
  "UND_ERR_RESPONSE_STATUS_CODE",
  "EPIPE",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** libuv's negated errno for EPIPE, ECONNRESET, ETIMEDOUT and ECONNREFUSED. */
const TRANSIENT_ERRNOS = new Set<number>([-32, -54, -60, -61]);

/**
 * Socket dropouts that arrive with no code at all — a stale keep-alive
 * connection surfaces as a bare `TypeError: fetch failed` whose cause carries
 * the detail in prose.
 */
const TRANSIENT_MESSAGES = [
  "fetch failed",
  "other side closed",
  "write epipe",
  "epipe",
  "socket error",
  "socket hang up",
  "socket closed",
  "premature close",
  "connection reset",
  "connection closed",
  "connection terminated",
  "network error",
  "undici",
];

export function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;

  const node = asNodeError(error);
  const cause = asNodeError(node?.cause);
  const code = node?.code ?? cause?.code;

  if (code && TRANSIENT_CODES.has(code)) return true;
  if (typeof node?.errno === "number" && TRANSIENT_ERRNOS.has(node.errno)) {
    return true;
  }

  const causeMessage =
    node?.cause instanceof Error
      ? node.cause.message
      : String(node?.cause ?? "");
  const message =
    `${error.message} ${causeMessage} ${error.name}`.toLowerCase();

  return TRANSIENT_MESSAGES.some((fragment) => message.includes(fragment));
}

/**
 * A connection the pool handed over already dead. Retrying costs nothing, so
 * these skip the backoff on the first attempt.
 */
function isStaleSocket(error: unknown): boolean {
  const node = asNodeError(error);
  const cause = asNodeError(node?.cause);
  const codes = [node?.code, cause?.code];

  return (
    codes.includes("UND_ERR_SOCKET") ||
    codes.includes("EPIPE") ||
    node?.errno === -32
  );
}

/**
 * HTTP methods that are safe to auto-retry on transient gateway or socket
 * failures. Non-idempotent methods (`POST`, `PATCH`) are never retried
 * automatically so a dropped response never duplicates a mutation.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ||
    new DOMException("The operation was aborted.", "AbortError")
  );
}

/** Waits `delayMs`, rejecting immediately if `signal` aborts during the sleep. */
function sleepWithSignal(
  delayMs: number,
  signal?: AbortSignal | null
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Creates a fetch function that wraps `fetch` with automatic retry logic for
 * transient socket closures (e.g. stale keep-alive sockets, EPIPE, UND_ERR_SOCKET)
 * and gateway timeouts on idempotent HTTP methods.
 */
export function createFetchWithRetry(options: RetryOptions = {}): FetchFn {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    backoffFactor = 2,
    maxDelayMs = 3000,
    retryOnStatus = [502, 503, 504, 408],
    fetch: customFetch = globalThis.fetch,
    onRetry,
  } = options;

  return async function fetchWithRetry(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let bufferedBody: ArrayBuffer | undefined;
    let requestUrl: string;
    let requestMethod: string;
    let requestSignal: AbortSignal | null | undefined;

    if (input instanceof Request) {
      requestUrl = input.url;
      requestMethod = (init?.method || input.method).toUpperCase();
      requestSignal = init?.signal ?? input.signal;
    } else {
      requestUrl = typeof input === "string" ? input : input.toString();
      requestMethod = (init?.method || "GET").toUpperCase();
      requestSignal = init?.signal;
    }

    const canRetry = IDEMPOTENT_METHODS.has(requestMethod);
    const allowedRetries = canRetry ? maxRetries : 0;

    if (canRetry && input instanceof Request && input.body && !input.bodyUsed) {
      try {
        bufferedBody = await input.clone().arrayBuffer();
      } catch {
        // If clone fails (e.g. stream already locked), proceed with input as-is
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= allowedRetries; attempt++) {
      if (requestSignal?.aborted) {
        throw abortReason(requestSignal);
      }

      try {
        let reqToFetch: RequestInfo | URL;
        let initToFetch: RequestInit | undefined;

        if (input instanceof Request) {
          if (bufferedBody !== undefined) {
            reqToFetch = new Request(input.url, {
              method: input.method,
              headers: input.headers,
              body: bufferedBody,
              credentials: input.credentials,
              cache: input.cache,
              redirect: input.redirect,
              referrer: input.referrer,
              integrity: input.integrity,
              keepalive: input.keepalive,
              signal: input.signal,
            });
          } else {
            // For requests without body or where cloning succeeded via fresh clone
            reqToFetch = attempt === 0 ? input : input.clone();
          }
          initToFetch = init;
        } else {
          reqToFetch = input;
          initToFetch = init;
        }

        const response = await customFetch(reqToFetch, initToFetch);

        if (
          !response.ok &&
          retryOnStatus.includes(response.status) &&
          attempt < allowedRetries
        ) {
          const delay = Math.min(
            initialDelayMs * Math.pow(backoffFactor, attempt),
            maxDelayMs
          );
          if (onRetry) {
            onRetry(new Error(`HTTP ${response.status}`), attempt + 1, delay);
          } else {
            console.warn(
              `[fetch-retry] ${requestMethod} ${requestUrl} returned ${response.status}. Retrying (${attempt + 1}/${allowedRetries}) in ${delay}ms...`
            );
          }
          await sleepWithSignal(delay, requestSignal);
          continue;
        }

        return response;
      } catch (err) {
        lastError = err;

        if (requestSignal?.aborted) {
          throw err;
        }

        if (isTransientNetworkError(err) && attempt < allowedRetries) {
          const delay =
            isStaleSocket(err) && attempt === 0
              ? 50
              : Math.min(
                  initialDelayMs * Math.pow(backoffFactor, attempt),
                  maxDelayMs
                );

          const errMsg = err instanceof Error ? err.message : String(err);
          if (onRetry) {
            onRetry(err, attempt + 1, delay);
          } else {
            console.warn(
              `[fetch-retry] ${requestMethod} ${requestUrl} failed with transient error (${errMsg}). Retrying (${attempt + 1}/${allowedRetries}) in ${delay}ms...`
            );
          }

          await sleepWithSignal(delay, requestSignal);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  };
}

export const defaultFetch = createFetchWithRetry();

export type ApiClient = ReturnType<typeof createClient<paths>>;

/**
 * Credentials attached to every request through the client, so no call site
 * builds an auth header itself. `value` resolves per request rather than once
 * at construction: a cookie belongs to the request being served, and a
 * browser token can be fetched lazily on first use.
 */
export type ApiAuth = {
  header: "cookie" | "authorization";
  value: () => Promise<string | null>;
};

export type ApiClientOptions = {
  baseUrl: string | undefined;
  auth?: ApiAuth;
  /** Headers sent on every request, for credentials known up front. */
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** Overrides the shared retry policy for this client's requests. */
  retry?: RetryOptions;
};

const authMiddleware = ({ header, value }: ApiAuth): Middleware => ({
  async onRequest({ request }) {
    const resolved = await value();
    if (resolved) request.headers.set(header, resolved);
    return request;
  },
});

export function createApiClient(options: ApiClientOptions): ApiClient;
export function createApiClient(
  baseUrl: string | undefined,
  headers?: Record<string, string>
): ApiClient;
export function createApiClient(
  optionsOrBaseUrl: ApiClientOptions | string | undefined,
  positionalHeaders?: Record<string, string>
): ApiClient {
  const options: ApiClientOptions =
    typeof optionsOrBaseUrl === "object"
      ? optionsOrBaseUrl
      : { baseUrl: optionsOrBaseUrl, headers: positionalHeaders };

  const { baseUrl, auth, headers, credentials, retry } = options;

  const client = createClient<paths>({
    baseUrl,
    headers,
    credentials,
    fetch: retry ? createFetchWithRetry(retry) : defaultFetch,
  });

  if (auth) client.use(authMiddleware(auth));

  return client;
}
