import type { Context } from "hono";
import { z } from "zod";
import {
  type InstancePolicy,
  instancePolicy,
  uploadLimitBytes,
} from "./instance-policy.js";

const HEADER_END = Buffer.from("\r\n\r\n");

/**
 * A multipart file field held to the instance's upload limit, and to the MIME
 * types `acceptedTypes` names when it is given. Both are read from the policy
 * each time a request is parsed, not when the route is declared, so a changed
 * limit applies to the next upload; one already past validation finishes under
 * the limit it was checked against. A refusal is the same issue `z.file().max()`
 * and `.mime()` raise — a `too_big` issue carries the `maximum`, which the
 * client reads to say what the limit is.
 */
export const uploadedFile = (
  acceptedTypes?: (policy: InstancePolicy) => readonly string[]
) =>
  z.file().check((ctx) => {
    const policy = instancePolicy();
    const file = ctx.value;

    const maximum = uploadLimitBytes(policy);
    if (file.size > maximum) {
      ctx.issues.push({
        code: "too_big",
        origin: "file",
        maximum,
        inclusive: true,
        input: file,
      });
    }

    const types = acceptedTypes?.(policy);
    if (types && !types.includes(file.type)) {
      ctx.issues.push({
        code: "invalid_value",
        values: [...types],
        input: file.type,
      });
    }
  });

/**
 * The `Content-Type` the client declared for a multipart file field.
 *
 * Bun's `FormData` parser ignores a part's declared type and derives `File.type`
 * from the filename's extension instead (`clip.wav` sent as `audio/wav` reads as
 * `audio/x-wav`, a `.bin` as `application/octet-stream`), so the stored MIME
 * would drift from what was uploaded. The part headers are read back out of the
 * raw body, which Hono has already buffered to parse the form, so nothing is
 * read twice. `undefined` when the field is missing or declared no type.
 */
export async function declaredFileType(
  c: Context,
  field: string
): Promise<string | undefined> {
  const boundary = c.req
    .header("content-type")
    ?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary) return undefined;

  const body = Buffer.from(await c.req.arrayBuffer());
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);

  for (
    let at = body.indexOf(delimiter);
    at !== -1;
    at = body.indexOf(delimiter, at + delimiter.length)
  ) {
    const headersStart = at + delimiter.length + 2;
    const headersEnd = body.indexOf(HEADER_END, headersStart);
    if (headersEnd === -1) return undefined;

    const headers = body.toString("utf8", headersStart, headersEnd);
    const name = headers.match(/^content-disposition:.*;\s*name="([^"]*)"/im);
    if (name?.[1] !== field) continue;

    return headers.match(/^content-type:\s*([^\r\n;]+)/im)?.[1]?.trim();
  }
  return undefined;
}
