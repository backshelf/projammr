import { afterEach, describe, expect, it } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";
import { NextRequest } from "next/server";
import { proxyShareMedia } from "./share-proxy";

afterEach(unstubAllGlobals);

/**
 * Sends `headers` through the proxy and returns the headers the upstream fetch
 * was given. A stubbed `fetch` answers, so nothing leaves the process.
 */
async function upstreamHeaders(headers: Record<string, string>) {
  let sent: Headers | undefined;
  stubGlobal("fetch", async (_url: URL, init: RequestInit) => {
    sent = new Headers(init.headers);
    return new Response("audio", { status: 200 });
  });
  const request = new NextRequest("http://web.test/share/tok/stream", {
    headers,
  });
  await proxyShareMedia(request, "tok/stream", "GET", []);
  return sent!;
}

describe("proxyShareMedia", () => {
  it("forwards the incoming x-forwarded-for unchanged, beside range", async () => {
    const sent = await upstreamHeaders({
      "x-forwarded-for": "203.0.113.5",
      range: "bytes=0-99",
    });
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.5");
    expect(sent.get("range")).toBe("bytes=0-99");
  });

  it("forwards the session cookie, for an instance that keeps shares to accounts", async () => {
    const sent = await upstreamHeaders({ cookie: "session=1" });
    expect(sent.get("cookie")).toBe("session=1");
  });

  it("forwards none of the browser's other headers", async () => {
    const sent = await upstreamHeaders({
      "x-forwarded-for": "203.0.113.5",
      cookie: "session=1",
      authorization: "Bearer secret",
      origin: "https://app.example",
      "user-agent": "test",
    });
    expect([...sent.keys()].sort()).toEqual(["cookie", "x-forwarded-for"]);
  });

  it("sends no x-forwarded-for when the request had none", async () => {
    const sent = await upstreamHeaders({ range: "bytes=0-99" });
    expect(sent.get("x-forwarded-for")).toBeNull();
    expect(sent.get("range")).toBe("bytes=0-99");
  });
});
