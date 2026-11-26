const BASE = "http://next-path.invalid";

/**
 * The page a visitor asked for before `/sign-in` interrupted them, as a path
 * on this origin. Anything that could leave the origin (an absolute URL, a
 * protocol-relative `//host`, a backslash the browser reads as a slash, a
 * `javascript:` URL) falls back to the home route, so the `next` query
 * parameter cannot be used as an open redirect.
 */
export function nextPath(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.includes("\\")) return "/";
  if (next.startsWith("//")) return "/";
  const url = new URL(next, BASE);
  if (url.origin !== BASE) return "/";
  // Dot segments collapse during parsing, so `/..//host` only shows its
  // protocol-relative shape in the parsed pathname.
  if (url.pathname.startsWith("//") || url.pathname.includes("\\")) return "/";
  return url.pathname + url.search + url.hash;
}

/** The `/sign-in` URL that returns to `path` once the visitor is signed in. */
export const signInUrlFor = (path: string): string =>
  `/sign-in?${new URLSearchParams({ next: path })}`;
