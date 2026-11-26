/**
 * A 24-bit FLAC encoder over libFLAC (`libflacjs`): the format the bounce
 * prints to, lossless like a 24-bit WAV at roughly half the bytes, so a
 * full-length song fits under the server's upload cap. It takes the loaded
 * library rather than loading it, so the worker that wraps it
 * (`flac-encode.worker.ts`) supplies the browser's WebAssembly build and a
 * test supplies the same build read from disk, and this file tests directly
 * with no worker or audio context.
 *
 * Calls the low-level `Flac` API directly rather than `libflacjs/lib/encoder`
 * or `libflacjs/lib/utils`: those wrappers are TypeScript UMD modules whose
 * shadowed `require` parameter breaks Turbopack's static resolution.
 */

import type { Flac, StreamMetadata } from "libflacjs";
import { FLAC_BITS_PER_SAMPLE } from "./flac-size";

/** libFLAC's default preset: most of level 8's size for a fraction of its time. */
const COMPRESSION_LEVEL = 5;
/** Frames converted and handed to libFLAC at a time, so its heap never holds the whole song. */
const CHUNK_FRAMES = 1 << 16;
/** Full-scale magnitudes either side of zero for a 24-bit signed sample. */
const POSITIVE_FULL_SCALE = 0x7fffff;
const NEGATIVE_FULL_SCALE = 0x800000;
/** 4-byte `fLaC` marker + 4-byte block header + 34-byte STREAMINFO payload. */
const FLAC_STREAMINFO_END = 42;

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

function concatChunks(
  chunks: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  let totalBytes = 0;
  for (const chunk of chunks) totalBytes += chunk.byteLength;
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Writes the finalized STREAMINFO fields (frame size bounds, 36-bit total
 * sample count, and 16-byte MD5) into the leading STREAMINFO block. The
 * streaming encoder cannot seek back to rewrite them once encoding finishes.
 */
function patchStreamInfo(
  bytes: Uint8Array<ArrayBuffer>,
  metadata: StreamMetadata
): void {
  if (
    bytes.byteLength < FLAC_STREAMINFO_END ||
    bytes[0] !== 0x66 || // 'f'
    bytes[1] !== 0x4c || // 'L'
    bytes[2] !== 0x61 || // 'a'
    bytes[3] !== 0x43 || // 'C'
    (bytes[4]! & 0x7f) !== 0
  ) {
    throw new Error("The bounce could not be encoded");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 24-bit big-endian min_framesize (bytes 12..14) and max_framesize (15..17).
  view.setUint8(12, (metadata.min_framesize >>> 16) & 0xff);
  view.setUint8(13, (metadata.min_framesize >>> 8) & 0xff);
  view.setUint8(14, metadata.min_framesize & 0xff);
  view.setUint8(15, (metadata.max_framesize >>> 16) & 0xff);
  view.setUint8(16, (metadata.max_framesize >>> 8) & 0xff);
  view.setUint8(17, metadata.max_framesize & 0xff);

  // 36-bit big-endian total_samples: low 4 bits of byte 21 + bytes 22..25.
  const highBits = Math.floor(metadata.total_samples / 0x100000000) & 0x0f;
  view.setUint8(21, (view.getUint8(21) & 0xf0) | highBits);
  view.setUint32(22, metadata.total_samples >>> 0);

  // 16-byte MD5 digest (bytes 26..41).
  for (let i = 0; i < 16; i++) {
    view.setUint8(
      26 + i,
      Number.parseInt(metadata.md5sum.slice(i * 2, i * 2 + 2), 16)
    );
  }
}

/**
 * Encodes `channels` (one Float32Array per channel, equal length, samples in
 * -1..1) at `sampleRate` as a 24-bit FLAC file, with the total sample count
 * and the audio's MD5 written into STREAMINFO. Throws if libFLAC refuses the
 * configuration or fails partway.
 */
export function encodeFlac24(
  flac: Flac,
  channels: Float32Array[],
  sampleRate: number
): Uint8Array<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const encoderId = flac.create_libflac_encoder(
    sampleRate,
    channels.length,
    FLAC_BITS_PER_SAMPLE,
    COMPRESSION_LEVEL,
    frames
  );
  if (encoderId === 0) {
    throw new Error("The bounce could not be encoded");
  }

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let metadata: StreamMetadata | undefined;

  try {
    const initStatus = flac.init_encoder_stream(
      encoderId,
      (data) => {
        chunks.push(data);
      },
      (m) => {
        if (m) metadata = m;
      }
    );
    if (initStatus !== 0) {
      throw new Error("The bounce could not be encoded");
    }

    for (let start = 0; start < frames; start += CHUNK_FRAMES) {
      const end = Math.min(frames, start + CHUNK_FRAMES);
      const chunk = channels.map((channel) => toInt24(channel, start, end));
      if (!flac.FLAC__stream_encoder_process(encoderId, chunk, end - start)) {
        throw new Error("The bounce could not be encoded");
      }
    }

    if (!flac.FLAC__stream_encoder_finish(encoderId) || !metadata) {
      throw new Error("The bounce could not be encoded");
    }

    const bytes = concatChunks(chunks);
    patchStreamInfo(bytes, metadata);
    return bytes;
  } finally {
    flac.FLAC__stream_encoder_delete(encoderId);
  }
}
