"use client";

import { DeepLinkFallbackDialog } from "@/components/deep-link/DeepLinkFallbackDialog";
import { useDeepLink } from "@/components/deep-link/use-deep-link";
import { createContext, type ReactNode, use } from "react";

type OpenDeepLinkFn = (href: string) => void;

const DeepLinkContext = createContext<OpenDeepLinkFn | null>(null);

const fallbackOpenDeepLink: OpenDeepLinkFn = (href) => {
  window.location.href = href;
};

/**
 * Mounts the desktop-app deep-link fallback dialog once for the signed-in shell
 * and shares one `open` function through context, so table rows and log items
 * never mount a dialog instance per row.
 */
export function DeepLinkProvider({ children }: { children: ReactNode }) {
  const { open, fallbackOpen, setFallbackOpen } = useDeepLink();

  return (
    <DeepLinkContext value={open}>
      {children}
      <DeepLinkFallbackDialog
        open={fallbackOpen}
        onOpenChange={setFallbackOpen}
      />
    </DeepLinkContext>
  );
}

/**
 * Opens a `projammr://` link through the app-level `DeepLinkProvider`, showing
 * the single shared fallback dialog if no desktop handler answers.
 */
export function useOpenDeepLink(): OpenDeepLinkFn {
  return use(DeepLinkContext) ?? fallbackOpenDeepLink;
}
