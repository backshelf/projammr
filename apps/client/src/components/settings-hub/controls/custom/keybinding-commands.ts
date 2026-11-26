import { COMMANDS } from "@/components/commands/index";
import {
  LINKED_CLIENT_COMMANDS,
  RESERVED_CLIENT_COMMANDS,
} from "@workspace/settings/groups/keybindings";
import { GLOBAL_SCOPE } from "@workspace/ui/lib/keymap";
import {
  sameSet,
  type BindableCommand,
  type KeyOverrides,
} from "./keybinding-rules";

/** A rebindable command with the heading the map lists it under. */
export type KeyMapCommand = BindableCommand & { group: string };

const RESERVED_CLIENT = new Set<string>(RESERVED_CLIENT_COMMANDS);

/**
 * The app's commands, each with its own declared keys. A keyless command is
 * listed, since a key can be added to it; a linked one is not, since it
 * follows its target.
 */
export const CLIENT_KEY_COMMANDS: readonly KeyMapCommand[] = COMMANDS.filter(
  (command) => !Object.hasOwn(LINKED_CLIENT_COMMANDS, command.id)
).map((command) => ({
  id: command.id,
  label: command.label,
  group: command.group,
  scope: command.scope ?? GLOBAL_SCOPE,
  defaults: command.keys ?? [],
  digits: command.yieldsToCount === true,
  reserved: RESERVED_CLIENT.has(command.id),
  typing: command.allowInInput === true,
}));

const COMMANDS_BY_SETTING: Readonly<Record<string, readonly KeyMapCommand[]>> =
  {
    "keybindings.client": CLIENT_KEY_COMMANDS,
  };

/** The commands the keybinding setting `settingKey` rebinds. */
export function keyCommandsFor(settingKey: string): readonly KeyMapCommand[] {
  if (!Object.hasOwn(COMMANDS_BY_SETTING, settingKey)) {
    throw new Error(`No keybinding map for setting: ${settingKey}`);
  }
  return COMMANDS_BY_SETTING[settingKey] as readonly KeyMapCommand[];
}

/**
 * `overrides` with command `id` bound to `keys`. Keys that equal the command's
 * defaults as a set are no override at all, so the entry is dropped.
 */
export function withKeys(
  overrides: KeyOverrides,
  command: BindableCommand,
  keys: readonly string[]
): KeyOverrides {
  return sameSet(keys, command.defaults)
    ? withoutOverride(overrides, command.id)
    : { ...overrides, [command.id]: keys };
}

/** `overrides` without the entry for `id`. */
export function withoutOverride(
  overrides: KeyOverrides,
  id: string
): KeyOverrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(([each]) => each !== id)
  );
}
