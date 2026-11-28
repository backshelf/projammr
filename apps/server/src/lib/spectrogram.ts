import sharp from "sharp";
import { SPECTROGRAM_BANDS } from "@workspace/dsp/offline";
import { newStorageKey, storeBytes } from "./storage.js";

/**
 * `bytes` is column-major (one column's `SPECTROGRAM_BANDS` values together,
 * lowest band first) the way `OfflineAnalyses.spectrogram` stores it; `sharp`
 * needs row-major raw pixels (one image row, left to right, at a time). Band
 * `y` becomes the PNG's row `y`, so the lowest band renders at the top.
 */
function toRowMajor(bytes: Uint8Array, columns: number): Buffer {
  const rowMajor = Buffer.alloc(columns * SPECTROGRAM_BANDS);
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < SPECTROGRAM_BANDS; y++) {
      rowMajor[y * columns + x] = bytes[x * SPECTROGRAM_BANDS + y]!;
    }
  }
  return rowMajor;
}

/**
 * Writes a session's spectrogram tile as a single-channel grayscale PNG under
 * `STORAGE_DIR.analysis` and returns the stored key with the bytes it took —
 * the file is nobody's upload, so its size is only knowable here and the row
 * records it for the storage counters. The client tints the band values
 * itself; the file holds the raw dB-mapped bytes only.
 */
export async function writeSpectrogramPng(
  bytes: Uint8Array,
  columns: number
): Promise<{ key: string; bytes: number }> {
  const key = newStorageKey("analysis", "png");
  const buffer = await sharp(toRowMajor(bytes, columns), {
    raw: { width: columns, height: SPECTROGRAM_BANDS, channels: 1 },
  })
    .toColourspace("b-w")
    .png()
    .toBuffer();
  await storeBytes(key, buffer, "image/png");
  return { key, bytes: buffer.byteLength };
}
