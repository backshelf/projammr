import {
  AUDIO_EXTENSIONS,
  IMAGE_TYPES,
} from "@workspace/settings/groups/instance-limits";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../auth.js";
import { describer, respond } from "../lib/http.js";
import { instancePolicy, uploadLimitBytes } from "../lib/instance-policy.js";

const { describe } = describer("Uploads");

const app = new Hono<AuthedEnv>();

const uploadLimitsSchema = z.object({
  /** The largest file `POST /assets/upload` and `POST /images/upload` accept. */
  maxBytes: z.number().int().positive(),
  /** The audio formats `POST /assets/upload` takes, by extension; any other file is an attachment. */
  audioTypes: z.array(z.enum(AUDIO_EXTENSIONS)),
  /** The image types `POST /images/upload` takes, by MIME type. */
  imageTypes: z.array(z.enum(IMAGE_TYPES)),
  /** Whether the instance pushes samples for every repo, so a repo made now pushes them whatever its own switch says. */
  pushSamplesEverywhere: z.boolean(),
});

app.get(
  "/limits",
  describe(
    "Get the upload limits. The limits every upload route enforces, for a client that has to check a file before it produces one.",
    {
      schema: uploadLimitsSchema,
      description: "Successfully retrieved the upload limits",
    }
  ),
  (c) => {
    const policy = instancePolicy();
    return respond(c, uploadLimitsSchema, {
      maxBytes: uploadLimitBytes(policy),
      audioTypes: [...policy.limits.audioTypes],
      imageTypes: [...policy.limits.imageTypes],
      pushSamplesEverywhere: policy.limits.pushSamplesEverywhere === true,
    });
  }
);

export default app;
