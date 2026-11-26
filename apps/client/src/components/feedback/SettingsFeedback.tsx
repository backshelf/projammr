"use client";

import { useTheme } from "@/components/theme/AppThemeProvider";
import { secondsToMs } from "@/lib/policies/from-settings";
import { useSetting } from "@/lib/settings/provider";
import { HapticsProvider } from "@workspace/ui/components/haptics";
import { Toaster } from "@workspace/ui/components/sonner";
import type { ReactNode } from "react";

/**
 * The root layout's haptics and toasts in the viewer's feedback settings.
 * They sit above the signed-in shell's `PoliciesProvider`, so they read the
 * settings themselves, signed in and signed out alike.
 */
export function SettingsHapticsProvider({ children }: { children: ReactNode }) {
  return (
    <HapticsProvider enabled={useSetting("feedback.haptics")}>
      {children}
    </HapticsProvider>
  );
}

export function SettingsToaster() {
  return (
    <Toaster
      theme={useTheme().resolvedTheme}
      duration={secondsToMs(useSetting("feedback.toastDuration"))}
      position={useSetting("feedback.toastPosition")}
    />
  );
}
