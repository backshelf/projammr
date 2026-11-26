export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The OAuth provider signs every query parameter it hands `/sign-in` and
 * `/consent` and appends its own `sig` parameter over the result (see
 * `@better-auth/oauth-provider`'s `signParams`). `sig` therefore only ever
 * appears on a provider-authored redirect, never on an ordinary visit, which
 * is what lets a page tell the two apart without re-verifying the signature
 * itself.
 */
export function hasOAuthQuery(searchParams: RawSearchParams): boolean {
  return searchParams.sig !== undefined;
}

/** A search param's first value, or `undefined` if it was never set. */
export function paramString(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Re-serialises a page's search params into a query string, for a redirect
 * that must carry the same OAuth query forward (`/consent` to `/sign-in`
 * when the visitor turns out to be signed out).
 */
export function searchParamsToQueryString(
  searchParams: RawSearchParams
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      params.append(key, entry);
    }
  }
  return params.toString();
}
