import { ArtSwatch } from "@/components/art/ArtSwatch";
import { isSidebarPathActive } from "@/components/sidebar/SidebarNavLink";
import { distinctArtwork } from "@/lib/art";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";

afterEach(cleanup);

describe("isSidebarPathActive", () => {
  it("matches exact paths and ignores query strings, hashes, and trailing slashes", () => {
    expect(isSidebarPathActive("/project/7", "/project/7")).toBe(true);
    expect(isSidebarPathActive("/project/7/", "/project/7")).toBe(true);
    expect(
      isSidebarPathActive(
        "/settings/project/7/assets",
        "/settings/project/7/assets#repos"
      )
    ).toBe(true);
    expect(
      isSidebarPathActive("/project/7/track/1", "/project/7/track/1?v=2")
    ).toBe(true);
  });

  it("does not match partial prefixes or a missing pathname", () => {
    expect(isSidebarPathActive(null, "/project/7")).toBe(false);
    expect(isSidebarPathActive("/project/7/track/1", "/project/7")).toBe(false);
    expect(
      isSidebarPathActive("/project/7/track/12", "/project/7/track/1")
    ).toBe(false);
  });
});

describe("distinctArtwork", () => {
  const art = {
    assetPath: "covers/ep.jpg",
    accentHue: 200,
    accentChroma: 0.14,
  };

  it("drops artwork that only repeats the parent's fallback image", () => {
    expect(distinctArtwork(art, "covers/ep.jpg")).toBeNull();
    expect(distinctArtwork(art, "covers/project.jpg")).toEqual(art);
    expect(distinctArtwork(art, null)).toEqual(art);
    expect(distinctArtwork(null, "covers/project.jpg")).toBeNull();
  });
});

describe("ArtSwatch spine variant", () => {
  it("renders a quiet fallback hairline when artwork has no distinct hue", () => {
    const { container } = render(<ArtSwatch artwork={null} variant="spine" />);
    const el = container.querySelector('[data-slot="art-swatch"]');
    expect(el?.getAttribute("data-variant")).toBe("spine");
    expect(el?.hasAttribute("data-fallback")).toBe(true);
    expect(el?.getAttribute("style")).toBeNull();
  });

  it("emits light and dark accent vars when a distinct hue is present", () => {
    const { container } = render(
      <ArtSwatch
        artwork={{
          assetPath: "covers/ep.jpg",
          accentHue: 210,
          accentChroma: 0.15,
        }}
        variant="spine"
      />
    );
    const el = container.querySelector('[data-slot="art-swatch"]');
    expect(el?.getAttribute("data-variant")).toBe("spine");
    expect(el?.hasAttribute("data-fallback")).toBe(false);
    expect(el?.getAttribute("style")).toContain("--art-light:");
    expect(el?.getAttribute("style")).toContain("--art-dark:");
  });
});
