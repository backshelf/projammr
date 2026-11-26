/**
 * Size estimation for 24-bit FLAC bounces, kept separate from the encoder
 * (`flac-encode.ts`) so callers on the main thread and SSR never pull the
 * encoder module into the page bundle.
 */

export const FLAC_BITS_PER_SAMPLE = 24;

/**
 * The share of 24-bit PCM a bounce's FLAC is assumed to take when checking it
 * against the upload cap before rendering. Mastered music at 24 bits
 * typically lands between 0.5 and 0.7; 0.75 sits above that so a borderline
 * song is stopped before its render rather than after. Full-scale noise
 * does not compress at all (about 1.0), which is why the upload's own
 * `too_big` answer is still handled.
 */
export const FLAC_SIZE_RATIO = 0.75;

/** `fLaC`, STREAMINFO, and the padding and vendor comment libFLAC writes. */
const FLAC_HEADER_BYTES = 8192;

/** The estimated FLAC size, in bytes, of `frames` frames of `channels`-channel 24-bit audio. */
export function estimateFlacBytes(frames: number, channels: number): number {
  const pcmBytes = frames * channels * (FLAC_BITS_PER_SAMPLE / 8);
  return Math.ceil(pcmBytes * FLAC_SIZE_RATIO) + FLAC_HEADER_BYTES;
}
