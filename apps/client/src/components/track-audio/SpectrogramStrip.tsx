"use client";

import { StripRow } from "@/components/track-audio/StripRow";
import { mediaProxyUrl } from "@/lib/utils";

/**
 * The stored spectrogram PNG, tinted by the artwork colour rather than drawn
 * in its own grayscale: the image sits over an artwork-coloured background
 * and a blend mode combines them. `writeSpectrogramPng`'s bytes are 0 at
 * −90 dB and 255 at 0 dB, so a bright pixel is an energetic band. Both
 * themes read the same way: a loud band shows the artwork tone and a quiet
 * one fades into the paper. On dark paper that is `multiply` over the plain
 * image (black silences the tint, white keeps it); on light paper it is
 * `screen` over the `invert`ed image (a quiet band, inverted to white, lifts
 * to the paper; a loud band, inverted to black, leaves the tint showing). The
 * one strip that is an image rather than a drawing, and taller than the rest
 * — 48px — since the picture needs the room a ruler does not.
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
  return (
    <StripRow
      label="Spectrogram"
      durationSeconds={durationSeconds}
      getSeconds={getSeconds}
      onSeek={onSeek}
      className="h-12"
    >
      <div className="absolute inset-0 bg-art">
        {/* eslint-disable-next-line @next/next/no-img-element -- fills a fluid strip at any width; next/image's fixed intrinsic size does not fit, and the API's images are already unoptimized */}
        <img
          src={mediaProxyUrl(spectrogramKey)}
          alt=""
          aria-hidden
          // `object-fill` stretches the tile to the strip's own duration
          // width instead of `object-cover` cropping whatever does not fit
          // the strip's aspect ratio. `writeSpectrogramPng` stores the
          // lowest band in row 0, the PNG's top row, so a vertical flip
          // here puts bass back at the bottom the way every other
          // spectrogram reads it.
          className="size-full -scale-y-100 object-fill mix-blend-screen invert dark:mix-blend-multiply dark:invert-0"
        />
      </div>
    </StripRow>
  );
}
