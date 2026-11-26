"use client";

import { useCommandPalette } from "@/components/command-palette/command-palette-context";
import { DIALOG_SCOPE, type CommandScope } from "@/components/commands/define";
import { COMMANDS } from "@/components/commands/index";
import { clientKeyOverrides } from "@/components/commands/key-overrides";
import { routeTrackFrom } from "@/components/commands/tracks";
import type {
  ActionContext,
  Command,
  CommandContext,
  ListedCommand,
} from "@/components/commands/types";
import { useNowPlaying } from "@/components/music-player/now-playing-context";
import {
  useCurrentTrack,
  useDuration,
  useLabSettings,
  useMusicPlayerStore,
} from "@/components/music-player/player-hooks";
import { useTheme } from "@/components/theme/AppThemeProvider";
import { useCurrentRoute } from "@/hooks/use-current-route";
import { subscribeUndo } from "@/lib/action-toast";
import {
  useFeedbackPolicy,
  usePlaybackPolicy,
  useShellPolicy,
} from "@/lib/policies/provider";
import type { ParsedRoute } from "@/lib/route-parser";
import { settingsProjectId } from "@/lib/settings/href";
import { useSetting } from "@/lib/settings/provider";
import { useFormat } from "@workspace/ui/components/format-provider";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import { useSidebar } from "@workspace/ui/components/sidebar";
import {
  createKeymap,
  GLOBAL_SCOPE,
  type Keymap,
  type KeymapOverrides,
  type KeymapState,
} from "@workspace/ui/lib/keymap";
import {
  ModalScopeProvider,
  type ModalSurface,
} from "@workspace/ui/lib/modal-scope";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

type PushOptions = {
  /** Silence every scope beneath this push, the global scope included. */
  modal?: boolean;
  /** Stay the innermost push: re-pushed whenever another push lands above. */
  onTop?: boolean;
};

/** The registry's engine: the keymap, the commands, the surfaces pushed. */
type RegistryCore = {
  keymap: Keymap;
  subscribe: (listener: () => void) => () => void;
  context: () => ActionContext;
  setContext: (context: ActionContext) => void;
  /** Pushes `name`, attaching `surface`; the returned function pops this push. */
  pushScope: (
    name: string,
    surface: RefObject<unknown>,
    options?: PushOptions
  ) => () => void;
  /** Tells subscribers a surface changed what it attaches. */
  emit: () => void;
  commands: () => readonly ListedCommand[];
  run: (id: string) => void;
};

const NO_OVERRIDES: KeymapOverrides = {};

function createRegistryCore(
  commands: readonly Command[],
  initialContext: ActionContext,
  overrides: KeymapOverrides
): RegistryCore {
  let context = initialContext;
  const byId = new Map(commands.map((command) => [command.id, command]));
  /** Each scope's pushes, in push order: the last is the innermost. */
  const surfaces = new Map<string, RefObject<unknown>[]>();
  const listeners = new Set<() => void>();

  const scopeOf = (command: Command) => command.scope ?? GLOBAL_SCOPE;

  const surfaceOf = (scope: string) => surfaces.get(scope)?.at(-1)?.current;

  /** The last `repeatable` command that ran, and the count it ran with. */
  let last: { id: string; count: number } | null = null;

  const contextFor = (command: Command, count: number): CommandContext => ({
    ...context,
    count,
    repeatLast,
    surface: surfaceOf(scopeOf(command)),
  });

  /** A scoped command has nothing to act on, and `when` is never asked,
   *  while its scope has no push. */
  function available(command: Command): boolean {
    const scope = scopeOf(command);
    if (scope !== GLOBAL_SCOPE && !surfaces.get(scope)?.length) return false;
    return command.when?.(contextFor(command, 1)) ?? true;
  }

  function run(command: Command, count: number) {
    if (command.repeatable) last = { id: command.id, count };
    void command.run(contextFor(command, count));
  }

  function repeatLast() {
    const command = last && byId.get(last.id);
    if (last && command && available(command)) run(command, last.count);
  }

  const keymap = createKeymap<string>({
    bindings: commands.map((command) => ({
      id: command.id,
      keys: command.keys ?? [],
      scope: scopeOf(command),
      alsoIn: command.alsoIn,
      when: () => available(command),
      label: command.label,
      group: command.group,
      countable: command.countable,
      yieldsToCount: command.yieldsToCount,
      allowInInput: command.allowInInput,
    })),
    overrides,
    onRun: (id, { count }) => {
      const command = byId.get(id);
      if (command) run(command, count);
    },
  });

  function emit() {
    for (const listener of listeners) listener();
  }

  function push(
    name: string,
    surface: RefObject<unknown>,
    modal: boolean
  ): () => void {
    // The surface goes in before the keymap's push notifies, and comes out
    // before its pop does, so no subscriber sees a push without its surface.
    const list = surfaces.get(name) ?? [];
    surfaces.set(name, list);
    list.push(surface);
    const pop = keymap.pushScope(name, { modal });
    return () => {
      const index = list.lastIndexOf(surface);
      if (index !== -1) list.splice(index, 1);
      pop();
    };
  }

  let listed: readonly ListedCommand[] = [];

  return {
    keymap,
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribe = keymap.subscribe(listener);
      // Whether `u` is available follows the toasts offering Undo.
      const unsubscribeUndo = subscribeUndo(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
        unsubscribeUndo();
      };
    },
    context: () => context,
    setContext(next) {
      context = next;
      emit();
    },
    pushScope(name, surface, { modal = false, onTop = false } = {}) {
      let pop = push(name, surface, modal);
      if (!onTop) return pop;

      let repushing = false;
      const unsubscribe = keymap.subscribe(() => {
        if (repushing || keymap.state().scope.at(-1) === name) return;
        repushing = true;
        pop();
        pop = push(name, surface, modal);
        repushing = false;
      });
      return () => {
        unsubscribe();
        pop();
      };
    },
    emit,
    commands() {
      const bindings = keymap.bindings();
      const next = commands.map((command, index) => ({
        ...command,
        keys: bindings[index]?.keys ?? [],
        available: available(command),
      }));
      const same =
        next.length === listed.length &&
        next.every(
          (entry, index) =>
            entry.available === listed[index]?.available &&
            entry.keys === listed[index]?.keys
        );
      if (!same) listed = next;
      return listed;
    },
    run(id) {
      const command = byId.get(id);
      if (command) run(command, 1);
    },
  };
}

const RegistryContext = createContext<RegistryCore | null>(null);

function useRegistry(hook: string): RegistryCore {
  const core = use(RegistryContext);
  if (!core) throw new Error(`${hook} requires a CommandProvider`);
  return core;
}

/**
 * The registry without the app around it: builds the keymap from `commands`
 * once, owns the one `keydown` listener on `window`, and hands every command
 * `context` when it runs. `CommandProvider` renders it with the app's
 * commands and context; a test renders it with its own.
 *
 * The value it provides never changes, so a consumer re-renders only on what
 * it subscribes to (`useCommands`, `useKeymapState`), never on the context.
 */
export function CommandRegistry({
  commands,
  context,
  overrides = NO_OVERRIDES,
  children,
}: {
  commands: readonly Command[];
  context: ActionContext;
  overrides?: KeymapOverrides;
  children: ReactNode;
}) {
  const [core] = useState(() =>
    createRegistryCore(commands, context, overrides)
  );

  useEffect(() => {
    if (core.context() !== context) core.setContext(context);
  }, [core, context]);

  useEffect(() => {
    core.keymap.setOverrides(overrides);
  }, [core, overrides]);

  useEffect(() => {
    const dispatch = (event: KeyboardEvent) => core.keymap.dispatch(event);
    window.addEventListener("keydown", dispatch);
    return () => window.removeEventListener("keydown", dispatch);
  }, [core]);

  return <RegistryContext value={core}>{children}</RegistryContext>;
}

/** The fields of the context only the palette's server-rendered recents know. */
export type PublishedCommandContext = {
  /** The project the fields describe: the `currentProject` cookie's. */
  projectId: number;
  canEdit: boolean;
  allTracks: readonly { id: number; title: string; archived: boolean }[];
};

const PublishContext = createContext<Dispatch<
  SetStateAction<PublishedCommandContext | null>
> | null>(null);

type ShortcutsOverlayState = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

/** Exported for `ShortcutsOverlay`'s own test, to drive it without the rest
 *  of `CommandProvider`'s context. */
export const ShortcutsOverlayContext =
  createContext<ShortcutsOverlayState | null>(null);

/** Off the project tree every route test fails. */
const OUTSIDE_A_PROJECT: ParsedRoute = { kind: "not-found" };

/**
 * The signed-in app's command registry: `COMMANDS` over the context built
 * here from the route, the player, the theme and the policies, so a command
 * runs the same from a key, the palette or the bar. The shortcuts overlay's
 * open state lives here too, shared by its key and the palette's command.
 *
 * Renders no DOM. It sits inside the sidebar's provider so a command can
 * reach the sidebar.
 */
export function CommandProvider({ children }: { children: ReactNode }) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [published, setPublished] = useState<PublishedCommandContext | null>(
    null
  );

  const router = useRouter();
  const pathname = usePathname();
  const current = useCurrentRoute();
  // A hub Project page sits outside `/project/:id` but is about one project,
  // so commands act in that project there too.
  const projectId = current?.projectId ?? settingsProjectId(pathname) ?? null;
  const route = current?.route ?? OUTSIDE_A_PROJECT;
  const { resolvedTheme, setTheme } = useTheme();
  const player = useMusicPlayerStore();
  const currentTrack = useCurrentTrack();
  const duration = useDuration();
  const coarsePointer = useCoarsePointer();
  const palette = useCommandPalette();
  const nowPlaying = useNowPlaying();
  const labSettings = useLabSettings();
  const { undoWindowMs } = useFeedbackPolicy();
  const playback = usePlaybackPolicy();
  const { paletteResultCap } = useShellPolicy();
  const formatters = useFormat();
  const { toggleSidebar } = useSidebar();

  // The recents come from the `currentProject` cookie, which can name a
  // different project from the URL's: they describe this one only when the
  // two agree.
  const projectFields =
    published !== null && published.projectId === projectId ? published : null;
  const canEdit = projectFields?.canEdit ?? false;
  const allTracks = projectFields?.allTracks;
  const routeTrack = useMemo(
    () => (allTracks ? routeTrackFrom(route, allTracks) : null),
    [route, allTracks]
  );

  const context = useMemo<ActionContext>(
    () => ({
      router,
      pathname,
      projectId,
      route,
      resolvedTheme,
      setTheme,
      player,
      playerActions: player.actions,
      currentTrack,
      duration,
      coarsePointer,
      setShortcutsOpen,
      palette,
      nowPlaying,
      labSettings,
      openLab: () => {
        nowPlaying.setView("lab");
        nowPlaying.setOpen(true);
      },
      canEdit,
      routeTrack,
      undoWindowMs,
      resultCap: paletteResultCap,
      formatters,
      playback,
      toggleSidebar,
    }),
    [
      router,
      pathname,
      projectId,
      route,
      resolvedTheme,
      setTheme,
      player,
      currentTrack,
      duration,
      coarsePointer,
      palette,
      nowPlaying,
      labSettings,
      canEdit,
      routeTrack,
      undoWindowMs,
      paletteResultCap,
      formatters,
      playback,
      toggleSidebar,
    ]
  );

  const storedKeys = useSetting("keybindings.client");
  const overrides = useMemo(() => clientKeyOverrides(storedKeys), [storedKeys]);

  const overlay = useMemo(
    () => ({ open: shortcutsOpen, setOpen: setShortcutsOpen }),
    [shortcutsOpen]
  );

  return (
    <PublishContext value={setPublished}>
      <ShortcutsOverlayContext value={overlay}>
        <CommandRegistry
          commands={COMMANDS}
          context={context}
          overrides={overrides}
        >
          <ModalScopeBridge>{children}</ModalScopeBridge>
        </CommandRegistry>
      </ShortcutsOverlayContext>
    </PublishContext>
  );
}

/**
 * Fills the ui seam: a dialog primitive's `useModalScope` (`@workspace/ui/lib/modal-scope`)
 * pushes through this into the registry's own `pushScope` — the same path
 * `useCommandScope`/`useModalScope` below use — so a ui dialog and the
 * client's own commands push one scope stack, not two.
 */
export function ModalScopeBridge({ children }: { children: ReactNode }) {
  const core = useRegistry("ModalScopeBridge");
  const push = useCallback(
    (surface: ModalSurface) =>
      core.pushScope(DIALOG_SCOPE.name, { current: surface }, { modal: true }),
    [core]
  );
  return <ModalScopeProvider push={push}>{children}</ModalScopeProvider>;
}

/**
 * Whether a command registry is mounted above: false on the pages outside the
 * signed-in app (a share page), where a component that pushes a scope has to
 * handle its key itself.
 */
export function useInCommandRegistry(): boolean {
  return use(RegistryContext) !== null;
}

/**
 * Tells the registry that what its commands report as available has changed
 * outside a surface or context update (a handler a surface looks up was
 * registered or withdrawn), so the bar and overlay re-read. Does nothing
 * outside a provider.
 */
export function useNotifyCommands(): () => void {
  const core = use(RegistryContext);
  return useCallback(() => core?.emit(), [core]);
}

/**
 * Pushes `scope` while `active`, attaching `surface` for its commands to read.
 * A surface pushes when it has the user's attention (a table under the
 * pointer, a dialog on screen), and the innermost push of a scope is the one
 * whose surface its commands see. Does nothing outside a provider.
 */
export function useCommandScope<Surface>(
  scope: CommandScope<Surface>,
  surface: Surface,
  active: boolean,
  { modal = false, onTop = false }: PushOptions = {}
) {
  const core = use(RegistryContext);
  const surfaceRef = useRef<unknown>(surface);

  useEffect(() => {
    if (surfaceRef.current === surface) return;
    surfaceRef.current = surface;
    core?.emit();
  }, [core, surface]);

  useEffect(() => {
    if (!core || !active) return;
    return core.pushScope(scope.name, surfaceRef, { modal, onTop });
  }, [core, scope.name, active, modal, onTop]);
}

/** Publishes the palette recents' fields into the context; `null` withdraws them. */
export function usePublishCommandContext(
  fields: PublishedCommandContext | null
) {
  const publish = use(PublishContext);

  useEffect(() => {
    if (!publish) return;
    publish(fields);
    return () => publish(null);
  }, [publish, fields]);
}

/** Every command with its live keys and whether it can run now. */
export function useCommands(): readonly ListedCommand[] {
  const core = useRegistry("useCommands");
  return useSyncExternalStore(core.subscribe, core.commands, core.commands);
}

/** Runs a command by id with the current context, as its key would. */
export function useRunCommand(): (id: string) => void {
  return useRegistry("useRunCommand").run;
}

/** The keymap's scope stack, pending chord, count and candidates. */
export function useKeymapState(): KeymapState {
  const { keymap, subscribe } = useRegistry("useKeymapState");
  return useSyncExternalStore(subscribe, keymap.state, keymap.state);
}

/** The context commands run with, for the palette's prefix commands. */
export function useActionContext(): ActionContext {
  const core = useRegistry("useActionContext");
  return useSyncExternalStore(core.subscribe, core.context, core.context);
}

/** Whether the "Keyboard shortcuts" overlay is open, and how to change it. */
export function useShortcutsOverlay(): ShortcutsOverlayState {
  const state = use(ShortcutsOverlayContext);
  if (!state) throw new Error("useShortcutsOverlay requires a CommandProvider");
  return state;
}
