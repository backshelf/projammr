import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { basename } from "node:path";
import type { AuthType } from "./auth.js";
import {
  getStaticFileByKey,
  type StaticFileKind,
  type StaticFileRecord,
} from "./db/queries/assets.js";
import { isMemberAtLeast } from "./db/queries/authorization.js";
import { trustedOrigins } from "./lib/env.js";
import {
  ensureVariantKey,
  isVariantWidth,
  VARIANT_CONTENT_TYPES,
  VARIANT_FORMATS,
  type VariantFormat,
  type VariantWidth,
  VARIANT_WIDTHS,
} from "./lib/images.js";
import { fileResponse } from "./lib/serve-file.js";

/**
 * The media types served in the browser rather than handed to the download
 * manager. Uploads are unrestricted — a music project legitimately stores
 * stems, PDFs and zips — so the guard is on serving: only audio and images
 * render on the API origin, and everything else is bytes to save. An uploaded
 * `text/html` replayed inline would run script where the session cookie lives.
 */
const INLINE_MIME = /^(audio|image)\//;

const CACHE_CONTROL = "private, max-age=3600";
const VARIANT_CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * Cache-Control header for a static response. Resized image variants are
 * derived from content-immutable UUID keys at fixed width/format parameters, so
 * they can be cached immutably for a year; original files keep a shorter
 * private cache window.
 */
export function staticCacheControl(width: VariantWidth | undefined): string {
  return width !== undefined ? VARIANT_CACHE_CONTROL : CACHE_CONTROL;
}

/**
 * The width a request is asking for, or `undefined` when it wants the original.
 * A width that is not on offer is a 400 rather than a silent full-size reply,
 * so a client asking for one it will not get hears about it — and the variant
 * cache cannot be grown a width at a time by anyone who can read the file.
 */
function requestedWidth(
  raw: string | undefined,
  kind: StaticFileKind
): VariantWidth | undefined {
  if (raw === undefined) return undefined;

  if (kind !== "image") {
    throw new HTTPException(400, { message: "Only images can be resized" });
  }

  const width = Number(raw);
  if (!isVariantWidth(width)) {
    throw new HTTPException(400, {
      message: `Width must be one of ${VARIANT_WIDTHS.join(", ")}`,
    });
  }

  return width;
}

/**
 * The encoding a resize is asked for, defaulting to WebP. Only meaningful
 * alongside a width — a request for the original ignores `?format=`, exactly
 * as it always has — so this is only called once a width has been resolved.
 */
function requestedFormat(raw: string | undefined): VariantFormat {
  if (raw === undefined) return "webp";

  if (!(VARIANT_FORMATS as readonly string[]).includes(raw)) {
    throw new HTTPException(400, {
      message: `Format must be one of ${VARIANT_FORMATS.join(", ")}`,
    });
  }

  return raw as VariantFormat;
}

/**
 * The stored key a request is for — the request path with the `/static/` mount
 * removed, which is exactly the string the owning row holds.
 */
function storedKeyOf(requestPath: string): string {
  return requestPath.replace(/^\/static\//, "");
}

function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  return (
    ifNoneMatch !== undefined &&
    ifNoneMatch.split(",").some((candidate) => candidate.trim() === etag)
  );
}

export const staticFiles = new Hono<{ Variables: AuthType }>({
  strict: false,
});

staticFiles.use(
  "/static/*",
  cors({
    origin: trustedOrigins,
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    allowHeaders: ["Content-Type", "Range"],
    exposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
    credentials: true,
  })
);

/**
 * Who may have a stored file its row does not make public. A share-page guest
 * reads bytes only through the share stream route, never here, and is
 * refused whether or not the key exists, so a guest cannot use this route's
 * status code to probe for one. An avatar is shown wherever its owner appears
 * — member lists, uploader columns — so it is readable by any signed-in user.
 * Everything else is gated on membership of the project that owns it.
 */
async function assertMayRead(
  user: AuthType["user"],
  record: StaticFileRecord | undefined
): Promise<void> {
  if (user?.isAnonymous) {
    throw new HTTPException(403, { message: "This needs an account" });
  }
  if (!record) throw new HTTPException(404);
  if (!user) throw new HTTPException(401);
  if (record.scope === "project") {
    if (
      record.projectId == null ||
      !(await isMemberAtLeast(user.id, record.projectId, "viewer"))
    ) {
      throw new HTTPException(403);
    }
  }
}

/**
 * Uploaded files are private, and the row that points at a file is what makes
 * it readable: no row means no reader, so an orphan left behind by a deleted
 * row — or anything else that lands in `./static` — is a 404 for everyone. An
 * instance image is the exception: the instance's own logo and icon, which
 * only an admin uploads, and which a signed-out page, a share page's guest, a
 * mail client and a home screen all show, so anyone may have it.
 */
staticFiles.use("/static/*", async (c) => {
  const record = await getStaticFileByKey(storedKeyOf(c.req.path));
  if (record?.scope !== "instance") {
    await assertMayRead(c.get("user"), record);
  }
  if (!record) throw new HTTPException(404);

  const width = requestedWidth(c.req.query("w"), record.kind);
  const format: VariantFormat = width
    ? requestedFormat(c.req.query("format"))
    : "webp";

  // Stored files are immutable — a UUID name is never rewritten — so the tag
  // identifies the row rather than the bytes, and no file is read to produce
  // it. The width and format are part of it: the same path now serves three
  // encodings.
  const etag = `"${record.kind}-${record.id}-${record.size}${
    width ? `-w${width}-${format}` : ""
  }"`;

  const cacheControl = staticCacheControl(width);

  // Validated after the gate, so an outsider holding a tag from elsewhere is
  // still refused rather than told the file is unchanged.
  if (matchesEtag(c.req.header("if-none-match"), etag)) {
    c.header("ETag", etag);
    c.header("Cache-Control", cacheControl);
    return c.body(null, 304);
  }

  const filename = basename(record.name);
  const headers = { ETag: etag, "Cache-Control": cacheControl };

  if (width) {
    return fileResponse(
      c,
      await ensureVariantKey(record.assetPath, width, format),
      {
        type: VARIANT_CONTENT_TYPES[format],
        filename,
        attachment: false,
        headers,
      }
    );
  }

  const inline = INLINE_MIME.test(record.type);

  // The stored MIME is authoritative for the types served inline: files are
  // named by a UUID plus an extension, and a type guessed from that extension
  // can differ from what was uploaded (`audio/x-wav` for `audio/wav`).
  return fileResponse(c, storedKeyOf(c.req.path), {
    type: inline ? record.type : "application/octet-stream",
    filename,
    attachment: !inline || c.req.query("download") !== undefined,
    headers,
  });
});
