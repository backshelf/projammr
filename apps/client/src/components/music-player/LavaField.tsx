"use client";

import { loadCoverPalette, type PaletteColour } from "@/lib/cover-palette";
import {
  useAnalyser,
  useAnalysis,
  useCurrentTrack,
  useIsPlaying,
  useRouted,
} from "@/components/music-player/player-hooks";
import {
  BANDS,
  bandLevels,
  configureAnalyser,
  drawField,
  fadeBlobs,
  restingBlobs,
  stepBlobs,
  type Theme,
} from "@/components/music-player/lava-field";
import { imageUrl } from "@/lib/utils";
import { useReducedMotion } from "@workspace/ui/lib/motion";
import { useTheme } from "@/components/theme/AppThemeProvider";
import { useEffect, useMemo, useRef, useState } from "react";

/** The backing store's edge: low-resolution on purpose, since `.miniplayer__field` in globals.css stretches and blurs it into a continuous field. */
const SIZE = 96;

/**
 * The now-playing sheet's background: the cover's own colours as large, soft
 * blobs, each following a different frequency band of the playing audio. It
 * is the background's colour moving, not a chart. Pausing lets the blobs ease
 * back to rest over a couple of seconds and then holds that frame; under
 * reduced motion it is only ever the still resting frame; and it draws
 * nothing without a cover to sample.
 */
export function LavaField() {
  // The field is the audio made visible, so opening the sheet is what asks
  // for analysis. The engine refuses that request outright on a coarse
  // pointer, so a phone keeps playing with the screen locked; the draw below
  // rests until `routed` says the graph is actually up.
  useAnalysis();
  const routed = useRouted();
  const analyser = useAnalyser();
  const playing = useIsPlaying();
  const reduced = useReducedMotion();
  const current = useCurrentTrack();
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);
  // The blobs outlive any one animation loop so that play/pause, a theme
  // switch or a new palette carry on from where the field is rather than
  // snapping it back to rest.
  const [blobs] = useState(restingBlobs);
  const [loaded, setLoaded] = useState<{
    url: string;
    colours: PaletteColour[];
  } | null>(null);

  const cover = current?.cover ?? null;
  const url = imageUrl(cover, 64);
  // The palette lags a cover change until it loads; the cross-fade in
  // ArtField covers the gap, so rendering nothing for a beat is fine.
  const palette = useMemo(
    () => (loaded?.url === url ? loaded.colours : []),
    [loaded, url]
  );

  useEffect(() => {
    if (!url) return;
    let live = true;
    loadCoverPalette(url).then((colours) => {
      if (live) setLoaded({ url, colours });
    });
    return () => {
      live = false;
    };
  }, [url]);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || palette.length === 0) return;

    const theme: Theme = resolvedTheme === "dark" ? "dark" : "light";

    if (!routed || !analyser || reduced) {
      drawField(ctx, blobs, palette, SIZE, theme);
      return;
    }

    let data: Uint8Array<ArrayBuffer> | null = null;
    if (playing) {
      configureAnalyser(analyser);
      data = new Uint8Array(analyser.frequencyBinCount);
    }
    const levels = new Float32Array(BANDS.length);
    let frame = 0;

    let lastT = performance.now();
    const tick = (t: number) => {
      let settled = false;
      if (data) {
        analyser.getByteFrequencyData(data);
        bandLevels(data, levels);
        stepBlobs(blobs, levels, t, t - lastT);
      } else {
        settled = fadeBlobs(blobs, t);
      }
      lastT = t;
      drawField(ctx, blobs, palette, SIZE, theme);
      if (!settled) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [routed, analyser, playing, reduced, palette, resolvedTheme, blobs]);

  if (!cover || palette.length === 0) return null;

  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      aria-hidden
      className={
        "miniplayer__field pointer-events-none absolute inset-0 -z-2 size-full"
      }
    />
  );
}
