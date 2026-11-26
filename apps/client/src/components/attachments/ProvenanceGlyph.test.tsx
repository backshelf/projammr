import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

import type { ProvenanceAsset } from "./AssetProvenance";
import { ProvenanceGlyph } from "./ProvenanceGlyph";

afterEach(cleanup);

const base: ProvenanceAsset = {
  id: 7,
  name: "bounce.wav",
  createdAt: "2026-03-01T10:00:00.000Z",
  localFilepath: null,
  localFileCreatedAt: null,
  localFileUpdatedAt: null,
  localFileMachineName: null,
  fingerprint: null,
};

describe("ProvenanceGlyph", () => {
  it("shows the uploader's initial for a web upload", () => {
    render(
      <ProvenanceGlyph
        asset={{
          ...base,
          uploadedBy: { id: "u1", name: "mira", image: null },
        }}
      />
    );
    expect(screen.getByText("M")).toBeTruthy();
  });

  it("falls back to a neutral avatar when the uploader is unknown", () => {
    const { container } = render(<ProvenanceGlyph asset={base} />);
    expect(container.querySelector("[data-slot='avatar']")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("names the machine glyph after the machine for a local file", () => {
    render(
      <ProvenanceGlyph
        asset={{
          ...base,
          localFilepath: "/music/bounce.wav",
          localFileMachineName: "Studio Mac",
        }}
      />
    );
    expect(screen.getByRole("img", { name: "Studio Mac" })).toBeTruthy();
  });
});
