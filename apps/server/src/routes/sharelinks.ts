import { Hono } from "hono";
import { z } from "zod";
import type { AuthType } from "../auth.js";
import {
  convertSharelink,
  convertSharelinkSchema,
  createSharelink,
  editSharelinkSchema,
  getShareOptions,
  listSharelinks,
  newShareRequestSchema,
  shareOptionsSchema,
  sharelinkWithTracksSchema,
  revokeSharelink,
  updateSharelink,
  updateSharelinkTracks,
  updateSharelinkTracksSchema,
} from "../db/queries/sharelinks.js";
import { SHARELINK_ENTITIES } from "../db/schema/sharelinks.js";
import { describer, idValue, respond, validator } from "../lib/http.js";
import { authenticated } from "../middleware/authenticated.js";

const { describe, describeRaw } = describer("Share links");

/**
 * A share's management surface — the link itself: listing, building, editing
 * and deleting one. Everything a project member does, never a guest.
 * `routes/share-guest.ts` holds the token-gated reads, `/stream`, and the
 * comment routes: a comment's own gate is the token plus authorship
 * (`assertShareComment`, `updateComment`/`deleteComment`'s author check),
 * never project membership, so posting, editing and deleting one all belong
 * there even though a guest wrote it. Every route here stays behind
 * `authenticated`, per-route as before the split; the per-route
 * `assertMayManageSharelink` checks the query layer runs are unchanged.
 * Mounted in `app.ts` **ahead of** `share-guest`'s `/:token` catch-all, so a
 * static path here (`/options`) is never read as a token.
 */
const app = new Hono<{ Variables: AuthType }>();

/** Names the entity whose share links (or shareable versions) are being read. */
const entityQuery = z.object({
  entityType: z.enum(SHARELINK_ENTITIES),
  entityId: idValue,
});

const sharelinkListSchema = z.array(sharelinkWithTracksSchema);

app.get(
  "/",
  authenticated,
  describe(
    "List every share link on a track or collection",
    { schema: sharelinkListSchema },
    400,
    403,
    404
  ),
  validator("query", entityQuery),
  async (c) => {
    const { entityType, entityId } = c.req.valid("query");
    return respond(
      c,
      sharelinkListSchema,
      await listSharelinks(entityType, entityId, c.get("user")!.id)
    );
  }
);

app.get(
  "/options",
  authenticated,
  describe(
    "What a snapshot can include. The tracks and versions a snapshot of this entity can be built from.",
    { schema: shareOptionsSchema },
    400,
    403,
    404
  ),
  validator("query", entityQuery),
  async (c) => {
    const { entityType, entityId } = c.req.valid("query");
    return respond(
      c,
      shareOptionsSchema,
      await getShareOptions(entityType, entityId, c.get("user")!.id)
    );
  }
);

app.post(
  "/snapshot",
  authenticated,
  describe(
    "Share a track or collection as a frozen snapshot",
    { schema: sharelinkWithTracksSchema, status: 201 },
    400,
    403,
    404,
    409
  ),
  validator("json", newShareRequestSchema),
  async (c) =>
    respond(
      c,
      sharelinkWithTracksSchema,
      await createSharelink("snapshot", c.req.valid("json"), c.get("user")!.id),
      201
    )
);

app.post(
  "/connected",
  authenticated,
  describe(
    "Share a track or collection as a connected link. It always reads the entity's current state.",
    { schema: sharelinkWithTracksSchema, status: 201 },
    400,
    403,
    404
  ),
  validator("json", newShareRequestSchema),
  async (c) =>
    respond(
      c,
      sharelinkWithTracksSchema,
      await createSharelink(
        "connected",
        c.req.valid("json"),
        c.get("user")!.id
      ),
      201
    )
);

app.patch(
  "/:token",
  authenticated,
  describe(
    "Update a share link's editable facets",
    { schema: sharelinkWithTracksSchema },
    400,
    403,
    404,
    410
  ),
  validator("json", editSharelinkSchema.partial()),
  async (c) =>
    respond(
      c,
      sharelinkWithTracksSchema,
      await updateSharelink(
        c.req.param("token"),
        c.get("user")!.id,
        c.req.valid("json")
      )
    )
);

app.patch(
  "/:token/tracks",
  authenticated,
  describe(
    "Refresh a snapshot share's tracks. Rebuilds its frozen track list from the live entity.",
    { schema: sharelinkWithTracksSchema },
    400,
    403,
    404,
    409,
    410
  ),
  validator("json", updateSharelinkTracksSchema),
  async (c) =>
    respond(
      c,
      sharelinkWithTracksSchema,
      await updateSharelinkTracks(
        c.req.param("token"),
        c.get("user")!.id,
        c.req.valid("json")
      )
    )
);

app.post(
  "/:token/convert",
  authenticated,
  describe(
    "Convert a share link between snapshot and connected",
    { schema: sharelinkWithTracksSchema },
    400,
    403,
    404,
    409,
    410
  ),
  validator("json", convertSharelinkSchema),
  async (c) =>
    respond(
      c,
      sharelinkWithTracksSchema,
      await convertSharelink(
        c.req.param("token"),
        c.get("user")!.id,
        c.req.valid("json")
      )
    )
);

app.delete(
  "/:token",
  authenticated,
  describeRaw(
    "Turn a share link off. It stops working for anyone holding it, and turning off a link already off succeeds.",
    { status: 204, description: "Share link turned off" },
    403,
    404
  ),
  async (c) => {
    await revokeSharelink(c.req.param("token"), c.get("user")!.id);
    return c.body(null, 204);
  }
);

export default app;
