"use client";
import { ArtSwatch } from "@/components/art/ArtSwatch";
import type {
  PrefixCommand,
  PrefixRow,
} from "@/components/command-palette/action-context";
import {
  matchActions,
  matchPrefixCommand,
  PREFIX_COMMANDS,
  resultHref,
} from "@/components/command-palette/action-context";
import { useCommandPalette } from "@/components/command-palette/command-palette-context";
import { emptyQueryGroups } from "@/components/command-palette/empty-groups";
import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { comboLabel } from "@/components/hotkeys/combo-format";
import {
  matchSettingResults,
  type SettingResult,
} from "@/components/command-palette/settings-results";
import { shouldRenderPalette } from "@/components/command-palette/should-render-palette";
import { tabQuickJumps } from "@/components/command-palette/tab-shortcuts";
import {
  prefixCandidates,
  usePrefixCommandResults,
} from "@/components/command-palette/use-prefix-command";
import type { Artwork } from "@workspace/api/api";
import type { SearchResult } from "@/components/command-palette/use-search";
import { useSearch } from "@/components/command-palette/use-search";
import { removeTrackFromCollection } from "@/actions/collections";
import {
  matchCollectionOpPrefix,
  type PendingCollectionOp,
  planCollectionOp,
} from "@/components/command-palette/collection-op";
import {
  useActionContext,
  useCommands,
  useRunCommand,
} from "@/components/commands/provider";
import type { ListedCommand } from "@/components/commands/types";
import { entityModule } from "@/entities";
import { linkTracksToCollection } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useShellPolicy } from "@/lib/policies/provider";
import type { PaletteEmptyGroup } from "@/lib/policies/shell";
import { type ParsedRoute } from "@/lib/route-parser";
import { useCurrentRoute } from "@/hooks/use-current-route";
import { hrefFromParsedRoute } from "@/lib/utils";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandItemDetail,
  CommandItemKind,
  CommandList,
  CommandShortcut,
} from "@workspace/ui/components/command";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
  IconDisc,
  IconExternalLink,
  IconFolderPlus,
  IconSettings,
} from "@tabler/icons-react";
import { useTrackStudioActions } from "@/components/track/track-studio-bridge";
import { isActionError } from "@workspace/api/lib/action-result";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";

/** The current project's recently edited records, server-rendered into the palette. */
export type PaletteRecents = {
  /** The project these belong to: the `currentProject` cookie's, which can
   *  name a different project from the URL's. */
  projectId: number;
  /** Whether the viewer is an editor or above in `projectId`. */
  canEdit: boolean;
  /** Every track in the project, so a track page can tell whether its track
   *  is archived. */
  allTracks: { id: number; title: string; archived: boolean }[];
  tracks: { id: number; title: string; artwork?: Artwork | null }[];
  sessions: {
    id: number;
    name: string;
    trackId: number | null;
    artwork?: Artwork | null;
  }[];
};

const NO_SETTINGS: readonly SettingResult[] = [];

function kindLabel(result: SearchResult): string {
  if (result.isComment) return "Comment";
  if (result.type === "asset") return "Asset";
  const noun = entityModule(result.type).nouns.singular;
  return noun[0]!.toUpperCase() + noun.slice(1);
}

/** A command that shows in the palette: the `hidden` ones a query still finds. */
type PaletteCommand = ListedCommand & {
  palette: NonNullable<ListedCommand["palette"]>;
};

function isPaletteCommand(command: ListedCommand): command is PaletteCommand {
  return command.palette !== undefined;
}

/** Palette commands grouped by their `group` field, in first-seen order. */
function actionGroups<T extends { group: string }>(
  items: readonly T[]
): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const existing = groups.get(item.group);
    if (existing) existing.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups.entries()];
}

export function CommandPalette({
  recents,
  settings = NO_SETTINGS,
}: {
  recents?: PaletteRecents;
  /** Every setting the caller can open in the settings hub. */
  settings?: readonly SettingResult[];
}) {
  const { open, setOpen, initialQuery } = useCommandPalette();
  const [query, setQuery] = useState(initialQuery);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery(initialQuery);
  }
  const [pendingOp, setPendingOp] = useState<PendingCollectionOp | null>(null);
  const router = useRouter();
  const mutate = useMutate();
  const current = useCurrentRoute();
  const apple = useIsApplePlatform();
  const isMobile = useIsMobile();
  const { dockTabs, paletteAliases, paletteEmptyGroups } = useShellPolicy();

  const actionContext = useActionContext();
  const commands = useCommands();
  const runCommand = useRunCommand();
  const trackStudio = useTrackStudioActions();
  // `provider.tsx` already resolves the hub-page fallback and the
  // outside-a-project default; the palette reads the same values off it
  // rather than recomputing them.
  const projectId = actionContext.projectId ?? undefined;
  const route: ParsedRoute = actionContext.route;

  // `move` takes the track out of the collection this page is scoped to, so
  // it is only offered where there is one.
  const scopedCollectionId =
    "collectionId" in route ? route.collectionId : undefined;
  const trackToCollectionMatch = pendingOp
    ? null
    : matchCollectionOpPrefix(query, {
        canMove: scopedCollectionId != null,
      });
  const prefixMatch = trackToCollectionMatch
    ? null
    : matchPrefixCommand(PREFIX_COMMANDS, query, paletteAliases);

  const { results } = useSearch(projectId, query, {
    enabled:
      prefixMatch === null && trackToCollectionMatch === null && !pendingOp,
  });

  const { results: trackPickerResults } = useSearch(
    projectId,
    trackToCollectionMatch?.remainder ?? "",
    { types: ["track"], enabled: trackToCollectionMatch !== null }
  );

  const { results: collectionPickerResults } = useSearch(projectId, query, {
    types: ["collection"],
    enabled: pendingOp !== null,
  });

  // `recents` comes from a server component keyed off the `currentProject`
  // cookie, not the current URL — outside a project (e.g. on /notes) that
  // cookie can still point at a real project, so recents are dropped here
  // rather than trusted to already be empty.
  // The role and the track states describe the URL's project only when the
  // cookie names the same one.
  const projectRecents =
    projectId !== undefined && recents?.projectId === projectId
      ? recents
      : undefined;
  // A hub Project page does not move the cookie, so its recents count there
  // only when they are that project's.
  const listedRecents = current ? recents : projectRecents;
  const recentTracks =
    projectId !== undefined ? (listedRecents?.tracks ?? []) : [];
  const recentSessions =
    projectId !== undefined ? (listedRecents?.sessions ?? []) : [];

  function onOpenChange(next: boolean) {
    setOpen(next);
    setQuery("");
    setPendingOp(null);
  }

  const { results: prefixResults, isLoading: isPrefixLoading } =
    usePrefixCommandResults(
      prefixMatch?.command ?? null,
      prefixMatch?.remainder ?? "",
      actionContext
    );
  const { activeMatch: activePrefixMatch, candidates: commandCandidates } =
    prefixCandidates(prefixMatch, query, actionContext);

  if (!shouldRenderPalette(current?.projectId, route)) return null;

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  function select(target: ParsedRoute) {
    if (projectId === undefined) return;
    go(hrefFromParsedRoute(target, projectId));
  }

  function openResult(result: SearchResult) {
    if (projectId === undefined) return;
    go(resultHref(result, projectId));
  }

  const trackCommands: PaletteCommand[] =
    route.kind === "track" && trackStudio
      ? [
          {
            id: "inspect-daw-history",
            label: "Inspect DAW & history",
            group: "Track" as const,
            keys: ["w"],
            alsoIn: [],
            available: true,
            run: () => trackStudio.openStudio(),
            palette: { icon: IconDisc, hidden: false },
          },
          ...(trackStudio.openInDaw
            ? [
                {
                  id: "open-in-daw",
                  label: "Open in DAW",
                  group: "Track" as const,
                  keys: [],
                  alsoIn: [],
                  available: true,
                  run: () => trackStudio.openInDaw?.(),
                  palette: { icon: IconExternalLink, hidden: false },
                },
              ]
            : []),
        ]
      : [];

  const paletteCommands = [
    ...commands.filter(isPaletteCommand).filter((command) => command.available),
    ...trackCommands,
  ];
  const matchedActions = matchActions(paletteCommands, query);
  const matchedSettings = matchSettingResults(settings, query);

  const quickJumps = isMobile
    ? tabQuickJumps(dockTabs, {
        projectId: actionContext.projectId,
        route: current?.route ?? null,
        pathname: actionContext.pathname,
        canEdit: listedRecents?.canEdit ?? false,
      })
    : [];
  const quickJumpByCommandId = new Map(
    quickJumps.flatMap((jump) =>
      jump.commandId ? [[jump.commandId, jump] as const] : []
    )
  );

  function commandShortcut(command: ListedCommand) {
    if (isMobile) {
      const jump = quickJumpByCommandId.get(command.id);
      return jump ? <CommandShortcut>{jump.hint}</CommandShortcut> : null;
    }
    const combo = command.keys[0];
    return combo ? (
      <CommandShortcut>{comboLabel(combo, apple)}</CommandShortcut>
    ) : null;
  }

  function runPrefixCommand(command: PrefixCommand, row: PrefixRow) {
    onOpenChange(false);
    void command.run(row, actionContext);
  }

  const PrefixIcon = prefixMatch?.command.icon;

  function runCommandRow(command: PaletteCommand) {
    onOpenChange(false);
    runCommand(command.id);
  }

  function pickTrackForCollectionOp(
    verb: "add" | "move",
    result: SearchResult
  ) {
    setPendingOp({
      verb,
      trackId: result.id,
      trackTitle: result.title,
      fromCollectionId: verb === "move" ? scopedCollectionId : undefined,
    });
    setQuery("");
  }

  async function pickCollectionForOp(result: SearchResult) {
    if (!pendingOp) return;
    onOpenChange(false);
    const steps = planCollectionOp(pendingOp, result.id);
    if (!steps) {
      toast(`“${pendingOp.trackTitle}” is already in ${result.title}`);
      return;
    }
    for (const step of steps) {
      const outcome =
        step.kind === "remove"
          ? await removeTrackFromCollection(step.collectionId, step.trackId)
          : await mutate(
              linkTracksToCollection(step.collectionId, [step.trackId])
            );
      if (isActionError(outcome)) {
        toast.error(outcome.error);
        break;
      }
    }
  }

  function pickCommandCandidate(command: PrefixCommand) {
    setQuery(command.prefix);
  }

  const emptyQueryActions = paletteCommands.filter(
    (command) => !command.palette.hidden
  );
  const emptyQuery = emptyQueryGroups(paletteEmptyGroups, {
    actions: emptyQueryActions.length,
    "recent-tracks": recentTracks.length,
    "recent-sessions": recentSessions.length,
  });
  const emptyGroup: Record<PaletteEmptyGroup, ReactNode> = {
    actions: actionGroups(emptyQueryActions).map(([group, groupCommands]) => (
      <CommandGroup key={group} heading={group}>
        {groupCommands.map((command) => (
          <CommandItem
            key={command.id}
            value={command.id}
            onSelect={() => runCommandRow(command)}
          >
            <command.palette.icon />
            <span className="truncate">{command.label}</span>
            {commandShortcut(command)}
          </CommandItem>
        ))}
      </CommandGroup>
    )),
    "recent-tracks": (
      <CommandGroup heading="Recent tracks">
        {recentTracks.map((track) => (
          <CommandItem
            key={`recent-track-${track.id}`}
            value={`recent-track-${track.id}`}
            onSelect={() => select({ kind: "track", trackId: track.id })}
          >
            <ArtSwatch artwork={track.artwork ?? null} />
            <span className="truncate">{track.title}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    ),
    "recent-sessions": (
      <CommandGroup heading="Recent sessions">
        {recentSessions.map((session) => (
          <CommandItem
            key={`recent-session-${session.id}`}
            value={`recent-session-${session.id}`}
            onSelect={() =>
              select({
                kind: "session",
                sessionId: session.id,
                trackId: session.trackId ?? undefined,
              })
            }
          >
            <ArtSwatch artwork={session.artwork ?? null} />
            <span className="truncate">{session.name}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    ),
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={
            pendingOp
              ? `${pendingOp.verb === "add" ? "Add" : "Move"} “${pendingOp.trackTitle}” to which collection…`
              : projectId === undefined
                ? "Search settings and commands…"
                : "Search this project…"
          }
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && query.length === 0 && pendingOp) {
              setPendingOp(null);
            }
          }}
        />
        <CommandList>
          {pendingOp ? (
            <>
              {collectionPickerResults.length === 0 && (
                <CommandEmpty>
                  {query.trim().length === 0
                    ? "Type to find a collection"
                    : `No collections matching “${query}”`}
                </CommandEmpty>
              )}
              {collectionPickerResults.length > 0 && (
                <CommandGroup heading="Collections">
                  {collectionPickerResults.map((result) => (
                    <CommandItem
                      key={`collection-op-${result.id}`}
                      value={`collection-op-${result.id}`}
                      onSelect={() => pickCollectionForOp(result)}
                    >
                      <IconFolderPlus />
                      <span className="truncate">{result.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          ) : trackToCollectionMatch ? (
            <>
              {trackToCollectionMatch.remainder.length === 0 && (
                <CommandEmpty>Type a track to search for…</CommandEmpty>
              )}
              {trackToCollectionMatch.remainder.length > 0 &&
                trackPickerResults.length === 0 && (
                  <CommandEmpty>
                    No tracks matching “{trackToCollectionMatch.remainder}”
                  </CommandEmpty>
                )}
              {trackPickerResults.length > 0 && (
                <CommandGroup
                  heading={
                    trackToCollectionMatch.verb === "add"
                      ? "Add to collection"
                      : "Move to collection"
                  }
                >
                  {trackPickerResults.map((result) => (
                    <CommandItem
                      key={`track-op-${result.id}`}
                      value={`track-op-${result.id}`}
                      onSelect={() =>
                        pickTrackForCollectionOp(
                          trackToCollectionMatch.verb,
                          result
                        )
                      }
                    >
                      <ArtSwatch artwork={result.image} />
                      <span className="truncate">{result.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          ) : query.trim().length === 0 ? (
            <>
              {emptyQuery.none && quickJumps.length === 0 && (
                <CommandEmpty>Type to search this project</CommandEmpty>
              )}
              {quickJumps.length > 0 && (
                <CommandGroup heading="Quick jump">
                  {quickJumps.map((jump) => (
                    <CommandItem
                      key={`quick-jump-${jump.id}`}
                      value={`quick-jump-${jump.id}`}
                      onSelect={() => go(jump.href)}
                    >
                      <jump.icon />
                      <span className="truncate">{jump.label}</span>
                      <CommandShortcut>{jump.hint}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {emptyQuery.groups.map((group) => (
                <Fragment key={group}>{emptyGroup[group]}</Fragment>
              ))}
            </>
          ) : activePrefixMatch ? (
            <>
              {activePrefixMatch.remainder.length === 0 && (
                <CommandEmpty>
                  {activePrefixMatch.command.hint("…")}
                </CommandEmpty>
              )}
              {activePrefixMatch.remainder.length > 0 && isPrefixLoading && (
                <CommandEmpty>
                  {activePrefixMatch.command.hint(activePrefixMatch.remainder)}
                </CommandEmpty>
              )}
              {activePrefixMatch.remainder.length > 0 &&
                !isPrefixLoading &&
                prefixResults.length === 0 && (
                  <CommandEmpty>
                    {activePrefixMatch.command.emptyLabel(
                      activePrefixMatch.remainder
                    )}
                  </CommandEmpty>
                )}
              {prefixResults.length > 0 && (
                <CommandGroup heading={activePrefixMatch.command.group}>
                  {prefixResults.map((row) => (
                    <CommandItem
                      key={
                        row.kind === "search"
                          ? `prefix-${row.result.type}-${row.result.id}`
                          : `prefix-local-${row.id}`
                      }
                      value={
                        row.kind === "search"
                          ? `prefix-${row.result.type}-${row.result.id}`
                          : `prefix-local-${row.id}`
                      }
                      onSelect={() =>
                        runPrefixCommand(activePrefixMatch.command, row)
                      }
                    >
                      {PrefixIcon && <PrefixIcon />}
                      {row.kind === "search" ? (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">
                              {row.result.title}
                            </span>
                            {row.result.subtitle && (
                              <CommandItemDetail className="block">
                                {row.result.subtitle}
                              </CommandItemDetail>
                            )}
                          </span>
                          <CommandItemKind>
                            {kindLabel(row.result)}
                          </CommandItemKind>
                        </>
                      ) : (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{row.title}</span>
                          {row.subtitle && (
                            <CommandItemDetail className="block">
                              {row.subtitle}
                            </CommandItemDetail>
                          )}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          ) : (
            <>
              {results.length === 0 &&
                matchedSettings.length === 0 &&
                matchedActions.length === 0 &&
                commandCandidates.length === 0 && (
                  <CommandEmpty>No results</CommandEmpty>
                )}
              {matchedActions.length > 0 &&
                actionGroups(matchedActions).map(([group, groupCommands]) => (
                  <CommandGroup key={group} heading={group}>
                    {groupCommands.map((command) => (
                      <CommandItem
                        key={command.id}
                        value={command.id}
                        onSelect={() => runCommandRow(command)}
                      >
                        <command.palette.icon />
                        <span className="truncate">{command.label}</span>
                        {commandShortcut(command)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              {commandCandidates.length > 0 && (
                <CommandGroup heading="Commands">
                  {commandCandidates.map((command) => (
                    <CommandItem
                      key={`command-${command.id}`}
                      value={`command-${command.id}`}
                      onSelect={() => pickCommandCandidate(command)}
                    >
                      <command.icon />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {command.prefix.trim()}…
                        </span>
                        <CommandItemDetail className="block">
                          {command.description}
                        </CommandItemDetail>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {(matchedSettings.length > 0 || results.length > 0) && (
                <CommandGroup heading="Results">
                  {/* A setting matches at once; the project's results follow
                      when their search answers, below rather than above. */}
                  {matchedSettings.map((setting) => (
                    <CommandItem
                      key={`setting-${setting.key}`}
                      value={`setting-${setting.key}`}
                      onSelect={() => go(setting.href)}
                    >
                      <IconSettings />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          Setting · {setting.label}
                        </span>
                        <CommandItemDetail className="block">
                          {setting.group}
                        </CommandItemDetail>
                      </span>
                    </CommandItem>
                  ))}
                  {results.map((result) => (
                    <CommandItem
                      key={`${result.type}-${result.id}-${result.matchedField}`}
                      value={`${result.type}-${result.id}-${result.matchedField}`}
                      onSelect={() => openResult(result)}
                    >
                      <ArtSwatch artwork={result.image} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{result.title}</span>
                          {result.archived && <ArchivedFlag />}
                        </span>
                        {(result.subtitle || result.snippet) && (
                          <CommandItemDetail className="block">
                            {result.subtitle && result.snippet
                              ? `${result.subtitle} · ${result.snippet}`
                              : result.subtitle || result.snippet}
                          </CommandItemDetail>
                        )}
                      </span>
                      <CommandItemKind>{kindLabel(result)}</CommandItemKind>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
