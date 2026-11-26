import { PAPER_DARK, PAPER_LIGHT } from "@workspace/ui/lib/brand-colours";
import {
  SettingsHapticsProvider,
  SettingsToaster,
} from "@/components/feedback/SettingsFeedback";
import { SettingsFormatProvider } from "@/components/format/SettingsFormatProvider";
import { ZoneCookie } from "@/components/format/ZoneCookie";
import { OfflineBanner } from "@/components/pwa/OfflineBanner";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { AppThemeProvider } from "@/components/theme/AppThemeProvider";
import { cachedBrand } from "@/lib/brand";
import { BrandProvider } from "@/lib/brand-context";
import { DEFAULT_BRAND } from "@/lib/brand-defaults";
import { viewerFormat } from "@/lib/formatters";
import { getCachedSession, isSignedOut, sessionUser } from "@/lib/session";
import { SettingsProvider } from "@/lib/settings/provider";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import {
  explicitTheme,
  SIGNED_OUT_ATTRIBUTE,
  THEME_SCRIPT,
} from "@/lib/theme/script";
import { documentAttributes, documentProperties } from "@workspace/settings";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@workspace/ui/styles/globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await cachedBrand();
  return {
    title: {
      default: brand.name,
      template: `%s · ${brand.name}`,
    },
    description:
      "Project management for music — track your projects, collections, tracks, and sessions.",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      // `black-translucent` would let the room run under the status bar, but
      // together with `viewportFit: "cover"` it trips WebKit bug 301108: an
      // installed app then reports its viewport one status bar short, so every
      // `dvh` height and every `bottom: 0` box stops above the screen edge.
      // Check that bug before changing this.
      statusBarStyle: "default",
      title: brand.name,
    },
  };
}

/**
 * `viewportFit: "cover"` lets the page reach under a phone's rounded corners
 * and home indicator, which is also what gives `env(safe-area-inset-*)` a real
 * value for the dock reservation to add on. Zoom stays enabled: pinching out of
 * a dense table is the only way to read one on a small screen.
 *
 * `interactiveWidget: "resizes-content"` makes Android Chrome shrink the
 * layout viewport for the soft keyboard, so `h-dvh` shrinks with it and the
 * fixed dock lands above the keyboard instead of behind it. iOS ignores the
 * hint and only shrinks the visual viewport, which `useKeyboardInset`
 * (`@workspace/ui/hooks/use-keyboard-inset`) covers instead.
 *
 * The browser chrome matches `--paper` in each theme by default; an instance
 * that has set its own theme colour gets that colour in both themes instead.
 */
export async function generateViewport(): Promise<Viewport> {
  const brand = await cachedBrand();
  const themeColor =
    brand.themeColour === DEFAULT_BRAND.themeColour
      ? [
          { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT },
          { media: "(prefers-color-scheme: dark)", color: PAPER_DARK },
        ]
      : [
          {
            media: "(prefers-color-scheme: light)",
            color: brand.themeColour,
          },
          { media: "(prefers-color-scheme: dark)", color: brand.themeColour },
        ];
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor,
  };
}

const fontDisplay = localFont({
  src: "../../public/fonts/Redaction35.woff2",
  variable: "--font-heading",
  weight: "400",
  display: "swap",
});

const fontDisplayClean = localFont({
  src: "../../public/fonts/Redaction.woff2",
  variable: "--font-display-clean",
  weight: "400",
  display: "swap",
});

const fontSub = localFont({
  src: "../../public/fonts/DepartureMono-Regular.woff2",
  variable: "--font-sub",
  weight: "400",
  display: "swap",
});

const fontMono = localFont({
  src: [
    { path: "../../public/fonts/SplineSansMono.woff2", weight: "400" },
    { path: "../../public/fonts/SplineSansMono-500.woff2", weight: "500" },
    { path: "../../public/fonts/SplineSansMono-600.woff2", weight: "600" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [session, format, settings, brand] = await Promise.all([
    getCachedSession(),
    viewerFormat(),
    cachedEffectiveSettings(),
    cachedBrand(),
  ]);
  const isAuthed = !isSignedOut(session);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      // The settings that mirror onto `<html>` paint with the first byte.
      {...documentAttributes(settings.values)}
      {...(!isAuthed && { [SIGNED_OUT_ATTRIBUTE]: "" })}
      style={documentProperties(settings.values)}
      className={cn(
        "antialiased",
        "font-mono",
        fontMono.variable,
        fontSub.variable,
        fontDisplay.variable,
        fontDisplayClean.variable,
        explicitTheme(settings.values["appearance.theme"])
      )}
    >
      <head>
        {/* A `system` theme's class comes from the browser, before paint. */}
        {/* eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml -- a constant, allowed by its hash in the content security policy */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* The body owns the shell's height: a `<main>` fills whatever is left
          under anything rendered in flow above it, such as the offline
          banner, rather than claiming the whole viewport for itself. */}
      <body className={"flex h-dvh flex-col"}>
        {/* Signed in, the caller's own settings; signed out, the instance's
            public ones. */}
        <SettingsProvider
          initial={settings}
          userId={isAuthed ? (sessionUser(session)?.id ?? null) : null}
        >
          <BrandProvider brand={brand}>
            {/* The signed-in shell mounts a hotkey registry, which owns `d`
              along with every other binding; the signed-out one has none, so
              the provider keeps its own listener there. */}
            <AppThemeProvider bindThemeHotkey={!isAuthed}>
              <MotionProvider>
                <TooltipProvider>
                  <SettingsHapticsProvider>
                    <SettingsFormatProvider
                      prefs={format.prefs}
                      zone={format.zone}
                    >
                      <SettingsToaster />
                      <ServiceWorkerRegistration />
                      <ZoneCookie />
                      <OfflineBanner />
                      {children}
                    </SettingsFormatProvider>
                  </SettingsHapticsProvider>
                </TooltipProvider>
              </MotionProvider>
            </AppThemeProvider>
          </BrandProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
