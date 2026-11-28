"use client";

import { NOW_PLAYING_SCOPE } from "@/components/commands/define";
import { useCommandScope } from "@/components/commands/provider";
import { ArtField } from "@/components/music-player/ArtField";
import { CoverMorph } from "@/components/music-player/CoverMorph";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { CurrentTrackRow } from "@/components/music-player/CurrentTrackRow";
import { useNowPlaying } from "@/components/music-player/now-playing-context";
import { ownerRoute } from "@/components/music-player/owners";
import {
  useAnalysis,
  useCurrentArt,
  useCurrentTrack,
  useLabAltering,
  usePlayerActions,
  useRoutedNotice,
  useUpcoming,
  useVolumeControllable,
} from "@/components/music-player/player-hooks";
import { LabView } from "@/components/lab/LabView";
import {
  MuteButton,
  Transport,
  VolumeSlider,
} from "@/components/music-player/PlayerControls";
import { LavaField } from "@/components/music-player/LavaField";
import { LiveLoudnessScale } from "@/components/loudness/LiveLoudnessScale";
import { LiveSpectrumScale } from "@/components/spectrum/LiveSpectrumScale";
import type { SpectrumCurve } from "@/components/spectrum/SpectrumScale";
import { useTrackAudioMeasure } from "@/components/track-audio/measures";
import { useFormat } from "@workspace/ui/components/format-provider";
import { spectrumWindow, type Spectrum } from "@workspace/dsp/spectrum";
import { Scrub } from "@/components/music-player/Scrub";
import { ENTITIES } from "@/entities";
import {
  artistLabel,
  trackLabel,
  type MusicPlayerTrack,
} from "@/components/music-player/types";
import { AppLink } from "@/components/navigation/AppLink";
import { VersionBadge } from "@/components/track-audio/VersionBadge";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { hrefFromParsedRoute, imageUrl } from "@/lib/utils";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconDotsVertical,
  IconPlaylist,
  IconVersions,
} from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useHaptics } from "@workspace/ui/components/haptics";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Logo } from "@workspace/ui/components/logo";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { AnimatePresence, LEAVE, m, OPTICAL } from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { TrackAudioWithAsset } from "@workspace/api/api";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { TrackAudioDropdown } from "@/components/track-audio/TrackAudioDropdown";
import { useVersionSwitch } from "@/components/track-audio/use-version-switch";

// The sortable list pulls in dnd-kit, which the view would otherwise carry for
// a pane most sessions never flip to.
const QueueList = dynamic(() => import("./QueueList"), {
  ssr: false,
  loading: () => (
    <div className={"flex justify-center py-4"}>
      <Spinner />
    </div>
  ),
});

/**
 * The view is a full-bleed screen at every width, on a phone and on a
 * desktop alike: the lava field behind it is the whole page, not a card's
 * background. The entrance follows — a surface that rises from the bottom
 * edge is the mini-player growing, which holds regardless of viewport size.
 *
 * The bottom safe area belongs to the content wrapper rather than the sheet,
 * which pads it together with the row that sits in it.
 */
const SHEET =
  "inset-0 isolate h-dvh overflow-hidden rounded-none border-0 pt-[env(safe-area-inset-top)] pb-0";

/**
 * The content column: full width on a phone, where there is no room to
 * spare, and centred to a media-player width above it so the art and
 * transport don't stretch across a desktop-width background.
 */
const CONTENT = cn(
  "mx-auto flex h-full min-h-0 w-full flex-col gap-3 px-(--gutter)",
  "pb-[calc(env(safe-area-inset-bottom)+1rem)] md:max-w-lg md:px-4 md:pb-4 lg:max-w-4xl"
);

/** The page the playing item came from, when it has one to go back to. */
const ownerHref = (track: MusicPlayerTrack | null) => {
  const route = track && ownerRoute(track);
  return route && track?.projectId != null
    ? hrefFromParsedRoute(route, track.projectId)
    : null;
};

/** The view's overflow: what it offers beyond playback, which is the way out
 *  to the page the playing item belongs to. Switching version is the
 *  secondary row's, so it is reached by one control rather than two. */
function OwnerMenu({
  current,
  href,
  onNavigate,
}: {
  current: MusicPlayerTrack;
  href: string;
  onNavigate: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size={"touch"} aria-label={"More"}>
          <IconDotsVertical />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={"end"} className={"w-48"}>
        <DropdownMenuItem asChild onSelect={onNavigate}>
          <AppLink href={href}>
            {`Go to ${ENTITIES[current.ownerType].nouns.singular}`}
          </AppLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The artwork at the size it was made for, or the panel that stands in for a
 *  track with none. */
function Cover({ cover }: { cover: string | undefined }) {
  const url = imageUrl(cover, 1024);
  const isPhone = useIsMobile();
  const { coverInSheet } = useNowPlaying();

  return (
    <div
      className={
        "mx-auto aspect-square w-full max-w-[42dvh] shrink-0 md:max-w-[26rem] lg:max-w-none"
      }
    >
      {url ? (
        // Until the cover has arrived — and again while it flies back to the
        // dock — the copy in the sheet stays out of sight.
        <CoverMorph active={isPhone && coverInSheet}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={""}
            className={cn(
              "size-full rounded-lg object-cover shadow-float",
              isPhone && !coverInSheet && "invisible"
            )}
          />
        </CoverMorph>
      ) : (
        <div
          className={
            "grid size-full place-items-center rounded-lg bg-paper-sunk"
          }
        >
          <span className={"text-title opacity-25"} aria-hidden>
            <Logo />
          </span>
        </div>
      )}
    </div>
  );
}

/** The playing track's identity: what it is, which version, and who by. */
function Identity({
  current,
  href,
  onNavigate,
  bare,
}: {
  current: MusicPlayerTrack;
  href: string | null;
  onNavigate: () => void;
  /** No artwork behind the type, so it sits on plain paper. */
  bare: boolean;
}) {
  const title = trackLabel(current);
  const byline = [artistLabel(current), current.album]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={"min-w-0 shrink-0"}>
      <p className={"truncate text-lead font-medium text-ink"}>
        {href ? (
          <AppLink
            href={href}
            onClick={onNavigate}
            className={"hover:underline"}
          >
            {title}
          </AppLink>
        ) : (
          title
        )}
        {current.trackAudio && (
          <VersionBadge
            version={current.trackAudio.version}
            active
            className={"ml-1.5 align-middle"}
          />
        )}
      </p>
      <p
        className={cn(
          "truncate text-small",
          bare ? "text-ink-soft" : "on-art-soft"
        )}
      >
        {byline}
      </p>
    </div>
  );
}

/**
 * The playing audio's level on the same ruler the track and collection rails
 * use: its integrated reading as a tick and caret when the server has
 * measured it, and the live meter running along it while it plays.
 */
function PlayingLoudness({
  current,
  bare,
}: {
  current: MusicPlayerTrack;
  bare: boolean;
}) {
  const lufs = current.trackAudio?.lufs ?? null;
  const version = current.trackAudio ? `v${current.trackAudio.version}` : null;
  const format = useFormat();

  // Opening the sheet asks for analysis the same way the rail's live meters
  // do; the engine is what turns that into nothing on a coarse pointer, so a
  // locked phone keeps playing whatever routed the graph, if anything did.
  useAnalysis();

  return (
    <LiveLoudnessScale
      owner={"any"}
      tone={bare ? "paper" : "art"}
      caption={"Loudness"}
      className={"shrink-0"}
      marks={
        lufs == null ? [] : [{ lufs, label: version ?? trackLabel(current) }]
      }
      pointer={lufs ?? undefined}
      label={
        lufs == null
          ? "Loudness meter"
          : `Integrated loudness ${format.lufs(lufs)} LUFS`
      }
    />
  );
}

/**
 * The playing audio's spectral balance on the same window the track and
 * collection rails use: its stored long-term average as a filled curve when
 * the server has measured it, and the live spectrum running over it. A queued
 * attachment or a session render has no version to have been measured, so it
 * draws the live line alone.
 *
 * Below `lg:` in a single-column stack, the spectrum is hidden when viewport
 * height is under 62.5rem so it does not squeeze the art; at `lg:` and above
 * the two-column layout places the meters beside the cover so both fit on
 * standard laptop screens.
 */
function PlayingSpectrum({
  current,
  bare,
}: {
  current: MusicPlayerTrack;
  bare: boolean;
}) {
  const stored = useTrackAudioMeasure<Spectrum>(
    current.trackAudio?.id ?? null,
    "spectrum"
  );
  const curves: SpectrumCurve[] = stored
    ? [
        {
          ...stored,
          label: current.trackAudio
            ? `v${current.trackAudio.version}`
            : trackLabel(current),
          emphasis: "selected",
        },
      ]
    : [];

  return (
    <LiveSpectrumScale
      owner={"any"}
      tone={bare ? "paper" : "art"}
      caption={"Spectrum"}
      className={"shrink-0 max-lg:[@media(height<62.5rem)]:hidden"}
      curves={curves}
      window={spectrumWindow(curves.map((curve) => curve.db))}
      label={
        stored
          ? "Spectrum, long-term average with the live level"
          : "Live spectrum"
      }
    />
  );
}

/**
 * The playing track at rest: its artwork, what it is and how loud. Stacks in
 * one column on narrower viewports and sits in two columns at `lg:` so the
 * art and both meters share the height cleanly.
 */
function PlayerPane({
  current,
  href,
  onNavigate,
  bare,
}: {
  current: MusicPlayerTrack | null;
  href: string | null;
  onNavigate: () => void;
  bare: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 grid-cols-1 content-center gap-4",
        "lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-center lg:gap-10"
      )}
    >
      <Cover cover={current?.cover} />
      {current ? (
        <div className={"flex min-w-0 flex-col gap-4"}>
          <Identity
            current={current}
            href={href}
            onNavigate={onNavigate}
            bare={bare}
          />
          <PlayingLoudness current={current} bare={bare} />
          <PlayingSpectrum current={current} bare={bare} />
        </div>
      ) : (
        <p className={"shrink-0 text-lead text-ink-soft"}>Nothing playing</p>
      )}
    </div>
  );
}

/**
 * What is playing and what follows it, with the reordering the queue affords.
 * Only the list scrolls, so the count and the current track stay in place
 * however long the queue is.
 */
function QueueView({ current }: { current: MusicPlayerTrack | null }) {
  const upcoming = useUpcoming();
  const { clear } = usePlayerActions();

  return (
    // A queue row is dragged up and down the list to reorder it, so the pane
    // keeps the pointers that land on it rather than losing them to the
    // dismissal the same movement would otherwise read as.
    <div
      className={"flex min-h-0 flex-1 flex-col gap-2"}
      data-base-ui-swipe-ignore
    >
      <div className={"flex shrink-0 items-center justify-between"}>
        <span className={cn(LABEL, "text-ink-soft")}>
          Up next ({upcoming.length})
        </span>
        <Button
          variant={"ghost"}
          size={"sm"}
          onClick={clear}
          disabled={!current && upcoming.length === 0}
        >
          Clear
        </Button>
      </div>

      {current && <CurrentTrackRow track={current} />}

      <div className={"min-h-0 flex-1 overflow-y-auto overscroll-contain"}>
        {upcoming.length > 0 ? (
          <QueueList size={"full"} />
        ) : (
          <p className={"py-6 text-center text-small text-ink-soft"}>
            Nothing queued
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The row under the transport: how loud, how fast, what is next, and — when
 * the playing track has more than one version — which version. These are the
 * settings a listener reaches for occasionally, so they sit a step quieter
 * than the transport and never take its space.
 */
function SecondaryRow({
  current,
  audios,
  available,
  onSelectVersion,
  onManageVersions,
}: {
  current: MusicPlayerTrack | null;
  audios: TrackAudioWithAsset[] | null;
  available: boolean;
  onSelectVersion: (audioId: number) => void;
  onManageVersions: () => void;
}) {
  const { view, setView } = useNowPlaying();
  const volumeControllable = useVolumeControllable();

  const showingQueue = view === "queue";
  const showingLab = view === "lab";
  // Anything actively altering the sound marks its button, so the player pane
  // says the record is not playing as mixed without opening the Lab.
  const labAltering = useLabAltering();

  return (
    <div className={"flex shrink-0 items-center justify-between gap-2"}>
      <div className={"flex max-w-48 min-w-0 flex-1 items-center gap-2"}>
        <MuteButton size={"full"} />
        {volumeControllable && <VolumeSlider />}
      </div>

      <div className={"flex items-center gap-1"}>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              size={"touch"}
              aria-label={labAltering ? "Lab, changing the sound" : "Lab"}
              aria-pressed={showingLab}
              className={showingLab ? "text-art" : undefined}
              onClick={() => setView(showingLab ? "player" : "lab")}
            >
              <IconAdjustmentsHorizontal />
              <span
                aria-hidden
                data-on={labAltering ? "" : undefined}
                className={
                  "absolute top-2.5 right-2.5 size-1.5 scale-0 rounded-full bg-art opacity-0 motion-settle data-on:scale-100 data-on:opacity-100"
                }
              />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>
            {labAltering ? "Lab (active)" : "Lab"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              size={"touch"}
              aria-label={"Up next"}
              aria-pressed={showingQueue}
              className={showingQueue ? "text-art" : undefined}
              onClick={() => setView(showingQueue ? "player" : "queue")}
            >
              <IconPlaylist />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>Up next</TooltipContent>
        </Tooltip>

        {available && audios && current?.trackAudio && (
          <Tooltip>
            <TrackAudioDropdown
              audios={audios}
              selectedAudioId={current.trackAudio.id}
              onSelect={onSelectVersion}
              onManage={onManageVersions}
            >
              <TooltipTrigger asChild>
                <IconButton size={"touch"} aria-label={"Versions"}>
                  <IconVersions />
                </IconButton>
              </TooltipTrigger>
            </TrackAudioDropdown>
            <TooltipContent>Versions</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/**
 * The one line under the transport for the case a coarse pointer never
 * routes on its own: audio routed through Web Audio anyway, which only an
 * explicit request (starting a comparison today; engaging the Lab once it
 * exists) can have caused. Renders nothing the rest of the time.
 */
function RoutedNotice() {
  if (!useRoutedNotice()) return null;
  return (
    <p className={"text-center text-micro text-ink-soft"}>
      Lab on · playback stops when the screen locks
    </p>
  );
}

/**
 * Pushes `NOW_PLAYING_SCOPE` while the sheet is open. It renders inside
 * `SheetContent` so its push lands above the sheet's modal push, which is what
 * lets the player and Lab keys answer under a modal that silences the page.
 */
function NowPlayingScope({ open }: { open: boolean }) {
  useCommandScope(NOW_PLAYING_SCOPE, undefined, open);
  return null;
}

/**
 * The playing track at full size: its artwork as the ground, the transport a
 * thumb can reach, and the queue behind a toggle. One tree for every width —
 * the lava field always fills the page, and only the content column's max
 * width changes above the phone tier.
 */
export default function NowPlaying() {
  const { open, setOpen, view, fromCover } = useNowPlaying();
  const current = useCurrentTrack();
  const art = useCurrentArt();
  const router = useRouter();
  const haptic = useHaptics();
  const { lavaField } = useVisualsPolicy();

  const close = () => setOpen(false);
  const bare = !current?.cover;
  const href = ownerHref(current);
  const heading =
    current?.collectionId != null && current.album
      ? `Playing from ${current.album}`
      : "Now playing";

  // Fetched once here — the header menu, the secondary row and the Lab's
  // match EQ all read the result, rather than each holding its own copy of
  // the sibling versions.
  const {
    audios: versionAudios,
    select: selectVersion,
    available: versionsAvailable,
  } = useVersionSwitch(current, open && view !== "queue");
  const manageVersions = () => {
    close();
    if (href) router.push(href);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next, details) => {
        // A swipe that took ends with the sheet already leaving under the
        // finger, so the buzz is what separates it from one that snapped back.
        if (!next && details.reason === "swipe") haptic();
        setOpen(next);
      }}
    >
      <SheetContent
        side={"bottom"}
        showCloseButton={false}
        aria-describedby={undefined}
        // Opened from the dock's cover, the sheet only fades: the cover is
        // morphing to its place in the sheet, and a view transition aims at
        // where that place is when it starts — a sheet still below the screen
        // would send the cover there.
        entrance={fromCover ? "fade" : "slide"}
        className={SHEET}
        style={art}
      >
        <NowPlayingScope open={open} />
        {!bare && (
          <ArtField
            cover={current?.cover ?? null}
            scrim={"full"}
            field={lavaField ? <LavaField /> : undefined}
          />
        )}

        <div className={cn(CONTENT, !bare && "on-art")}>
          <header className={"flex h-12 shrink-0 items-center gap-1"}>
            <IconButton size={"touch"} aria-label={"Close"} onClick={close}>
              <IconChevronDown />
            </IconButton>
            <SheetTitle
              className={cn(LABEL, "min-w-0 flex-1 truncate text-center")}
            >
              {heading}
            </SheetTitle>
            {current && href ? (
              <OwnerMenu current={current} href={href} onNavigate={close} />
            ) : (
              /* The title is centred between the two ends of the row, so the
                 close button keeps its counterweight when there is no menu. */
              <span className={"size-11 shrink-0"} aria-hidden />
            )}
          </header>

          {/* The two panes trade places under a header that stays put: the one
              leaving is gone before the one arriving fades up, so nothing
              overlaps in the space they share. */}
          <AnimatePresence mode={"wait"} initial={false}>
            <m.div
              key={view}
              variants={OPTICAL}
              initial={"hidden"}
              animate={"shown"}
              exit={{ opacity: 0, transition: LEAVE.quick }}
              className={"flex min-h-0 flex-1 flex-col"}
            >
              {view === "queue" ? (
                <QueueView current={current} />
              ) : view === "lab" ? (
                <LabView current={current} audios={versionAudios} />
              ) : (
                <PlayerPane
                  current={current}
                  href={href}
                  onNavigate={close}
                  bare={bare}
                />
              )}
            </m.div>
          </AnimatePresence>

          {/* A finger on the scrubber is scrubbing, and the little vertical
              travel it makes on the way is not a dismissal. The extra margin
              keeps the scrub track clear of the loudness ruler above it, two
              instruments rather than one. */}
          <div className={"mt-3 shrink-0"} data-base-ui-swipe-ignore>
            <Scrub size={"full"} />
          </div>

          <div className={"flex shrink-0 items-center justify-between"}>
            <Transport size={"full"} />
          </div>

          <RoutedNotice />

          <SecondaryRow
            current={current}
            audios={versionAudios}
            available={versionsAvailable}
            onSelectVersion={selectVersion}
            onManageVersions={manageVersions}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
