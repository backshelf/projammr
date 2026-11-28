"use client";

import {
  buildSpectrogramLut,
  formatSpectrogramReadout,
  hzForTopFraction,
  renderSpectrogramToPixels,
  spectrogramByteToDb,
  srgbToOklch,
  topFractionForHz,
  type OklchColor,
} from "@/components/track-audio/spectrogram-lut";
import { StripRow } from "@/components/track-audio/StripRow";
import { mediaProxyUrl } from "@/lib/utils";
import { IconArrowsMaximize, IconArrowsMinimize } from "@tabler/icons-react";
import { SPECTROGRAM_FLOOR_DB } from "@workspace/dsp/offline";
import { useEffect, useRef, useState } from "react";

type DecodedSpectrogram = {
  width: number;
  height: number;
  data: Uint8Array;
};

const decodedCache = new Map<string, Promise<DecodedSpectrogram>>();

async function decodeSpectrogramPng(url: string): Promise<DecodedSpectrogram> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch spectrogram (${response.status})`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(bitmapSourceFrom(blob));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const data = new Uint8Array(bitmap.width * bitmap.height);
    for (let i = 0; i < data.length; i++) {
      data[i] = rgba[i * 4]!;
    }
    return { width: bitmap.width, height: bitmap.height, data };
  } finally {
    bitmap.close();
  }
}

function bitmapSourceFrom(blob: Blob): ImageBitmapSource {
  return blob;
}

function loadDecodedSpectrogram(url: string): Promise<DecodedSpectrogram> {
  let pending = decodedCache.get(url);
  if (!pending) {
    pending = decodeSpectrogramPng(url).catch((error) => {
      decodedCache.delete(url);
      throw error;
    });
    decodedCache.set(url, pending);
  }
  return pending;
}

let swatchCtx: CanvasRenderingContext2D | null = null;

function cssColorToOklch(cssColor: string): OklchColor | null {
  if (!cssColor) return null;
  if (!swatchCtx && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    swatchCtx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!swatchCtx) return null;
  swatchCtx.clearRect(0, 0, 1, 1);
  swatchCtx.fillStyle = "transparent";
  swatchCtx.fillStyle = cssColor;
  swatchCtx.fillRect(0, 0, 1, 1);
  const pixel = swatchCtx.getImageData(0, 0, 1, 1).data;
  return srgbToOklch(pixel[0]!, pixel[1]!, pixel[2]!);
}

function readRoomPalette(element: HTMLElement): {
  dark: boolean;
  artLch: OklchColor;
} {
  const styles = getComputedStyle(element);
  const paperColor = styles.getPropertyValue("--paper").trim();
  const artColor = styles.getPropertyValue("--art").trim();
  const paperLch = cssColorToOklch(paperColor);
  const dark = paperLch
    ? paperLch.L < 0.5
    : document.documentElement.classList.contains("dark");
  const artLch = cssColorToOklch(artColor) ?? { L: 0.55, C: 0, H: 0 };
  return { dark, artLch };
}

const FREQUENCY_GUIDES = [100, 1000, 10_000] as const;
const FREQUENCY_TICKS: readonly { hz: number; label: string }[] = [
  { hz: 50, label: "50" },
  { hz: 200, label: "200" },
  { hz: 1000, label: "1k" },
  { hz: 4000, label: "4k" },
  { hz: 16_000, label: "16k" },
];

/**
 * Studio-grade listening-room spectrogram: decodes the calibrated grayscale
 * PNG once into a cached `Uint8Array`, paints to a DPR-scaled `<canvas>` via a
 * 256-entry OKLCH `--art` LUT (`[−68 dB, −6 dB]`, gamma `1.35`, silence
 * transparent), overlays subtle log-frequency guides and ticks, and shows a
 * `fine:` hover crosshair with `time · Hz (note) · dB` studio readout.
 */
export function SpectrogramStrip({
  spectrogramKey,
  durationSeconds,
  getSeconds,
  onSeek,
}: {
  spectrogramKey: string;
  durationSeconds: number;
  getSeconds: () => number;
  onSeek: (seconds: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [decoded, setDecoded] = useState<DecodedSpectrogram | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [paletteTick, setPaletteTick] = useState(0);

  const url = mediaProxyUrl(spectrogramKey);

  useEffect(() => {
    if (!url || typeof createImageBitmap !== "function") return;
    let cancelled = false;
    loadDecodedSpectrogram(url)
      .then((result) => {
        if (!cancelled) setDecoded(result);
      })
      .catch(() => {
        // Leave canvas empty on network or decode failure.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setBoxSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height }
      );
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bump = () => setPaletteTick((t) => t + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const artHost = canvas.closest<HTMLElement>("[style*='--art']");
    if (artHost && artHost !== document.documentElement) {
      observer.observe(artHost, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !decoded || boxSize.width <= 0 || boxSize.height <= 0) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const dstWidth = Math.max(1, Math.round(boxSize.width * dpr));
    const dstHeight = Math.max(1, Math.round(boxSize.height * dpr));
    if (canvas.width !== dstWidth) canvas.width = dstWidth;
    if (canvas.height !== dstHeight) canvas.height = dstHeight;

    const palette = readRoomPalette(canvas);
    const lut = buildSpectrogramLut(palette);
    const imageData = ctx.createImageData(dstWidth, dstHeight);
    const out = new Uint32Array(imageData.data.buffer);

    renderSpectrogramToPixels({
      data: decoded.data,
      srcWidth: decoded.width,
      srcHeight: decoded.height,
      dstWidth,
      dstHeight,
      lut,
      out,
    });
    ctx.putImageData(imageData, 0, 0);
  }, [decoded, boxSize, paletteTick]);

  const sampleDbAt = (ratio: number, yRatio: number): number => {
    if (!decoded) return SPECTROGRAM_FLOOR_DB;
    const col = Math.min(
      decoded.width - 1,
      Math.max(0, Math.floor(ratio * decoded.width))
    );
    const band = Math.min(
      decoded.height - 1,
      Math.max(0, Math.round((1 - yRatio) * (decoded.height - 1)))
    );
    const byte = decoded.data[band * decoded.width + col] ?? 0;
    return spectrogramByteToDb(byte);
  };

  return (
    <StripRow
      label="Spectrogram"
      durationSeconds={durationSeconds}
      getSeconds={getSeconds}
      onSeek={onSeek}
      className={expanded ? "h-44" : "h-24 phone:h-20"}
      eyebrow={
        <button
          type="button"
          aria-pressed={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex cursor-pointer items-center gap-1 text-micro text-ink-soft motion-ink hover:text-ink"
        >
          {expanded ? (
            <>
              <IconArrowsMinimize className="size-3" aria-hidden />
              Collapse
            </>
          ) : (
            <>
              <IconArrowsMaximize className="size-3" aria-hidden />
              Expand
            </>
          )}
        </button>
      }
      renderHoverReadout={(hover) => {
        const hz = hzForTopFraction(hover.yRatio);
        const db = sampleDbAt(hover.ratio, hover.yRatio);
        return formatSpectrogramReadout(hover.seconds, hz, db);
      }}
      renderOverlay={(hover) =>
        hover ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 hidden h-px bg-ink-faint/60 fine:block"
            style={{ top: `${hover.yRatio * 100}%` }}
          />
        ) : null
      }
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
      {FREQUENCY_GUIDES.map((hz) => (
        <span
          key={hz}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-px bg-[color-mix(in_oklab,var(--ink)_8%,transparent)]"
          style={{ top: `${topFractionForHz(hz) * 100}%` }}
        />
      ))}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-1 select-none"
      >
        {FREQUENCY_TICKS.map(({ hz, label }) => {
          const pct = Math.min(92, Math.max(8, topFractionForHz(hz) * 100));
          return (
            <span
              key={hz}
              className="absolute right-0 -translate-y-1/2 text-micro/none text-ink-faint tabular-nums"
              style={{ top: `${pct}%` }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </StripRow>
  );
}
