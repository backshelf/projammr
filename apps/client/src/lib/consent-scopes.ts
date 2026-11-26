const REQUIRED_SCOPE = "read";

/** The scopes the user may toggle and the ones the grant always carries. */
export function consentChoices(requested: string): {
  fixed: string[];
  optional: string[];
} {
  const scopes = requested.split(" ").filter(Boolean);
  return {
    fixed: scopes.filter((s) => s === REQUIRED_SCOPE),
    optional: scopes.filter((s) => s !== REQUIRED_SCOPE),
  };
}

/** The scope string to grant: the fixed set plus whatever optional scopes stayed ticked. */
export function grantedScope(requested: string, ticked: Set<string>): string {
  const { fixed, optional } = consentChoices(requested);
  return [...fixed, ...optional.filter((s) => ticked.has(s))].join(" ");
}
