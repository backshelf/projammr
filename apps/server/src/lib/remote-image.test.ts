import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import {
  decodeBase64Image,
  fetchRemoteImage,
  isPrivateIp,
} from "./remote-image.js";

async function makeImageBytes(format: "jpeg" | "png" | "webp" = "jpeg") {
  const img = sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 220, g: 40, b: 80 },
    },
  });
  const buf =
    format === "png"
      ? await img.png().toBuffer()
      : format === "webp"
        ? await img.webp().toBuffer()
        : await img.jpeg().toBuffer();
  return new Uint8Array(buf);
}

const publicLookup = async () => ["93.184.216.34"];

describe("isPrivateIp", () => {
  it("flags loopback, RFC 1918, CGNAT/Tailscale, link-local, metadata, and ULA addresses", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "100.100.100.100",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "224.0.0.1",
      "::",
      "::1",
      "[::1]",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.5",
      "2002:7f00:0001::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  it("allows public IPv4 and IPv6 addresses", () => {
    for (const ip of [
      "1.1.1.1",
      "8.8.8.8",
      "93.184.216.34",
      "172.32.0.1",
      "100.128.0.1",
      "2606:4700:4700::1111",
      "::ffff:93.184.216.34",
    ]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("fetchRemoteImage", () => {
  it("fetches a valid image, verifies its real MIME via sharp, and derives filename from query params", async () => {
    const jpeg = await makeImageBytes("jpeg");
    const result = await fetchRemoteImage(
      "https://linkr.audio/images?image=sr--20260819054852257.jpg",
      {
        lookup: publicLookup,
        fetch: async () =>
          new Response(Buffer.from(jpeg), {
            status: 200,
            headers: { "content-type": "application/octet-stream" },
          }),
      }
    );

    expect(result.kind).toBe("bytes");
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("sr--20260819054852257.jpg");
    expect(result.bytes.byteLength).toBe(jpeg.byteLength);
  });

  it("follows public redirects and respects Content-Disposition filename", async () => {
    const png = await makeImageBytes("png");
    const seen: string[] = [];
    const result = await fetchRemoteImage("https://cdn.example.com/start", {
      lookup: publicLookup,
      fetch: async (input: string | URL | Request) => {
        const url = String(input);
        seen.push(url);
        if (seen.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://media.example.com/final" },
          });
        }
        return new Response(Buffer.from(png), {
          status: 200,
          headers: {
            "content-disposition": 'inline; filename="album-art.png"',
          },
        });
      },
    });

    expect(seen).toEqual([
      "https://cdn.example.com/start",
      "https://media.example.com/final",
    ]);
    expect(result.type).toBe("image/png");
    expect(result.name).toBe("album-art.png");
  });

  it("refuses private hosts, embedded credentials, non-http schemes, and redirects to private IPs", async () => {
    await expect(
      fetchRemoteImage("file:///etc/passwd", { lookup: publicLookup })
    ).rejects.toThrow(/http or https/);

    await expect(
      fetchRemoteImage("https://user:pass@example.com/a.jpg", {
        lookup: publicLookup,
      })
    ).rejects.toThrow(/credentials/);

    await expect(
      fetchRemoteImage("http://127.0.0.1/secret.jpg")
    ).rejects.toThrow(/public address/);

    await expect(
      fetchRemoteImage("http://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/public address/);

    await expect(
      fetchRemoteImage("https://internal.local/cover.jpg", {
        lookup: async () => ["10.0.0.5"],
      })
    ).rejects.toThrow(/public address/);

    await expect(
      fetchRemoteImage("https://public.example.com/redirect", {
        lookup: async (host) =>
          host === "public.example.com" ? ["93.184.216.34"] : ["127.0.0.1"],
        fetch: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://localhost/private.jpg" },
          }),
      })
    ).rejects.toThrow(/public address/);
  });

  it("sends User-Agent and Accept headers on requests and redirects", async () => {
    const jpeg = await makeImageBytes("jpeg");
    const seenHeaders: Headers[] = [];

    await fetchRemoteImage("https://cdn.example.com/start.jpg", {
      lookup: publicLookup,
      fetch: async (_input, init) => {
        seenHeaders.push(new Headers(init?.headers));
        if (seenHeaders.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://media.example.com/final.jpg" },
          });
        }
        return new Response(Buffer.from(jpeg), { status: 200 });
      },
    });

    expect(seenHeaders).toHaveLength(2);
    for (const headers of seenHeaders) {
      expect(headers.get("user-agent")).toContain("Projammr/1.0");
      expect(headers.get("accept")).toContain("image/");
    }
  });

  it("refuses oversized responses, non-image payloads, and disallowed MIME types", async () => {
    const jpeg = await makeImageBytes("jpeg");

    await expect(
      fetchRemoteImage("https://cdn.example.com/huge.jpg", {
        maxBytes: jpeg.byteLength - 1,
        lookup: publicLookup,
        fetch: async () => new Response(Buffer.from(jpeg), { status: 200 }),
      })
    ).rejects.toThrow(/upload limit/);

    await expect(
      fetchRemoteImage("https://cdn.example.com/not-an-image.jpg", {
        lookup: publicLookup,
        fetch: async () =>
          new Response("<html>not an image</html>", {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
      })
    ).rejects.toThrow(/valid image/);

    await expect(
      fetchRemoteImage("https://cdn.example.com/art.png", {
        allowedTypes: ["image/jpeg"],
        lookup: publicLookup,
        fetch: async () =>
          new Response(Buffer.from(await makeImageBytes("png")), {
            status: 200,
          }),
      })
    ).rejects.toThrow(/Unsupported image type/);
  });
});

describe("decodeBase64Image", () => {
  it("decodes raw base64 and data URLs, sanitizes filename, and verifies real format via sharp", async () => {
    const jpeg = await makeImageBytes("jpeg");
    const rawResult = await decodeBase64Image(
      Buffer.from(jpeg).toString("base64"),
      { filename: "../nested/artwork.jpg" }
    );
    expect(rawResult.kind).toBe("bytes");
    expect(rawResult.type).toBe("image/jpeg");
    expect(rawResult.name).toBe("artwork.jpg");
    expect(rawResult.bytes.byteLength).toBe(jpeg.byteLength);

    const png = await makeImageBytes("png");
    const wrapped = Buffer.from(png)
      .toString("base64")
      .replace(/(.{40})/g, "$1\n");
    // Even if the data URL claims jpeg, sharp detects the actual png bytes.
    const dataUrlResult = await decodeBase64Image(
      `data:image/jpeg;base64,${wrapped}`
    );
    expect(dataUrlResult.type).toBe("image/png");
    expect(dataUrlResult.name).toBe("cover.png");
    expect(dataUrlResult.bytes.byteLength).toBe(png.byteLength);
  });

  it("rejects empty data, invalid base64, non-image bytes, disallowed MIME types, and oversized payloads", async () => {
    const jpeg = await makeImageBytes("jpeg");
    const png = await makeImageBytes("png");

    await expect(decodeBase64Image("   ")).rejects.toThrow(/empty/i);
    await expect(decodeBase64Image("not!valid@base64")).rejects.toThrow(
      /valid base64/i
    );
    await expect(
      decodeBase64Image("data:text/plain;base64,aGVsbG8=")
    ).rejects.toThrow(/valid base64/i);
    await expect(
      decodeBase64Image(Buffer.from("not an image").toString("base64"))
    ).rejects.toThrow(/valid image/i);
    await expect(
      decodeBase64Image(Buffer.from(png).toString("base64"), {
        allowedTypes: ["image/jpeg"],
      })
    ).rejects.toThrow(/Unsupported image type/);
    await expect(
      decodeBase64Image(Buffer.from(jpeg).toString("base64"), {
        maxBytes: jpeg.byteLength - 1,
      })
    ).rejects.toThrow(/upload limit/);
    await expect(
      decodeBase64Image("A".repeat(400), { maxBytes: 16 })
    ).rejects.toThrow(/upload limit/);
  });
});
