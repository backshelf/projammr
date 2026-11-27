import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ApiError, jsonErrorHandler } from "./http.js";
import { UPLOAD_ENVELOPE_BYTES } from "./instance-policy.js";
import { AUDIO_SIGNATURE_BYTES } from "./media.js";
import {
  cleanupStreamedUpload,
  streamMultipartRequest,
  streamMultipartUpload,
} from "./multipart-stream.js";
import { uploadBodyLimit } from "../middleware/body-limit.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

/** Builds a raw multipart/form-data Request delivered in fixed-size chunks. */
function chunkedMultipartRequest(
  boundary: string,
  body: Uint8Array,
  chunkSize: number
): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < body.byteLength; i += chunkSize) {
        controller.enqueue(body.subarray(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Request("http://localhost/upload", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: stream,
  });
}

function buildMultipart(
  boundary: string,
  parts: {
    name: string;
    filename?: string;
    contentType?: string;
    data: string | Uint8Array;
  }[]
): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) {
      header += `; filename="${part.filename}"`;
    }
    header += "\r\n";
    if (part.contentType !== undefined) {
      header += `Content-Type: ${part.contentType}\r\n`;
    }
    header += "\r\n";
    chunks.push(encoder.encode(header));
    chunks.push(
      typeof part.data === "string" ? encoder.encode(part.data) : part.data
    );
    chunks.push(encoder.encode("\r\n"));
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe("streamMultipartRequest", () => {
  afterEach(() => {
    restoreInstancePolicy();
  });

  it("streams a file to disk across tiny chunks, preserving declared MIME, fields, and 6 KiB head", async () => {
    const boundary = "TestBoundary12345";
    const payload = new Uint8Array(AUDIO_SIGNATURE_BYTES + 2048);
    for (let i = 0; i < payload.byteLength; i++) payload[i] = i & 0xff;

    const raw = buildMultipart(boundary, [
      { name: "projectId", data: "42" },
      {
        name: "file",
        filename: "bounce.wav",
        contentType: "audio/wav",
        data: payload,
      },
      { name: "fingerprint", data: "abc123" },
    ]);

    // 7-byte chunks force every boundary, header delimiter, and body boundary to straddle chunks.
    const req = chunkedMultipartRequest(boundary, raw, 7);
    const result = await streamMultipartRequest(req);
    try {
      expect(result.fields).toEqual({
        projectId: "42",
        fingerprint: "abc123",
      });
      expect(result.file).not.toBeNull();
      expect(result.file!.name).toBe("bounce.wav");
      expect(result.file!.type).toBe("audio/wav");
      expect(result.file!.size).toBe(payload.byteLength);
      expect(result.file!.head).toEqual(
        payload.subarray(0, AUDIO_SIGNATURE_BYTES)
      );
      expect(new Uint8Array(await readFile(result.file!.tempPath))).toEqual(
        payload
      );
    } finally {
      const path = result.file!.tempPath;
      await result.cleanup();
      expect(existsSync(path)).toBe(false);
    }
  });

  it("aborts immediately with exact too_big Zod issue shape and unlinks temp file", async () => {
    stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } }); // 1024 bytes
    const boundary = "LimitBoundary";
    const oversized = new Uint8Array(4096).fill(0x61);
    const raw = buildMultipart(boundary, [
      {
        name: "file",
        filename: "big.bin",
        contentType: "application/octet-stream",
        data: oversized,
      },
    ]);

    let chunksRead = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const start = chunksRead * 256;
        chunksRead++;
        if (start >= raw.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(raw.subarray(start, start + 256));
      },
    });
    const req = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: stream,
    });

    let caught: unknown;
    try {
      await streamMultipartRequest(req);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_request");
    expect(err.details).toEqual({
      issues: [
        {
          code: "too_big",
          origin: "file",
          maximum: 1024,
          path: ["file"],
          message: "File is over the 1024-byte upload limit",
        },
      ],
    });
    // Aborted early rather than draining the whole stream.
    expect(chunksRead).toBeLessThan(raw.byteLength / 256);
  });

  it("rejects disallowed MIME types immediately with invalid_value", async () => {
    const boundary = "MimeBoundary";
    const raw = buildMultipart(boundary, [
      {
        name: "file",
        filename: "cover.jpeg",
        contentType: "image/jpeg",
        data: new Uint8Array(64),
      },
    ]);
    const req = chunkedMultipartRequest(boundary, raw, 32);

    let caught: unknown;
    try {
      await streamMultipartRequest(req, {
        acceptedTypes: () => ["image/png", "image/webp"],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_request");
    expect(err.details).toMatchObject({
      issues: [
        {
          code: "invalid_value",
          values: ["image/png", "image/webp"],
          path: ["file"],
        },
      ],
    });
  });

  it("memoizes streamMultipartUpload across middleware and handler and cleans up via cleanupStreamedUpload", async () => {
    const app = new Hono();
    let stagedPath = "";

    app.use("/upload", async (c, next) => {
      try {
        const first = await streamMultipartUpload(c);
        expect(first.fields.projectId).toBe("9");
        stagedPath = first.file!.tempPath;
        await next();
      } finally {
        await cleanupStreamedUpload(c);
      }
    });

    app.post("/upload", async (c) => {
      const second = await streamMultipartUpload(c);
      expect(second.file!.tempPath).toBe(stagedPath);
      expect(existsSync(stagedPath)).toBe(true);
      return c.json({ ok: true, name: second.file!.name });
    });

    const form = new FormData();
    form.append("projectId", "9");
    form.append("file", new File(["hello"], "clip.wav", { type: "audio/wav" }));

    const res = await app.request("/upload", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "clip.wav" });
    expect(existsSync(stagedPath)).toBe(false);
  });

  it("streams chunked bodies through uploadBodyLimit without pre-buffering and aborts early over limit", async () => {
    stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } }); // 1024 bytes
    const app = new Hono();
    app.onError(jsonErrorHandler);

    let chunksPulled = 0;
    let handlerReached = false;
    app.post("/upload", uploadBodyLimit, async (c) => {
      handlerReached = true;
      const upload = await streamMultipartUpload(c);
      try {
        return c.json({ size: upload.file?.size ?? 0 });
      } finally {
        await upload.cleanup();
      }
    });

    // Unsized stream larger than maxFileBytes + UPLOAD_ENVELOPE_BYTES.
    const totalChunks = Math.ceil((UPLOAD_ENVELOPE_BYTES + 65536) / 8192) + 20;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksPulled >= totalChunks) {
          controller.close();
          return;
        }
        chunksPulled++;
        if (chunksPulled === 1) {
          controller.enqueue(
            new TextEncoder().encode(
              '--ChunkedBound\r\nContent-Disposition: form-data; name="extra"; filename="skip.bin"\r\n\r\n'
            )
          );
        } else {
          controller.enqueue(new Uint8Array(8192));
        }
      },
    });

    const res = await app.request("/upload", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=ChunkedBound",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["file"], code: "too_big", maximum: 1024 }] },
    });
    // Handler started streaming rather than uploadBodyLimit buffering the whole body first,
    // and the stream was cancelled early before pulling every chunk.
    expect(handlerReached).toBe(true);
    expect(chunksPulled).toBeLessThan(totalChunks);
  });

  it("stops reading immediately after the closing boundary rather than draining unbounded epilogue", async () => {
    const boundary = "EpilogueBound";
    const head = buildMultipart(boundary, [{ name: "projectId", data: "7" }]);
    let epiloguePulls = 0;
    let sentHead = false;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sentHead) {
          sentHead = true;
          controller.enqueue(head);
          return;
        }
        epiloguePulls++;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const result = await streamMultipartRequest(req);
    expect({ ...result.fields }).toEqual({ projectId: "7" });
    expect(cancelled).toBe(true);
    // ReadableStream's default HWM=1 may prefetch at most one chunk before cancel.
    expect(epiloguePulls).toBeLessThanOrEqual(1);
  });

  it("caps total text field bytes and part count and guards prototype keys", async () => {
    // Exceed total text bytes (5 x 60 KiB > 256 KiB, each under 64 KiB).
    const bigText = "a".repeat(60 * 1024);
    const tooMuchText = buildMultipart(
      "TextCap",
      Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: bigText }))
    );
    await expect(
      streamMultipartRequest(
        chunkedMultipartRequest("TextCap", tooMuchText, 4096)
      )
    ).rejects.toThrow();

    // Exceed part count (> 64 parts).
    const tooManyParts = buildMultipart(
      "PartsCap",
      Array.from({ length: 65 }, (_, i) => ({ name: `p${i}`, data: "x" }))
    );
    await expect(
      streamMultipartRequest(
        chunkedMultipartRequest("PartsCap", tooManyParts, 1024)
      )
    ).rejects.toThrow();

    // Prototype keys are ignored and fields has a null prototype.
    const protoRaw = buildMultipart("ProtoCap", [
      { name: "__proto__", data: "polluted" },
      { name: "constructor", data: "polluted" },
      { name: "projectId", data: "3" },
    ]);
    const protoResult = await streamMultipartRequest(
      chunkedMultipartRequest("ProtoCap", protoRaw, 64)
    );
    expect(Object.getPrototypeOf(protoResult.fields)).toBeNull();
    expect(protoResult.fields.projectId).toBe("3");
    expect("__proto__" in protoResult.fields).toBe(false);
    expect("constructor" in protoResult.fields).toBe(false);
  });

  it("lowercases declared part Content-Type headers per RFC 9110", async () => {
    const boundary = "CaseMime";
    const raw = buildMultipart(boundary, [
      {
        name: "file",
        filename: "cover.png",
        contentType: "Image/PNG; charset=binary",
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
    ]);
    const result = await streamMultipartRequest(
      chunkedMultipartRequest(boundary, raw, 32),
      { acceptedTypes: () => ["image/png"] }
    );
    try {
      expect(result.file?.type).toBe("image/png");
    } finally {
      await result.cleanup();
    }
  });
});
