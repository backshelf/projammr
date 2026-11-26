import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const PATCH = mock(async () => ({
  data: {},
  response: new Response(null, { status: 200 }),
}));
mock.module("@/lib/browser-api", () => ({ browserApi: { PATCH } }));

const { DEFAULT_POLICIES } = await import("./policies");
type Policies = import("./policies").Policies;
const {
  PoliciesProvider,
  useFeedbackPolicy,
  useLabPolicy,
  usePlaybackPolicy,
  useShellPolicy,
  useVisualsPolicy,
} = await import("./provider");
const { SettingsProvider, useUserSettingsWrite } =
  await import("@/lib/settings/provider");
const { DEFAULT_EFFECTIVE_SETTINGS, effectiveSettings } =
  await import("@/lib/settings/effective");
const { policiesFrom } = await import("./from-settings");

const useAll = () => ({
  playback: usePlaybackPolicy(),
  lab: useLabPolicy(),
  visuals: useVisualsPolicy(),
  shell: useShellPolicy(),
  feedback: useFeedbackPolicy(),
});

describe("PoliciesProvider", () => {
  it("reads every policy's defaults with no provider above", () => {
    const { result } = renderHook(useAll);

    expect(result.current).toEqual(DEFAULT_POLICIES);
  });

  it("hands each hook its own policy from the one value provided", () => {
    const policies: Policies = {
      playback: { ...DEFAULT_POLICIES.playback, crossfadeSeconds: 4 },
      lab: { ...DEFAULT_POLICIES.lab, releaseDelayMs: 500 },
      visuals: { ...DEFAULT_POLICIES.visuals, lavaField: false },
      shell: { ...DEFAULT_POLICIES.shell, recentItems: 8 },
      feedback: { ...DEFAULT_POLICIES.feedback, haptics: false },
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PoliciesProvider policies={policies}>{children}</PoliciesProvider>
    );

    const { result } = renderHook(useAll, { wrapper });

    expect(result.current.playback).toBe(policies.playback);
    expect(result.current.lab).toBe(policies.lab);
    expect(result.current.visuals).toBe(policies.visuals);
    expect(result.current.shell).toBe(policies.shell);
    expect(result.current.feedback).toBe(policies.feedback);
  });

  describe("under the settings", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("follows a setting written after the first render, without waiting on the server", () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SettingsProvider initial={DEFAULT_EFFECTIVE_SETTINGS} userId="u1">
          <PoliciesProvider policies={DEFAULT_POLICIES}>
            {children}
          </PoliciesProvider>
        </SettingsProvider>
      );
      const { result } = renderHook(
        () => ({ ...useAll(), write: useUserSettingsWrite() }),
        { wrapper }
      );
      expect(result.current.feedback).toBe(DEFAULT_POLICIES.feedback);

      act(() => {
        void result.current.write({
          "feedback.undoWindow": 9,
          "playback.crossfade": 2,
        });
      });

      expect(result.current.feedback.undoWindowMs).toBe(9000);
      expect(result.current.playback.crossfadeSeconds).toBe(2);
      expect(PATCH).not.toHaveBeenCalled();
    });

    it("follows a project's settings inside the project's provider and not outside it", () => {
      const projectSettings = effectiveSettings(
        { "lab.normaliseTarget": -9 },
        "v2"
      );
      const projectPolicies = policiesFrom(projectSettings.values);
      const Probe = ({ id }: { id: string }) => (
        <output data-testid={id}>{useLabPolicy().normaliseTargetLufs}</output>
      );

      render(
        <SettingsProvider initial={DEFAULT_EFFECTIVE_SETTINGS} userId="u1">
          <PoliciesProvider policies={DEFAULT_POLICIES}>
            <Probe id="outside" />
            <SettingsProvider initial={projectSettings} projectId={7}>
              <PoliciesProvider policies={projectPolicies}>
                <Probe id="inside" />
              </PoliciesProvider>
            </SettingsProvider>
          </PoliciesProvider>
        </SettingsProvider>
      );

      expect(screen.getByTestId("outside").textContent).toBe("-14");
      expect(screen.getByTestId("inside").textContent).toBe("-9");
    });
  });
});
