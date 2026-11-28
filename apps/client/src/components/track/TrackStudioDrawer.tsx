"use client";

import { setSessionMain } from "@/actions/sessions";
import { useOpenDeepLink } from "@/components/deep-link/DeepLinkProvider";
import { AppLink } from "@/components/navigation/AppLink";
import { SessionPicker } from "@/components/product-linking/pickers";
import { LastPushLine } from "@/components/repo/LastPush";
import { CompareControls } from "@/components/session/CompareControls";
import { HistoryRuler } from "@/components/session/HistoryRuler";
import { ShowCheckpointsToggle } from "@/components/session/LogControls";
import { OpenInDawButton } from "@/components/session/OpenInDawButton";
import {
  SessionCommitLog,
  SessionSaveLog,
} from "@/components/session/SessionCommitLog";
import { SessionSamples } from "@/components/session/SessionSamples";
import {
  holderOfSession,
  openInDawTarget,
} from "@/components/session/open-in-daw";
import { registerTrackStudioActions } from "@/components/track/track-studio-bridge";
import { ENTITY_API } from "@/entities/api";
import { useParamWriter } from "@/hooks/use-param-writer";
import { browserApi } from "@/lib/browser-api";
import {
  clientGetProjectSamples,
  clientGetSession,
  clientGetSessionCommits,
  clientGetSessionPresence,
  clientGetSessionSaves,
  clientGetTrackRepos,
  clientGetTrackSessions,
} from "@/lib/client-api";
import { dawCanReport, structureEmptyLabel } from "@/lib/daw";
import { useFeedbackPolicy, useShellPolicy } from "@/lib/policies/provider";
import { confirmPolicy } from "@/lib/policies/shell";
import { latestSaveInfo } from "@/lib/save-before";
import { hrefFromParsedRoute } from "@/lib/utils";
import {
  IconCheck,
  IconChevronDown,
  IconDots,
  IconExternalLink,
  IconLink,
  IconLinkOff,
  IconPencil,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
import type {
  GetSession,
  GetTrack,
  MachinePresence,
  Repo,
  SampleUsage,
  SaveMeta,
  Session,
  SessionCommit,
  SessionSave,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useFormat } from "@workspace/ui/components/format-provider";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Input } from "@workspace/ui/components/input";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  SaveDiffCard,
  stampOf,
} from "@workspace/ui/components/session-structure/save-diff-card";
import {
  SaveDiffControls,
  SaveDiffModeSwitch,
  SaveDiffStepper,
} from "@workspace/ui/components/session-structure/save-diff-controls";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHandle,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { isBlankStoredDocument } from "@workspace/ui/lib/block-document";
import {
  buildCommits,
  FIRST_COMMITS,
  foldLog,
  knownSaves,
  LOG_BRANCH,
  MOST_COMMITS,
  uncommittedSaves,
} from "@workspace/ui/lib/commit-log";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { changedTrackCount, diffSave } from "@workspace/session-diff";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

type StudioTab = "overview" | "history" | "gear";
const VALID_TABS = new Set<StudioTab>(["overview", "history", "gear"]);
const HISTORY_SAVES_LIMIT = 500;
const EMPTY_SAVES: SessionSave[] = [];
const EMPTY_COMMITS: SessionCommit[] = [];

function parseTab(raw: string | null): StudioTab | null {
  if (!raw) return null;
  return VALID_TABS.has(raw as StudioTab) ? (raw as StudioTab) : "overview";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function notePreview(notes: GetSession["notes"]): string {
  if (!notes || isBlankStoredDocument(notes)) return "";
  const lines: string[] = [];
  for (const block of notes) {
    const content = block.content;
    if (Array.isArray(content)) {
      const text = content
        .map((node) =>
          typeof node === "object" && node !== null && "text" in node
            ? String((node as { text?: unknown }).text ?? "")
            : ""
        )
        .join("")
        .trim();
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}

function extractDevices(structure: GetSession["structure"]) {
  if (!structure?.tracks) return { thirdParty: [], builtins: [] };
  const counts = new Map<string, number>();
  for (const track of structure.tracks) {
    for (const dev of track.devices ?? []) {
      counts.set(dev, (counts.get(dev) ?? 0) + 1);
    }
  }
  const pluginsMap = structure.plugins ?? {};
  const thirdParty: { name: string; count: number; meta?: string }[] = [];
  const builtins: { name: string; count: number }[] = [];
  for (const [name, count] of counts) {
    const info = pluginsMap[name];
    if (info) {
      thirdParty.push({
        name,
        count,
        meta: [info.manufacturer, info.host].filter(Boolean).join(" · "),
      });
    } else {
      builtins.push({ name, count });
    }
  }
  thirdParty.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  builtins.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { thirdParty, builtins };
}

export function TrackStudioDrawer({
  projectId,
  trackId,
  collectionId,
  trackTitle,
  studio,
  canEdit,
  viewerId,
}: {
  projectId: number;
  trackId: number;
  collectionId?: number;
  trackTitle: string;
  studio: GetTrack["studio"];
  canEdit: boolean;
  viewerId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { write } = useParamWriter({ shallow: true });
  const isMobile = useIsMobile();
  const format = useFormat();
  const shell = useShellPolicy();
  const feedback = useFeedbackPolicy();
  const openDeepLink = useOpenDeepLink();

  const studioTab = parseTab(searchParams.get("studio"));
  const open = studioTab !== null;
  const activeTab: StudioTab = studioTab ?? "overview";

  const requestedSessionId = Number(searchParams.get("session"));
  const activeSessionId =
    Number.isInteger(requestedSessionId) && requestedSessionId > 0
      ? requestedSessionId
      : (studio.mainSession?.id ?? null);

  const fromId = Number(searchParams.get("from")) || undefined;
  const toIdParam = Number(searchParams.get("to")) || undefined;
  const showCheckpoints = searchParams.get("checkpoints") === "1";

  const [sessionsList, setSessionsList] = useState<Session[] | null>(null);
  const [sessionDetail, setSessionDetail] = useState<GetSession | null>(null);
  const [presence, setPresence] = useState<MachinePresence[]>([]);
  const [saves, setSaves] = useState<SessionSave[]>([]);
  const [commits, setCommits] = useState<SessionCommit[]>([]);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [projectSamples, setProjectSamples] = useState<
    SampleUsage[] | undefined
  >(undefined);
  const [loadedSaves, setLoadedSaves] = useState<{
    sessionId: number;
    full: boolean;
  } | null>(null);
  const [loadedGearFor, setLoadedGearFor] = useState<number | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [builtinsOpen, setBuiltinsOpen] = useState(false);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [, startTransition] = useTransition();

  const closeDrawer = useCallback(() => {
    write({
      studio: null,
      session: null,
      from: null,
      to: null,
      checkpoints: null,
    });
  }, [write]);

  const openStudio = useCallback(
    (tab: StudioTab = "overview") => {
      write({
        studio: tab,
        session: activeSessionId != null ? String(activeSessionId) : null,
      });
    },
    [write, activeSessionId]
  );

  // `w` opens the Studio drawer on Track pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key !== "w" ||
        isEditableTarget(event.target) ||
        open
      ) {
        return;
      }
      event.preventDefault();
      openStudio("overview");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openStudio]);

  const mainSessionId = studio.mainSession?.id ?? null;
  const holder = useMemo(() => holderOfSession(presence), [presence]);
  const mainTarget = useMemo(() => {
    if (mainSessionId == null) return null;
    const { href } = openInDawTarget(mainSessionId, holder);
    return href ? () => openDeepLink(href) : null;
  }, [mainSessionId, holder, openDeepLink]);

  useEffect(() => {
    return registerTrackStudioActions({
      openStudio: () => openStudio("overview"),
      openInDaw: mainTarget,
    });
  }, [openStudio, mainTarget]);

  // Zero fetches while closed: load track sessions + active session only when open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      clientGetTrackSessions(trackId),
      clientGetTrackRepos(trackId),
    ]).then(([sessRes, reposRes]) => {
      if (cancelled) return;
      if (!isActionError(sessRes)) setSessionsList(sessRes);
      if (!isActionError(reposRes)) setRepos(reposRes);
    });
    return () => {
      cancelled = true;
    };
  }, [open, trackId]);

  useEffect(() => {
    if (!open || activeSessionId == null) return;
    let cancelled = false;
    void Promise.all([
      clientGetSession(activeSessionId),
      clientGetSessionPresence(activeSessionId),
    ]).then(([detailRes, presenceRes]) => {
      if (cancelled) return;
      if (!isActionError(detailRes)) setSessionDetail(detailRes);
      setPresence(presenceRes);
      setNowIso(new Date().toISOString());
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeSessionId]);

  // Load the overview slice (8 saves / FIRST_COMMITS) on overview/gear, or
  // upgrade once to full history when History is opened.
  useEffect(() => {
    if (!open || activeSessionId == null) return;
    const needFull = activeTab === "history";
    const alreadyLoaded =
      loadedSaves?.sessionId === activeSessionId &&
      (!needFull || loadedSaves.full);
    if (alreadyLoaded) return;

    let cancelled = false;
    void Promise.all([
      clientGetSessionSaves(
        activeSessionId,
        needFull ? HISTORY_SAVES_LIMIT : 8
      ),
      clientGetSessionCommits(activeSessionId, {
        branch: LOG_BRANCH,
        limit: needFull ? MOST_COMMITS : FIRST_COMMITS,
      }),
    ]).then(([savesRes, commitsRes]) => {
      if (cancelled) return;
      setSaves((prev) =>
        !isActionError(savesRes)
          ? savesRes
          : loadedSaves?.sessionId === activeSessionId
            ? prev
            : EMPTY_SAVES
      );
      setCommits((prev) =>
        !isActionError(commitsRes)
          ? commitsRes
          : loadedSaves?.sessionId === activeSessionId
            ? prev
            : EMPTY_COMMITS
      );
      setLoadedSaves({ sessionId: activeSessionId, full: needFull });
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, activeSessionId, loadedSaves]);

  // Lazy load project samples when Gear & Samples tab opens.
  useEffect(() => {
    if (
      !open ||
      activeTab !== "gear" ||
      activeSessionId == null ||
      loadedGearFor === projectId
    ) {
      return;
    }
    let cancelled = false;
    void clientGetProjectSamples(projectId).then((res) => {
      if (cancelled) return;
      if (!isActionError(res)) setProjectSamples(res);
      setLoadedGearFor(projectId);
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, activeSessionId, projectId, loadedGearFor]);

  const currentHref = useMemo(() => {
    const qs = new URLSearchParams(searchParams.toString());
    return qs.size > 0 ? `${pathname}?${qs.toString()}` : pathname;
  }, [pathname, searchParams]);

  const refreshTrackSessions = useCallback(async () => {
    const res = await clientGetTrackSessions(trackId);
    if (!isActionError(res)) setSessionsList(res);
    router.refresh();
  }, [trackId, router]);

  const handleSetMain = (nextMain: boolean) => {
    if (activeSessionId == null) return;
    startTransition(async () => {
      const res = await setSessionMain(activeSessionId, nextMain);
      if (isActionError(res)) {
        toast.error(res.error);
        return;
      }
      setSessionDetail((prev) => (prev ? { ...prev, main: nextMain } : prev));
      await refreshTrackSessions();
    });
  };

  const handleUnlink = async () => {
    if (activeSessionId == null) return;
    const res = await ENTITY_API.session.patch(browserApi, activeSessionId, {
      trackId: null,
      main: false,
    });
    if (isActionError(res)) {
      toast.error(res.error);
      return;
    }
    toast("Unlinked from track");
    const remaining = (sessionsList ?? []).filter(
      (s) => s.id !== activeSessionId
    );
    setSessionsList(remaining);
    if (remaining[0]) {
      write({ session: String(remaining[0].id) });
    } else {
      closeDrawer();
    }
    router.refresh();
  };

  const handleDelete = async () => {
    if (activeSessionId == null) return;
    const res = await ENTITY_API.session.remove(browserApi, activeSessionId);
    if (isActionError(res)) {
      toast.error(res.error);
      return;
    }
    toast("Session deleted");
    setDeleteDialogOpen(false);
    const remaining = (sessionsList ?? []).filter(
      (s) => s.id !== activeSessionId
    );
    setSessionsList(remaining);
    if (remaining[0]) {
      write({ session: String(remaining[0].id) });
    } else {
      closeDrawer();
    }
    router.refresh();
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeSessionId == null || !editName.trim()) return;
    const res = await ENTITY_API.session.patch(browserApi, activeSessionId, {
      name: editName.trim(),
    });
    if (isActionError(res)) {
      toast.error(res.error);
      return;
    }
    setSessionDetail((prev) =>
      prev ? { ...prev, name: editName.trim() } : prev
    );
    setEditDialogOpen(false);
    await refreshTrackSessions();
  };

  const session =
    open && activeSessionId != null && sessionDetail?.id === activeSessionId
      ? sessionDetail
      : null;
  const loadingSession = open && activeSessionId != null && session == null;
  const savesReady = loadedSaves?.sessionId === activeSessionId;
  const sessionSaves = savesReady ? saves : EMPTY_SAVES;
  const sessionCommits = savesReady ? commits : EMPTY_COMMITS;
  const loadingHistory =
    open &&
    activeTab === "history" &&
    activeSessionId != null &&
    !(savesReady && loadedSaves.full);
  const dawDisplayName =
    session?.dawName ??
    session?.daw ??
    studio.mainSession?.dawName ??
    studio.mainSession?.daw ??
    "DAW";

  const { savedAt, previous } = useMemo(() => {
    if (!session) return { savedAt: null, previous: undefined };
    return latestSaveInfo(session, sessionSaves);
  }, [session, sessionSaves]);

  const latestSaveDiff = useMemo(() => {
    if (!session) return null;
    const samplePaths = session.samples?.map((s) => s.path) ?? [];
    const sessionAsMeta: SaveMeta = {
      tempo: session.tempo,
      timeSignature: session.timeSignature,
      rootNote: session.rootNote,
      scale: session.scale,
      tracksCount: session.tracksCount,
      scenesCount: session.scenesCount,
      dawVersion: session.dawVersion,
      samplePaths,
      structure: session.structure,
    };
    const comparable = previous?.meta != null;
    return {
      diff: diffSave(
        comparable ? previous.meta : null,
        sessionAsMeta,
        session.dawCapabilities,
        format
      ),
      saves: {
        before: comparable ? stampOf(previous) : null,
        after: {
          at: savedAt ?? session.updatedAt,
          machine: session.localFileMachineName ?? null,
        },
      },
    };
  }, [session, previous, savedAt, format]);

  const historyData = useMemo(() => {
    if (!session) return null;
    const known = knownSaves(sessionSaves, sessionCommits);
    const byId = new Map(known.map((s, idx) => [s.id, idx]));
    const toId =
      toIdParam != null && byId.has(toIdParam) ? toIdParam : undefined;
    let resolvedFromId =
      fromId != null && byId.has(fromId) ? fromId : undefined;
    if (toId != null) {
      const toIndex = byId.get(toId)!;
      if (resolvedFromId != null && byId.get(resolvedFromId)! <= toIndex) {
        resolvedFromId = undefined;
      }
      if (resolvedFromId == null) resolvedFromId = known[toIndex + 1]?.id;
    }
    const toSave = toId != null ? known[byId.get(toId)!] : undefined;
    const fromSave =
      resolvedFromId != null ? known[byId.get(resolvedFromId)!] : undefined;
    const comparable = fromSave?.meta != null;
    const compareDiff =
      toSave?.meta != null
        ? diffSave(
            comparable ? fromSave.meta : null,
            toSave.meta as SaveMeta,
            session.dawCapabilities,
            format
          )
        : undefined;
    const logCommits = buildCommits({
      commits: sessionCommits,
      saves: sessionSaves,
      capabilities: session.dawCapabilities,
      format,
    });
    const entries = foldLog(logCommits, showCheckpoints);
    const uncommitted = uncommittedSaves({
      commits: sessionCommits,
      saves: sessionSaves,
      capabilities: session.dawCapabilities,
      format,
    });
    const hasCheckpoints = logCommits.some((c) => c.kind === "checkpoint");
    const commitOfSave = new Map(logCommits.map((c) => [c.saveId, c.message]));
    const compareOptions = known.map((s) => {
      const when = format.dateTime(s.fileUpdatedAt);
      const named = commitOfSave.get(s.id);
      return { id: s.id, label: named ? `${when} · ${named}` : when };
    });
    return {
      toId,
      fromId: resolvedFromId,
      toSave,
      fromSave,
      comparable,
      compareDiff,
      logCommits,
      entries,
      uncommitted,
      hasCheckpoints,
      compareOptions,
    };
  }, [
    session,
    sessionSaves,
    sessionCommits,
    toIdParam,
    fromId,
    showCheckpoints,
    format,
  ]);

  const activeRepo = useMemo(
    () =>
      repos?.find((r) => r.id === session?.repoId) ??
      (session?.repoId != null ? repos?.[0] : undefined),
    [repos, session?.repoId]
  );

  const devices = useMemo(
    () => extractDevices(session?.structure ?? null),
    [session?.structure]
  );

  const sessionsForPicker = sessionsList ?? [];
  const standaloneHref =
    activeSessionId != null
      ? `${hrefFromParsedRoute(
          {
            kind: "session",
            sessionId: activeSessionId,
            trackId,
            collectionId,
          },
          projectId
        )}?standalone=1`
      : null;

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && closeDrawer()}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "flex flex-col p-0",
            isMobile
              ? "max-h-[88dvh]"
              : "w-full sm:max-w-[40rem] lg:max-w-[46rem]"
          )}
        >
          {isMobile && <SheetHandle />}
          <SheetHeader className="border-b border-rule px-6 py-4 pr-12">
            <div className="flex items-center gap-2">
              {studio.openOn != null && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-art ring-2 ring-art/25"
                />
              )}
              <span className={cn(LABEL, "text-ink-soft")}>STUDIO / DAW</span>
              <span className="text-micro text-ink-faint">· {trackTitle}</span>
            </div>

            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                {sessionsForPicker.length >= 2 && activeSessionId != null ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={String(activeSessionId)}
                      onValueChange={(val) =>
                        write({ session: val, from: null, to: null })
                      }
                      items={sessionsForPicker.map((s) => ({
                        value: String(s.id),
                        label: s.main ? `${s.name} (Main)` : s.name,
                      }))}
                    >
                      <SelectTrigger className="max-w-72 text-body font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sessionsForPicker.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.main ? `${s.name} (Main)` : s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <IconPlus data-icon="inline-start" />
                            Set
                            <IconChevronDown data-icon="inline-end" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem
                            onSelect={() => setLinkDialogOpen(true)}
                          >
                            <IconLink />
                            Link existing set…
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <AppLink
                              href={hrefFromParsedRoute(
                                {
                                  kind: "session-new",
                                  collectionId,
                                  trackId,
                                },
                                projectId
                              )}
                            >
                              <IconPlus />
                              New manual session
                            </AppLink>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                ) : (
                  <SheetTitle className="truncate text-lead">
                    {session?.name ?? studio.mainSession?.name ?? "No DAW set"}
                  </SheetTitle>
                )}
                <SheetDescription className="sr-only">
                  Inspect linked DAW set details, save history, plugins, and
                  samples for {trackTitle}.
                </SheetDescription>
              </div>

              {activeSessionId != null && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <OpenInDawButton
                    sessionId={activeSessionId}
                    holder={holder}
                  />
                  {canEdit ? (
                    <Button
                      variant={session?.main ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => handleSetMain(!session?.main)}
                      aria-pressed={session?.main ?? false}
                    >
                      {session?.main ? (
                        <>
                          <IconStarFilled data-icon="inline-start" />
                          Main set
                        </>
                      ) : (
                        <>
                          <IconStar data-icon="inline-start" />
                          Make main
                        </>
                      )}
                    </Button>
                  ) : (
                    session?.main && (
                      <span className="inline-flex items-center gap-1 px-2 text-micro text-ink-soft">
                        <IconStarFilled className="size-3.5 text-ink" />
                        Main set
                      </span>
                    )
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        variant="icon"
                        size="touch"
                        aria-label="Session actions"
                      >
                        <IconDots />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {standaloneHref && (
                        <DropdownMenuItem asChild>
                          <AppLink href={standaloneHref}>
                            <IconExternalLink />
                            Open full session page ↗
                          </AppLink>
                        </DropdownMenuItem>
                      )}
                      {canEdit && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditName(session?.name ?? "");
                              setEditDialogOpen(true);
                            }}
                          >
                            <IconPencil />
                            Edit set details
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={handleUnlink}>
                            <IconLinkOff />
                            Unlink from this track
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              if (confirmPolicy("session", feedback)) {
                                setDeleteDialogOpen(true);
                              } else {
                                void handleDelete();
                              }
                            }}
                          >
                            <IconTrash />
                            Delete session
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </SheetHeader>

          {activeSessionId == null ? (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 px-6 py-10">
              <p className="text-body text-ink-soft">
                No DAW set is linked to {trackTitle} yet.
              </p>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setLinkDialogOpen(true)}
                  >
                    <IconLink data-icon="inline-start" />
                    Link existing set…
                  </Button>
                  <Button variant="ghost" asChild>
                    <AppLink
                      href={hrefFromParsedRoute(
                        { kind: "session-new", collectionId, trackId },
                        projectId
                      )}
                    >
                      <IconPlus data-icon="inline-start" />
                      New manual session
                    </AppLink>
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(next) =>
                write({ studio: next, from: null, to: null })
              }
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="border-b border-rule px-6">
                <TabsList variant="line">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="gear">Gear &amp; Samples</TabsTrigger>
                </TabsList>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                {loadingSession && !session ? (
                  <div className="flex items-center justify-center py-12">
                    <Spinner />
                  </div>
                ) : !session ? (
                  <p className="text-small text-ink-soft">
                    Could not load session details.
                  </p>
                ) : (
                  <>
                    <TabsContent value="overview" className="space-y-8">
                      <section className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                        <div>
                          <p className={cn(LABEL, "text-ink-faint")}>DAW</p>
                          <MetadataItem>
                            {session.dawVersion ?? dawDisplayName}
                          </MetadataItem>
                        </div>
                        {dawCanReport(session, "tempo") && (
                          <div>
                            <p className={cn(LABEL, "text-ink-faint")}>BPM</p>
                            <MetadataItem>
                              {session.tempo != null
                                ? format.tempo(session.tempo, { unit: true })
                                : "—"}
                            </MetadataItem>
                          </div>
                        )}
                        {dawCanReport(session, "key") && (
                          <div>
                            <p className={cn(LABEL, "text-ink-faint")}>KEY</p>
                            <MetadataItem>
                              {format.key(session.rootNote, session.scale) ??
                                "—"}
                            </MetadataItem>
                          </div>
                        )}
                        {dawCanReport(session, "timeSignature") && (
                          <div>
                            <p className={cn(LABEL, "text-ink-faint")}>
                              TIME SIG
                            </p>
                            <MetadataItem>
                              {session.timeSignature ?? "—"}
                            </MetadataItem>
                          </div>
                        )}
                        {dawCanReport(session, "structure") && (
                          <div>
                            <p className={cn(LABEL, "text-ink-faint")}>
                              TRACKS
                            </p>
                            <MetadataItem>
                              {session.tracksCount ?? "—"}
                            </MetadataItem>
                          </div>
                        )}
                        {session.history.timeInSet > 0 && (
                          <div>
                            <p className={cn(LABEL, "text-ink-faint")}>
                              TIME IN SET
                            </p>
                            <MetadataItem>
                              {format.timeInSet(session.history.timeInSet)}
                            </MetadataItem>
                          </div>
                        )}
                      </section>

                      {session.structure && latestSaveDiff ? (
                        <section>
                          <SectionHead count={session.structure.tracks.length}>
                            STRUCTURE
                          </SectionHead>
                          <SaveDiffControls
                            key={`${previous?.id ?? "first"}:${savedAt ?? "none"}`}
                            changes={changedTrackCount(
                              latestSaveDiff.diff.structure
                            )}
                            defaultMode="whole"
                          >
                            <SaveDiffCard
                              diff={latestSaveDiff.diff}
                              saves={latestSaveDiff.saves}
                              daw={session.dawVersion ?? dawDisplayName}
                              format={format}
                              actions={
                                <>
                                  <SaveDiffModeSwitch />
                                  <SaveDiffStepper />
                                </>
                              }
                            />
                          </SaveDiffControls>
                        </section>
                      ) : (
                        <p className="text-small text-ink-soft">
                          {structureEmptyLabel(session)}
                        </p>
                      )}

                      {activeRepo && (
                        <section className="space-y-2 border-t border-rule pt-5">
                          <SectionHead
                            action={
                              <AppLink
                                href={hrefFromParsedRoute(
                                  { kind: "repo", repoId: activeRepo.id },
                                  projectId
                                )}
                                className="text-micro text-ink-soft hover:text-ink"
                              >
                                Open repository →
                              </AppLink>
                            }
                          >
                            REPOSITORY
                          </SectionHead>
                          <div className="flex flex-wrap items-baseline justify-between gap-2 text-small">
                            <span className="text-ink">
                              {activeRepo.name} · main
                            </span>
                            <span className="text-ink-soft tabular-nums">
                              {format.bytes(
                                activeRepo.storage.setBytes +
                                  activeRepo.storage.sampleBytes,
                                1
                              )}
                            </span>
                          </div>
                          <p className="text-micro text-ink-soft">
                            <LastPushLine
                              repo={activeRepo}
                              format={format}
                              viewerId={viewerId}
                            />
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {sessionCommits[0] && (
                              <Button variant="outline" size="sm" asChild>
                                <a
                                  href={`/api/commits/${sessionCommits[0].id}/set`}
                                  download
                                >
                                  Download set
                                </a>
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" asChild>
                              <a
                                href={`/api/repos/${activeRepo.id}/archive`}
                                download
                              >
                                Download repo
                              </a>
                            </Button>
                          </div>
                        </section>
                      )}

                      {(notePreview(session.notes) ||
                        session.attachments.length > 0) && (
                        <Collapsible
                          open={notesOpen}
                          onOpenChange={setNotesOpen}
                          className="border-t border-rule pt-4"
                        >
                          <CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-small text-ink-soft hover:text-ink">
                            <CollapsibleChevron />
                            <span>
                              Session notes &amp; attachments (
                              {session.attachments.length})
                            </span>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-3 pt-3 text-small">
                            {notePreview(session.notes) && (
                              <p className="whitespace-pre-wrap text-ink-soft">
                                {notePreview(session.notes)}
                              </p>
                            )}
                            {session.attachments.length > 0 && (
                              <Rows as="ul">
                                {session.attachments.map((att) => (
                                  <Row as="li" key={att.id}>
                                    <RowMain>
                                      <RowTitle>{att.name}</RowTitle>
                                    </RowMain>
                                    <span className="text-micro text-ink-soft tabular-nums">
                                      {format.bytes(att.size, 1)}
                                    </span>
                                  </Row>
                                ))}
                              </Rows>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </TabsContent>

                    <TabsContent value="history" className="space-y-6">
                      {loadingHistory ? (
                        <div className="flex items-center justify-center py-10">
                          <Spinner />
                        </div>
                      ) : !historyData || session.saveCount === 0 ? (
                        <p className="text-small text-ink-soft">
                          No saves recorded yet.
                        </p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-micro text-ink-soft tabular-nums">
                              {session.history.commits} commits ·{" "}
                              {session.history.saves} saves
                              {session.history.timeInSet > 0
                                ? ` · ${format.timeInSet(session.history.timeInSet)}`
                                : ""}
                            </p>
                            {historyData.hasCheckpoints && (
                              <ShowCheckpointsToggle
                                shown={showCheckpoints}
                                shallow
                              />
                            )}
                          </div>

                          <HistoryRuler
                            commits={historyData.logCommits.map(
                              ({
                                id,
                                kind,
                                message,
                                authorName,
                                machineName,
                                committedAt,
                                saveId,
                                baselineSaveId,
                              }) => ({
                                id,
                                kind,
                                message,
                                authorName,
                                machineName,
                                committedAt,
                                saveId,
                                baselineSaveId,
                              })
                            )}
                            saves={sessionSaves.map(
                              ({ id, fileUpdatedAt, machineName }) => ({
                                id,
                                fileUpdatedAt,
                                machineName,
                              })
                            )}
                            marked={{
                              from: historyData.fromId,
                              to: historyData.toId,
                            }}
                            historyHref={currentHref}
                            now={nowIso}
                          />

                          {historyData.compareDiff && historyData.toSave && (
                            <section>
                              <SectionHead>COMPARING</SectionHead>
                              <SaveDiffControls
                                key={`${historyData.fromSave?.id ?? "first"}:${historyData.toSave.id}`}
                                changes={changedTrackCount(
                                  historyData.compareDiff.structure
                                )}
                                defaultMode="changes"
                              >
                                <SaveDiffCard
                                  diff={historyData.compareDiff}
                                  saves={{
                                    before:
                                      historyData.comparable &&
                                      historyData.fromSave
                                        ? stampOf(historyData.fromSave)
                                        : null,
                                    after: stampOf(historyData.toSave),
                                  }}
                                  daw={
                                    historyData.toSave.meta?.dawVersion ??
                                    dawDisplayName
                                  }
                                  format={format}
                                  when={
                                    <CompareControls
                                      options={historyData.compareOptions}
                                      fromId={historyData.fromId}
                                      toId={historyData.toId}
                                      shallow
                                    />
                                  }
                                  actions={
                                    <>
                                      <SaveDiffModeSwitch />
                                      <SaveDiffStepper />
                                    </>
                                  }
                                />
                              </SaveDiffControls>
                            </section>
                          )}

                          <section>
                            <SectionHead>LOG</SectionHead>
                            {sessionCommits.length === 0 ? (
                              <SessionSaveLog
                                saves={historyData.uncommitted}
                                historyHref={currentHref}
                                retentionDays={
                                  session.history.contentRetentionDays
                                }
                                format={format}
                                marked={{
                                  from: historyData.fromId,
                                  to: historyData.toId,
                                }}
                              />
                            ) : (
                              <SessionCommitLog
                                entries={historyData.entries}
                                uncommitted={historyData.uncommitted}
                                historyHref={currentHref}
                                canEdit={canEdit}
                                restoreOn={holder?.name ?? null}
                                retentionDays={
                                  session.history.contentRetentionDays
                                }
                                format={format}
                                marked={{
                                  from: historyData.fromId,
                                  to: historyData.toId,
                                }}
                              />
                            )}
                          </section>
                        </>
                      )}
                    </TabsContent>

                    <TabsContent value="gear" className="space-y-8">
                      <section className="space-y-3">
                        <SectionHead count={devices.thirdParty.length}>
                          PLUGINS &amp; DEVICES
                        </SectionHead>
                        {devices.thirdParty.length === 0 &&
                        devices.builtins.length === 0 ? (
                          <p className="text-small text-ink-soft">
                            No devices recorded in this set yet.
                          </p>
                        ) : (
                          <>
                            {devices.thirdParty.length > 0 && (
                              <Rows as="ul">
                                {devices.thirdParty.map((plugin) => (
                                  <Row as="li" key={plugin.name}>
                                    <RowMain>
                                      <RowTitle>
                                        <AppLink
                                          href={`${hrefFromParsedRoute(
                                            { kind: "plugins" },
                                            projectId
                                          )}?device=${encodeURIComponent(
                                            plugin.name
                                          )}`}
                                          className="hover:underline"
                                        >
                                          {plugin.name}
                                        </AppLink>
                                      </RowTitle>
                                      {plugin.meta && (
                                        <RowMeta>{plugin.meta}</RowMeta>
                                      )}
                                    </RowMain>
                                    <span className="text-micro text-ink-soft tabular-nums">
                                      {plugin.count}{" "}
                                      {plugin.count === 1 ? "track" : "tracks"}
                                    </span>
                                  </Row>
                                ))}
                              </Rows>
                            )}
                            {devices.builtins.length > 0 && (
                              <Collapsible
                                open={builtinsOpen}
                                onOpenChange={setBuiltinsOpen}
                              >
                                <CollapsibleTrigger className="flex items-center gap-2 text-small text-ink-soft hover:text-ink">
                                  <CollapsibleChevron />
                                  <span>
                                    {devices.builtins.length} built-in{" "}
                                    {devices.builtins.length === 1
                                      ? "device"
                                      : "devices"}
                                  </span>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-2">
                                  <Rows as="ul">
                                    {devices.builtins.map((dev) => (
                                      <Row as="li" key={dev.name}>
                                        <RowMain>
                                          <RowTitle>
                                            <AppLink
                                              href={`${hrefFromParsedRoute(
                                                { kind: "plugins" },
                                                projectId
                                              )}?device=${encodeURIComponent(
                                                dev.name
                                              )}`}
                                              className="hover:underline"
                                            >
                                              {dev.name}
                                            </AppLink>
                                          </RowTitle>
                                        </RowMain>
                                        <span className="text-micro text-ink-soft tabular-nums">
                                          {dev.count}{" "}
                                          {dev.count === 1 ? "track" : "tracks"}
                                        </span>
                                      </Row>
                                    ))}
                                  </Rows>
                                </CollapsibleContent>
                              </Collapsible>
                            )}
                          </>
                        )}
                      </section>

                      {(dawCanReport(session, "samplePaths") ||
                        session.repoId != null) &&
                        (session.samples?.length ?? 0) > 0 && (
                          <SessionSamples
                            session={session}
                            usage={projectSamples}
                            defaults={shell.inventoryDefaults.samples}
                          />
                        )}
                    </TabsContent>
                  </>
                )}
              </div>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link existing DAW set</DialogTitle>
          </DialogHeader>
          <SessionPicker trackId={trackId} />
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename DAW set</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Set name"
              autoFocus={!isMobile}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!editName.trim()}>
                <IconCheck data-icon="inline-start" />
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &ldquo;{session?.name}&rdquo; and its
              recorded save history from Projammr.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
