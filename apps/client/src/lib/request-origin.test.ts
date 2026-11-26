import { describe, expect, it } from "bun:test";
import path from "node:path";
import { requestOrigin, requestProtocol } from "./request-origin";

const headers = (init: Record<string, string>) => new Headers(init);

describe("requestProtocol", () => {
  it("is https behind a proxy that terminated TLS", () => {
    expect(requestProtocol(headers({ "x-forwarded-proto": "https" }))).toBe(
      "https"
    );
  });

  it("is http for a plain-http request", () => {
    expect(requestProtocol(headers({ "x-forwarded-proto": "http" }))).toBe(
      "http"
    );
  });

  it("takes the first proto of a forwarded chain", () => {
    expect(
      requestProtocol(headers({ "x-forwarded-proto": "http, https" }))
    ).toBe("http");
    expect(
      requestProtocol(headers({ "x-forwarded-proto": "HTTPS , http" }))
    ).toBe("https");
  });

  // Only `proxy.ts` sees a request before Next fills the header, and then it
  // arrived on this server's own plain-http socket, whatever the host is.
  it("is http when nothing forwarded a proto, even for a public host", () => {
    expect(requestProtocol(headers({ host: "app.example.com" }))).toBe("http");
  });

  it("treats anything but https as http", () => {
    expect(requestProtocol(headers({ "x-forwarded-proto": "wss" }))).toBe(
      "http"
    );
  });
});

describe("requestOrigin", () => {
  it("joins the forwarded proto to the host", () => {
    expect(
      requestOrigin(
        headers({ host: "app.example.com", "x-forwarded-proto": "https" })
      )
    ).toBe("https://app.example.com");
  });

  it("keeps the port of a development host", () => {
    expect(
      requestOrigin(
        headers({ host: "localhost:3000", "x-forwarded-proto": "http" })
      )
    ).toBe("http://localhost:3000");
  });

  it("falls back to localhost with no host header", () => {
    expect(requestOrigin(headers({}))).toBe("http://localhost");
  });
});

describe("build-time origins", () => {
  const roots = [
    path.resolve(import.meta.dir, ".."),
    path.resolve(import.meta.dir, "../../../../packages/api/src"),
  ];
  // This file names the variables in the pattern below.
  const self = path.resolve(import.meta.path);
  const removed = /NEXT_PUBLIC_(API_URL|BETTER_AUTH_URL)\b/;

  // One built image serves any hostname only while nothing is inlined into it
  // at build time: the API origin comes from the environment at start-up and
  // the public origin and scheme from each request.
  it("are read nowhere in the client or the shared API package", async () => {
    const readers: string[] = [];
    for (const root of roots) {
      let scanned = 0;
      const glob = new Bun.Glob("**/*.{ts,tsx}");
      for await (const file of glob.scan({ cwd: root, absolute: true })) {
        scanned += 1;
        if (file === self) continue;
        if (removed.test(await Bun.file(file).text())) readers.push(file);
      }
      // A root that moved would otherwise pass with nothing read.
      expect(scanned).toBeGreaterThan(0);
    }
    expect(readers).toEqual([]);
  });
});
