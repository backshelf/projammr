import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, jest, mock } from "bun:test";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";
import type { ReactNode } from "react";

const PATCH = mock(async () => ({
  data: {},
  response: new Response(null, { status: 200 }),
}));
mock.module("@/lib/browser-api", () => ({ browserApi: { PATCH } }));

const { useSelectedStrips } = await import("./use-selected-strips");
const { policiesFrom } = await import("@/lib/policies/from-settings");
const { PoliciesProvider } = await import("@/lib/policies/provider");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");

afterEach(() => jest.useRealTimers());

describe("useSelectedStrips", () => {
  it("shows the setting's known strips and saves a toggle to it", async () => {
    jest.useFakeTimers();
    const initial = effectiveSettings(
      { "visuals.strips": ["loudness", "pitch", "change"] },
      "v1"
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SettingsProvider initial={initial} userId="u1">
        <PoliciesProvider policies={policiesFrom(initial.values)}>
          {children}
        </PoliciesProvider>
      </SettingsProvider>
    );
    const { result } = renderHook(useSelectedStrips, { wrapper });

    act(() => result.current[1]("spectrogram"));
    act(() => result.current[1]("loudness"));

    expect(result.current[0]).toEqual(["change", "spectrogram"]);
    await act(async () => {
      await advanceTimersByTimeAsync(300);
    });
    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(PATCH.mock.calls[0]).toMatchObject([
      "/api/settings/{scope}/{id}",
      {
        params: { path: { scope: "user", id: "u1" } },
        body: { "visuals.strips": ["change", "spectrogram"] },
      },
    ]);
  });
});
