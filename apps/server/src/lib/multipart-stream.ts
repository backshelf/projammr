import {
  getMultipartBoundary,
  MaxHeaderSizeExceededError,
  MultipartParseError,
} from "@mjackson/multipart-parser";
import type { Context } from "hono";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, invalidRequest } from "./http.js";
import {
  type InstancePolicy,
  instancePolicy,
  UPLOAD_ENVELOPE_BYTES,
  uploadLimitBytes,
} from "./instance-policy.js";
import { AUDIO_SIGNATURE_BYTES } from "./media.js";
import {
  LOCAL_TMP_DIR,
  STATIC_ROOT,
  storageBackend,
  unlinkQuietly,
} from "./storage.js";

const HEADER_END = Buffer.from("\r\n\r\n");
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_TEXT_FIELD_BYTES = 64 * 1024;
const MAX_TOTAL_TEXT_BYTES = 256 * 1024;
const MAX_PARTS = 64;
const MAX_PREAMBLE_BYTES = 8 * 1024;
const FORBIDDEN_FIELD_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export type StreamedFile = {
  /** Local staging file holding the streamed upload bytes. */
  tempPath: string;
  /** Original filename from the multipart `Content-Disposition` header. */
  name: string;
  /** Declared MIME type from the part's `Content-Type` header. */
  type: string;
  /** Total bytes written to `tempPath`. */
  size: number;
  /** First `AUDIO_SIGNATURE_BYTES` (up to 6 KiB) captured while streaming. */
  head: Uint8Array;
};

export type StreamedMultipart = {
  file: StreamedFile | null;
  fields: Record<string, string>;
  /** Idempotently deletes the staged temp file if it still exists. */
  cleanup: () => Promise<void>;
};

export type StreamMultipartOptions = {
  /** Form field name expected to hold the file part. Defaults to `"file"`. */
  fieldName?: string;
  /** Maximum file size in bytes. Defaults to `uploadLimitBytes(instancePolicy())`. */
  maxFileBytes?: number;
  /** Allowed MIME types for the file part, evaluated from the active policy. */
  acceptedTypes?: (policy: InstancePolicy) => readonly string[];
};

const streamedCache = new WeakMap<Request, Promise<StreamedMultipart>>();
const cleanupCache = new WeakMap<Request, () => Promise<void>>();

/** Whether the request carries a `multipart/form-data` content type. */
export function isMultipartFormRequest(c: Context): boolean {
  const ct = c.req.header("content-type");
  return ct != null && /^multipart\/form-data\b/i.test(ct.trim());
}

/**
 * Cleans up any staged temp file created while streaming `c`'s multipart body.
 * Safe to call even when no upload was streamed or cleanup already ran.
 */
export async function cleanupStreamedUpload(c: Context): Promise<void> {
  const cleanup = cleanupCache.get(c.req.raw);
  if (cleanup) {
    cleanupCache.delete(c.req.raw);
    await cleanup();
  }
}

function tooBigError(maximum: number): ApiError {
  return new ApiError(400, {
    code: "invalid_request",
    message: "Invalid request",
    details: {
      issues: [
        {
          code: "too_big",
          origin: "file",
          maximum,
          path: ["file"],
          message: `File is over the ${maximum}-byte upload limit`,
        },
      ],
    },
  });
}

function invalidMimeError(
  actual: string,
  allowed: readonly string[]
): ApiError {
  return new ApiError(400, {
    code: "invalid_request",
    message: "Invalid request",
    details: {
      issues: [
        {
          code: "invalid_value",
          values: [...allowed],
          path: ["file"],
          message: `Invalid file type "${actual}": expected one of ${allowed.join(", ")}`,
        },
      ],
    },
  });
}

function assertAcceptedMime(
  file: StreamedFile | null,
  acceptedTypes: ((policy: InstancePolicy) => readonly string[]) | undefined
): void {
  if (!file || !acceptedTypes) return;
  const allowed = acceptedTypes(instancePolicy());
  if (!allowed.includes(file.type)) {
    throw invalidMimeError(file.type, allowed);
  }
}

/** Ensures a staged file part is present, or throws a 400 `invalid_request`. */
export function requireUploadedFile(upload: StreamedMultipart): StreamedFile {
  if (!upload.file) {
    throw invalidRequest([
      { path: ["file"], code: "invalid_type", message: "Expected file" },
    ]);
  }
  return upload.file;
}

type PartHeaders = {
  name?: string;
  filename?: string;
  contentType?: string;
};

function decodeRfc5987(value: string): string {
  const match = /^[^']*'[^']*'(.*)$/.exec(value);
  const encoded = match ? match[1]! : value;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function parsePartHeaders(raw: string): PartHeaders {
  let name: string | undefined;
  let filename: string | undefined;
  let filenameStar: string | undefined;
  let contentType: string | undefined;

  for (const line of raw.split(/\r\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "content-disposition") {
      const nameMatch =
        /(?:^|;)\s*name=(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(value);
      if (nameMatch) {
        name = (nameMatch[1] ?? nameMatch[2] ?? "").replace(/\\(.)/g, "$1");
      }

      const fnStarMatch = /(?:^|;)\s*filename\*=([^;\s]+)/i.exec(value);
      if (fnStarMatch?.[1]) {
        filenameStar = decodeRfc5987(fnStarMatch[1]);
      }

      const fnMatch =
        /(?:^|;)\s*filename=(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(value);
      if (fnMatch) {
        filename = (fnMatch[1] ?? fnMatch[2] ?? "").replace(/\\(.)/g, "$1");
      }
    } else if (key === "content-type") {
      contentType = value.split(";")[0]?.trim().toLowerCase() || undefined;
    }
  }

  return {
    name,
    filename: filenameStar ?? filename,
    contentType,
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b;
  if (b.byteLength === 0) return a;
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Buffer): number {
  return Buffer.from(
    haystack.buffer,
    haystack.byteOffset,
    haystack.byteLength
  ).indexOf(needle);
}

/**
 * Picks a staging path on the same filesystem as `./static` for local storage
 * so `putFromFile` is an atomic `rename`, or `os.tmpdir()` when storing to S3.
 */
async function createStagingPath(): Promise<string> {
  const id = crypto.randomUUID();
  if (storageBackend().kind === "local") {
    const dir = join(STATIC_ROOT, LOCAL_TMP_DIR);
    await mkdir(dir, { recursive: true });
    return join(dir, `upload-${id}.tmp`);
  }
  return join(tmpdir(), `projammr-upload-${id}.tmp`);
}

type ActiveFilePart = {
  kind: "file";
  tempPath: string;
  name: string;
  type: string;
  writer: Bun.FileSink;
  size: number;
  head: Uint8Array;
  headFilled: number;
};

type ActiveTextPart = {
  kind: "text";
  name: string;
  chunks: Uint8Array[];
  size: number;
};

type ActiveSkipPart = {
  kind: "skip";
};

type ActivePart = ActiveFilePart | ActiveTextPart | ActiveSkipPart;

/**
 * Streams a `multipart/form-data` `Request` chunk-by-chunk, writing the file
 * part straight to a temporary file on disk while capturing the first
 * {@link AUDIO_SIGNATURE_BYTES} and text form fields in memory.
 *
 * Enforces `maxFileBytes` (default: active instance policy upload limit) and
 * optional `acceptedTypes` on the fly, aborting and unlinking the temp file
 * immediately on refusal or error.
 */
export async function streamMultipartRequest(
  request: Request,
  options: StreamMultipartOptions = {}
): Promise<StreamedMultipart> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType.trim())) {
    throw invalidRequest([
      { path: ["file"], message: "Expected multipart/form-data body" },
    ]);
  }
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    throw invalidRequest([
      { path: ["file"], message: "Missing multipart boundary" },
    ]);
  }
  if (!request.body) {
    throw invalidRequest([
      { path: ["file"], message: "Request body is empty" },
    ]);
  }

  const fieldName = options.fieldName ?? "file";
  const policy = instancePolicy();
  const maxFileBytes = options.maxFileBytes ?? uploadLimitBytes(policy);
  const maxStreamBytes = maxFileBytes + UPLOAD_ENVELOPE_BYTES;
  const allowedTypes = options.acceptedTypes?.(policy);

  const opening = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);

  const fields: Record<string, string> = Object.create(null);
  let completedFile: StreamedFile | null = null;
  let activePart: ActivePart | null = null;
  let state: "preamble" | "after-boundary" | "headers" | "body" | "done" =
    "preamble";
  let preambleBytes = 0;
  let totalStreamBytes = 0;
  let totalTextBytes = 0;
  let partCount = 0;
  let buf: Uint8Array = new Uint8Array(0);
  const decoder = new TextDecoder("utf-8");

  const tempPaths = new Set<string>();
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    const paths = [...tempPaths];
    tempPaths.clear();
    await Promise.all(paths.map((path) => unlinkQuietly(path)));
  };

  async function writePartData(chunk: Uint8Array): Promise<void> {
    if (chunk.byteLength === 0 || !activePart) return;
    if (activePart.kind === "skip") return;

    if (activePart.kind === "text") {
      activePart.size += chunk.byteLength;
      totalTextBytes += chunk.byteLength;
      if (activePart.size > MAX_TEXT_FIELD_BYTES) {
        throw new MultipartParseError(
          `Form field "${activePart.name}" exceeds ${MAX_TEXT_FIELD_BYTES} bytes`
        );
      }
      if (totalTextBytes > MAX_TOTAL_TEXT_BYTES) {
        throw new MultipartParseError(
          `Total multipart text fields exceed ${MAX_TOTAL_TEXT_BYTES} bytes`
        );
      }
      activePart.chunks.push(chunk.slice());
      return;
    }

    activePart.size += chunk.byteLength;
    if (activePart.size > maxFileBytes) {
      throw tooBigError(maxFileBytes);
    }

    if (activePart.headFilled < AUDIO_SIGNATURE_BYTES) {
      const take = Math.min(
        chunk.byteLength,
        AUDIO_SIGNATURE_BYTES - activePart.headFilled
      );
      activePart.head.set(chunk.subarray(0, take), activePart.headFilled);
      activePart.headFilled += take;
    }

    const written = activePart.writer.write(chunk);
    if (written instanceof Promise) await written;
  }

  async function finishPart(): Promise<void> {
    if (!activePart) return;
    const part = activePart;
    activePart = null;

    if (part.kind === "skip") return;
    if (part.kind === "text") {
      if (FORBIDDEN_FIELD_NAMES.has(part.name)) return;
      const combined = new Uint8Array(part.size);
      let offset = 0;
      for (const piece of part.chunks) {
        combined.set(piece, offset);
        offset += piece.byteLength;
      }
      fields[part.name] = decoder.decode(combined);
      return;
    }

    await part.writer.end();
    completedFile = {
      tempPath: part.tempPath,
      name: part.name,
      type: part.type,
      size: part.size,
      head: part.head.subarray(0, part.headFilled),
    };
  }

  async function startPart(headers: PartHeaders): Promise<void> {
    partCount++;
    if (partCount > MAX_PARTS) {
      throw new MultipartParseError(
        `Multipart request exceeds maximum of ${MAX_PARTS} parts`
      );
    }
    if (!headers.name) {
      activePart = { kind: "skip" };
      return;
    }

    if (headers.name === fieldName && headers.filename !== undefined) {
      const mime = headers.contentType ?? "application/octet-stream";
      if (allowedTypes && !allowedTypes.includes(mime)) {
        throw invalidMimeError(mime, allowedTypes);
      }
      if (completedFile) {
        await unlinkQuietly(completedFile.tempPath);
        tempPaths.delete(completedFile.tempPath);
        completedFile = null;
      }
      const tempPath = await createStagingPath();
      tempPaths.add(tempPath);
      const writer = Bun.file(tempPath).writer();
      activePart = {
        kind: "file",
        tempPath,
        name: headers.filename,
        type: mime,
        writer,
        size: 0,
        head: new Uint8Array(AUDIO_SIGNATURE_BYTES),
        headFilled: 0,
      };
      return;
    }

    if (headers.filename !== undefined) {
      // Unrequested file field: discard without buffering in memory.
      activePart = { kind: "skip" };
      return;
    }

    activePart = {
      kind: "text",
      name: headers.name,
      chunks: [],
      size: 0,
    };
  }

  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalStreamBytes += value.byteLength;
      if (totalStreamBytes > maxStreamBytes) {
        throw tooBigError(maxFileBytes);
      }

      buf = concatBytes(buf, value);

      for (;;) {
        if (state === "preamble") {
          const idx = indexOfBytes(buf, opening);
          if (idx === -1) {
            const keep = Math.min(buf.byteLength, opening.length - 1);
            preambleBytes += buf.byteLength - keep;
            if (preambleBytes > MAX_PREAMBLE_BYTES) {
              throw new MultipartParseError(
                "Invalid multipart stream: missing initial boundary"
              );
            }
            buf =
              keep > 0 ? buf.slice(buf.byteLength - keep) : new Uint8Array(0);
            break;
          }
          buf = buf.subarray(idx + opening.length);
          state = "after-boundary";
        }

        if (state === "after-boundary") {
          if (buf.byteLength < 2) {
            buf = buf.slice();
            break;
          }
          if (buf[0] === 0x2d && buf[1] === 0x2d) {
            state = "done";
            buf = new Uint8Array(0);
            break;
          }
          if (buf[0] === 0x0d && buf[1] === 0x0a) {
            buf = buf.subarray(2);
            state = "headers";
          } else {
            throw new MultipartParseError(
              "Invalid multipart stream: expected CRLF after boundary"
            );
          }
        }

        if (state === "headers") {
          const headerEnd = indexOfBytes(buf, HEADER_END);
          if (headerEnd === -1) {
            if (buf.byteLength > MAX_HEADER_BYTES) {
              throw new MaxHeaderSizeExceededError(MAX_HEADER_BYTES);
            }
            buf = buf.slice();
            break;
          }
          if (headerEnd > MAX_HEADER_BYTES) {
            throw new MaxHeaderSizeExceededError(MAX_HEADER_BYTES);
          }
          const rawHeaders = decoder.decode(buf.subarray(0, headerEnd));
          await startPart(parsePartHeaders(rawHeaders));
          buf = buf.subarray(headerEnd + HEADER_END.length);
          state = "body";
        }

        if (state === "body") {
          const boundaryIdx = indexOfBytes(buf, delimiter);
          if (boundaryIdx === -1) {
            const safeLen = buf.byteLength - (delimiter.length - 1);
            if (safeLen > 0) {
              await writePartData(buf.subarray(0, safeLen));
              buf = buf.slice(safeLen);
            } else {
              buf = buf.slice();
            }
            break;
          }
          await writePartData(buf.subarray(0, boundaryIdx));
          await finishPart();
          buf = buf.subarray(boundaryIdx + delimiter.length);
          state = "after-boundary";
        }
      }

      if (state === "done") {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    if (state !== "done") {
      throw new MultipartParseError("Incomplete multipart stream");
    }

    return { file: completedFile, fields, cleanup };
  } catch (error) {
    const dangling = activePart as ActivePart | null;
    if (dangling?.kind === "file") {
      try {
        await dangling.writer.end();
      } catch {
        // Ignore close error while propagating the original failure.
      }
    }
    await reader.cancel().catch(() => undefined);
    await cleanup();
    if (error instanceof ApiError) throw error;
    if (error instanceof MultipartParseError) {
      throw invalidRequest([{ path: ["file"], message: error.message }]);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Streams `c`'s multipart upload once and memoizes the result on `c.req.raw`,
 * so `authorizeProject` can inspect `fields.projectId` and the route handler
 * can consume the already-staged file without re-reading or buffering the body.
 */
export async function streamMultipartUpload(
  c: Context,
  options: StreamMultipartOptions = {}
): Promise<StreamedMultipart> {
  const raw = c.req.raw;
  let pending = streamedCache.get(raw);
  if (!pending) {
    pending = streamMultipartRequest(raw, options).then((result) => {
      cleanupCache.set(raw, result.cleanup);
      return result;
    });
    streamedCache.set(raw, pending);
  }
  const result = await pending;
  // Re-check `acceptedTypes` / `maxFileBytes` in case `authorizeProject`
  // triggered the stream before the route supplied its MIME filter.
  if (result.file && options.maxFileBytes !== undefined) {
    if (result.file.size > options.maxFileBytes) {
      await result.cleanup();
      throw tooBigError(options.maxFileBytes);
    }
  }
  try {
    assertAcceptedMime(result.file, options.acceptedTypes);
  } catch (error) {
    await result.cleanup();
    throw error;
  }
  return result;
}
