"use client";

import {
  bandReadout,
  freeBandIndex,
  readoutPlacement,
} from "@/components/lab/eq-bands";
import { eqResponseDb } from "@/components/lab/eq-response";
import {
  bandFraction,
  dragToBand,
  EQ_GAIN_WINDOW,
  EQ_GRID_LEVELS,
  hzAtFraction,
  qDragStep,
  type QDragOrigin,
  stepGain,
  stepHz,
  stepQFromWheel,
} from "@/components/lab/eq-curve-geometry";
import { DEFAULT_LAB, type EqBand } from "@/lib/dsp/lab-settings";
import {
  SPECTRUM_DRAWING_HEIGHT,
  type SpectrumSize,
} from "@/components/spectrum/SpectrumScale";
import {
  curvePath,
  fillToLevelPath,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  yOf,
} from "@/components/spectrum/spectrum-geometry";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";

/** Points sampled across the log axis for a smooth response curve. */
const CURVE_POINTS = 129;
const CURVE_HZ = Array.from({ length: CURVE_POINTS }, (_, i) =>
  hzAtFraction(i / (CURVE_POINTS - 1))
);

type Drag = { index: number; qOrigin: QDragOrigin | null };

/** The drawing the curve sits on, shared with the live spectrum under it. */
export const EQ_DRAWING_SIZE: SpectrumSize = "tall";

const READOUT_VERTICAL = {
  above: "bottom-[calc(100%+6px)]",
  below: "top-[calc(100%+6px)]",
} as const;
const READOUT_HORIZONTAL = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

/**
 * The eight biquads' combined response, drawn as a 1.5px `--art` line over
 * whatever the caller stacks it on (the live spectrum), with the region
 * between it and 0 dB washed in the same colour so a boost and a cut read as
 * shapes. Each active band has a numbered handle: dragging sets frequency
 * and gain from the pointer's position directly; holding shift adjusts Q
 * instead, from the drag's vertical movement, with frequency and gain held
 * where the drag started. Arrow keys on a focused handle do the same, a
 * semitone-sized step at a time, fine with shift. While a handle is dragged
 * or focused, its frequency, gain and Q ride beside it.
 */
export function EqCurveOverlay({
  bands,
  onChangeBand,
  disabled,
}: {
  bands: EqBand[];
  onChangeBand: (index: number, patch: Partial<EqBand>) => void;
  /** Draws the curve and handles without any way to move them. */
  disabled?: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [engaged, setEngaged] = useState<number | null>(null);
  const wheelStateRef = useLatestRef({ bands, onChangeBand, disabled });

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const {
        bands: currentBands,
        onChangeBand: change,
        disabled: isDisabled,
      } = wheelStateRef.current;
      if (isDisabled) return;
      const handle = (e.target as Element | null)?.closest<HTMLElement>(
        "[data-band-index]"
      );
      if (!handle) return;
      const index = Number(handle.dataset.bandIndex);
      const band = currentBands[index];
      if (!band || band.kind === "off") return;
      e.preventDefault();
      setEngaged(index);
      change(index, { q: stepQFromWheel(band.q, e.deltaY, e.shiftKey) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelStateRef]);

  const responseDb = useMemo(() => eqResponseDb(bands, CURVE_HZ), [bands]);
  const path = useMemo(
    () => curvePath(CURVE_HZ, responseDb, EQ_GAIN_WINDOW),
    [responseDb]
  );
  const fill = useMemo(
    () => fillToLevelPath(CURVE_HZ, responseDb, EQ_GAIN_WINDOW, 0),
    [responseDb]
  );

  function fractionFromEvent(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function onPointerDown(index: number, e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { index, qOrigin: null };
    setEngaged(index);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.index !== bandIndexOf(e)) return;
    const band = bands[drag.index]!;
    const pos = fractionFromEvent(e);
    if (e.shiftKey) {
      const { origin, q } = qDragStep(drag.qOrigin, band.q, pos.y);
      drag.qOrigin = origin;
      onChangeBand(drag.index, { q });
      return;
    }
    // Not (or no longer) a Q drag: the next shift-held move re-anchors from
    // wherever the pointer and Q are then, rather than the last shift-drag.
    drag.qOrigin = null;
    const { hz, gainDb } = dragToBand(pos.x, pos.y);
    onChangeBand(drag.index, { hz, gainDb });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (document.activeElement !== e.currentTarget) setEngaged(null);
  }

  function onOverlayDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const free = freeBandIndex(bands);
    if (free == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { hz, gainDb } = dragToBand(
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height
    );
    onChangeBand(free, {
      kind: "peaking",
      hz: Math.round(hz),
      gainDb: Math.round(gainDb * 10) / 10,
    });
    setEngaged(free);
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLDivElement>) {
    const band = bands[index]!;
    const fine = e.shiftKey;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        onChangeBand(index, { gainDb: stepGain(band.gainDb, 1, fine) });
        return;
      case "ArrowDown":
        e.preventDefault();
        onChangeBand(index, { gainDb: stepGain(band.gainDb, -1, fine) });
        return;
      case "ArrowRight":
        e.preventDefault();
        onChangeBand(index, { hz: stepHz(band.hz, 1, fine) });
        return;
      case "ArrowLeft":
        e.preventDefault();
        onChangeBand(index, { hz: stepHz(band.hz, -1, fine) });
    }
  }

  return (
    // Pinned to the top-left corner at the live spectrum's own drawing
    // height — its wrapper is taller once the numerals row is added below
    // the svg, and `inset-0` would stretch this to that instead of lining up
    // with the axis both drawings share.
    <div
      ref={overlayRef}
      onDoubleClick={onOverlayDoubleClick}
      className={cn(
        "absolute inset-x-0 top-0",
        disabled ? "pointer-events-none" : "pointer-events-auto",
        SPECTRUM_DRAWING_HEIGHT[EQ_DRAWING_SIZE]
      )}
    >
      <svg
        aria-hidden
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-full w-full overflow-visible"
      >
        <g strokeWidth={1}>
          {EQ_GRID_LEVELS.map((db) => {
            const y = yOf(db, EQ_GAIN_WINDOW);
            return (
              <line
                key={db}
                x1={0}
                x2={VIEW_WIDTH}
                y1={y}
                y2={y}
                strokeDasharray={db === 0 ? undefined : "2 3"}
                vectorEffect="non-scaling-stroke"
                className={db === 0 ? "stroke-rule-strong" : "stroke-rule"}
              />
            );
          })}
        </g>
        <path d={fill} className="fill-art/15" />
        <path
          d={path}
          fill="none"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-art"
        />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-1 select-none"
      >
        {EQ_GRID_LEVELS.map((db) => (
          <span
            key={db}
            className="absolute right-0 -translate-y-1/2 font-mono text-micro/none text-ink-faint/75 tabular-nums"
            style={{ top: `${(yOf(db, EQ_GAIN_WINDOW) / VIEW_HEIGHT) * 100}%` }}
          >
            {db > 0 ? `+${db}` : db < 0 ? `−${-db}` : "0"}
          </span>
        ))}
      </div>
      {bands.map((band, index) => {
        if (band.kind === "off") return null;
        const pos = bandFraction(band);
        const placement = readoutPlacement(pos);
        const shown = engaged === index;
        return (
          <div
            // eslint-disable-next-line @eslint-react/no-array-index-key -- the index is the band's fixed slot (0..7), never reordered; a content key would remount the handle mid-drag as its frequency changed
            key={index}
            role="slider"
            tabIndex={disabled ? undefined : 0}
            aria-disabled={disabled || undefined}
            aria-label={`EQ band ${index + 1}`}
            aria-valuemin={EQ_GAIN_WINDOW[0]}
            aria-valuemax={EQ_GAIN_WINDOW[1]}
            aria-valuenow={Math.round(band.gainDb * 10) / 10}
            aria-valuetext={bandReadout(band)}
            data-band-index={index}
            data-engaged={shown ? "" : undefined}
            className={cn(
              "absolute grid size-4 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full",
              "border border-art bg-paper text-ink outline-hidden motion-press",
              disabled
                ? "pointer-events-none opacity-50"
                : "pointer-events-auto cursor-grab focus-visible:ring-2 focus-visible:ring-art/40 active:cursor-grabbing data-engaged:bg-art data-engaged:text-paper",
              // A coarse pointer gets a 44px target without the mark itself
              // growing, the same halo technique `IconButton` uses.
              "coarse:after:absolute coarse:after:-inset-3.5 coarse:after:content-['']"
            )}
            style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
            onPointerDown={
              disabled ? undefined : (e) => onPointerDown(index, e)
            }
            onPointerMove={disabled ? undefined : onPointerMove}
            onPointerUp={disabled ? undefined : onPointerUp}
            onPointerCancel={disabled ? undefined : onPointerUp}
            onDoubleClick={
              disabled
                ? undefined
                : (e) => {
                    e.stopPropagation();
                    onChangeBand(index, {
                      gainDb: 0,
                      q: DEFAULT_LAB.rack.eq.bands[index]!.q,
                    });
                  }
            }
            onKeyDown={disabled ? undefined : (e) => onKeyDown(index, e)}
            onFocus={disabled ? undefined : () => setEngaged(index)}
            onBlur={
              disabled
                ? undefined
                : () =>
                    setEngaged((current) =>
                      current === index ? null : current
                    )
            }
          >
            <span
              aria-hidden
              className={cn(LABEL, "leading-none tracking-normal")}
            >
              {index + 1}
            </span>
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute z-10 rounded-sm border border-rule-strong bg-paper px-1.5 py-0.5",
                "font-mono text-micro whitespace-nowrap text-ink tabular-nums opacity-0 motion-reveal",
                "data-shown:opacity-100",
                READOUT_VERTICAL[placement.vertical],
                READOUT_HORIZONTAL[placement.horizontal]
              )}
              data-shown={shown ? "" : undefined}
            >
              {bandReadout(band)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function bandIndexOf(e: React.PointerEvent<HTMLDivElement>): number {
  return Number(e.currentTarget.dataset.bandIndex);
}
