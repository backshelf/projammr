"use client";

import { clampPosition } from "@/components/music-player/scrub-math";
import {
  useCallback,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

export type TimelineHover = {
  /** Normalized horizontal position in `[0, 1]`. */
  ratio: number;
  /** Normalized vertical position in `[0, 1]` (0 = top, 1 = bottom). */
  yRatio: number;
  /** Time position in seconds. */
  seconds: number;
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function timelineRatioFromClientX(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">
): number {
  if (rect.width <= 0) return 0;
  return clampRatio((clientX - rect.left) / rect.width);
}

export function timelineYRatioFromClientY(
  clientY: number,
  rect: Pick<DOMRect, "top" | "height">
): number {
  if (rect.height <= 0) return 0;
  return clampRatio((clientY - rect.top) / rect.height);
}

export type TouchIntent = "pending" | "scrub" | "scroll";

/** Classifies a pointer move against its initial press coordinates. */
export function resolveTouchIntent(
  dx: number,
  dy: number,
  pointerType: string
): TouchIntent {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (pointerType === "mouse") {
    return absX > 3 ? "scrub" : "pending";
  }
  if (absY > 8 && absY > absX) return "scroll";
  if (absX > 6 && absX > absY * 1.2) return "scrub";
  return "pending";
}

type DragState = {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  intent: TouchIntent;
};

/**
 * Shared timeline scrub + `fine:` hover hook for `TrackWaveform` and `StripRow`.
 *
 * - Supports click-to-seek and mouse/touch drag scrubbing (`touch-pan-y` yields
 *   vertical swipes to page scroll while horizontal drags capture and scrub).
 * - Tracks hover position on `fine:` (mouse) pointers for ghost playhead and
 *   timecode/studio readout pills.
 */
export function useTimelineScrub({
  durationSeconds,
  onSeek,
}: {
  durationSeconds: number;
  onSeek: (seconds: number) => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [hover, setHover] = useState<TimelineHover | null>(null);

  const seekAtClientX = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (durationSeconds <= 0) return;
      const ratio = timelineRatioFromClientX(clientX, rect);
      onSeek(clampPosition(ratio, durationSeconds));
    },
    [durationSeconds, onSeek]
  );

  const updateHover = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      if (durationSeconds <= 0) return;
      const ratio = timelineRatioFromClientX(clientX, rect);
      const yRatio = timelineYRatioFromClientY(clientY, rect);
      setHover({ ratio, yRatio, seconds: ratio * durationSeconds });
    },
    [durationSeconds]
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (durationSeconds <= 0) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      suppressClickRef.current = false;
      dragRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        intent: "pending",
      };
    },
    [durationSeconds]
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (durationSeconds <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const drag = dragRef.current;

      if (drag && drag.pointerId === event.pointerId) {
        if (drag.intent === "scroll") return;
        if (drag.intent === "pending") {
          const nextIntent = resolveTouchIntent(
            event.clientX - drag.startX,
            event.clientY - drag.startY,
            drag.pointerType
          );
          drag.intent = nextIntent;
          if (nextIntent === "scroll") return;
          if (nextIntent === "scrub") {
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic test events may lack an active pointer capture target.
            }
          }
        }
        if (drag.intent === "scrub") {
          seekAtClientX(event.clientX, rect);
          if (drag.pointerType === "mouse") {
            updateHover(event.clientX, event.clientY, rect);
          }
        }
        return;
      }

      if (event.pointerType === "mouse") {
        updateHover(event.clientX, event.clientY, rect);
      }
    },
    [durationSeconds, seekAtClientX, updateHover]
  );

  const endDrag = useCallback(
    (event: PointerEvent<HTMLElement>, commitSeek: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.intent === "scrub") {
        suppressClickRef.current = true;
        if (commitSeek) {
          seekAtClientX(
            event.clientX,
            event.currentTarget.getBoundingClientRect()
          );
        }
        try {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore if already released.
        }
      }
      dragRef.current = null;
    },
    [seekAtClientX]
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => endDrag(event, true),
    [endDrag]
  );

  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLElement>) => endDrag(event, false),
    [endDrag]
  );

  const onPointerLeave = useCallback(() => {
    if (dragRef.current?.intent !== "scrub") setHover(null);
  }, []);

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (durationSeconds <= 0) return;
      // Keyboard activation on a `<button>` carries detail=0 and clientX=0, clientY=0.
      if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) {
        onSeek(0);
        return;
      }
      seekAtClientX(event.clientX, event.currentTarget.getBoundingClientRect());
    },
    [durationSeconds, onSeek, seekAtClientX]
  );

  return {
    hover,
    clearHover: () => setHover(null),
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onClick,
    },
  };
}
