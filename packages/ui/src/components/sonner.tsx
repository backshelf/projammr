"use client";

import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader,
} from "@tabler/icons-react";
import { useHaptics } from "@workspace/ui/components/haptics";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { Toaster as Sonner, useSonner, type ToasterProps } from "sonner";

/** Only a toast that carries a verdict buzzes — an `info` or `loading` toast
 *  is narration, and narration that buzzes is noise. */
const OUTCOMES = new Set(["success", "warning", "error"]);

/**
 * Rings each toast once as it arrives. Sonner has no "toast shown" callback,
 * so the live list is watched instead and the ids already rung are remembered
 * — a re-render of the same toast must not buzz again. Ids leave the set when
 * their toast does, so it stays the size of what is on screen.
 */
function ToastHaptics() {
  const { toasts } = useSonner();
  const haptic = useHaptics();
  const rungRef = useRef(new Set<string | number>());

  useEffect(() => {
    const live = new Set(toasts.map((toast) => toast.id));

    for (const toast of toasts) {
      if (rungRef.current.has(toast.id)) continue;
      rungRef.current.add(toast.id);
      if (OUTCOMES.has(String(toast.type))) haptic();
    }

    for (const id of rungRef.current) {
      if (!live.has(id)) rungRef.current.delete(id);
    }
  }, [toasts, haptic]);

  return null;
}

/**
 * `theme` is for an app that keeps its theme outside next-themes; without
 * one the toasts follow next-themes' theme.
 */
const Toaster = ({ theme, ...props }: ToasterProps) => {
  const { theme: nextTheme = "system" } = useTheme();

  return (
    <>
      <ToastHaptics />
      <Sonner
        theme={theme ?? (nextTheme as ToasterProps["theme"])}
        className="toaster group"
        // A toast sits above whatever is docked to the bottom edge. --dock is
        // 0px wherever there is none, so one expression covers every width;
        // mobileOffset is sonner's own sub-600px inset, tightened to match.
        offset={{ bottom: "calc(var(--dock) + 2rem)" }}
        mobileOffset={{ bottom: "calc(var(--dock) + 1rem)" }}
        icons={{
          success: <IconCircleCheck className="size-4" />,
          info: <IconInfoCircle className="size-4" />,
          warning: <IconAlertTriangle className="size-4" />,
          error: <IconAlertOctagon className="size-4" />,
          loading: <IconLoader className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "cn-toast",
          },
        }}
        {...props}
      />
    </>
  );
};

export { Toaster };
