import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { ApiError, type ValidationIssue } from "../lib/http.js";
import {
  REQUEST_BODY_CAP_BYTES,
  UPLOAD_ENVELOPE_BYTES,
  instancePolicy,
  uploadLimitBytes,
} from "../lib/instance-policy.js";

/*
 * The limits on what a route reads, checked before anything reads it: a
 * declared `Content-Length` over the limit is refused without a byte being
 * read, and a body sent with no length is counted as it streams in and
 * refused the moment it passes. `Bun.serve`'s own cap sits at the upload
 * ceiling, far above both, so these are what hold a request to its route's
 * allowance.
 */

/**
 * Every route but an upload reads at most {@link REQUEST_BODY_CAP_BYTES}; a
 * larger body is a 413 in the shared envelope.
 */
export const requestBodyCap = bodyLimit({
  maxSize: REQUEST_BODY_CAP_BYTES,
  onError: () => {
    throw new HTTPException(413, { message: "Request body too large" });
  },
});

/**
 * An upload route reads at most the instance's upload limit and the envelope
 * around the file, read from the policy for each request. A body over it is
 * refused the way the route's own validator refuses a file over the limit —
 * a 400 whose `details.issues` holds a `too_big` issue for `file` carrying
 * the `maximum` — so a client reads one answer whichever check caught it.
 */
export const uploadBodyLimit = createMiddleware(async (c, next) => {
  const maximum = uploadLimitBytes();
  return bodyLimit({
    maxSize: maximum + UPLOAD_ENVELOPE_BYTES,
    onError: () => {
      const issue: ValidationIssue = {
        path: ["file"],
        code: "too_big",
        maximum,
        message: `File is over the ${maximum}-byte upload limit`,
      };
      throw new ApiError(400, {
        code: "invalid_request",
        message: "Invalid request",
        details: { issues: [issue] },
      });
    },
  })(c, next);
});

/**
 * The pack upload (`POST /repos/:id/objects`) reads at most the instance's
 * upload limit, and only a body that declares its length: a pack with no
 * `Content-Length` is a 411 before a byte is read, and one over the limit is a
 * 413 `pack_too_large` rather than the file uploads' `too_big` on a `file`
 * field, which a raw octet-stream body does not have. Mount it after the
 * project gate, so a caller outside the project is answered 404 before any
 * 411 or 413.
 */
export const packBodyLimit = createMiddleware(async (c, next) => {
  const { body, headers } = c.req.raw;
  if (
    body &&
    (!headers.has("content-length") || headers.has("transfer-encoding"))
  ) {
    throw new ApiError(411, {
      code: "length_required",
      message: "A pack needs a Content-Length",
    });
  }
  const policy = instancePolicy();
  return bodyLimit({
    maxSize: uploadLimitBytes(policy),
    onError: () => {
      throw new ApiError(413, {
        code: "pack_too_large",
        message: `This pack is larger than this instance's upload limit (${policy.limits.maxUploadMb} MB)`,
      });
    },
  })(c, next);
});
