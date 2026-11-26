"use client";

import { GR_RULER, grFraction, grLabel } from "@/components/lab/gr-scale";
import { RulerScale } from "@workspace/ui/components/loudness/ruler-scale";
import { useGrFrames } from "@/components/music-player/use-gr-frames";
import {
  holdPeak,
  meterStep,
  scaledBallistics,
  type PeakHold,
} from "@/lib/meter-ballistics";
import { useVisualsPolicy } from "@/lib/policies/provider";
import { LABEL } from "@workspace/ui/lib/shell";
import { useReducedMotion } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { useRef } from "react";

/** Down fast to catch a transient, back up slowly, like a hardware GR meter. */
const BALLISTICS = { attackMs: 15, releaseMs: 260 };
/** The deepest recent cut lingers as a tick, then eases back 8 dB a second. */
const HOLD = { holdMs: 1400, fallPerSecond: 8 / 24 };
/** The figure changes a few times a second, so it can be read. */
const READOUT_MS = 160;

// Resting transforms as inline styles, the property the frame loop writes.
const AT_REST = { transform: "scaleX(0)" };
const HOLD_AT_REST = { transform: "translateX(100%)" };

/**
 * The compressor's gain reduction on the loudness meter's own drawing: a
 * −24..0 dB ruler with an `--art` bar hanging from 0 that reaches left as the
 * compressor works, an ink tick holding the deepest recent cut, and the
 * figure above it. Only the Lab's player posts a `gr` frame, so this reads
 * nothing while the rack's compressor is off or the Lab is not live. Under
 * reduced motion the bar jumps to each reading rather than easing.
 */
export function GrMeter({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const ballistics = scaledBallistics(
    BALLISTICS,
    useVisualsPolicy().meterBallistics
  );
  const barRef = useRef<HTMLElement>(null);
  const holdRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const stateRef = useRef<{ shown: number; hold: PeakHold; sinceText: number }>(
    { shown: 0, hold: { value: 0, heldMs: 0 }, sinceText: READOUT_MS }
  );

  useGrFrames(active, (db, dtMs) => {
    const s = stateRef.current;
    const next = meterStep(
      s.shown,
      grFraction(db),
      dtMs,
      ballistics,
      !!reduced
    );
    const moving = Math.abs(next - s.shown) > 0.0005 || s.hold.value > 0.0005;
    s.shown = next;
    s.hold = holdPeak(s.hold, next, dtMs, HOLD);

    if (barRef.current) barRef.current.style.transform = `scaleX(${next})`;
    if (holdRef.current)
      holdRef.current.style.transform = `translateX(${(1 - s.hold.value) * 100}%)`;

    s.sinceText += dtMs;
    if (textRef.current && s.sinceText >= READOUT_MS) {
      s.sinceText = 0;
      const text = grLabel(db);
      if (textRef.current.textContent !== text)
        textRef.current.textContent = text;
    }
    return moving;
  });

  const layer = (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <i
        ref={barRef}
        className="absolute inset-x-0 bottom-px h-[3px] origin-right bg-art/70"
        style={AT_REST}
      />
      <i ref={holdRef} className="absolute inset-0" style={HOLD_AT_REST}>
        <span className="absolute bottom-px left-0 h-[7px] w-px -translate-x-1/2 bg-ink" />
      </i>
    </span>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 font-mono text-micro text-ink-soft tabular-nums">
        <span className={LABEL}>Gain reduction</span>
        <span ref={textRef} className={cn("text-ink")}>
          0.0 dB
        </span>
      </div>
      <RulerScale
        config={GR_RULER}
        marks={[]}
        label="Compressor gain reduction"
        live={layer}
      />
    </div>
  );
}
