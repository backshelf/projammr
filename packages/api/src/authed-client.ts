import type { ActionError } from "./action-result";
import { serverApiBaseUrl } from "./api-base-url";
import { type ApiClient, createApiClient } from "./api-client";

export type { ApiClient };

/**
 * The client for calls made from the server — RSC and server actions. The
 * incoming request's Cookie header is forwarded, which is how the API sees the
 * signed-in session.
 *
 * The incoming request's Origin is forwarded too. A server-to-server `fetch`
 * sends none of its own, and the API's CSRF check reads a cookie-bearing
 * request with no `Content-Type` (every bodyless mutation) as a possible
 * cross-site form post, which it lets through only from a trusted origin. The
 * browser set the forwarded value on the server action's own request, and
 * Next refuses an action whose Origin does not match its host, so it names the
 * page the user acted from. An RSC render is a GET with no Origin, and sends
 * none on.
 *
 * `getForwardedFor`, when given, supplies the incoming request's
 * `X-Forwarded-For`, which is sent on unchanged. Without it the API sees only
 * this process's own address, and every caller's render draws on one
 * rate-limit bucket. A getter that returns nothing sets no header.
 */
export const createServerApiClient = (
  getCookie: () => Promise<string | null>,
  getOrigin: () => Promise<string | null>,
  getForwardedFor?: () => Promise<string | null>
): ApiClient => {
  const client = createApiClient({
    baseUrl: serverApiBaseUrl,
    auth: { header: "cookie", value: getCookie },
  });

  client.use({
    async onRequest({ request }) {
      const origin = await getOrigin();
      if (origin) request.headers.set("origin", origin);
      const forwardedFor = await getForwardedFor?.();
      if (forwardedFor) request.headers.set("x-forwarded-for", forwardedFor);
      return request;
    },
  });

  return client;
};

/**
 * The client for calls made from the browser. It carries no credentials of its
 * own: a relative `baseUrl` keeps every request same-origin with the page, so
 * the HttpOnly session cookie rides it and the API resolves the session from
 * that. The web app's `proxy.ts` forwards `/api/*` through to the API server.
 */
export const createBrowserApiClient = (): ApiClient =>
  createApiClient({
    baseUrl: "",
    credentials: "include",
  });

/**
 * Posts a file to a multipart endpoint. The typed client cannot describe a
 * `FormData` body, and a server action would cap the body at Next's 1MB limit,
 * so these go to the API's multipart route directly — same-origin, like every
 * other browser call, so the session cookie authenticates them.
 *
 * Sent with `XMLHttpRequest` rather than `fetch` because only it reports
 * upload progress; `onProgress` receives the fraction sent, 0–1.
 */
export function uploadMultipart<T>(
  path: string,
  file: File,
  fields: Record<string, string | number | undefined>,
  onProgress?: (fraction: number) => void
): Promise<T | ActionError> {
  const body = new FormData();
  body.append("file", file);
  for (const [name, value] of Object.entries(fields)) {
    if (value != null) body.append(name, String(value));
  }

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress)
        onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => resolve({ error: "Network error" });
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        resolve(uploadFailure(xhr.status, xhr.responseText));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        resolve({ error: "Unreadable response" });
      }
    };
    xhr.send(body);
  });
}

/**
 * The `ActionError` for a non-2xx upload response. When `responseText` parses
 * as an envelope with a string `error`, that string is the message and its
 * `code`/`details` come along — a `too_big` refusal's issues among them, which
 * the client's `tooBigMaximum` reads — otherwise the message falls back to the
 * raw text or the status.
 */
function uploadFailure(status: number, responseText: string): ActionError {
  const body = safeParseJson(responseText);
  const { error, code, details } =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown; code?: unknown; details?: unknown })
      : {};

  if (typeof error === "string") {
    return {
      error,
      status,
      ...(typeof code === "string" && code !== "" ? { code } : {}),
      ...(typeof details === "object" &&
      details !== null &&
      !Array.isArray(details)
        ? { details: details as Record<string, unknown> }
        : {}),
    };
  }

  return { error: responseText || `HTTP ${status}`, status };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
