import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { stubGlobal } from "@workspace/test/globals";

import { LoudnessReading } from "./loudness-reading";
import { LoudnessUnit } from "./loudness-unit";

afterEach(cleanup);

function stubCoarseMatchMedia(matches: boolean) {
  stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)" ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("LoudnessReading", () => {
  it("sets the figure in ink with its unit and qualifier beside it", () => {
    const html = renderToStaticMarkup(
      <LoudnessReading lufs={-9.24}>LUFS median</LoudnessReading>
    );
    expect(html).toMatch(/font-display-clean[^"]*text-ink">−9.2</);
    expect(html).toContain("LUFS median");
  });

  it("reads faint while the figure is still being measured", () => {
    const html = renderToStaticMarkup(
      <LoudnessReading lufs={-9.24} pending>
        LUFS
      </LoudnessReading>
    );
    expect(html).toMatch(/font-display-clean[^"]*text-ink-soft/);
  });
});

describe("LoudnessUnit", () => {
  it("renders the unit as a focusable abbreviation with no browser to ask", () => {
    const html = renderToStaticMarkup(<LoudnessUnit unit="LUFS" />);
    expect(html).toMatch(/<abbr[^>]*tabindex="0"[^>]*>LUFS<\/abbr>/);
  });

  it("keeps a compact unit out of the tab order", () => {
    const html = renderToStaticMarkup(<LoudnessUnit unit="M" compact />);
    expect(html).toMatch(/<abbr[^>]*>M<\/abbr>/);
    expect(html).not.toContain("tabindex");
  });

  it("uses a native button trigger on coarse pointers without Base UI errors or aria-expanded on abbr", () => {
    stubCoarseMatchMedia(true);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(<LoudnessUnit unit="LUFS" />);
      const button = screen.getByRole("button", { name: "LUFS" });
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-expanded")).toBe("false");

      const abbr = container.querySelector("abbr");
      expect(abbr).toBeTruthy();
      expect(abbr?.getAttribute("aria-expanded")).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps a compact coarse-pointer button out of the tab order", () => {
    stubCoarseMatchMedia(true);
    render(<LoudnessUnit unit="TP" compact />);
    const button = screen.getByRole("button", { name: "TP" });
    expect(button.getAttribute("tabindex")).toBe("-1");
  });
});
