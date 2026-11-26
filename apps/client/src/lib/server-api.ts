import "server-only";
import { getCookie, getForwardedFor, getOrigin } from "@/lib/request-cookie";
import { createServerApiClient } from "@workspace/api/lib/authed-client";

/**
 * The API client for server actions and RSC. It forwards the incoming
 * request's cookies, origin and `X-Forwarded-For`, so every call is made as the
 * signed-in user, from the page they acted on and keyed on the caller's own
 * address, without any call site passing a header.
 */
export const serverApi = createServerApiClient(
  getCookie,
  getOrigin,
  getForwardedFor
);
