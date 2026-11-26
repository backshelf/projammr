"use client";

import { formatPrefsFrom } from "@/lib/policies/from-settings";
import { useSettingsDerived } from "@/lib/settings/provider";
import { FormatProvider } from "@workspace/ui/components/format-provider";
import type { FormatPrefs } from "@workspace/ui/lib/formatters";
import type { ReactNode } from "react";

/**
 * `FormatProvider` in the viewer's format settings: `prefs` and `zone` are the
 * server's (`viewerFormat()`), and a format setting written since moves every
 * formatted value with it.
 */
export function SettingsFormatProvider({
  prefs,
  zone,
  children,
}: {
  prefs: FormatPrefs;
  zone: string;
  children: ReactNode;
}) {
  return (
    <FormatProvider
      prefs={useSettingsDerived(prefs, formatPrefsFrom)}
      zone={zone}
    >
      {children}
    </FormatProvider>
  );
}
