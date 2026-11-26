/**
 * A 24-bit FLAC encoder over libFLAC (`libflacjs`): the format the bounce
 * prints to, lossless like a 24-bit WAV at roughly half the bytes, so a
 * full-length song fits under the server's upload cap. It takes the loaded
 * library rather than loading it, so the worker that wraps it
 * (`flac-encode.worker.ts`) supplies the browser's WebAssembly build and a
 * test supplies the same build read from disk, and this file tests directly
 * with no worker or audio context.
 */

import type { Flac } from "libflacjs";
import { Encoder } from "libflacjs/lib/encoder";
import { exportFlacData } from "libflacjs/lib/utils";

const FLAC_BITS_PER_SAMPLE = 24;
/** libFLAC's default preset: most of level 8's size for a fraction of its time. */
const COMPRESSION_LEVEL = 5;
/** Frames converted and handed to libFLAC at a time, so its heap never holds the whole song. */
const CHUNK_FRAMES = 1 << 16;
/** Full-scale magnitudes either side of zero for a 24-bit signed sample. */
const POSITIVE_FULL_SCALE = 0x7fffff;
const NEGATIVE_FULL_SCALE = 0x800000;

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

/**
 * Resolves once `flac` has finished loading. The WebAssembly build
 * instantiates asynchronously, and calling into it before then fails.
 */
export function whenFlacReady(flac: Flac): Promise<Flac> {
  return new Promise((resolve) => {
    if (flac.isReady()) resolve(flac);
    else flac.on("ready", () => resolve(flac));
  });
}

/** `channel[start, end)` as 24-bit signed integers, clamped to ±1 first. */
function toInt24(
  channel: Float32Array,
  start: number,
  end: number
): Int32Array<ArrayBuffer> {
  const out = new Int32Array(end - start);
  for (let i = start; i < end; i++) {
    const sample = Math.min(1, Math.max(-1, channel[i] ?? 0));
    out[i - start] = Math.round(
      sample < 0 ? sample * NEGATIVE_FULL_SCALE : sample * POSITIVE_FULL_SCALE
    );
  }
  return out;
}

/**
 * Encodes `channels` (one Float32Array per channel, equal length, samples in
 * -1..1) at `sampleRate` as a 24-bit FLAC file, with the total sample count
 * and the audio's MD5 written into STREAMINFO. Throws if libFLAC refuses the
 * configuration or fails partway.
 */
export async function encodeFlac24(
  flac: Flac,
  channels: Float32Array[],
  sampleRate: number
): Promise<Uint8Array<ArrayBuffer>> {
  const frames = channels[0]?.length ?? 0;
  const encoder = new Encoder(flac, {
    sampleRate,
    channels: channels.length,
    bitsPerSample: FLAC_BITS_PER_SAMPLE,
    compression: COMPRESSION_LEVEL,
    totalSamples: frames,
  });
  try {
    for (let start = 0; start < frames; start += CHUNK_FRAMES) {
      const end = Math.min(frames, start + CHUNK_FRAMES);
      const chunk = channels.map((channel) => toInt24(channel, start, end));
      if (!encoder.encode(chunk, end - start)) {
        throw new Error("The bounce could not be encoded");
      }
    }
    const metadata = encoder.encode() ? encoder.metadata : undefined;
    if (!metadata) throw new Error("The bounce could not be encoded");
    return await exportFlacData(encoder.rawData, metadata, false);
  } finally {
    encoder.destroy();
  }
}
