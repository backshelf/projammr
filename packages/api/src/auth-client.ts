import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import {
  anonymousClient,
  deviceAuthorizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { FALLBACK_API_URL } from "./api-base-url";

/** A better-auth browser client, whichever server it points at. The shared
 *  auth forms take one so a desktop app can hand them a client built for the
 *  server the user is signing into. */
export type AuthClient = ReturnType<typeof createAuthClient>;

const viteUrl = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env?.VITE_API_URL;

/**
 * In a browser page (the Next.js client) the auth endpoints are same-origin:
 * the web app forwards `/api/auth/*` to the API server, so the session
 * cookie is first-party and `SameSite=Lax` works. Leaving `baseURL` undefined
 * makes better-auth use `window.location.origin`.
 *
 * Outside a browser — the Electron main process, or SSR without a request
 * origin — fall back to an explicit URL from the environment. (A desktop renderer
 * builds its own client per server via `createAuthClientFor`.)
 */
const baseURL =
  typeof window !== "undefined"
    ? undefined
    : typeof process !== "undefined" && process.env.API_URL
      ? process.env.API_URL
      : viteUrl === undefined
        ? FALLBACK_API_URL
        : viteUrl;

const createSharedClient = () =>
  createAuthClient({
    baseURL: baseURL || undefined,
    // `oauthProviderClient()` adds a fetch hook that signs the current page's
    // query string onto every mutating auth request as `oauth_query`, which is
    // what lets `/sign-in` and `/consent` resume an MCP client's authorization
    // request after the user signs in or answers the consent prompt.
    // `deviceAuthorizationClient()` is the `/device` page's way to look up,
    // approve and deny the code a `dit login` shows.
    plugins: [
      anonymousClient(),
      oauthProviderClient(),
      deviceAuthorizationClient(),
    ],
  });

let sharedClient: ReturnType<typeof createSharedClient> | null = null;

/**
 * The client a browser page shares, built on first use rather than on import.
 * `createAuthClient` resolves its base URL immediately, and with none passed
 * that means `window.location.origin` — which better-auth rejects unless it is
 * http(s). A packaged desktop renderer can be a `file://` page, so building
 * this eagerly threw there in any chunk that merely *imported* the shared
 * login form, which names this client as the default for its injectable
 * `authClient` prop. Deferring the call keeps that import free, while a real
 * use of the wrong client still fails loudly instead of silently pointing
 * somewhere else.
 */
export const authClient: ReturnType<typeof createSharedClient> = new Proxy(
  {} as ReturnType<typeof createSharedClient>,
  {
    get: (_target, property) =>
      Reflect.get((sharedClient ??= createSharedClient()), property),
  }
);

export const createAuthClientFor = (
  baseURL: string,
  options: Omit<Parameters<typeof createAuthClient>[0], "baseURL"> = {}
): AuthClient =>
  createAuthClient({
    baseURL,
    ...options,
  });
