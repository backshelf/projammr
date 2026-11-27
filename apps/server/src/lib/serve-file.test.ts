import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { fileResponse } from "./serve-file.js";
import {
  setStorageBackend,
  type ByteRange,
  type StorageBackend,
} from "./storage.js";

function memoryBackend(files: Record<string, Uint8Array>): StorageBackend {
  const rangesRequested: (ByteRange | undefined)[] = [];
  const backend: StorageBackend & {
    rangesRequested: (ByteRange | undefined)[];
  } = {
    kind: "s3",
    rangesRequested,
    async exists(key) {
      return key in files;
    },
    async stat(key) {
      const bytes = files[key];
      return bytes ? { size: bytes.byteLength, modifiedAt: new Date(0) } : null;
    },
    async readBytes(key) {
      return files[key]!;
    },
    readStream(key, range) {
      rangesRequested.push(range);
      const bytes = files[key]!;
      const slice = range ? bytes.subarray(range[0], range[1] + 1) : bytes;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          if (slice.byteLength > 0) controller.enqueue(slice);
          controller.close();
        },
      });
    },
    async putBytes() {},
    async putFromFile() {},
    async putObjects() {},
    async remove() {
      return true;
    },
    async listEntries() {
      return [];
    },
    async withLocalFile(_key, fn) {
      return fn("");
    },
  };
  return backend;
}

describe("fileResponse", () => {
  afterEach(() => {
    setStorageBackend(null);
  });

  function makeApp() {
    const app = new Hono();
    app.get("/file/:key{.*}", (c) =>
      fileResponse(c, c.req.param("key"), {
        type: "audio/wav",
        filename: c.req.query("name") ?? "track.wav",
        attachment: c.req.query("download") !== undefined,
        headers: {
          ETag: '"asset-1-10"',
          "Cache-Control": "private, max-age=3600",
        },
      })
    );
    return app;
  }

  it("streams a full stored object with expected headers", async () => {
    const bytes = new TextEncoder().encode("0123456789");
    setStorageBackend(memoryBackend({ "assets/a.wav": bytes }));

    const res = await makeApp().request("/file/assets/a.wav");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBe('"asset-1-10"');
    expect(res.headers.get("content-disposition")).toBe(
      'inline; filename="track.wav"'
    );
  });

  it("serves 206 partial content for byte ranges and suffix ranges", async () => {
    const bytes = new TextEncoder().encode("0123456789");
    setStorageBackend(memoryBackend({ "assets/a.wav": bytes }));
    const app = makeApp();

    const mid = await app.request("/file/assets/a.wav", {
      headers: { Range: "bytes=2-5" },
    });
    expect(mid.status).toBe(206);
    expect(await mid.text()).toBe("2345");
    expect(mid.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(mid.headers.get("content-length")).toBe("4");

    const suffix = await app.request("/file/assets/a.wav", {
      headers: { Range: "bytes=-3" },
    });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("789");
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
  });

  it("answers 416 for unsatisfiable ranges and 404 for missing keys", async () => {
    setStorageBackend(
      memoryBackend({ "assets/a.wav": new TextEncoder().encode("0123456789") })
    );
    const app = makeApp();

    const badRange = await app.request("/file/assets/a.wav", {
      headers: { Range: "bytes=50-60" },
    });
    expect(badRange.status).toBe(416);
    expect(badRange.headers.get("content-range")).toBe("bytes */10");

    const missing = await app.request("/file/assets/nope.wav");
    expect(missing.status).toBe(404);
  });

  it("encodes non-ASCII attachment filenames with RFC 6266 filename*", async () => {
    setStorageBackend(
      memoryBackend({ "assets/a.wav": new TextEncoder().encode("abc") })
    );
    const res = await makeApp().request(
      `/file/assets/a.wav?download=1&name=${encodeURIComponent("Mix — Final.wav")}`
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Mix _ Final.wav"; filename*=UTF-8''Mix%20%E2%80%94%20Final.wav`
    );
  });
});
