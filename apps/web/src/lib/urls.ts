const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Normalise a site base path to `""` (site at root) or `"/segment"` (leading
 * slash, no trailing slash). */
export function normalizeBasePath(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function hasBasePrefix(path: string, base: string): boolean {
  if (base === "") return false;
  if (path === base) return true;
  if (!path.startsWith(base)) return false;
  const next = path[base.length];
  return next === "/" || next === "#" || next === "?";
}

function defaultBasePath(): string {
  return import.meta.env?.BASE_URL ?? "/";
}

/** Prefix a root-relative path with the site's base path (from
 * `import.meta.env.BASE_URL` unless overridden). Leaves external URLs,
 * protocol-relative URLs, relative paths, query/hash-only references, and
 * paths that already carry the base prefix untouched. */
export function siteHref(
  path: string,
  base: string = defaultBasePath()
): string {
  if (
    path === "" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    SCHEME.test(path)
  ) {
    return path;
  }
  const prefix = normalizeBasePath(base);
  if (prefix === "" || hasBasePrefix(path, prefix)) {
    return path;
  }
  return `${prefix}${path}`;
}

/** Remove a leading base path from a root-relative URL path, leaving `"/"`
 * when the path was the base itself. Paths outside the base are returned
 * unchanged. */
export function stripBasePath(path: string, base: string): string {
  const prefix = normalizeBasePath(base);
  if (prefix === "" || !hasBasePrefix(path, prefix)) {
    return path;
  }
  const rest = path.slice(prefix.length);
  if (rest === "") return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}
