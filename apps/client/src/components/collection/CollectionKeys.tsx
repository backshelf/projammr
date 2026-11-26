"use client";

import {
  beatSeconds,
  DEFAULT_CIRCLE_LAYOUT,
  keyDots,
  keyLabels,
  type KeyDot,
} from "@/components/collection/circle-of-fifths";
import {
  useCurrentTrack,
  useIsPlaying,
} from "@/components/music-player/player-hooks";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { CollectionKeyTrack, CollectionTempo } from "@workspace/api/api";
import { FloatingNote } from "@workspace/ui/components/floating-note";
import { useFormat } from "@workspace/ui/components/format-provider";
import { keyParts } from "@workspace/session-diff/musical-key";
import { RailLabel } from "@workspace/ui/components/layout/rail";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

const { cx, cy, outerR, innerR } = DEFAULT_CIRCLE_LAYOUT;

/** The drawing's 0..100 view units as a percentage of the wheel's box,
 *  rounded so the server's and the browser's float printing agree. */
const at = (x: number, y: number) => ({
  left: `${x.toFixed(2)}%`,
  top: `${y.toFixed(2)}%`,
});

/**
 * A collection's tonal spread as a shape rather than a list: the twelve major
 * keys around a hairline ring, a dot in the artwork colour per track at its
 * detected key, minor keys on an inner ring at their relative major's spoke.
 * "Mostly in G, with two in E minor" reads faster as a cluster of dots than
 * as a list of counts.
 *
 * While one of the collection's tracks plays, its dot swells and sends a ring
 * out once a beat at the track's detected tempo, so the wheel says which of
 * its keys is sounding. Hovering or focusing a dot names the track, its key
 * and its tempo.
 */
export function CollectionKeys({
  keys,
  tempo,
}: {
  keys: readonly CollectionKeyTrack[];
  tempo: CollectionTempo;
}) {
  const current = useCurrentTrack();
  const isPlaying = useIsPlaying();
  const [noted, setNoted] = useState<{
    dot: KeyDot;
    anchor: HTMLElement;
  } | null>(null);

  const format = useFormat();
  const dots = keyDots(keys);
  const bpms = new Map(tempo?.tracks.map((track) => [track.id, track.bpm]));
  // A detected key and tempo, as the viewer writes them: the key in their
  // notation, the tempo a whole figure unless they keep decimals.
  const keyOf = (dot: KeyDot) => {
    const { tonic, scale } = keyParts(dot.key);
    return format.key(tonic, scale) ?? dot.key;
  };
  const tempoOf = (bpm: number) =>
    format.tempo(bpm, { unit: true, whole: true });
  const playingId =
    isPlaying && current?.ownerType === "track" ? current.ownerId : null;

  return (
    <div>
      <RailLabel action={<span>{pluralizeCount(dots.length, "track")}</span>}>
        KEYS
      </RailLabel>
      <div
        role="group"
        aria-label="Detected keys"
        className="relative mx-auto mt-3 size-44"
      >
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full overflow-visible"
        >
          {[outerR, innerR].map((r) => (
            <circle
              key={r}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="stroke-rule-strong"
            />
          ))}
        </svg>
        {keyLabels(format.keyNotation).map(({ x, y, label }) => (
          <span
            key={label}
            aria-hidden
            className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-micro leading-none text-ink-soft"
            style={at(x, y)}
          >
            {label}
          </span>
        ))}
        {dots.map((dot) => {
          const playing = dot.trackId === playingId;
          const bpm = bpms.get(dot.trackId);
          return (
            <button
              key={dot.trackId}
              type="button"
              aria-label={`${dot.title}, ${keyOf(dot)}${bpm ? `, ${tempoOf(bpm)}` : ""}`}
              data-playing={playing ? "" : undefined}
              className={cn(
                "absolute grid size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-default place-items-center rounded-full bg-art motion-settle outline-none",
                "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-paper data-playing:scale-150",
                dot.ring === "inner" && "size-2",
                "coarse:after:absolute coarse:after:-inset-4 coarse:after:content-['']"
              )}
              style={at(dot.x, dot.y)}
              onPointerEnter={(e) => setNoted({ dot, anchor: e.currentTarget })}
              onPointerLeave={() => setNoted(null)}
              onFocus={(e) => setNoted({ dot, anchor: e.currentTarget })}
              onBlur={() => setNoted(null)}
            >
              {playing && bpm && (
                <span
                  aria-hidden
                  className="key-beat pointer-events-none absolute inset-0 rounded-full border border-art"
                  style={{ ["--beat" as string]: `${beatSeconds(bpm)}s` }}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-center text-micro text-ink-faint">
        Major outside, minor inside
      </p>
      <AnimatePresence>
        {noted && (
          <FloatingNote
            key="key-note"
            anchor={noted.anchor}
            placement="above"
            className="p-2.5 px-3"
          >
            <p className="text-small text-ink">{noted.dot.title}</p>
            <p className="text-micro text-ink-soft tabular-nums">
              {keyOf(noted.dot)}
              {bpms.has(noted.dot.trackId) &&
                ` · ${tempoOf(bpms.get(noted.dot.trackId)!)}`}
            </p>
          </FloatingNote>
        )}
      </AnimatePresence>
    </div>
  );
}
