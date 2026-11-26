import { describe, expect, it } from "bun:test";
import { app } from "../app.js";
import { trustedOrigins } from "../lib/env.js";
import { baseUrl, setupSuite, testImage } from "../test/fixtures.js";

/**
 * Regression for the gap `csrfProtection` (`middleware/trusted-origin.ts`)
 * closes: a plain HTML form on a foreign site can POST
 * `multipart/form-data` without a preflight, so the cookie riding along is
 * the only thing that ever stood between it and an upload. Before the fix
 * this request succeeded; a bearer-token caller, which never sends a
 * cookie, must keep working regardless of what `Origin` it sends.
 */
const suite = setupSuite("UploadCsrf");

async function uploadCount(): Promise<number> {
  const res = await app.request(
    `${baseUrl}/assets/project/${suite.projectId}`,
    { headers: { Cookie: suite.owner.cookie } }
  );
  return ((await res.json()) as { rowCount: number }).rowCount;
}

async function uploadForm(): Promise<FormData> {
  const form = new FormData();
  form.append("projectId", String(suite.projectId));
  form.append(
    "file",
    new File([await testImage()], "csrf-probe.jpeg", { type: "image/jpeg" })
  );
  return form;
}

describe("upload CSRF protection", () => {
  it("refuses a cookie-authenticated multipart upload from a foreign Origin, and writes nothing", async () => {
    suite.requireProject();
    const before = await uploadCount();

    const res = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: {
        Cookie: suite.owner.cookie,
        Origin: "https://evil.example",
      },
      body: await uploadForm(),
    });

    expect(res.status).toBe(403);
    expect(await uploadCount()).toBe(before);
  });

  it("still accepts the same upload from a bearer token with no cookie, whatever the Origin", async () => {
    suite.requireProject();
    const before = await uploadCount();

    const res = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${suite.owner.token}`,
        Origin: "https://evil.example",
      },
      body: await uploadForm(),
    });

    expect(res.status).toBe(201);
    expect(await uploadCount()).toBe(before + 1);
  });

  it("still accepts the same upload from the cookie when the Origin is trusted", async () => {
    suite.requireProject();
    const before = await uploadCount();

    const res = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      // A real browser sends `Origin` on a same-origin POST too, not only a
      // cross-site one — `csrf()` refuses a form post that carries neither
      // `Origin` nor `Sec-Fetch-Site`, so this has to name one explicitly.
      headers: { Cookie: suite.owner.cookie, Origin: trustedOrigins[0]! },
      body: await uploadForm(),
    });

    expect(res.status).toBe(201);
    expect(await uploadCount()).toBe(before + 1);
  });
});
