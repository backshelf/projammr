import type { Command, CommandContext } from "@/components/commands/types";
import { GLOBAL_SCOPE, parseCombo } from "@workspace/ui/lib/keymap";

/**
 * A keymap scope with the type of what a push of it attaches: a table's
 * cursor, the compare state. Commands declared in the scope read it as
 * `ctx.surface`.
 */
export type CommandScope<Surface = undefined> = {
  readonly name: string;
  /** Carries `Surface` for the type checker only; never set. */
  readonly surfaceType?: Surface;
};

export function defineScope<Surface = undefined>(
  name: string
): CommandScope<Surface> {
  return { name };
}

/** The scope that answers everywhere; its commands have no surface. */
export const GLOBAL = defineScope(GLOBAL_SCOPE);

/** Pushed modal by an open dialog, silencing everything beneath it. */
export const DIALOG_SCOPE = defineScope<{
  /** What `mod+Enter` confirms, when the dialog has one thing to confirm. */
  confirm?: () => void;
}>("dialog");

/**
 * Pushed while the now-playing sheet is open, above the sheet's modal push.
 * The commands that declare it in `alsoIn` (the player's, the Lab's and the
 * queue toggle) answer inside the sheet; the rest of the page stays silent.
 */
export const NOW_PLAYING_SCOPE = defineScope("now-playing");

/** What a `defineCommands` call stamps on every command it declares. */
type DefineOptions = {
  /** Scopes the commands also answer in, beyond the one they are declared in. */
  alsoIn?: readonly CommandScope<unknown>[];
};

/** A command as an area file declares it: `when` and `run` see the scope's surface. */
export type CommandSpec<Surface> = Omit<
  Command,
  "scope" | "alsoIn" | "when" | "run"
> & {
  when?(ctx: CommandContext<Surface>): boolean;
  run(ctx: CommandContext<Surface>): void | Promise<void>;
};

/**
 * Declares one area's commands in `scope`. Throws at module load on an id
 * declared twice or a key the grammar cannot read, so a typo never reaches
 * the keymap; `COMMANDS` checks ids across areas the same way. `alsoIn` only
 * widens where the keys answer: a command's surface and availability stay
 * those of `scope`.
 */
export function defineCommands<Surface>(
  scope: CommandScope<Surface>,
  specs: readonly CommandSpec<Surface>[],
  { alsoIn }: DefineOptions = {}
): Command[] {
  assertUniqueIds(specs);
  for (const spec of specs) {
    for (const key of spec.keys ?? []) {
      if (parseCombo(key) === null) {
        throw new Error(
          `The command "${spec.id}" has a key the grammar cannot read: "${key}".`
        );
      }
    }
  }
  // The provider hands each command the surface of its own scope's push, so
  // `unknown` is always this scope's `Surface` by the time `when` or `run` sees it.
  return specs.map(
    (spec) =>
      ({
        ...spec,
        scope: scope.name,
        alsoIn: alsoIn?.map((also) => also.name),
      }) as Command
  );
}

/** Throws when two commands share an id. */
export function assertUniqueIds(commands: readonly { id: string }[]) {
  const seen = new Set<string>();
  for (const { id } of commands) {
    if (seen.has(id)) {
      throw new Error(`The command id "${id}" is declared twice.`);
    }
    seen.add(id);
  }
}
