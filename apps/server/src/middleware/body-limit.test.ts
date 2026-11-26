import { afterEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { app } from "../app.js";
import { jsonErrorHandler } from "../lib/http.js";
import {
  REQUEST_BODY_CAP_BYTES,
  UPLOAD_ENVELOPE_BYTES,
} from "../lib/instance-policy.js";
import {
  authUrl,
  baseUrl,
  setupSuite,
  trustedOrigin,
} from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import { requestBodyCap, uploadBodyLimit } from "./body-limit.js";

const suite = setupSuite("Body limits");

const KIB = 1024;
const MIB = 1024 * 1024;

afterEach(() => {
  restoreInstancePolicy();
});

/** A tiny app with `limit` in front of a handler that records whether it ran. */
function limited(limit: typeof uploadBodyLimit) {
  const handler = mock(async (c: { req: { text: () => Promise<string> } }) =>
    c.req.text()
  );
  const limitedApp = new Hono();
  limitedApp.post("/", limit, async (c) => c.text(await handler(c)));
  limitedApp.onError(jsonErrorHandler);
  return { limitedApp, handler };
}

/** A body of `bytes` that declares no length, the way a chunked upload arrives. */
const unsizedBody = (bytes: number) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let sent = 0; sent < bytes; sent += 64 * KIB) {
        controller.enqueue(new Uint8Array(Math.min(64 * KIB, bytes - sent)));
      }
      controller.close();
    },
  });

const tooBig = (maximum: number) => ({
  code: "invalid_request",
  details: { issues: [{ path: ["file"], code: "too_big", maximum }] },
});

describe("uploadBodyLimit", () => {
  it("refuses a declared length over the limit without the handler running", async () => {
    stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } });
    const { limitedApp, handler } = limited(uploadBodyLimit);

    const res = await limitedApp.request("/", {
      method: "POST",
      body: "x",
      headers: {
        "content-length": String(KIB + UPLOAD_ENVELOPE_BYTES + 1),
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject(tooBig(KIB));
    expect(handler).not.toHaveBeenCalled();
  });

  it("counts a body that declares no length and refuses it once it passes the limit", async () => {
    stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } });
    const { limitedApp, handler } = limited(uploadBodyLimit);

    const res = await limitedApp.request("/", {
      method: "POST",
      body: unsizedBody(KIB + UPLOAD_ENVELOPE_BYTES + 1),
      duplex: "half",
    } as RequestInit);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject(tooBig(KIB));
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a body within the limit through whole", async () => {
    stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } });
    const { limitedApp, handler } = limited(uploadBodyLimit);

    const res = await limitedApp.request("/", {
      method: "POST",
      body: unsizedBody(MIB),
      duplex: "half",
    } as RequestInit);

    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(MIB);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reads the limit in force for each request", async () => {
    const { limitedApp } = limited(uploadBodyLimit);
    const send = () =>
      limitedApp.request("/", {
        method: "POST",
        body: "x",
        headers: { "content-length": String(2 * MIB) },
      });

    stubInstancePolicy({ limits: { maxUploadMb: 0.5 } });
    expect((await send()).status).toBe(400);

    stubInstancePolicy({ limits: { maxUploadMb: 2 } });
    expect((await send()).status).toBe(200);
  });
});

describe("requestBodyCap", () => {
  it("refuses a body over the fixed cap with a 413, and passes one under it", async () => {
    const { limitedApp, handler } = limited(requestBodyCap);
    const send = (length: number) =>
      limitedApp.request("/", {
        method: "POST",
        body: "x",
        headers: { "content-length": String(length) },
      });

    const over = await send(REQUEST_BODY_CAP_BYTES + 1);
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({
      error: "Request body too large",
    });
    expect(handler).not.toHaveBeenCalled();

    expect((await send(REQUEST_BODY_CAP_BYTES)).status).toBe(200);
  });
});

describe("the app's body limits", () => {
  const upload = (headers: Record<string, string>, body: BodyInit) =>
    app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: {
        Cookie: suite.owner.cookie,
        Origin: trustedOrigin,
        ...headers,
      },
      body,
    });

  it("holds a route that takes no upload to the fixed cap, signed in or not", async () => {
    const res = await app.request(`${baseUrl}${authUrl}/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": String(REQUEST_BODY_CAP_BYTES + 1),
      },
      body: "{}",
    });

    expect(res.status).toBe(413);
  });

  it("holds any other method on an upload path to the fixed cap", async () => {
    suite.requireProject();
    stubInstancePolicy({ limits: { maxUploadMb: 2048 } });

    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await app.request(`${baseUrl}/assets/upload`, {
        method,
        headers: {
          Cookie: suite.owner.cookie,
          Origin: trustedOrigin,
          "Content-Type": "application/json",
          "content-length": String(REQUEST_BODY_CAP_BYTES + 1),
        },
        body: "{}",
      });

      expect(res.status).toBe(413);
    }
  });

  it("refuses an upload over the instance's limit before the form is read", async () => {
    suite.requireProject();
    stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } });

    // The body is not a form at all: only the declared length can have
    // refused it with the limit's own answer.
    const res = await upload(
      { "content-length": String(KIB + UPLOAD_ENVELOPE_BYTES + 1) },
      "x"
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject(tooBig(KIB));
  });

  it("lets an upload past the fixed cap when the instance's limit allows it", async () => {
    suite.requireProject();
    stubInstancePolicy({ limits: { maxUploadMb: 256 } });

    const res = await upload(
      { "content-length": String(REQUEST_BODY_CAP_BYTES + 1) },
      "x"
    );

    // Refused later, for not being a form, rather than by either body limit.
    expect(res.status).not.toBe(413);
    expect(await res.json()).not.toMatchObject(tooBig(256 * MIB));
  });

  it("takes an upload within the limit", async () => {
    suite.requireProject();
    const form = new FormData();
    form.append("file", new File(["within the limit"], "within.txt"));
    form.append("projectId", String(suite.projectId));

    const res = await upload({}, form);

    expect(res.status).toBe(201);
  });
});
