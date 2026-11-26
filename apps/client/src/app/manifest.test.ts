import { describe, expect, it, mock } from "bun:test";
import { DEFAULT_BRAND } from "@/lib/brand-defaults";
import { ICONS } from "./icon-ids";

const cachedBrand = mock(async () => DEFAULT_BRAND);
mock.module("@/lib/brand", () => ({ cachedBrand }));

const { generateImageMetadata } = await import("./icon");
const { default: manifest } = await import("./manifest");

describe("manifest icons", () => {
  it("every icon src and size matches a route app/icon.tsx generates", async () => {
    const routes = new Map(
      generateImageMetadata().map(({ id, size }) => [
        `/icon/${id}`,
        `${size.width}x${size.height}`,
      ])
    );
    const { icons } = await manifest();

    expect(icons?.length).toBe(ICONS.length);
    for (const icon of icons ?? []) {
      expect(routes.get(icon.src)).toBe(icon.sizes as string);
    }
  });

  it("includes a 192px icon", async () => {
    const { icons } = await manifest();

    expect(icons?.map((icon) => icon.sizes)).toContain("192x192");
  });

  it("gives the maskable icon a maskable purpose and the others an any purpose", async () => {
    const { icons } = await manifest();
    const bySrc = Object.fromEntries(
      (icons ?? []).map((icon) => [icon.src, icon.purpose])
    );

    expect(bySrc["/icon/maskable"]).toBe("maskable");
    expect(bySrc["/icon/default"]).toBe("any");
    expect(bySrc["/icon/small"]).toBe("any");
  });
});

describe("manifest shortcuts", () => {
  it("offers Projects and Notes", async () => {
    const { shortcuts } = await manifest();

    expect(shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      "/projects",
      "/notes",
    ]);
  });

  it("gives each shortcut an icon that is a served icon route", async () => {
    const routes = ICONS.map(({ id }) => `/icon/${id}`);
    const { shortcuts } = await manifest();

    for (const shortcut of shortcuts ?? []) {
      expect(shortcut.icons?.length).toBeGreaterThan(0);
      for (const icon of shortcut.icons ?? []) {
        expect(routes).toContain(icon.src);
        expect(icon.sizes).toBe("192x192");
      }
    }
  });
});

describe("manifest defaults", () => {
  it("paints the splash in the dark room with the default brand", async () => {
    const { background_color, theme_color, name, short_name } =
      await manifest();

    expect(background_color).toBe(DEFAULT_BRAND.backgroundColour);
    expect(theme_color).toBe(DEFAULT_BRAND.themeColour);
    expect(name).toBe(DEFAULT_BRAND.name);
    expect(short_name).toBe(DEFAULT_BRAND.name);
  });
});

// eslint-disable-next-line no-restricted-syntax -- a brand's own colours, stored as hex, not a class name
const THEME_COLOUR = "#123456";
// eslint-disable-next-line no-restricted-syntax -- a brand's own colours, stored as hex, not a class name
const BACKGROUND_COLOUR = "#654321";

describe("manifest under a brand", () => {
  it("takes its name and colours from the instance", async () => {
    cachedBrand.mockResolvedValueOnce({
      ...DEFAULT_BRAND,
      name: "Riverside Sessions",
      themeColour: THEME_COLOUR,
      backgroundColour: BACKGROUND_COLOUR,
    });

    const { name, short_name, theme_color, background_color } =
      await manifest();

    expect(name).toBe("Riverside Sessions");
    expect(short_name).toBe("Riverside Sessions");
    expect(theme_color).toBe(THEME_COLOUR);
    expect(background_color).toBe(BACKGROUND_COLOUR);
  });
});
