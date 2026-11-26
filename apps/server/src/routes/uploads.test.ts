import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_INSTANCE_POLICY } from "../lib/instance-policy.js";
import { setupSuite } from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";

const { request } = setupSuite("Uploads");

describe("GET /uploads/limits", () => {
  afterEach(() => {
    restoreInstancePolicy();
  });

  it("answers with the byte cap and the types the upload routes enforce", async () => {
    const res = await request("viewer", "/uploads/limits");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      maxBytes: DEFAULT_INSTANCE_POLICY.limits.maxUploadMb * 1024 * 1024,
      audioTypes: DEFAULT_INSTANCE_POLICY.limits.audioTypes,
      imageTypes: DEFAULT_INSTANCE_POLICY.limits.imageTypes,
      pushSamplesEverywhere:
        DEFAULT_INSTANCE_POLICY.limits.pushSamplesEverywhere,
    });
  });

  it("answers with the policy in force, not the one the server booted with", async () => {
    stubInstancePolicy({
      limits: {
        maxUploadMb: 40,
        audioTypes: [".wav", ".flac"],
        imageTypes: ["image/png"],
      },
    });

    const res = await request("viewer", "/uploads/limits");
    expect(await res.json()).toEqual({
      maxBytes: 40 * 1024 * 1024,
      audioTypes: [".wav", ".flac"],
      imageTypes: ["image/png"],
      pushSamplesEverywhere: false,
    });
  });

  it("rejects an anonymous caller", async () => {
    const res = await request("anonymous", "/uploads/limits");
    expect(res.status).toBe(401);
  });
});
