import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE } from "@workspace/ui/lib/site";
import type { ShareRoom } from "@/components/share/ShareRoom";
import { BrandProvider } from "@/lib/brand-context";
import { DEFAULT_BRAND, type Brand } from "@/lib/brand-defaults";

mock.module("server-only", () => ({}));

const { ShareFooter } = await import("./ShareFooter");
const { ShareRoomContext } = await import("./ShareRoom");

const renderFooter = (brand: Brand) =>
  render(
    <ShareRoomContext value={{ artwork: null } as unknown as ShareRoom}>
      <BrandProvider brand={brand}>
        <ShareFooter />
      </BrandProvider>
    </ShareRoomContext>
  );

afterEach(cleanup);

describe("ShareFooter", () => {
  it("links the default brand to the product repository", () => {
    renderFooter(DEFAULT_BRAND);

    expect(
      screen
        .getByRole("link", { name: DEFAULT_BRAND.name })
        .getAttribute("href")
    ).toBe(SITE.repository);
  });

  it("renders a custom-named brand as plain text, with no link", () => {
    renderFooter({ ...DEFAULT_BRAND, name: "Studio Nine" });

    expect(screen.getByText("Studio Nine")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a brand with a logo as plain text, with no link", () => {
    renderFooter({
      ...DEFAULT_BRAND,
      logoImageId: 7,
      logoImagePath: "/media/7",
    });

    expect(screen.getByText(DEFAULT_BRAND.name)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
