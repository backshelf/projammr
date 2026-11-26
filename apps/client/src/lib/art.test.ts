import { describe, expect, it } from "bun:test";

import { artVarsFromArtwork } from "./art";
import type { Artwork } from "@workspace/api/api";

const artwork = (over: Partial<Artwork> = {}): Artwork => ({
  assetPath: "./static/images/a.jpg",
  accentHue: null,
  accentChroma: null,
  ...over,
});

describe("artVarsFromArtwork", () => {
  it("emits the chromatic accent at fixed lightness for both themes", () => {
    const vars = artVarsFromArtwork(
      artwork({ accentHue: 220.7, accentChroma: 0.108 })
    );
    expect(vars["--art-light"]).toBe("oklch(0.55 0.140 220.7)");
    expect(vars["--art-dark"]).toBe("oklch(0.78 0.135 220.7)");
    expect(vars["--art-image"]).toBe('url("/media/images/a.jpg?w=256")');
  });

  it("falls back to the no-artwork accent when the hue is null, keeping the cover", () => {
    const vars = artVarsFromArtwork(artwork());
    expect(vars["--art-light"]).toBe(
      "var(--art-fallback-light, oklch(0.45 0 0))"
    );
    expect(vars["--art-dark"]).toBe("var(--art-fallback-dark, oklch(0.8 0 0))");
    expect(vars["--art-image"]).toBe('url("/media/images/a.jpg?w=256")');
  });

  it("renders the no-artwork accent with no artwork at all", () => {
    const vars = artVarsFromArtwork(null);
    expect(vars["--art-light"]).toBe(
      "var(--art-fallback-light, oklch(0.45 0 0))"
    );
    expect(vars["--art-image"]).toBe("none");
  });
});
