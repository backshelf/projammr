import { describe, expect, test } from "bun:test";

import { bounceView } from "@/components/lab/bounce-view";

describe("bounceView", () => {
  test("invites a bounce with nothing printed before one has run", () => {
    expect(bounceView(null)).toMatchObject({
      caption: "Print what you hear",
      printed: 0,
      running: null,
      downloadedName: null,
      uploadedName: null,
      canUpload: false,
    });
  });

  test("prints as far as the render has got", () => {
    expect(bounceView({ phase: "rendering", fraction: 0.42 })).toMatchObject({
      caption: "Rendering 42%",
      printed: 0.42,
      running: "bounce",
      canUpload: false,
    });
  });

  test("holds the whole print through encoding and local download", () => {
    expect(bounceView({ phase: "encoding" })).toMatchObject({
      caption: "Encoding",
      printed: 1,
      running: "bounce",
      canUpload: false,
    });
    expect(
      bounceView({
        phase: "downloaded",
        name: "nightdrive lab.flac",
        canUpload: true,
      })
    ).toMatchObject({
      caption: "Downloaded",
      printed: 1,
      running: null,
      downloadedName: "nightdrive lab.flac",
      uploadedName: null,
      canUpload: true,
    });
    expect(
      bounceView({
        phase: "downloaded",
        name: "nightdrive lab.flac",
        canUpload: false,
      })
    ).toMatchObject({
      caption: "Downloaded",
      printed: 1,
      running: null,
      downloadedName: "nightdrive lab.flac",
      canUpload: false,
    });
  });

  test("holds the print during opt-in upload and links the attachment once uploaded", () => {
    expect(bounceView({ phase: "uploading", fraction: 0.5 })).toMatchObject({
      caption: "Uploading 50%",
      printed: 1,
      running: "upload",
      canUpload: true,
    });
    expect(
      bounceView({ phase: "done", assetId: 9, name: "nightdrive lab.flac" })
    ).toMatchObject({
      caption: "Uploaded",
      printed: 1,
      running: null,
      downloadedName: null,
      uploadedName: "nightdrive lab.flac",
      canUpload: false,
    });
  });

  test("clears the print on render failure and keeps print + Upload on upload failure", () => {
    expect(
      bounceView({ phase: "failed", reason: "Not enough memory" })
    ).toMatchObject({
      caption: "Not enough memory",
      printed: 0,
      failed: true,
      running: null,
      canUpload: false,
    });
    expect(
      bounceView({
        phase: "failed",
        reason: "Too long to upload",
        canUpload: true,
      })
    ).toMatchObject({
      caption: "Too long to upload",
      printed: 1,
      failed: true,
      running: null,
      canUpload: true,
    });
  });
});
