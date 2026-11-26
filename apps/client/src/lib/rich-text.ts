/**
 * The block editor hands its document back serialized. `notes` is a `jsonb`
 * column holding the document itself, so a form parses the string before
 * sending it — passing the string through would store a JSON-encoded
 * string in the column instead of the blocks. An empty or unparseable value
 * means the editor was never touched, and the column stays null.
 */
export const richTextDocument = (
  value?: string
): Record<string, unknown>[] | undefined => {
  if (!value) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? (parsed as Record<string, unknown>[])
      : undefined;
  } catch {
    return undefined;
  }
};
