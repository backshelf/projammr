import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { DEFAULT_FORMAT_PREFS } from "@workspace/ui/lib/formatters";
import { useFormat } from "@workspace/ui/components/format-provider";

mock.module("@/lib/browser-api", () => ({ browserApi: {} }));

const { SettingsFormatProvider } = await import("./SettingsFormatProvider");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { DEFAULT_EFFECTIVE_SETTINGS, effectiveSettings } =
  await import("@/lib/settings/effective");
const { formatPrefsFrom } = await import("@/lib/policies/from-settings");

afterEach(cleanup);

const Probe = ({ id }: { id: string }) => (
  <output data-testid={id}>{useFormat().weekStart}</output>
);

describe("SettingsFormatProvider", () => {
  it("formats by a project's settings inside the project's provider and not outside it", () => {
    const projectSettings = effectiveSettings(
      { "formats.weekStart": "monday" },
      "v2"
    );

    render(
      <SettingsProvider initial={DEFAULT_EFFECTIVE_SETTINGS} userId="u1">
        <SettingsFormatProvider prefs={DEFAULT_FORMAT_PREFS} zone={"UTC"}>
          <Probe id="outside" />
          <SettingsProvider initial={projectSettings} projectId={7}>
            <SettingsFormatProvider
              prefs={formatPrefsFrom(projectSettings.values)}
              zone={"UTC"}
            >
              <Probe id="inside" />
            </SettingsFormatProvider>
          </SettingsProvider>
        </SettingsFormatProvider>
      </SettingsProvider>
    );

    expect(screen.getByTestId("outside").textContent).toBe("0");
    expect(screen.getByTestId("inside").textContent).toBe("1");
  });

  it("moves with the project's store, not with the prefs it was first handed", () => {
    const page = (settings: typeof DEFAULT_EFFECTIVE_SETTINGS) => (
      <SettingsProvider initial={DEFAULT_EFFECTIVE_SETTINGS} userId="u1">
        <SettingsFormatProvider prefs={DEFAULT_FORMAT_PREFS} zone={"UTC"}>
          <Probe id="outside" />
          <SettingsProvider initial={settings} projectId={7}>
            <SettingsFormatProvider prefs={DEFAULT_FORMAT_PREFS} zone={"UTC"}>
              <Probe id="inside" />
            </SettingsFormatProvider>
          </SettingsProvider>
        </SettingsFormatProvider>
      </SettingsProvider>
    );

    const { rerender } = render(
      page(effectiveSettings({ "formats.weekStart": "sunday" }, "v2"))
    );
    expect(screen.getByTestId("inside").textContent).toBe("0");

    rerender(page(effectiveSettings({ "formats.weekStart": "monday" }, "v3")));
    expect(screen.getByTestId("inside").textContent).toBe("1");
    expect(screen.getByTestId("outside").textContent).toBe("0");
  });
});
