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

function uploadTooBigError(maximum: number): ApiError {
  const issue: ValidationIssue = {
    path: ["file"],
    code: "too_big",
    maximum,
    message: `File is over the ${maximum}-byte upload limit`,
  };
  return new ApiError(400, {
    code: "invalid_request",
    message: "Invalid request",
    details: { issues: [issue] },
  });
}

/**
 * Wraps `source` in a pass-through `ReadableStream` that counts bytes as chunks
 * flow downstream without buffering them in RAM. Once the total exceeds
 * `maxSize`, it cancels `source` and errors the stream with `tooBigError`.
 */
function countingBodyStream(
  source: ReadableStream<Uint8Array>,
  maxSize: number,
  maximum: number
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let seen = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen > maxSize) {
        await reader.cancel().catch(() => undefined);
        controller.error(uploadTooBigError(maximum));
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

/**
 * An upload route reads at most the instance's upload limit and the envelope
 * around the file, read from the policy for each request. Declared lengths over
 * the cap are refused before any byte is read; unsized or chunked bodies are
 * wrapped in a zero-buffer counting stream so they abort mid-stream without
 * buffering the whole upload in RAM. Either path answers with the shared 400
 * `too_big` issue carrying `maximum`.
 */
export const uploadBodyLimit = createMiddleware(async (c, next) => {
  if (!c.req.raw.body) return next();

  const maximum = uploadLimitBytes();
  const maxSize = maximum + UPLOAD_ENVELOPE_BYTES;
  const headers = c.req.raw.headers;
  const hasTransferEncoding = headers.has("transfer-encoding");

  if (headers.has("content-length") && !hasTransferEncoding) {
    const declared = Number.parseInt(headers.get("content-length") || "0", 10);
    if (declared > maxSize) {
      throw uploadTooBigError(maximum);
    }
    return next();
  }

  const counted = countingBodyStream(c.req.raw.body, maxSize, maximum);
  c.req.raw = new Request(c.req.raw, {
    body: counted,
    duplex: "half",
  } as RequestInit);
  return next();
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
