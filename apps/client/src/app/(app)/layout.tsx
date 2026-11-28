import { ClientCommandBar } from "@/components/command-bar/ClientCommandBar";
import { CommandPaletteMount } from "@/components/command-palette/CommandPaletteMount";
import { CommandPaletteRecents } from "@/components/command-palette/CommandPaletteRecents";
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-context";
import { CopyTextProvider } from "@/components/copy-text/CopyTextProvider";
import { DeepLinkProvider } from "@/components/deep-link/DeepLinkProvider";
import { CommandProvider } from "@/components/commands/provider";
import { Dock } from "@/components/dock/Dock";
import { JobsProvider } from "@/components/jobs/JobsProvider";
import { ShortcutsOverlay } from "@/components/hotkeys/ShortcutsOverlay";
import { MusicPlayer } from "@/components/music-player/MusicPlayer";
import { MusicPlayerProvider } from "@/components/music-player/MusicPlayerProvider";
import { playerInitial } from "@/components/music-player/player-initial";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { AppSidebarProvider } from "@/components/sidebar/AppSidebarProvider";
import { PoliciesProvider } from "@/lib/policies/provider";
import { cachedPolicies } from "@/lib/policies/server";
import { getCachedSession, isSignedOut } from "@/lib/session";
import { cookies } from "next/headers";
import { Suspense } from "react";

/**
 * The signed-in shell: sidebar, player, dock and the command registry and
 * palette they need. A signed-out reader — or a guest holding nothing but an
 * anonymous session — gets the bare canvas instead, which is all the sign-in
 * and invite pages want.
 *
 * Routes that are standalone for everyone, `/share/:token` among them, sit
 * outside this group and never mount any of it.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCachedSession();
  const isAuthed = !isSignedOut(session);
  const cookieStore = await cookies();

  if (!isAuthed) {
    return (
      <main
        id={"main-content"}
        tabIndex={-1}
        className={
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus:outline-hidden"
        }
      >
        <div className={"min-h-0 flex-1 overflow-hidden"}>{children}</div>
      </main>
    );
  }

  const policies = await cachedPolicies();

  return (
    <CopyTextProvider>
      <DeepLinkProvider>
        <PoliciesProvider policies={policies}>
          <MusicPlayerProvider initial={playerInitial(policies)}>
            <JobsProvider>
              <CommandPaletteProvider>
                <AppSidebarProvider
                  defaultOpen={
                    cookieStore.get("sidebar_state")?.value !== "false"
                  }
                  // The wrapper is the body's flex item; its own `min-h-svh`
                  // would overrun the body when something sits above it.
                  className={"min-h-0 flex-1"}
                >
                  <CommandProvider>
                    <a
                      href={"#main-content"}
                      className={
                        "sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-rule-strong focus:bg-paper focus:px-3 focus:py-2 focus:text-small focus:text-ink focus:shadow-overlay focus:ring-2 focus:ring-art focus:outline-hidden"
                      }
                    >
                      Skip to content
                    </a>
                    <ShortcutsOverlay />
                    <AppSidebar />
                    <MusicPlayer />
                    <Dock
                      currentProjectId={
                        Number(cookieStore.get("currentProject")?.value) || null
                      }
                    />
                    <Suspense fallback={<CommandPaletteMount />}>
                      <CommandPaletteRecents />
                    </Suspense>
                    <main
                      id={"main-content"}
                      tabIndex={-1}
                      className={
                        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus:outline-hidden"
                      }
                    >
                      <ClientCommandBar edge="top" />
                      <div className={"min-h-0 flex-1 overflow-hidden"}>
                        {children}
                      </div>
                      <ClientCommandBar edge="bottom" />
                    </main>
                  </CommandProvider>
                </AppSidebarProvider>
              </CommandPaletteProvider>
            </JobsProvider>
          </MusicPlayerProvider>
        </PoliciesProvider>
      </DeepLinkProvider>
    </CopyTextProvider>
  );
}
