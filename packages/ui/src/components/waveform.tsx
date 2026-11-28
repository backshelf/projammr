"use client";

import { FloatingNote } from "@workspace/ui/components/floating-note";
import { formatSeconds, formatTimecode } from "@workspace/ui/lib/format";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { MAX_BARS, toBars } from "@workspace/ui/lib/waveform-bars";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";

export type CommentMark = {
  id: number;
  positionMs: number;
  /** The commenter's name; missing on a mark whose caller has no user data. */
  author?: string;
  /** The comment's opening line. A mark without one shows no floating note,
   *  which keeps an older feed's pins behaving exactly as before. */
  excerpt?: string;
  /** The comment is resolved: its pin fades to faint ink and its drop-line
   *  dims, though it still seeks and still shows its note. */
  resolved?: boolean;
  /** Who resolved it; a resolved mark without one says only `Resolved`. */
  resolvedBy?: string;
};

/** How tall a wave draws: `lg` where it leads the page it sits on. */
export type WaveSize = "md" | "lg";

/**
 * Fixed-width bars; the gap absorbs the slack so the wave spans its container
 * at any width instead of stopping short (flex bars with a max-width cannot
 * fill a wide container). The bars themselves are styled in motion.css, where
 * they also carry the left-to-right sweep they mount with. `px-2` keeps the
 * comment pins, which straddle the wave's edges, inside the container.
 */
const WAVE =
  "wave relative flex w-full min-w-full flex-1 cursor-pointer items-center justify-between overflow-hidden px-2";

const WAVE_HEIGHT: Record<WaveSize, string> = { md: "h-12", lg: "h-20" };

/** The classes of the element a wave's bars sit in, at one of its sizes. */
export const waveSurface = (size: WaveSize) => cn(WAVE, WAVE_HEIGHT[size]);

/**
 * The `--played` value for a playhead `fraction` of the way along `count`
 * bars: how many bars are behind it. motion.css lights every bar whose `--i`
 * is below it, so progress is one custom property on the wave rather than a
 * re-render of its bars.
 */
export const playedBars = (fraction: number, count: number) =>
  String(Math.round(fraction * count));

/** A pin above the wave: an `<i>` dot and a `<span>` 8px hairline dropping
 *  into the wave that ties a comment to its moment rather than leaving the
 *  link implied. A resolved pin (`data-resolved`) fades its dot to faint ink
 *  and keeps a faint 8px hairline stem so its anchor on the wave stays clear. */
const MARK = cn(
  "absolute top-0 grid size-[1.125rem] -translate-x-1/2 cursor-pointer place-items-center border-none bg-transparent p-0",
  "coarse:after:absolute coarse:after:-inset-3.5 coarse:after:content-['']",
  "[&>i]:block [&>i]:size-2 [&>i]:rounded-full [&>i]:border-2 [&>i]:border-paper [&>i]:bg-art",
  "[&>i]:motion-press [&>i]:duration-(--dur-move)",
  "hover:[&>i]:scale-[1.45] aria-current:[&>i]:scale-[1.45]",
  "data-[resolved]:[&>i]:bg-ink-faint",
  "[&>span]:absolute [&>span]:top-3.5 [&>span]:left-1/2 [&>span]:h-2 [&>span]:w-px [&>span]:origin-top",
  "[&>span]:bg-[color-mix(in_oklab,var(--art)_55%,transparent)]",
  "[&>span]:motion-ink",
  "data-[resolved]:[&>span]:bg-[color-mix(in_oklab,var(--ink-faint)_45%,transparent)]"
);

const CLUSTER_MARK = cn(
  "absolute top-0 grid size-[1.125rem] -translate-x-1/2 cursor-pointer place-items-center border-none bg-transparent p-0",
  "coarse:after:absolute coarse:after:-inset-3.5 coarse:after:content-['']",
  "[&>i]:flex [&>i]:h-4 [&>i]:min-w-4 [&>i]:items-center [&>i]:justify-center [&>i]:rounded-full [&>i]:border-2 [&>i]:border-paper [&>i]:bg-art [&>i]:px-1 [&>i]:font-mono [&>i]:text-[0.625rem]/none [&>i]:text-paper [&>i]:not-italic [&>i]:tabular-nums",
  "[&>i]:motion-press [&>i]:duration-(--dur-move)",
  "hover:[&>i]:scale-[1.2] aria-current:[&>i]:scale-[1.2]",
  "data-[resolved]:[&>i]:bg-ink-faint",
  "[&>span]:absolute [&>span]:top-4 [&>span]:left-1/2 [&>span]:h-2 [&>span]:w-px [&>span]:origin-top",
  "[&>span]:bg-[color-mix(in_oklab,var(--art)_55%,transparent)]",
  "[&>span]:motion-ink",
  "data-[resolved]:[&>span]:bg-[color-mix(in_oklab,var(--ink-faint)_45%,transparent)]"
);

/** Pins within 2.5% of the track's duration collapse into one count badge. */
export const CLUSTER_THRESHOLD_FRACTION = 0.025;

export type MarkCluster = {
  marks: CommentMark[];
  ids: number[];
  positionMs: number;
  resolved: boolean;
};

/** Groups adjacent comment marks within `threshold` of `duration` seconds. */
export function clusterMarks(
  marks: readonly CommentMark[],
  duration: number,
  threshold: number = CLUSTER_THRESHOLD_FRACTION
): MarkCluster[] {
  if (marks.length === 0 || duration <= 0) return [];
  const sorted = [...marks].sort(
    (a, b) => a.positionMs - b.positionMs || a.id - b.id
  );
  const clusters: MarkCluster[] = [];
  let bucket: CommentMark[] = [];
  let anchorFraction = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    const sumMs = bucket.reduce((acc, m) => acc + m.positionMs, 0);
    clusters.push({
      marks: bucket,
      ids: bucket.map((m) => m.id),
      positionMs: sumMs / bucket.length,
      resolved: bucket.every((m) => Boolean(m.resolved)),
    });
    bucket = [];
  };

  for (const mark of sorted) {
    const fraction = Math.min(
      1,
      Math.max(0, mark.positionMs / 1000 / duration)
    );
    if (bucket.length === 0) {
      bucket = [mark];
      anchorFraction = fraction;
    } else if (fraction - anchorFraction <= threshold) {
      bucket.push(mark);
    } else {
      flush();
      bucket = [mark];
      anchorFraction = fraction;
    }
  }
  flush();
  return clusters;
}

/**
 * The bars of one series, each its slot on the timeline. Renders only when the
 * bars change: which of them are behind the playhead is the wave element's
 * `--played` (see {@link playedBars}), so progress never re-renders a bar.
 */
export const WaveBars = memo(function WaveBars({ bars }: { bars: number[] }) {
  return (
    <>
      {bars.map((v, i) => (
        <i
          // eslint-disable-next-line @eslint-react/no-array-index-key -- a bar is its slot on the timeline; content keys would remount the bars and replay the entrance on every resize
          key={i}
          style={{
            ["--h" as string]: `${Math.max(8, v * 100)}%`,
            // Staggers this bar's entrance so the wave draws left to right.
            ["--i" as string]: i,
          }}
        />
      ))}
    </>
  );
});

/**
 * The compared version, drawn static behind the played wave at the same bar
 * count so the two line up bar for bar; wherever it is the louder of the two
 * it shows above the front bars.
 */
export function WaveStack({
  compareBars,
  size,
  children,
}: {
  compareBars: number[];
  size: WaveSize;
  children: ReactNode;
}) {
  return (
    <div className={"relative"}>
      {compareBars.length > 0 && (
        <div
          aria-hidden
          className={cn(
            waveSurface(size),
            "pointer-events-none absolute inset-0 opacity-60"
          )}
        >
          <WaveBars bars={compareBars} />
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The pin note's content: who said what, and when, then a closing line when
 * the comment is resolved. Marks without an excerpt (an older feed, or a
 * caller that never supplied one) render no note.
 */
function MarkNote({ mark }: { mark: CommentMark }) {
  if (!mark.excerpt) return null;
  return (
    <>
      <p className="flex items-baseline gap-2">
        <span className="text-small text-ink">{mark.author || "Someone"}</span>
        <span className="shrink-0 text-micro text-ink-soft tabular-nums">
          {formatTimecode(mark.positionMs)}
        </span>
      </p>
      <p className="text-small/[1.5] text-pretty text-ink-soft">
        {mark.excerpt}
      </p>
      {mark.resolved && (
        <p className="mt-2 text-micro text-ink-soft">
          {mark.resolvedBy ? `Resolved · ${mark.resolvedBy}` : "Resolved"}
        </p>
      )}
    </>
  );
}

function ClusterNote({ marks }: { marks: readonly CommentMark[] }) {
  const withExcerpt = marks.filter((m) => Boolean(m.excerpt));
  if (withExcerpt.length === 0) return null;
  const shown = withExcerpt.slice(0, 4);
  const rest = withExcerpt.length - shown.length;
  return (
    <div className="flex flex-col divide-y divide-rule">
      {shown.map((mark) => (
        <div key={mark.id} className="py-2 first:pt-0 last:pb-0">
          <MarkNote mark={mark} />
        </div>
      ))}
      {rest > 0 && (
        <p className="pt-2 text-micro text-ink-soft">+{rest} more</p>
      )}
    </div>
  );
}

/**
 * Comment pins ride above the wave with a drop-line into it, placed along
 * `duration` seconds. Adjacent pins within ~2.5% of the duration collapse
 * into count badges so threads never pile atop one another. Hovering or
 * keyboard-focusing a pin shows its comment on a floating note; touch keeps
 * the pin's tap-to-seek-and-open behaviour unchanged.
 *
 * Memoised because the pins only move when the thread or the duration does,
 * not when the wave around them re-renders for a resize.
 */
export const WaveMarks = memo(function WaveMarks({
  marks,
  duration,
  onMarkerClick,
}: {
  marks: CommentMark[];
  duration: number;
  onMarkerClick?: (ids: number[]) => void;
}) {
  const [hovered, setHovered] = useState<{
    cluster: MarkCluster;
    anchor: HTMLButtonElement;
  } | null>(null);

  useEffect(() => {
    if (!hovered) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHovered(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hovered]);

  const clusters = useMemo(
    () => clusterMarks(marks, duration),
    [marks, duration]
  );

  if (!clusters.length || duration <= 0) return null;

  const hasHoveredExcerpts =
    hovered?.cluster.marks.some((m) => Boolean(m.excerpt)) ?? false;

  return (
    <div className={"relative h-[1.125rem]"}>
      {clusters.map((cluster) => {
        const seconds = cluster.positionMs / 1000;
        const left = `${Math.min(100, (seconds / duration) * 100)}%`;

        if (cluster.marks.length === 1) {
          const mark = cluster.marks[0]!;
          return (
            <button
              key={mark.id}
              type={"button"}
              className={MARK}
              style={{ left }}
              data-resolved={mark.resolved ? "" : undefined}
              aria-label={
                (mark.resolved ? "Resolved comment" : "Comment") +
                (mark.author ? ` by ${mark.author}` : "") +
                ` at ${formatSeconds(seconds)}`
              }
              onPointerEnter={(e) =>
                setHovered({ cluster, anchor: e.currentTarget })
              }
              onPointerLeave={() => setHovered(null)}
              onFocus={(e) => setHovered({ cluster, anchor: e.currentTarget })}
              onBlur={() => setHovered(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setHovered(null);
              }}
              onClick={() => onMarkerClick?.([mark.id])}
            >
              <i />
              <span />
            </button>
          );
        }

        return (
          <button
            key={cluster.ids.join(",")}
            type={"button"}
            className={CLUSTER_MARK}
            style={{ left }}
            data-resolved={cluster.resolved ? "" : undefined}
            aria-label={
              `${cluster.marks.length} ` +
              (cluster.resolved ? "resolved comments" : "comments") +
              ` around ${formatSeconds(seconds)}`
            }
            onPointerEnter={(e) =>
              setHovered({ cluster, anchor: e.currentTarget })
            }
            onPointerLeave={() => setHovered(null)}
            onFocus={(e) => setHovered({ cluster, anchor: e.currentTarget })}
            onBlur={() => setHovered(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setHovered(null);
            }}
            onClick={() => onMarkerClick?.(cluster.ids)}
          >
            <i>{cluster.marks.length}</i>
            <span />
          </button>
        );
      })}
      <AnimatePresence>
        {hovered && hasHoveredExcerpts && (
          <FloatingNote
            key="wave-mark-note"
            anchor={hovered.anchor}
            placement="above"
            className="w-64 p-3.5 px-4"
          >
            <ClusterNote marks={hovered.cluster.marks} />
          </FloatingNote>
        )}
      </AnimatePresence>
    </div>
  );
});

const NO_PEAKS: number[] = [];
const NO_MARKS: CommentMark[] = [];

/**
 * A wave drawn from props alone: `peaks` as `count` bars, lit up to
 * `progress` (a fraction of the way through; unlit without one), a compared
 * series behind it, and comment pins placed along `duration` seconds. What
 * a static page shows of a track; the app's player composes the same parts
 * around its own seek surface and bar count.
 */
export function Waveform({
  peaks,
  comparePeaks = NO_PEAKS,
  scale,
  progress,
  marks = NO_MARKS,
  duration = 0,
  count = MAX_BARS,
  size = "md",
  label,
  className,
}: {
  peaks: number[];
  /** A second version drawn behind, for an A/B comparison. */
  comparePeaks?: number[];
  /** The ceiling both series are drawn against; defaults to `peaks`' own. */
  scale?: number;
  /** How far through the playhead is, from 0 to 1. */
  progress?: number;
  marks?: CommentMark[];
  /** The track's length in seconds, which the pins are placed along. */
  duration?: number;
  count?: number;
  size?: WaveSize;
  /** What a screen reader hears in place of the drawing. */
  label: string;
  className?: string;
}) {
  const bars = toBars(peaks, count, scale);
  const compareBars = toBars(comparePeaks, count, scale);
  const style =
    progress == null
      ? undefined
      : { ["--played" as string]: playedBars(progress, bars.length) };

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <WaveMarks marks={marks} duration={duration} />
      <WaveStack compareBars={compareBars} size={size}>
        <div
          role="img"
          aria-label={label}
          className={cn(waveSurface(size), "cursor-default")}
          style={style}
        >
          <WaveBars bars={bars} />
        </div>
      </WaveStack>
    </div>
  );
}
