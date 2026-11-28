import { describe, expect, it } from "bun:test";

import { artVarsFromAccent } from "./art";

describe("artVarsFromAccent", () => {
  it("emits the chromatic accent at fixed lightness for both themes", () => {
    const vars = artVarsFromAccent(220.7, 0.108);
    expect(vars["--art-light"]).toBe("oklch(0.5 0.140 220.7)");
    expect(vars["--art-glow-light"]).toBe("oklch(0.72 0.108 220.7)");
    expect(vars["--art-dark"]).toBe("oklch(0.78 0.135 220.7)");
    expect(vars["--art-glow-dark"]).toBe("oklch(0.45 0.108 220.7)");
  });

  it("caps a saturated cover's chroma so the accent stays calm against paper", () => {
    const vars = artVarsFromAccent(10, 0.4);
    expect(vars["--art-light"]).toBe("oklch(0.5 0.190 10.0)");
    expect(vars["--art-dark"]).toBe("oklch(0.78 0.170 10.0)");
    expect(vars["--art-glow-light"]).toBe("oklch(0.72 0.140 10.0)");
  });

  it("falls back to the document's --art-fallback accent, else grayscale, when the hue is null", () => {
    const vars = artVarsFromAccent(null, 0.1);
    expect(vars["--art-light"]).toBe(
      "var(--art-fallback-light, oklch(0.45 0 0))"
    );
    expect(vars["--art-glow-light"]).toBe(
      "var(--art-fallback-glow-light, oklch(0.65 0 0))"
    );
    expect(vars["--art-dark"]).toBe("var(--art-fallback-dark, oklch(0.8 0 0))");
    expect(vars["--art-glow-dark"]).toBe(
      "var(--art-fallback-glow-dark, oklch(0.38 0 0))"
    );
  });

  it("reads a missing chroma as none, leaving the hue grey", () => {
    expect(artVarsFromAccent(40, null)["--art-light"]).toBe(
      "oklch(0.5 0.000 40.0)"
    );
  });

  it("carries the cover as --art-image, or none without one", () => {
    expect(artVarsFromAccent(40, 0.1, "/covers/a.jpg")["--art-image"]).toBe(
      'url("/covers/a.jpg")'
    );
    expect(artVarsFromAccent(40, 0.1)["--art-image"]).toBe("none");
  });
});
