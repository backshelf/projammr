import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("@/lib/browser-api", () => ({
  browserApi: { GET: mock(), PATCH: mock() },
}));

mock.module("@/actions/sharelinks", () => ({
  createSharelink: mock(),
  getShareOptions: mock(async () => []),
  updateSharelink: mock(),
  updateSharelinkTracks: mock(),
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { ShareDialog } = await import("./ShareDialog");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { toDateInputValue } = await import("@/lib/share-links");

afterEach(cleanup);

const mount = async (settings: Record<string, unknown>) => {
  await act(async () => {
    render(
      <SettingsProvider initial={effectiveSettings(settings, "v1")}>
        <ShareDialog
          entityType="track"
          entityId={1}
          open
          onOpenChange={() => {}}
        />
      </SettingsProvider>
    );
  });
};

const isChecked = (role: "radio" | "switch", name: string | RegExp) =>
  screen.getByRole(role, { name }).getAttribute("aria-checked") === "true" ||
  (screen.getByRole(role, { name }) as HTMLInputElement).checked === true;

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInputValue(date.toISOString());
};

describe("ShareDialog new link", () => {
  it("starts from the project's kind, expiry, comment privacy and downloads", async () => {
    await mount({
      "project-sharing.shareKind": "snapshot",
      "project-sharing.shareExpiresDays": 14,
      "project-sharing.shareCommentPrivacy": "private",
      "project-sharing.shareDownloads": true,
    });

    expect(isChecked("radio", /^Snapshot/)).toBe(true);
    expect(isChecked("switch", "Stops working")).toBe(true);
    expect(
      (screen.getByLabelText("Expiry date") as HTMLInputElement).value
    ).toBe(daysFromToday(14));
    expect(isChecked("switch", /private/i)).toBe(true);
    expect(isChecked("switch", /download/i)).toBe(true);
  });

  it("never expires when the project's links never expire", async () => {
    await mount({ "project-sharing.shareExpiresDays": null });

    expect(isChecked("switch", "Stops working")).toBe(false);
    expect(isChecked("radio", /^Current version/)).toBe(true);
  });
});
