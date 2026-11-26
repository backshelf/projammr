import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { basename, extname } from "node:path";
import { z } from "zod";
import type { AuthType } from "../auth.js";
import {
  commentWithRepliesSchema,
  commentWithUserSchema,
} from "../db/queries/comments.js";
import {
  createShareComment,
  deleteShareComment,
  editShareCommentSchema,
  getShareComments,
  getSharelink,
  newShareCommentSchema,
  resolveSharelinkTrackAudio,
  sharelinkWithTracksSchema,
  updateShareComment,
} from "../db/queries/sharelinks.js";
import { describer, idValue, params, respond, validator } from "../lib/http.js";
import {
  ensureVariant,
  isVariantWidth,
  VARIANT_CONTENT_TYPES,
  VARIANT_WIDTHS,
} from "../lib/images.js";
import { fileResponse } from "../lib/serve-file.js";
import { storedFilePath } from "../lib/storage.js";
import { guestAccess, guestOrMember } from "../middleware/authenticated.js";
import { rateLimit } from "../middleware/rate-limit.js";

const { describe, describeRaw } = describer("Share page");

/**
 * A share's guest-facing surface: what a reader who holds nothing but the
 * token — signed out, or signed in as the anonymous session a share page
 * mints for commenting — may reach, while the instance allows guests
 * (`guestAccess`, first on every route; members pass it either way). That
 * includes editing and deleting a comment, since a comment's gate is the
 * token plus authorship (`assertShareComment` below the token check, then the
 * comment queries' own author-only check), never project membership — a guest
 * wrote it, so a guest edits or deletes it. `routes/sharelinks.ts` holds the
 * share link's own management (list, options, create, patch, delete,
 * snapshot), gated at `authenticated`, which never sees a guest at all. Paths
 * are unchanged from before the split; only which router answers them moved.
 */
const app = new Hono<{ Variables: AuthType }>();

const commentThreadSchema = z.array(commentWithRepliesSchema);

/** The `id` query parameter naming a track audio, on the routes that grant
 * access to one track within a share. */
const trackAudioIdQuery = z.object({ id: idValue });

/** Anything that would break out of the quoted filename, or out of its
 *  directory, once a browser writes the download to disk. */
const safeFilename = (value: string) =>
  value.replace(/["\\\r\n]/g, "").replace(/[/\\]/g, "-");

/**
 * What a download is saved as. A snapshot names the file after the title it
 * froze, keeping the real extension, so the name the file was uploaded under
 * never reaches a guest; every other share keeps the uploaded name.
 */
function downloadFilename(
  shareType: "snapshot" | "connected",
  title: string | undefined,
  name: string | undefined
) {
  if (shareType === "snapshot" && title?.trim()) {
    return safeFilename(`${title.trim()}${extname(name ?? "")}`);
  }
  return safeFilename(basename(name ?? "audio"));
}

app.get(
  "/:token",
  guestAccess,
  rateLimit("share-read"),
  describe(
    "Get a share link. Its details and the tracks it currently grants.",
    { schema: sharelinkWithTracksSchema },
    404,
    410
  ),
  async (c) =>
    respond(
      c,
      sharelinkWithTracksSchema,
      await getSharelink(c.req.param("token"))
    )
);

app.get(
  "/:token/stream",
  guestAccess,
  rateLimit("share-stream"),
  describeRaw(
    "Stream or download one of the share's tracks. Needs no authentication.",
    { description: "The audio bytes" },
    400,
    403,
    404,
    410
  ),
  validator(
    "query",
    trackAudioIdQuery.extend({ download: z.string().optional() })
  ),
  async (c) => {
    const { id, download } = c.req.valid("query");
    const { sharelink, track } = await resolveSharelinkTrackAudio(
      c.req.param("token"),
      id
    );

    const wantsDownload = download !== undefined;
    if (wantsDownload && !sharelink.isDownloadsEnabled) {
      throw new HTTPException(403, {
        message: "Downloads are not enabled for this share",
      });
    }

    const { assetPath, type, name } = track.trackAudio;
    if (!assetPath || !type) throw new HTTPException(404);

    return fileResponse(c, storedFilePath(assetPath), {
      type,
      filename: downloadFilename(sharelink.shareType, track.title, name),
      attachment: wantsDownload,
    });
  }
);

/**
 * The encodings this route offers, a strict subset of `VARIANT_FORMATS`: a
 * cover is a photo, never a logo, so it has no need of PNG's transparency,
 * and the poster that fetches this route with `format=jpeg` is the one
 * consumer that cannot read WebP.
 */
const SHARE_COVER_FORMATS = ["webp", "jpeg"] as const;

app.get(
  "/:token/cover/:id",
  guestAccess,
  rateLimit("share-stream"),
  describeRaw(
    "The cover of one of the share's tracks, as WebP or JPEG",
    { description: "The image bytes" },
    400,
    404,
    410
  ),
  params({ token: z.string(), id: idValue }),
  validator(
    "query",
    z.object({
      w: z.string().optional(),
      format: z.enum(SHARE_COVER_FORMATS).optional(),
    })
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { track } = await resolveSharelinkTrackAudio(
      c.req.param("token"),
      id
    );
    if (!track.artwork) throw new HTTPException(404);

    // Only the resizes are served, never the original: a variant has a
    // content type this route knows without sniffing a UUID-named file, and
    // the three widths are the only ones any caller asks for.
    const { w, format = "webp" } = c.req.valid("query");
    const width = Number(w ?? 1024);
    if (!isVariantWidth(width)) {
      throw new HTTPException(400, {
        message: `Width must be one of ${VARIANT_WIDTHS.join(", ")}`,
      });
    }

    const path = await ensureVariant(track.artwork.assetPath, width, format);

    return c.body(Bun.file(path).stream(), {
      headers: {
        "Content-Type": VARIANT_CONTENT_TYPES[format],
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
);

app.get(
  "/:token/comments",
  guestAccess,
  rateLimit("share-read"),
  describe(
    "Get the comments on one of the share's tracks",
    { schema: commentThreadSchema },
    400,
    404,
    410
  ),
  validator("query", trackAudioIdQuery),
  async (c) =>
    respond(
      c,
      commentThreadSchema,
      await getShareComments(
        c.req.param("token"),
        c.req.valid("query").id,
        c.get("user")?.id ?? null
      )
    )
);

app.post(
  "/:token/comments",
  guestAccess,
  guestOrMember,
  rateLimit("share-comment"),
  describe(
    "Leave a timestamped comment on one of the share's tracks. 403 when the project takes no comments through its share links.",
    { schema: commentWithUserSchema, status: 201 },
    400,
    403,
    404,
    410
  ),
  validator("json", newShareCommentSchema),
  async (c) =>
    respond(
      c,
      commentWithUserSchema,
      await createShareComment(
        c.req.param("token"),
        c.get("user")!.id,
        c.req.valid("json")
      ),
      201
    )
);

app.patch(
  "/:token/comments/:id",
  guestAccess,
  guestOrMember,
  rateLimit("share-comment"),
  describe(
    "Edit a comment left through this share",
    { schema: commentWithUserSchema },
    400,
    403,
    404,
    410
  ),
  params({ token: z.string(), id: idValue }),
  validator("json", editShareCommentSchema),
  async (c) =>
    respond(
      c,
      commentWithUserSchema,
      await updateShareComment(
        c.req.param("token"),
        c.get("user")!.id,
        c.req.valid("param").id,
        c.req.valid("json")
      )
    )
);

app.delete(
  "/:token/comments/:id",
  guestAccess,
  guestOrMember,
  rateLimit("share-comment"),
  describeRaw(
    "Delete a comment left through this share",
    { status: 204, description: "Comment deleted" },
    400,
    403,
    404,
    410
  ),
  params({ token: z.string(), id: idValue }),
  async (c) => {
    await deleteShareComment(
      c.req.param("token"),
      c.get("user")!.id,
      c.req.valid("param").id
    );
    return c.body(null, 204);
  }
);

export default app;
