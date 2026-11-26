import {
  LINKED_CLIENT_COMMANDS,
  RESERVED_CLIENT_COMMANDS,
} from "@workspace/settings/groups/keybindings";
import type { KeymapOverrides } from "@workspace/ui/lib/keymap";

const RESERVED: ReadonlySet<string> = new Set(RESERVED_CLIENT_COMMANDS);

/**
 * The keymap's overrides from the stored `keybindings.client` record. A
 * reserved command is never left without a key, and a linked command takes
 * the keys of the command it follows; every other entry passes through for
 * the keymap to validate.
 */
export function clientKeyOverrides(
  stored: Readonly<Record<string, readonly string[]>>
): KeymapOverrides {
  const overrides: Record<string, readonly string[]> = {};
  for (const [id, keys] of Object.entries(stored)) {
    if (keys.length === 0 && RESERVED.has(id)) continue;
    overrides[id] = keys;
  }
  for (const [follower, target] of Object.entries(LINKED_CLIENT_COMMANDS)) {
    const keys = overrides[target];
    if (keys) overrides[follower] = keys;
    else delete overrides[follower];
  }
  return overrides;
}
