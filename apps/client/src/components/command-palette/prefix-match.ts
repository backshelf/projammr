/**
 * The prefix command owning a query, if any. A query only belongs to a
 * command once the prefix is complete — while the user is still typing
 * `pla`, the plain actions list is what should match.
 *
 * `aliases` are extra words that open a command, each mapped to the command's
 * id; a word opens its command once it is typed in full and followed by a
 * space, as a prefix is. Every command's own prefix is tried first, so an
 * alias can never take a prefix from the command that owns it.
 */
export function matchPrefixCommand<T extends { id: string; prefix: string }>(
  commands: T[],
  query: string,
  aliases: Readonly<Record<string, string>> = {}
): { command: T; remainder: string } | null {
  const lower = query.toLowerCase();
  for (const command of commands) {
    if (!lower.startsWith(command.prefix.toLowerCase())) continue;
    return {
      command,
      remainder: query.slice(command.prefix.length).trim(),
    };
  }
  for (const [alias, id] of Object.entries(aliases)) {
    const word = alias.trim().toLowerCase();
    if (word.length === 0 || !lower.startsWith(`${word} `)) continue;
    const command = commands.find((candidate) => candidate.id === id);
    if (!command) continue;
    return { command, remainder: query.slice(word.length + 1).trim() };
  }
  return null;
}
