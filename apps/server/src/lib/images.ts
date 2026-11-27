import { basename, extname } from "node:path";
import sharp from "sharp";
import { addVariantUsage } from "../db/queries/storage-usage.js";
import {
  readStoredBytes,
  removeStoredFile,
  storageBackend,
  storeBytes,
  storedFileExists,
  storedFilePath,
  withLocalStoredFile,
} from "./storage.js";

// Cap libvips' thread pool and operation cache so image resizing cannot contend
// with ffmpeg or retain large decoded buffers in memory.
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 64 });

/**
 * The widths a stored image is offered at, chosen from what the client actually
 * renders at 2× device pixels: 64 for table thumbs (28–32px), 256 for the rail
 * thumb, attachment thumbs and every blurred artwork backdrop, 1024 for the
 * uploader preview and the settings preview. Anything else is a 400 rather than
 * a resize, so the cache cannot be filled by a stranger picking widths.
 */
export const VARIANT_WIDTHS = [64, 256, 1024] as const;

export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

export function isVariantWidth(width: number): width is VariantWidth {
  return (VARIANT_WIDTHS as readonly number[]).includes(width);
}

/**
 * The encodings a resize is offered in. WebP is what the app renders; JPEG is
 * for the consumers that cannot read it, such as a link-unfurl poster; PNG is
 * for consumers that cannot read WebP and need transparency preserved, such
 * as Satori's `ImageResponse` drawing a brand mark.
 */
export const VARIANT_FORMATS = ["webp", "jpeg", "png"] as const;

export type VariantFormat = (typeof VARIANT_FORMATS)[number];

/** The MIME type a variant of each format is served as. */
export const VARIANT_CONTENT_TYPES: Record<VariantFormat, string> = {
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** The directory every cached resize is stored under, as a stored key. */
const VARIANT_PREFIX = "images/variants/";

/**
 * The stored key of the resize of one image. The name carries the original's
 * UUID, the width and the format, so a variant is derivable from the
 * original's key alone and no second row is needed to find one.
 */
export function variantKey(
  key: string,
  width: VariantWidth,
  format: VariantFormat = "webp"
): string {
  return `${VARIANT_PREFIX}${basename(key, extname(key))}-w${width}.${format}`;
}

/** Where the resize of one stored image lives on disk. */
export const variantPath = (
  key: string,
  width: VariantWidth,
  format: VariantFormat = "webp"
): string => storedFilePath(variantKey(key, width, format));

/**
 * The original's UUID a variant key names, and the width and format it holds —
 * the read of `variantKey` that lets a file on disk be traced back to the image
 * row it belongs to. Null for a key that is not a variant at all.
 */
export function readVariantKey(
  key: string
): { stem: string; width: number; format: VariantFormat } | null {
  if (!key.startsWith(VARIANT_PREFIX)) return null;

  const match = /^(.+)-w(\d+)\.(webp|jpeg|png)$/.exec(
    key.slice(VARIANT_PREFIX.length)
  );
  return match?.[1] && match[2] && match[3]
    ? {
        stem: match[1],
        width: Number(match[2]),
        format: match[3] as VariantFormat,
      }
    : null;
}

/** The UUID an image's key carries, which its variants are named after. */
export const imageKeyStem = (key: string): string =>
  basename(key, extname(key));

const inFlight = new Map<string, Promise<string>>();

function encodeVariant(
  input: string | Uint8Array,
  width: VariantWidth,
  format: VariantFormat
): Promise<Buffer> {
  const resized = sharp(input).resize({
    width,
    withoutEnlargement: true,
  });
  const encoded =
    format === "jpeg"
      ? resized.jpeg({ quality: 82 })
      : format === "png"
        ? resized.png()
        : resized.webp({ quality: 82 });
  return encoded.toBuffer();
}

/**
 * Resizes and encodes one stored image into the requested variant buffer.
 * On local storage, passes the file path straight to libvips rather than
 * buffering the whole original image in JS memory; remote backends fall back
 * to reading the stored bytes.
 */
export async function renderVariant(
  key: string,
  width: VariantWidth,
  format: VariantFormat = "webp"
): Promise<Buffer> {
  if (storageBackend().kind === "local") {
    return withLocalStoredFile(key, (localPath) =>
      encodeVariant(localPath, width, format)
    );
  }
  return encodeVariant(await readStoredBytes(key), width, format);
}

/**
 * Stored key of the cached variant, generating it through the active storage
 * backend if it is missing.
 *
 * Concurrent callers for the same variant share one generation: a page that
 * renders twenty thumbs off a cold cache would otherwise start twenty sharp
 * pipelines over the same file and have them race to write the same key.
 *
 * `withoutEnlargement` keeps an image smaller than the requested width at its
 * own size — the point is to send fewer bytes, never more.
 */
export function ensureVariantKey(
  key: string,
  width: VariantWidth,
  format: VariantFormat = "webp"
): Promise<string> {
  const targetKey = variantKey(key, width, format);

  const pending = inFlight.get(targetKey);
  if (pending) return pending;

  const work = (async () => {
    if (await storedFileExists(targetKey)) return targetKey;

    const buffer = await renderVariant(key, width, format);

    await storeBytes(targetKey, buffer, VARIANT_CONTENT_TYPES[format]);

    // Counted here rather than by each caller: a resize is generated from a
    // request, from the variants job and from a share page, and every one of
    // those adds bytes to the image's project and uploader.
    await addVariantUsage(key, buffer.byteLength);

    return targetKey;
  })().finally(() => inFlight.delete(targetKey));

  inFlight.set(targetKey, work);
  return work;
}

/** Local path of the cached variant, generating it if it is missing. */
export async function ensureVariant(
  key: string,
  width: VariantWidth,
  format: VariantFormat = "webp"
): Promise<string> {
  return storedFilePath(await ensureVariantKey(key, width, format));
}

/**
 * Drops every variant of a stored image, called wherever the original is
 * removed. The widths are a fixed set, so the keys are derived rather than
 * discovered — a directory holding one entry per image per width is not worth
 * scanning to delete three files.
 */
export async function removeVariants(key: string): Promise<void> {
  for (const width of VARIANT_WIDTHS) {
    for (const format of VARIANT_FORMATS) {
      await removeStoredFile(variantKey(key, width, format));
    }
  }
}
