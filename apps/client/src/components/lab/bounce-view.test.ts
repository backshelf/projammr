import { describe, expect, test } from "bun:test";

import { bounceView } from "@/components/lab/bounce-view";

describe("bounceView", () => {
  test("invites a bounce with nothing printed before one has run", () => {
    expect(bounceView(null)).toMatchObject({
      caption: "Print what you hear as an attachment",
      printed: 0,
      running: false,
    });
  });

  test("prints as far as the render has got", () => {
    expect(bounceView({ phase: "rendering", fraction: 0.42 })).toMatchObject({
      caption: "Rendering 42%",
      printed: 0.42,
      running: true,
    });
  });

  test("holds the whole print through the encode and the upload", () => {
    expect(bounceView({ phase: "encoding" }).printed).toBe(1);
    expect(bounceView({ phase: "uploading", fraction: 0.5 })).toMatchObject({
      caption: "Uploading 50%",
      printed: 1,
      running: true,
    });
  });

  test("names the finished attachment and keeps the print", () => {
    expect(
      bounceView({ phase: "done", assetId: 9, name: "nightdrive lab.flac" })
    ).toMatchObject({
      caption: "Bounced",
      printed: 1,
      running: false,
      doneName: "nightdrive lab.flac",
    });
  });

  test("clears the print and reads as an error when the bounce fails", () => {
    expect(
      bounceView({ phase: "failed", reason: "Too long to upload" })
    ).toMatchObject({
      caption: "Too long to upload",
      printed: 0,
      failed: true,
      running: false,
    });
  });
});
