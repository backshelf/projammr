"use client";

import {
  useCurrentTrack,
  useIsPlaying,
  useLabSettings,
  useLabTarget,
  usePlayerActions,
  usePlayerPrefs,
  useVolumeControllable,
} from "@/components/music-player/player-hooks";
import { useNowPlaying } from "@/components/music-player/now-playing-context";
import { labAudition } from "@/lib/dsp/lab-auditions";
import { SPEED_STEP } from "@/lib/dsp/lab-settings";
import { useLabPolicy } from "@/lib/policies/provider";
import type { PlayerSize } from "@/components/music-player/types";
import { GlyphSwap, PlayGlyph } from "@/components/music-player/PlayGlyph";
import {
  IconArrowsShuffle,
  IconDotsVertical,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOff,
  IconRepeatOnce,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Slider } from "@workspace/ui/components/slider";

const repeatLabel = { off: "Off", all: "All", one: "One" } as const;

/** A thumb needs a 44px target; a cursor is served by the smaller mark. */
const buttonSize = (size: PlayerSize) =>
  size === "full" ? ("touch" as const) : ("default" as const);

const repeatIcon = {
  off: IconRepeatOff,
  all: IconRepeat,
  one: IconRepeatOnce,
} as const;

/**
 * Move between tracks and start or stop them. A screen with room for them puts
 * shuffle and repeat either side of the three, where the card leaves them in
 * its overflow menu; both answer on colour alone, with no background, so the
 * row reads as a set of marks.
 */
export function Transport({ size }: { size: PlayerSize }) {
  const isPlaying = useIsPlaying();
  const { shuffle, repeat } = usePlayerPrefs();
  const { togglePlay, next, prev, toggleShuffle, cycleRepeat } =
    usePlayerActions();

  const RepeatIcon = repeatIcon[repeat];

  return (
    <>
      {size === "full" && (
        <IconButton
          size={"touch"}
          aria-label={"Shuffle"}
          aria-pressed={shuffle}
          data-active={shuffle || undefined}
          className={"data-active:text-art"}
          onClick={toggleShuffle}
        >
          <IconArrowsShuffle />
        </IconButton>
      )}

      <IconButton
        size={buttonSize(size)}
        aria-label={"Previous"}
        onClick={prev}
      >
        <IconPlayerSkipBackFilled />
      </IconButton>

      <IconButton
        variant={size === "full" ? "hero" : "play"}
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={togglePlay}
      >
        <PlayGlyph playing={isPlaying} />
      </IconButton>

      <IconButton size={buttonSize(size)} aria-label={"Next"} onClick={next}>
        <IconPlayerSkipForwardFilled />
      </IconButton>

      {size === "full" && (
        <IconButton
          size={"touch"}
          aria-label={`Repeat: ${repeatLabel[repeat]}`}
          data-active={repeat === "off" ? undefined : true}
          className={"data-active:text-art"}
          onClick={cycleRepeat}
        >
          <GlyphSwap slot={repeat} aria-hidden>
            <RepeatIcon />
          </GlyphSwap>
        </IconButton>
      )}
    </>
  );
}

/** Off when there is nothing to hear, whichever of the mute and the level
 *  silenced it. */
function VolumeIcon() {
  const { volume, muted } = usePlayerPrefs();
  return muted || volume === 0 ? <IconVolumeOff /> : <IconVolume />;
}

/** Silence, in the one mark that both reports it and lifts it. Every platform
 *  honours `muted`, so this is the control a surface can always offer. */
export function MuteButton({ size }: { size: PlayerSize }) {
  const { muted } = usePlayerPrefs();
  const { toggleMute } = usePlayerActions();

  return (
    <IconButton
      size={buttonSize(size)}
      aria-label={muted ? "Unmute" : "Mute"}
      onClick={toggleMute}
    >
      <VolumeIcon />
    </IconButton>
  );
}

/** The level. Only worth showing where a write to it lands — see
 *  {@link useVolumeControllable}. */
export function VolumeSlider({ className }: { className?: string }) {
  const { volume, muted } = usePlayerPrefs();
  const { setVolume } = usePlayerActions();

  return (
    <Slider
      className={className}
      value={[muted ? 0 : volume]}
      onValueChange={([value]) => value !== undefined && setVolume(value)}
      min={0}
      max={1}
      step={0.01}
    />
  );
}

/**
 * A slider behind a popover, or the bare mute toggle on a platform that owns
 * the volume itself — iOS ignores a write to `audio.volume`, so a slider there
 * would move without effect while muting still works.
 */
function VolumeControl({ size }: { size: PlayerSize }) {
  const volumeControllable = useVolumeControllable();

  if (!volumeControllable) return <MuteButton size={size} />;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size={buttonSize(size)} aria-label={"Volume"}>
          <VolumeIcon />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className={"flex w-40 flex-row items-center gap-2"}>
        <MuteButton size={size} />
        <VolumeSlider />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The playback speed, wherever it is housed. The keypress stops here because
 * the menu the card keeps this in would otherwise take the arrow keys the
 * slider needs.
 */
function SpeedSlider({ className }: { className?: string }) {
  const { speed } = useLabSettings();
  const { setSpeed } = usePlayerActions();
  const { speedRange } = useLabPolicy();

  return (
    <div className={className} onKeyDown={(event) => event.stopPropagation()}>
      <Slider
        value={[speed]}
        onValueChange={([value]) => value !== undefined && setSpeed(value)}
        min={speedRange.min}
        max={speedRange.max}
        step={SPEED_STEP}
      />
    </div>
  );
}

/**
 * The controls that do not earn a mark of their own on the surface. Shuffle
 * and repeat are only here for the card, which has no room for them beside the
 * transport; the speed slider is here on every surface.
 */
function OverflowMenu({ size }: { size: PlayerSize }) {
  const { shuffle, repeat } = usePlayerPrefs();
  const { speed, auditions } = useLabSettings();
  const current = useCurrentTrack();
  const { toggleShuffle, cycleRepeat, setAudition } = usePlayerActions();
  const { setOpen, setView } = useNowPlaying();

  const RepeatIcon = repeatIcon[repeat];
  const lufs = current?.trackAudio?.lufs ?? null;
  const mono = labAudition("mono");
  const dim = labAudition("dim");
  const normalise = labAudition("normalise");
  const normaliseTargetLufs = useLabTarget();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size={buttonSize(size)} aria-label={"More controls"}>
          <IconDotsVertical />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={"end"} className={"w-48"}>
        {size === "card" && (
          <>
            <DropdownMenuCheckboxItem
              checked={shuffle}
              onCheckedChange={toggleShuffle}
            >
              <IconArrowsShuffle className={"mr-2 size-3.5"} />
              Shuffle
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                cycleRepeat();
              }}
            >
              <RepeatIcon className={"mr-2 size-3.5"} />
              Repeat: {repeatLabel[repeat]}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className={"font-normal text-ink-soft"}>
          Speed: {speed.toFixed(2)}×
        </DropdownMenuLabel>
        <SpeedSlider className={"px-2 pt-1 pb-2"} />
        {size === "card" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={"font-normal text-ink-soft"}>
              Lab
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={mono.isOn(auditions)}
              onCheckedChange={(next) => setAudition(mono.set(next))}
            >
              Mono
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dim.isOn(auditions)}
              onCheckedChange={(next) => setAudition(dim.set(next))}
            >
              Dim
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={normalise.isOn(auditions)}
              disabled={lufs == null}
              onCheckedChange={(next) => setAudition(normalise.set(next))}
            >
              {normalise.labelFor({ normaliseTargetLufs })}
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              onSelect={() => {
                setView("lab");
                setOpen(true);
              }}
            >
              Open Lab
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Everything beside the transport: the volume affordance and the overflow
 * menu. A surface with room for them in one run renders the pair; the card
 * splits them around its transport, so each is addressable on its own.
 */
export function SecondaryControls({ size }: { size: PlayerSize }) {
  return (
    <>
      <VolumeControl size={size} />
      <OverflowMenu size={size} />
    </>
  );
}

SecondaryControls.Volume = VolumeControl;
SecondaryControls.Overflow = OverflowMenu;
