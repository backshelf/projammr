import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import sharp from "sharp";
import { addVariantUsage } from "../db/queries/storage-usage.js";
import { storedFilePath, unlinkQuietly } from "./storage.js";

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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Path of the cached variant, generating it if it is missing.
 *
 * Concurrent callers for the same variant share one generation: a page that
 * renders twenty thumbs off a cold cache would otherwise start twenty sharp
 * pipelines over the same file and have them race to write the same path.
 *
 * `withoutEnlargement` keeps an image smaller than the requested width at its
 * own size — the point is to send fewer bytes, never more.
 */
export function ensureVariant(
  key: string,
  width: VariantWidth,
  format: VariantFormat = "webp"
): Promise<string> {
  const target = variantPath(key, width, format);

  const pending = inFlight.get(target);
  if (pending) return pending;

  const work = (async () => {
    if (await exists(target)) return target;

    await mkdir(dirname(target), { recursive: true });
    const resized = sharp(storedFilePath(key)).resize({
      width,
      withoutEnlargement: true,
    });
    const encoded =
      format === "jpeg"
        ? resized.jpeg({ quality: 82 })
        : format === "png"
          ? resized.png()
          : resized.webp({ quality: 82 });
    const { size } = await encoded.toFile(target);

    // Counted here rather than by each caller: a resize is generated from a
    // request, from the variants job and from a share page, and every one of
    // those adds bytes to the image's project and uploader.
    await addVariantUsage(key, size);

    return target;
  })().finally(() => inFlight.delete(target));

  inFlight.set(target, work);
  return work;
}

/**
 * Drops every variant of a stored image, called wherever the original is
 * unlinked. The widths are a fixed set, so the paths are derived rather than
 * discovered — a directory holding one entry per image per width is not worth
 * scanning to delete three files.
 */
export async function removeVariants(key: string): Promise<void> {
  for (const width of VARIANT_WIDTHS) {
    for (const format of VARIANT_FORMATS) {
      await unlinkQuietly(variantPath(key, width, format));
    }
  }
}
