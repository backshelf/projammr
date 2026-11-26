/**
 * The origin a request declares for itself, when it matches the host the
 * request was addressed to.
 *
 * A browser only pairs those two headers that way for a genuinely same-origin
 * request, and can forge neither. A non-browser client can set both, but it
 * could as easily send an origin the server already trusts, so treating the
 * pairing as same-origin gives nothing away.
 */
export function sameOrigin(request: Request | undefined): string | null {
  const origin = request?.headers.get("origin");
  const host = request?.headers.get("host");
  if (!origin || !host) return null;

  try {
    return new URL(origin).host === host ? origin : null;
  } catch {
    return null;
  }
}
