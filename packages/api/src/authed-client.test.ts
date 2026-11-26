import { describe, expect, it } from "bun:test";
import { createServerApiClient } from "./authed-client";

/**
 * Sends one bodyless mutation through a server client and returns the request
 * it would have put on the wire. A trailing middleware answers it, so nothing
 * leaves the process.
 */
async function sentRequest(
  cookie: string | null,
  origin: string | null,
  forwardedFor?: string | null
): Promise<Request> {
  const client = createServerApiClient(
    async () => cookie,
    async () => origin,
    forwardedFor === undefined ? undefined : async () => forwardedFor
  );
  let sent: Request | undefined;
  client.use({
    onRequest({ request }) {
      sent = request;
      return new Response(null, { status: 204 });
    },
  });
  await client.PATCH("/api/track-audios/{id}/primary", {
    params: { path: { id: "1" } },
  });
  return sent!;
}

describe("createServerApiClient", () => {
  it("forwards the incoming request's cookie and origin", async () => {
    const request = await sentRequest("session=1", "https://app.example");
    expect(request.headers.get("cookie")).toBe("session=1");
    expect(request.headers.get("origin")).toBe("https://app.example");
  });

  it("sends no origin when the incoming request had none", async () => {
    const request = await sentRequest("session=1", null);
    expect(request.headers.get("origin")).toBeNull();
  });

  it("forwards the incoming request's x-forwarded-for unchanged", async () => {
    const request = await sentRequest(
      "session=1",
      null,
      "9.9.9.9, 203.0.113.5"
    );
    expect(request.headers.get("x-forwarded-for")).toBe("9.9.9.9, 203.0.113.5");
  });

  it("sends no x-forwarded-for without a getter", async () => {
    const request = await sentRequest("session=1", null);
    expect(request.headers.get("x-forwarded-for")).toBeNull();
  });

  it("sends no x-forwarded-for when the getter returns nothing", async () => {
    const request = await sentRequest("session=1", null, null);
    expect(request.headers.get("x-forwarded-for")).toBeNull();
  });
});
