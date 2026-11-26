import type { SessionDaw } from "@workspace/api/api";

/**
 * The DAW names a session table or form offers as suggestions: each distinct
 * name once. A DAW with no name offers nothing — its raw id (`"manual"`) is not
 * a name, and picking it would save it as one.
 */
export const dawSuggestions = (daws: SessionDaw[]): string[] => [
  ...new Set(
    daws.map((d) => d.dawName).filter((name): name is string => !!name)
  ),
];
