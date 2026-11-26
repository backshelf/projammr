import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * How a file on disk is handed to the browser. The type is the caller's to
 * decide — the stored MIME for files that render inline, an octet stream for
 * anything that is only ever saved — as is the name the download manager
 * shows for it.
 */
export interface FileResponseOptions {
  /** The `Content-Type` to send. */
  type: string;
  /**
   * The name in `Content-Disposition`. Quotes, backslashes and line breaks are
   * stripped so an uploaded name cannot break out of the header.
   */
  filename: string;
  /** Hand the bytes to the download manager rather than rendering them. */
  attachment: boolean;
  /** Headers on every response, such as `ETag` and `Cache-Control`. */
  headers?: Record<string, string>;
}

/**
 * The inclusive byte span a `Range` header asks for, so `<audio>` can seek
 * without fetching the whole file. `undefined` means serve the whole file: no
 * header, a unit other than bytes, or several ranges (answered in full rather
 * than as a multipart body). A span that starts past the end is unsatisfiable.
 */
function byteRange(
  header: string | undefined,
  size: number
): [start: number, end: number] | "unsatisfiable" | undefined {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;
  const [, from, to] = match;
  if (!from && !to) return undefined;

  if (!from) {
    // A suffix: the last `to` bytes.
    const length = Math.min(Number(to), size);
    return length === 0 ? "unsatisfiable" : [size - length, size - 1];
  }

  const start = Number(from);
  const end = to ? Math.min(Number(to), size - 1) : size - 1;
  if (start >= size || start > end) return "unsatisfiable";
  return [start, end];
}

/**
 * The `Content-Disposition` value naming `name`. A header value is a byte
 * string, so a character past Latin-1 in `filename` (the em dash in every Lab
 * bounce's name) would fail the whole response; a name outside printable
 * ASCII therefore goes in `filename` with those characters replaced, and in
 * full as RFC 6266's UTF-8 `filename*`, which browsers prefer when present.
 */
export function contentDisposition(
  disposition: "attachment" | "inline",
  name: string
): string {
  const filename = name.replace(/["\\\r\n]/g, "");
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  if (ascii === filename) return `${disposition}; filename="${filename}"`;
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Serves a file from disk with the headers every served file carries and full
 * `Range` support (206 for a satisfiable span, 416 for one past the end). A
 * file that is missing is a 404: the row that names it has outlived the bytes.
 */
export async function fileResponse(
  c: Context,
  path: string,
  options: FileResponseOptions
): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new HTTPException(404);

  const { type, attachment } = options;
  const headers = {
    ...options.headers,
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Disposition": contentDisposition(
      attachment ? "attachment" : "inline",
      options.filename
    ),
  };

  const range = byteRange(c.req.header("range"), file.size);
  if (range === "unsatisfiable") {
    return c.body(null, 416, {
      ...headers,
      "Content-Range": `bytes */${file.size}`,
    });
  }
  if (range) {
    const [start, end] = range;
    return new Response(file.slice(start, end + 1, type), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${file.size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(file, { headers });
}
